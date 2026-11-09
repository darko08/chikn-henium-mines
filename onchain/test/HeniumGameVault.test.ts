import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HeniumGameVault, HeniumToken } from "../typechain-types";
import { DOMAIN_NAMES, RELEASE_TYPES, type ReleaseVoucher, domainFor, signRelease } from "../scripts/lib/vouchers";

const E18 = 10n ** 18n;
const FAR = 2n ** 64n;
const PLAYER = ethers.id("player:alice#1");
const DAY = 86_400n;

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

describe("HeniumGameVault", () => {
  async function fixture() {
    const [admin, signer, pauser, burner, alice, bob, relayer, mallory, minter] = await ethers.getSigners();
    const token = (await ethers.deployContract("HeniumToken", [admin.address])) as unknown as HeniumToken;
    await token.grantRole(await token.MINTER_ROLE(), minter.address);
    const vault = (await ethers.deployContract("HeniumGameVault", [await token.getAddress(), admin.address])) as unknown as HeniumGameVault;
    await vault.grantRole(await vault.SIGNER_ROLE(), signer.address);
    await vault.grantRole(await vault.PAUSER_ROLE(), pauser.address);
    await vault.grantRole(await vault.BURNER_ROLE(), burner.address);
    for (const s of [alice, bob]) {
      await token.connect(minter).mint(s.address, 1_000n * E18);
      await token.connect(s).approve(await vault.getAddress(), ethers.MaxUint256);
    }
    const { chainId } = await ethers.provider.getNetwork();
    const domain = await domainFor(vault, DOMAIN_NAMES.vault, chainId);
    return { token, vault, domain, chainId, admin, signer, pauser, burner, alice, bob, relayer, mallory, minter };
  }
  type Ctx = Awaited<ReturnType<typeof fixture>>;

  let nonceSeq = 1n;
  const release = (account: Signer, amount: bigint, extra: Partial<ReleaseVoucher> = {}): ReleaseVoucher => ({
    account: account.address,
    amount,
    nonce: nonceSeq++,
    deadline: FAR,
    ...extra,
  });
  async function releaseAs(ctx: Ctx, v: ReleaseVoucher, signer: Signer = ctx.signer, by: Signer = ctx.relayer) {
    return ctx.vault.connect(by).release(v, await signRelease(signer, ctx.domain, v));
  }

  it("rejects a zero token or admin at construction", async () => {
    const [admin] = await ethers.getSigners();
    const F = await ethers.getContractFactory("HeniumGameVault");
    await expect(F.deploy(ethers.ZeroAddress, admin.address)).to.be.revertedWithCustomError(F, "ZeroAddress");
    const token = await ethers.deployContract("HeniumToken", [admin.address]);
    await expect(F.deploy(await token.getAddress(), ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
  });

  describe("deposit", () => {
    it("moves HENIUM into escrow and emits the event the game server listens to", async () => {
      const ctx = await loadFixture(fixture);
      await expect(ctx.vault.connect(ctx.alice).deposit(250n * E18, PLAYER))
        .to.emit(ctx.vault, "Deposited")
        .withArgs(ctx.alice.address, PLAYER, 250n * E18)
        .and.to.emit(ctx.token, "Transfer")
        .withArgs(ctx.alice.address, await ctx.vault.getAddress(), 250n * E18);
      expect(await ctx.vault.escrowBalance()).to.equal(250n * E18);
      expect(await ctx.token.balanceOf(ctx.alice.address)).to.equal(750n * E18);
      expect(await ctx.vault.totalDeposited()).to.equal(250n * E18);
    });

    it("rejects zero amounts, a zero player id and missing allowance", async () => {
      const ctx = await loadFixture(fixture);
      await expect(ctx.vault.connect(ctx.alice).deposit(0n, PLAYER)).to.be.revertedWithCustomError(ctx.vault, "ZeroAmount");
      await expect(ctx.vault.connect(ctx.alice).deposit(1n, ethers.ZeroHash)).to.be.revertedWithCustomError(ctx.vault, "ZeroPlayerId");
      await expect(ctx.vault.connect(ctx.mallory).deposit(1n, PLAYER)).to.be.revertedWithCustomError(ctx.token, "ERC20InsufficientAllowance");
    });

    it("depositWithPermit works without a prior approve, and survives a front-run permit", async () => {
      const ctx = await loadFixture(fixture);
      const owner = ctx.mallory; // has no allowance yet
      await ctx.token.connect(ctx.minter).mint(owner.address, 10n * E18);
      const deadline = BigInt(await time.latest()) + 3_600n;
      const permitDomain = { name: "Henium", version: "1", chainId: ctx.chainId, verifyingContract: await ctx.token.getAddress() };
      const permitTypes = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const sign = async (value: bigint) =>
        ethers.Signature.from(
          await owner.signTypedData(permitDomain, permitTypes, {
            owner: owner.address,
            spender: await ctx.vault.getAddress(),
            value,
            nonce: await ctx.token.nonces(owner.address),
            deadline,
          }),
        );
      let sig = await sign(4n * E18);
      await expect(ctx.vault.connect(owner).depositWithPermit(4n * E18, PLAYER, deadline, sig.v, sig.r, sig.s))
        .to.emit(ctx.vault, "Deposited")
        .withArgs(owner.address, PLAYER, 4n * E18);

      // someone copies the permit from the mempool and submits it first: the deposit still goes through
      sig = await sign(6n * E18);
      await ctx.token.connect(ctx.relayer).permit(owner.address, await ctx.vault.getAddress(), 6n * E18, deadline, sig.v, sig.r, sig.s);
      await ctx.vault.connect(owner).depositWithPermit(6n * E18, PLAYER, deadline, sig.v, sig.r, sig.s);
      expect(await ctx.vault.escrowBalance()).to.equal(10n * E18);

      // a bad permit and no allowance: transferFrom fails
      await ctx.token.connect(ctx.minter).mint(owner.address, 1n);
      await expect(ctx.vault.connect(owner).depositWithPermit(1n, PLAYER, deadline, sig.v, sig.r, sig.s)).to.be.revertedWithCustomError(
        ctx.token,
        "ERC20InsufficientAllowance",
      );
    });
  });

  describe("release", () => {
    it("pays escrow out on a valid voucher, submitted by anyone, without minting", async () => {
      const ctx = await loadFixture(fixture);
      await ctx.vault.connect(ctx.alice).deposit(500n * E18, PLAYER);
      const supply = await ctx.token.totalSupply();
      const v = release(ctx.bob, 120n * E18);
      await expect(releaseAs(ctx, v))
        .to.emit(ctx.vault, "Released")
        .withArgs(ctx.bob.address, v.nonce, v.amount, ctx.signer.address);
      expect(await ctx.token.balanceOf(ctx.bob.address)).to.equal(1_120n * E18);
      expect(await ctx.vault.escrowBalance()).to.equal(380n * E18);
      expect(await ctx.vault.totalReleased()).to.equal(120n * E18);
      expect(await ctx.token.totalSupply()).to.equal(supply); // release never mints
      expect(await ctx.token.hasRole(await ctx.token.MINTER_ROLE(), await ctx.vault.getAddress())).to.equal(false);
    });

    it("can never pay out more than the escrow holds", async () => {
      const ctx = await loadFixture(fixture);
      await ctx.vault.connect(ctx.alice).deposit(100n * E18, PLAYER);
      await expect(releaseAs(ctx, release(ctx.bob, 100n * E18 + 1n)))
        .to.be.revertedWithCustomError(ctx.vault, "InsufficientEscrow")
        .withArgs(100n * E18 + 1n, 100n * E18);
      await releaseAs(ctx, release(ctx.bob, 100n * E18)); // exactly the escrow is fine
      await expect(releaseAs(ctx, release(ctx.bob, 1n))).to.be.revertedWithCustomError(ctx.vault, "InsufficientEscrow").withArgs(1n, 0n);
    });

    it("rejects replays, expired vouchers, unknown signers and other domains", async () => {
      const ctx = await loadFixture(fixture);
      await ctx.vault.connect(ctx.alice).deposit(500n * E18, PLAYER);
      const v = release(ctx.bob, E18);
      const sig = await signRelease(ctx.signer, ctx.domain, v);
      await ctx.vault.release(v, sig);
      await expect(ctx.vault.release(v, sig)).to.be.revertedWithCustomError(ctx.vault, "NonceAlreadyUsed").withArgs(ctx.bob.address, v.nonce);

      const now = BigInt(await time.latest());
      await expect(releaseAs(ctx, release(ctx.bob, E18, { deadline: now }))).to.be.revertedWithCustomError(ctx.vault, "VoucherExpired");
      await expect(releaseAs(ctx, release(ctx.bob, E18), ctx.mallory))
        .to.be.revertedWithCustomError(ctx.vault, "InvalidSigner")
        .withArgs(ctx.mallory.address);

      // a voucher signed for the emission's domain (or another chain) is useless here
      for (const domain of [
        { ...ctx.domain, name: DOMAIN_NAMES.emission },
        { ...ctx.domain, chainId: 8453n },
        { ...ctx.domain, verifyingContract: ctx.mallory.address },
      ]) {
        const w = release(ctx.bob, E18);
        const s = await signRelease(ctx.signer, domain, w);
        await expect(ctx.vault.release(w, s))
          .to.be.revertedWithCustomError(ctx.vault, "InvalidSigner")
          .withArgs(ethers.verifyTypedData(ctx.domain, RELEASE_TYPES, w, s));
      }
      await expect(releaseAs(ctx, release(ctx.bob, 0n))).to.be.revertedWithCustomError(ctx.vault, "ZeroAmount");
      const z = { ...release(ctx.bob, 1n), account: ethers.ZeroAddress };
      await expect(ctx.vault.release(z, await signRelease(ctx.signer, ctx.domain, z))).to.be.revertedWithCustomError(ctx.vault, "ZeroAddress");
    });

    it("lets the signer cancel a voucher before it is used", async () => {
      const ctx = await loadFixture(fixture);
      await ctx.vault.connect(ctx.alice).deposit(10n * E18, PLAYER);
      const v = release(ctx.bob, E18);
      const sig = await signRelease(ctx.signer, ctx.domain, v);
      await ctx.vault.connect(ctx.signer).cancelNonce(ctx.bob.address, v.nonce);
      await expect(ctx.vault.release(v, sig)).to.be.revertedWithCustomError(ctx.vault, "NonceAlreadyUsed");
      expect(await ctx.vault.isNonceUsed(ctx.bob.address, v.nonce)).to.equal(true);
    });

    it("enforces the optional daily release cap per UTC day", async () => {
      const ctx = await loadFixture(fixture);
      await ctx.vault.connect(ctx.alice).deposit(1_000n * E18, PLAYER);
      expect(await ctx.vault.releaseRemainingToday()).to.equal(ethers.MaxUint256);
      await expect(ctx.vault.connect(ctx.signer).setDailyReleaseCap(1n)).to.be.revertedWithCustomError(ctx.vault, "AccessControlUnauthorizedAccount");
      // align to the start of a UTC day so the whole test runs inside one day
      const dayStart = (BigInt(await time.latest()) / DAY + 1n) * DAY;
      await time.setNextBlockTimestamp(dayStart);
      await releaseAs(ctx, release(ctx.bob, 30n * E18)); // tracked even while the cap is off
      await expect(ctx.vault.setDailyReleaseCap(100n * E18)).to.emit(ctx.vault, "DailyReleaseCapSet").withArgs(0n, 100n * E18);
      expect(await ctx.vault.releasedToday()).to.equal(30n * E18);
      await releaseAs(ctx, release(ctx.bob, 60n * E18));
      expect(await ctx.vault.releaseRemainingToday()).to.equal(10n * E18);
      await expect(releaseAs(ctx, release(ctx.bob, 11n * E18)))
        .to.be.revertedWithCustomError(ctx.vault, "DailyReleaseCapExceeded")
        .withArgs(11n * E18, 10n * E18);
      await ctx.vault.setDailyReleaseCap(50n * E18); // below today's usage
      expect(await ctx.vault.releaseRemainingToday()).to.equal(0n);
      await expect(releaseAs(ctx, release(ctx.bob, 1n)))
        .to.be.revertedWithCustomError(ctx.vault, "DailyReleaseCapExceeded")
        .withArgs(1n, 0n);
      await time.increaseTo(dayStart + DAY);
      expect(await ctx.vault.releasedToday()).to.equal(0n); // a new UTC day
      expect(await ctx.vault.releaseRemainingToday()).to.equal(50n * E18);
      await releaseAs(ctx, release(ctx.bob, 50n * E18));
      expect(await ctx.vault.releasedToday()).to.equal(50n * E18);
    });

    it("exposes the EIP-712 digest and domain", async () => {
      const ctx = await loadFixture(fixture);
      const v = release(ctx.bob, 7n);
      expect(await ctx.vault.hashRelease(v)).to.equal(ethers.TypedDataEncoder.hash(ctx.domain, RELEASE_TYPES, v));
      expect(await ctx.vault.DOMAIN_SEPARATOR()).to.equal(ethers.TypedDataEncoder.hashDomain(ctx.domain));
      expect(await ctx.vault.RELEASE_TYPEHASH()).to.equal(ethers.id("Release(address account,uint256 amount,uint256 nonce,uint256 deadline)"));
      expect(await ctx.vault.henium()).to.equal(await ctx.token.getAddress());
    });
  });

  describe("burnSunk", () => {
    it("burns escrowed HENIUM spent in game, lowering totalSupply", async () => {
      const ctx = await loadFixture(fixture);
      await ctx.vault.connect(ctx.alice).deposit(400n * E18, PLAYER);
      const supply = await ctx.token.totalSupply();
      const reason = ethers.id("dig:depth-22");
      await expect(ctx.vault.connect(ctx.burner).burnSunk(150n * E18, reason))
        .to.emit(ctx.vault, "SunkBurned")
        .withArgs(reason, 150n * E18, ctx.burner.address)
        .and.to.emit(ctx.token, "Transfer")
        .withArgs(await ctx.vault.getAddress(), ethers.ZeroAddress, 150n * E18);
      expect(await ctx.token.totalSupply()).to.equal(supply - 150n * E18);
      expect(await ctx.vault.escrowBalance()).to.equal(250n * E18);
      expect(await ctx.vault.totalSunkBurned()).to.equal(150n * E18);
    });

    it("is BURNER_ROLE only and bounded by the escrow", async () => {
      const ctx = await loadFixture(fixture);
      await ctx.vault.connect(ctx.alice).deposit(10n * E18, PLAYER);
      for (const who of [ctx.admin, ctx.signer, ctx.alice]) {
        await expect(ctx.vault.connect(who).burnSunk(1n, ethers.ZeroHash))
          .to.be.revertedWithCustomError(ctx.vault, "AccessControlUnauthorizedAccount")
          .withArgs(who.address, await ctx.vault.BURNER_ROLE());
      }
      await expect(ctx.vault.connect(ctx.burner).burnSunk(10n * E18 + 1n, ethers.ZeroHash))
        .to.be.revertedWithCustomError(ctx.vault, "InsufficientEscrow")
        .withArgs(10n * E18 + 1n, 10n * E18);
      await expect(ctx.vault.connect(ctx.burner).burnSunk(0n, ethers.ZeroHash)).to.be.revertedWithCustomError(ctx.vault, "ZeroAmount");
    });
  });

  describe("pause", () => {
    it("PAUSER_ROLE stops deposits, releases and burns, then resumes them", async () => {
      const ctx = await loadFixture(fixture);
      await ctx.vault.connect(ctx.alice).deposit(10n * E18, PLAYER);
      await expect(ctx.vault.connect(ctx.alice).pause()).to.be.revertedWithCustomError(ctx.vault, "AccessControlUnauthorizedAccount");
      await ctx.vault.connect(ctx.pauser).pause();
      await expect(ctx.vault.connect(ctx.alice).deposit(1n, PLAYER)).to.be.revertedWithCustomError(ctx.vault, "EnforcedPause");
      await expect(ctx.vault.connect(ctx.alice).depositWithPermit(1n, PLAYER, 0n, 0, ethers.ZeroHash, ethers.ZeroHash)).to.be.revertedWithCustomError(
        ctx.vault,
        "EnforcedPause",
      );
      await expect(releaseAs(ctx, release(ctx.bob, 1n))).to.be.revertedWithCustomError(ctx.vault, "EnforcedPause");
      await expect(ctx.vault.connect(ctx.burner).burnSunk(1n, ethers.ZeroHash)).to.be.revertedWithCustomError(ctx.vault, "EnforcedPause");
      await ctx.vault.connect(ctx.pauser).unpause();
      await releaseAs(ctx, release(ctx.bob, 1n));
    });
  });
});
