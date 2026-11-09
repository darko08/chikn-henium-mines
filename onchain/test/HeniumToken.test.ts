import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HeniumToken } from "../typechain-types";

const E18 = 10n ** 18n;
const CAP = 21_000_000n * E18;

describe("HeniumToken", () => {
  async function fixture() {
    const [admin, minter, alice, bob, spender] = await ethers.getSigners();
    const token = (await ethers.deployContract("HeniumToken", [admin.address])) as unknown as HeniumToken;
    await token.grantRole(await token.MINTER_ROLE(), minter.address);
    return { token, admin, minter, alice, bob, spender };
  }

  type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];
  /** `signer` signs a permit that claims `owner` as the owner (they differ only in the forgery test). */
  async function signPermit(token: HeniumToken, signer: Signer, owner: string, spender: string, value: bigint, deadline: bigint) {
    const { chainId } = await ethers.provider.getNetwork();
    const domain = { name: "Henium", version: "1", chainId, verifyingContract: await token.getAddress() };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const nonce = await token.nonces(owner);
    return ethers.Signature.from(await signer.signTypedData(domain, types, { owner, spender, value, nonce, deadline }));
  }

  describe("metadata", () => {
    it("is Henium / HENIUM with 18 decimals and a 21M cap", async () => {
      const { token } = await loadFixture(fixture);
      expect(await token.name()).to.equal("Henium");
      expect(await token.symbol()).to.equal("HENIUM");
      expect(await token.decimals()).to.equal(18);
      expect(await token.cap()).to.equal(CAP);
      expect(await token.MAX_SUPPLY()).to.equal(CAP);
      expect(await token.totalSupply()).to.equal(0n);
    });

    it("has no pause, blacklist, fee or other admin power over balances", async () => {
      const { token } = await loadFixture(fixture);
      const names: string[] = [];
      token.interface.forEachFunction((f) => names.push(f.name));
      for (const forbidden of ["pause", "unpause", "blacklist", "freeze", "setFee", "forceTransfer", "adminBurn", "rescue"]) {
        expect(names).to.not.include(forbidden);
      }
      // the only privileged functions are AccessControl's role management and the minter's mint
      expect(names).to.include.members(["mint", "burn", "burnFrom", "permit", "grantRole", "revokeRole", "renounceRole"]);
    });

    it("rejects a zero admin", async () => {
      const factory = await ethers.getContractFactory("HeniumToken");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAdmin");
    });
  });

  describe("roles", () => {
    it("gives the deployer-chosen admin DEFAULT_ADMIN_ROLE and no minter by default", async () => {
      const { token, admin } = await loadFixture(fixture);
      expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await token.hasRole(await token.MINTER_ROLE(), admin.address)).to.equal(false);
      expect(await token.supportsInterface("0x7965db0b")).to.equal(true); // IAccessControl
    });

    it("only MINTER_ROLE can mint", async () => {
      const { token, admin, alice } = await loadFixture(fixture);
      await expect(token.connect(alice).mint(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, await token.MINTER_ROLE());
      await expect(token.connect(admin).mint(alice.address, 1n)).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("only the admin manages MINTER_ROLE; revoking stops minting", async () => {
      const { token, minter, alice } = await loadFixture(fixture);
      const role = await token.MINTER_ROLE();
      await expect(token.connect(alice).grantRole(role, alice.address)).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
      await token.revokeRole(role, minter.address);
      await expect(token.connect(minter).mint(alice.address, 1n)).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("renouncing the admin freezes the minter set forever", async () => {
      const { token, admin, minter, alice } = await loadFixture(fixture);
      const role = await token.MINTER_ROLE();
      await token.renounceRole(await token.DEFAULT_ADMIN_ROLE(), admin.address);
      await expect(token.grantRole(role, alice.address)).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
      await expect(token.revokeRole(role, minter.address)).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
      await token.connect(minter).mint(alice.address, 5n); // the existing minter keeps working
      expect(await token.balanceOf(alice.address)).to.equal(5n);
    });
  });

  describe("cap", () => {
    it("mints up to exactly 21M and not one wei more", async () => {
      const { token, minter, alice } = await loadFixture(fixture);
      await token.connect(minter).mint(alice.address, CAP - 1n);
      await token.connect(minter).mint(alice.address, 1n);
      expect(await token.totalSupply()).to.equal(CAP);
      await expect(token.connect(minter).mint(alice.address, 1n))
        .to.be.revertedWithCustomError(token, "ERC20ExceededCap")
        .withArgs(CAP + 1n, CAP);
    });

    it("bounds totalSupply: after a burn the token itself would allow re-minting (the emission never does)", async () => {
      const { token, minter, alice } = await loadFixture(fixture);
      await token.connect(minter).mint(alice.address, CAP);
      await token.connect(alice).burn(10n * E18);
      expect(await token.totalSupply()).to.equal(CAP - 10n * E18);
      // ERC20Capped semantics: headroom reappears on the token. HeniumEmission keeps its own lifetime counter
      // (totalIssued) so burned HENIUM is never re-issued; see HeniumEmission tests.
      await token.connect(minter).mint(alice.address, 10n * E18);
      await expect(token.connect(minter).mint(alice.address, 1n)).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
    });
  });

  describe("burn", () => {
    it("burn lowers balance and totalSupply", async () => {
      const { token, minter, alice } = await loadFixture(fixture);
      await token.connect(minter).mint(alice.address, 100n * E18);
      await expect(token.connect(alice).burn(40n * E18))
        .to.emit(token, "Transfer")
        .withArgs(alice.address, ethers.ZeroAddress, 40n * E18);
      expect(await token.balanceOf(alice.address)).to.equal(60n * E18);
      expect(await token.totalSupply()).to.equal(60n * E18);
    });

    it("burnFrom needs and spends an allowance", async () => {
      const { token, minter, alice, spender } = await loadFixture(fixture);
      await token.connect(minter).mint(alice.address, 100n * E18);
      await expect(token.connect(spender).burnFrom(alice.address, 1n)).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
      await token.connect(alice).approve(spender.address, 30n * E18);
      await token.connect(spender).burnFrom(alice.address, 30n * E18);
      expect(await token.allowance(alice.address, spender.address)).to.equal(0n);
      expect(await token.totalSupply()).to.equal(70n * E18);
    });

    it("cannot burn more than the balance", async () => {
      const { token, minter, alice } = await loadFixture(fixture);
      await token.connect(minter).mint(alice.address, 1n);
      await expect(token.connect(alice).burn(2n)).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });
  });

  describe("permit (EIP-2612)", () => {
    it("sets an allowance from a signature and bumps the nonce", async () => {
      const { token, alice, spender } = await loadFixture(fixture);
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(token, alice, alice.address, spender.address, 123n, deadline);
      await token.connect(spender).permit(alice.address, spender.address, 123n, deadline, sig.v, sig.r, sig.s);
      expect(await token.allowance(alice.address, spender.address)).to.equal(123n);
      expect(await token.nonces(alice.address)).to.equal(1n);
      // replay fails: the nonce moved on, so the signature recovers to another address
      await expect(token.permit(alice.address, spender.address, 123n, deadline, sig.v, sig.r, sig.s)).to.be.revertedWithCustomError(
        token,
        "ERC2612InvalidSigner",
      );
    });

    it("rejects an expired permit and a permit signed by someone else", async () => {
      const { token, alice, bob, spender } = await loadFixture(fixture);
      const past = BigInt(await time.latest()) - 1n;
      const expired = await signPermit(token, alice, alice.address, spender.address, 1n, past);
      await expect(token.permit(alice.address, spender.address, 1n, past, expired.v, expired.r, expired.s))
        .to.be.revertedWithCustomError(token, "ERC2612ExpiredSignature")
        .withArgs(past);
      const deadline = past + 3600n;
      const forged = await signPermit(token, bob, alice.address, spender.address, 1n, deadline);
      await expect(token.permit(alice.address, spender.address, 1n, deadline, forged.v, forged.r, forged.s))
        .to.be.revertedWithCustomError(token, "ERC2612InvalidSigner")
        .withArgs(bob.address, alice.address);
    });

    it("exposes its EIP-712 domain", async () => {
      const { token } = await loadFixture(fixture);
      const d = await token.eip712Domain();
      expect(d.name).to.equal("Henium");
      expect(d.version).to.equal("1");
      expect(d.verifyingContract).to.equal(await token.getAddress());
    });
  });
});
