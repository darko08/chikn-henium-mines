import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import hre, { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { RESOURCES, deployAll } from "../scripts/lib/deploy-all";
import { ABI_CONTRACTS, exportAbis, writeDeployment } from "../scripts/lib/output";
import { Category, DOMAIN_NAMES, domainFor, signClaim, signRelease, signWithdrawal } from "../scripts/lib/vouchers";

const E18 = 10n ** 18n;

describe("Deployment script + end-to-end game flow", () => {
  async function deployed() {
    const stack = await deployAll(hre, { genesisAmount: 100_000n * E18, seedPools: true, smokeSwap: true });
    return stack;
  }

  describe("deployAll", () => {
    it("wires every role, registers the 13 resources and seeds the three pools at the game's prices", async () => {
      const s = await loadFixture(deployed);
      const [deployer] = await ethers.getSigners();
      const me = deployer.address;
      expect(await s.token.hasRole(await s.token.MINTER_ROLE(), await s.emission.getAddress())).to.equal(true);
      expect(await s.token.hasRole(await s.token.MINTER_ROLE(), me)).to.equal(false);
      for (const c of [s.emission, s.vault, s.bridge]) {
        expect(await c.hasRole(await c.SIGNER_ROLE(), me)).to.equal(true);
        expect(await c.hasRole(await c.PAUSER_ROLE(), me)).to.equal(true);
      }
      expect(await s.vault.hasRole(await s.vault.BURNER_ROLE(), me)).to.equal(true);
      expect(await s.emission.genesisMinted()).to.equal(true);

      expect((await s.bridge.registeredTokens()).length).to.equal(13);
      for (const r of RESOURCES) {
        const t = s.resources[r.id];
        expect(await t.bridge()).to.equal(await s.bridge.getAddress());
        expect(await t.symbol()).to.equal(r.symbol);
        expect(s.record.resources[r.id].address).to.equal(await t.getAddress());
      }

      // seeded prices (before the smoke swap moved them a little): HENIUM 0.0004 ETH, EGG 0.25 HENIUM, Stone 0.00004 HENIUM
      const price = async (label: string, base: string) => {
        const p = s.pairs[label];
        const [r0, r1] = await p.getReserves();
        return (await p.token0()) === base ? Number(r1) / Number(r0) : Number(r0) / Number(r1);
      };
      expect(await price("HENIUM/WETH", await s.token.getAddress())).to.be.closeTo(0.0004, 0.0004 * 0.01);
      expect(await price("mEGG/HENIUM", await s.egg.getAddress())).to.be.closeTo(0.25, 1e-12);
      expect(await price("STONE/HENIUM", await s.resources.stone.getAddress())).to.be.closeTo(0.00004, 0.00004 * 0.01);

      expect(s.record.smokeSwap!.receivedEth).to.equal(s.record.smokeSwap!.quotedOut);
      expect(Number(s.record.smokeSwap!.heniumBurned)).to.be.greaterThan(0);
      expect(Number(s.record.smokeSwap!.stoneBurned)).to.equal(100); // 0.10% of 100,000 Stone
      expect(s.record.chainId).to.equal("31337");
      expect(s.record.eip712.HeniumEmission.name).to.equal(DOMAIN_NAMES.emission);
      expect(Object.keys(s.record.pools)).to.deep.equal(["HENIUM/WETH", "mEGG/HENIUM", "STONE/HENIUM"]);
    });

    it("hands admin over to a multisig, uses a separate server key and can freeze the minter set", async () => {
      const [deployer, multisig, server, guardian, burner] = await ethers.getSigners();
      const s = await deployAll(hre, {
        admin: multisig.address,
        signer: server.address,
        pauser: guardian.address,
        burner: burner.address,
        treasury: deployer.address,
        genesisAmount: 20_000n * E18,
        renounceTokenAdmin: true,
        seedScaleMilli: 100n, // 10% of the default seed
      });
      const ADMIN = ethers.ZeroHash;
      expect(await s.token.hasRole(ADMIN, deployer.address)).to.equal(false);
      expect(await s.token.hasRole(ADMIN, multisig.address)).to.equal(false); // frozen: nobody can add a minter
      for (const c of [s.emission, s.vault, s.bridge]) {
        expect(await c.hasRole(ADMIN, multisig.address)).to.equal(true);
        expect(await c.hasRole(ADMIN, deployer.address)).to.equal(false);
        expect(await c.hasRole(await c.SIGNER_ROLE(), server.address)).to.equal(true);
        expect(await c.hasRole(await c.SIGNER_ROLE(), deployer.address)).to.equal(false); // temporary seeding grant revoked
        expect(await c.hasRole(await c.PAUSER_ROLE(), guardian.address)).to.equal(true);
      }
      expect(await s.vault.hasRole(await s.vault.BURNER_ROLE(), burner.address)).to.equal(true);
      const [r0, r1] = await s.pairs["STONE/HENIUM"].getReserves();
      expect(r0 + r1).to.be.greaterThan(0n);
    });

    it("reuses existing WETH / EGG tokens and refuses to seed without HENIUM", async () => {
      const weth = await ethers.deployContract("WETH9");
      const egg = await ethers.deployContract("MockERC20", ["Existing", "EX", 18]);
      const s = await deployAll(hre, { weth: await weth.getAddress(), egg: await egg.getAddress(), seedPools: false });
      expect(s.record.contracts.WETH).to.equal(await weth.getAddress());
      expect(s.record.contracts.EGG).to.equal(await egg.getAddress());
      expect(s.record.pools["HENIUM/WETH"].reserve0).to.equal("0");
      await expect(deployAll(hre, { genesisAmount: 0n, seedPools: true })).to.be.rejectedWith(/Seeding needs/);
      // with an existing EGG the deployer must already hold it
      const [deployer] = await ethers.getSigners();
      await egg.mint(deployer.address, 10_000n * E18);
      const s2 = await deployAll(hre, { egg: await egg.getAddress(), genesisAmount: 20_000n * E18, seedScaleMilli: 1000n });
      const [e0, e1] = await s2.pairs["mEGG/HENIUM"].getReserves();
      expect(e0 + e1).to.equal(12_500n * E18);
    });

    it("writes deployments/<network>.json and exports the ABIs", async () => {
      const s = await loadFixture(deployed);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "henium-"));
      const file = writeDeployment(hre, s.record, path.join(dir, "deployments"));
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(path.basename(file)).to.equal("hardhat.json");
      expect(parsed.contracts.HeniumToken).to.equal(await s.token.getAddress());
      const abis = await exportAbis(hre, path.join(dir, "abi"));
      expect(abis.length).to.equal(ABI_CONTRACTS.length);
      const routerAbi = JSON.parse(fs.readFileSync(path.join(dir, "abi", "HeniumDexRouter.json"), "utf8"));
      expect(routerAbi.some((f: { name?: string }) => f.name === "swapExactTokensForETH")).to.equal(true);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("a player's journey", () => {
    it("earns HENIUM, moves it through the game vault, withdraws Stone, and sells it for ETH", async () => {
      const s = await loadFixture(deployed);
      const [server, player, relayer] = await ethers.getSigners(); // the deployer holds the server roles locally
      const { chainId } = await ethers.provider.getNetwork();
      const playerId = ethers.id("player:42");
      const deadline = BigInt(await time.latest()) + 3_600n;

      // 1. the player refined and fought today: the server signs two claims (a relayer pays the gas)
      const emissionDomain = await domainFor(s.emission, DOMAIN_NAMES.emission, chainId);
      for (const [category, amount, nonce] of [
        [Category.REFINERY, 300n * E18, 1n],
        [Category.WAR, 50n * E18, 2n],
      ] as const) {
        const v = { account: player.address, category, amount, nonce, deadline };
        await s.emission.connect(relayer).claim(v, await signClaim(server, emissionDomain, v));
      }
      expect(await s.token.balanceOf(player.address)).to.equal(350n * E18);

      // 2. the player puts 200 HENIUM into the game; spends 120 on deep digging (burned); takes 50 back out
      await s.token.connect(player).approve(await s.vault.getAddress(), 200n * E18);
      await s.vault.connect(player).deposit(200n * E18, playerId);
      const supplyBefore = await s.token.totalSupply();
      await s.vault.connect(server).burnSunk(120n * E18, ethers.id("dig:depth-23"));
      expect(await s.token.totalSupply()).to.equal(supplyBefore - 120n * E18);
      const vaultDomain = await domainFor(s.vault, DOMAIN_NAMES.vault, chainId);
      const rel = { account: player.address, amount: 50n * E18, nonce: 1n, deadline };
      await s.vault.connect(relayer).release(rel, await signRelease(server, vaultDomain, rel));
      expect(await s.token.balanceOf(player.address)).to.equal(200n * E18);
      expect(await s.vault.escrowBalance()).to.equal(30n * E18);

      // 3. the player withdraws 1,000,000 Stone from the game and sells half via STONE -> HENIUM -> ETH
      const stone = s.resources.stone;
      const bridgeDomain = await domainFor(s.bridge, DOMAIN_NAMES.bridge, chainId);
      const w = { account: player.address, token: await stone.getAddress(), amount: 1_000_000n * E18, nonce: 1n, deadline };
      await s.bridge.connect(relayer).withdraw(w, await signWithdrawal(server, bridgeDomain, w));
      await stone.connect(player).approve(await s.router.getAddress(), ethers.MaxUint256);
      const route = [await stone.getAddress(), await s.token.getAddress(), await s.weth.getAddress()];
      const quoted = await s.router.getAmountsOut(500_000n * E18, route);
      const ethBefore = await ethers.provider.getBalance(player.address);
      const receipt = await (await s.router.connect(player).swapExactTokensForETH(500_000n * E18, quoted[2], route, player.address, deadline)).wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      expect((await ethers.provider.getBalance(player.address)) + gas - ethBefore).to.equal(quoted[2]);

      // 4. ...and sells some HENIUM for ETH too
      await s.token.connect(player).approve(await s.router.getAddress(), ethers.MaxUint256);
      await s.router.connect(player).swapExactTokensForETH(10n * E18, 0n, [await s.token.getAddress(), await s.weth.getAddress()], player.address, deadline);

      // 5. the rest of the Stone goes back into the game (burned on chain, credited in game)
      await stone.connect(player).approve(await s.bridge.getAddress(), 500_000n * E18);
      await expect(s.bridge.connect(player).deposit(await stone.getAddress(), 500_000n * E18, playerId))
        .to.emit(s.bridge, "Deposited")
        .withArgs(player.address, await stone.getAddress(), playerId, 500_000n * E18);
      expect(await stone.balanceOf(player.address)).to.equal(0n);

      // supply accounting: HENIUM only ever came from genesis + claims, minus every burn
      const issued = await s.emission.totalIssued();
      expect(issued).to.equal(100_000n * E18 + 350n * E18);
      expect(await s.token.totalSupply()).to.be.lessThan(issued);
    });
  });
});
