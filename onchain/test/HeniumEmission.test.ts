import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import type { HeniumEmission, HeniumToken } from "../typechain-types";
import { CLAIM_TYPES, Category, type ClaimVoucher, DOMAIN_NAMES, domainFor, signClaim } from "../scripts/lib/vouchers";
import { BPS, DAY, SHARES, buildPrefix, refCumulative, refDaily } from "./helpers/emissionRef";

const E18 = 10n ** 18n;
const CAP = 21_000_000n * E18;
const INITIAL = 7_200n * E18;
const INTERVAL = 1_458n;
const FAR = 2n ** 64n; // a deadline that never expires in these tests
const ALL = [Category.REFINERY, Category.WAR, Category.HUNT];

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

describe("HeniumEmission", () => {
  const prefixDefault = buildPrefix(INITIAL, INTERVAL);

  async function deploy(opts: { initial?: bigint; interval?: bigint; genesisAmount?: bigint; startIn?: bigint; grantMinter?: boolean } = {}) {
    const [admin, signer, pauser, alice, bob, relayer, treasury, mallory] = await ethers.getSigners();
    const token = (await ethers.deployContract("HeniumToken", [admin.address])) as unknown as HeniumToken;
    const genesisTime = BigInt(await time.latest()) + (opts.startIn ?? 1_000n);
    const genesisAmount = opts.genesisAmount ?? 0n;
    const emission = (await ethers.deployContract("HeniumEmission", [
      await token.getAddress(),
      admin.address,
      genesisTime,
      opts.initial ?? INITIAL,
      opts.interval ?? INTERVAL,
      genesisAmount,
      genesisAmount > 0n ? treasury.address : ethers.ZeroAddress,
    ])) as unknown as HeniumEmission;
    if (opts.grantMinter ?? true) await token.grantRole(await token.MINTER_ROLE(), await emission.getAddress());
    await emission.grantRole(await emission.SIGNER_ROLE(), signer.address);
    await emission.grantRole(await emission.PAUSER_ROLE(), pauser.address);
    const { chainId } = await ethers.provider.getNetwork();
    const domain = await domainFor(emission, DOMAIN_NAMES.emission, chainId);
    return { token, emission, genesisTime, domain, chainId, admin, signer, pauser, alice, bob, relayer, treasury, mallory };
  }

  const defaultFixture = () => deploy();
  type Ctx = Awaited<ReturnType<typeof deploy>>;

  let nonceSeq = 1_000n;
  function voucher(account: Signer, category: Category, amount: bigint, extra: Partial<ClaimVoucher> = {}): ClaimVoucher {
    return { account: account.address, category, amount, nonce: nonceSeq++, deadline: FAR, ...extra };
  }

  async function claimAs(ctx: Ctx, v: ClaimVoucher, by: Signer = ctx.relayer, signer: Signer = ctx.signer) {
    const sig = await signClaim(signer, ctx.domain, v);
    return ctx.emission.connect(by).claim(v, sig);
  }

  /** Moves the chain so that the next block lands `offset` seconds into emission day `day`. */
  async function atDay(ctx: Ctx, day: bigint, offset = 1n) {
    await time.setNextBlockTimestamp(ctx.genesisTime + day * DAY + offset);
  }

  // ------------------------------------------------------------------------------------------------------------
  describe("construction", () => {
    it("stores immutable parameters and precomputes the full schedule", async () => {
      const ctx = await loadFixture(defaultFixture);
      const e = ctx.emission;
      expect(await e.token()).to.equal(await ctx.token.getAddress());
      expect(await e.genesisTime()).to.equal(ctx.genesisTime);
      expect(await e.initialDailyEmission()).to.equal(INITIAL);
      expect(await e.halvingIntervalDays()).to.equal(INTERVAL);
      expect(await e.supplyCap()).to.equal(CAP);
      expect(await e.DEFAULT_INITIAL_DAILY_EMISSION()).to.equal(INITIAL);
      expect(await e.DEFAULT_HALVING_INTERVAL_DAYS()).to.equal(INTERVAL);
      expect(await e.MAX_HALVINGS()).to.equal(64n);
      expect(await e.totalScheduledEmission()).to.equal(prefixDefault[prefixDefault.length - 1]);
      expect(await e.genesisAmount()).to.equal(0n);
      expect(await e.genesisMinted()).to.equal(true);
      expect(await e.totalIssued()).to.equal(0n);
      expect(await e.remainingSupply()).to.equal(CAP);
    });

    it("mirrors bitcoin: 10,497,600 HENIUM in the first epoch and ~20,995,200 in total, below the 21M cap", async () => {
      const { emission } = await loadFixture(defaultFixture);
      expect(await emission.cumulativeEmission(INTERVAL - 1n)).to.equal(10_497_600n * E18);
      const total = await emission.totalScheduledEmission();
      expect(total).to.be.lessThan(CAP);
      expect(total).to.be.greaterThan(20_995_199n * E18);
      expect(total).to.be.lessThanOrEqual(20_995_200n * E18);
    });

    it("validates its parameters", async () => {
      const [admin, treasury] = await ethers.getSigners();
      const token = await ethers.deployContract("HeniumToken", [admin.address]);
      const F = await ethers.getContractFactory("HeniumEmission");
      const t = await token.getAddress();
      const now = BigInt(await time.latest());
      const Z = ethers.ZeroAddress;
      await expect(F.deploy(Z, admin.address, now, INITIAL, INTERVAL, 0n, Z)).to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy(t, Z, now, INITIAL, INTERVAL, 0n, Z)).to.be.revertedWithCustomError(F, "ZeroAddress");
      await expect(F.deploy(t, admin.address, now, 0n, INTERVAL, 0n, Z)).to.be.revertedWithCustomError(F, "InvalidSchedule");
      await expect(F.deploy(t, admin.address, now, CAP + 1n, INTERVAL, 0n, Z)).to.be.revertedWithCustomError(F, "InvalidSchedule");
      await expect(F.deploy(t, admin.address, now, INITIAL, 0n, 0n, Z)).to.be.revertedWithCustomError(F, "InvalidSchedule");
      await expect(F.deploy(t, admin.address, now, INITIAL, 2n ** 32n, 0n, Z)).to.be.revertedWithCustomError(F, "InvalidSchedule");
      await expect(F.deploy(t, admin.address, now, INITIAL, INTERVAL, CAP + 1n, treasury.address))
        .to.be.revertedWithCustomError(F, "GenesisExceedsCap")
        .withArgs(CAP + 1n, CAP);
      await expect(F.deploy(t, admin.address, now, INITIAL, INTERVAL, 1n, Z)).to.be.revertedWithCustomError(F, "ZeroAddress");
      // extremes that are allowed
      await F.deploy(t, admin.address, now, CAP, 2n ** 32n - 1n, CAP, treasury.address);
      await F.deploy(t, admin.address, now, 1n, 1n, 0n, Z);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("schedule math", () => {
    it("dailyEmission and cumulativeEmission match a day-by-day JS reference at every epoch boundary", async () => {
      const { emission } = await loadFixture(defaultFixture);
      const days: bigint[] = [0n, 1n, 2n, 10n, 365n];
      for (let e = 1n; e <= 64n; e++) days.push(e * INTERVAL - 1n, e * INTERVAL, e * INTERVAL + 1n);
      days.push(64n * INTERVAL + 1_000n, 10n ** 12n, 2n ** 255n);
      for (const d of days) {
        expect(await emission.dailyEmission(d), `daily(${d})`).to.equal(refDaily(d, INITIAL, INTERVAL));
        expect(await emission.cumulativeEmission(d), `cumulative(${d})`).to.equal(refCumulative(prefixDefault, d));
        expect(await emission.epochOf(d)).to.equal(d / INTERVAL);
      }
      expect(await emission.dailyEmission(64n * INTERVAL)).to.equal(0n);
      expect(await emission.dailyEmission(64n * INTERVAL - 1n)).to.equal(INITIAL >> 63n);
    });

    it("matches the reference on every single day of a short schedule with an odd initial emission", async () => {
      const initial = 1_000n * E18 + 7n; // odd: every halving floors
      const interval = 3n;
      const ctx = await deploy({ initial, interval });
      const prefix = buildPrefix(initial, interval, 20n);
      for (let d = 0n; d < 64n * interval + 20n; d++) {
        expect(await ctx.emission.dailyEmission(d), `daily(${d})`).to.equal(refDaily(d, initial, interval));
        expect(await ctx.emission.cumulativeEmission(d), `cumulative(${d})`).to.equal(refCumulative(prefix, d));
      }
      expect(await ctx.emission.totalScheduledEmission()).to.equal(prefix[prefix.length - 1]);
    });

    it("tracks the schedule over several halvings with real time travel", async () => {
      const ctx = await loadFixture(defaultFixture);
      const e = ctx.emission;
      expect(await e.hasStarted()).to.equal(false);
      for (const day of [0n, 1n, 1_457n, 1_458n, 1_459n, 2_916n, 4_373n, 4_374n, 5_832n, 7_290n, 10_000n]) {
        await time.increaseTo(ctx.genesisTime + day * DAY + 7n);
        const epoch = day / INTERVAL;
        expect(await e.hasStarted()).to.equal(true);
        expect(await e.currentDay()).to.equal(day);
        expect(await e.currentEpoch()).to.equal(epoch);
        expect(await e.currentDailyEmission()).to.equal(INITIAL >> epoch);
        expect(await e.budgetToDate()).to.equal(refCumulative(prefixDefault, day));
        expect(await e.nextHalvingTime()).to.equal(ctx.genesisTime + (epoch + 1n) * INTERVAL * DAY);
        for (const c of ALL) {
          expect(await e.categoryBudget(c)).to.equal((refCumulative(prefixDefault, day) * SHARES[c]) / BPS);
        }
      }
      expect(await e.epochStartTime(0n)).to.equal(ctx.genesisTime);
      expect(await e.epochStartTime(4n)).to.equal(ctx.genesisTime + 4n * INTERVAL * DAY);
    });

    it("releases each day's budget exactly at the day boundary", async () => {
      const ctx = await loadFixture(defaultFixture);
      const day0Refinery = (INITIAL * 7_000n) / BPS; // 5,040 HENIUM
      await time.setNextBlockTimestamp(ctx.genesisTime); // first second of day 0
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, day0Refinery - 1n));
      // last second of day 0: only 1 wei left
      await time.setNextBlockTimestamp(ctx.genesisTime + DAY - 1n);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 2n)))
        .to.be.revertedWithCustomError(ctx.emission, "CategoryBudgetExceeded")
        .withArgs(Category.REFINERY, 2n, 1n);
      // first second of day 1: a new day's budget
      await time.setNextBlockTimestamp(ctx.genesisTime + DAY);
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 2n));
      expect(await ctx.emission.categoryRemaining(Category.REFINERY)).to.equal(day0Refinery - 1n);
      expect(await ctx.emission.mintedByCategory(Category.REFINERY)).to.equal(day0Refinery + 1n);
    });

    it("splits the budget 70 / 20 / 10 and never over-allocates through rounding", async () => {
      const ctx = await loadFixture(defaultFixture);
      expect(await ctx.emission.shareBps(Category.REFINERY)).to.equal(7_000n);
      expect(await ctx.emission.shareBps(Category.WAR)).to.equal(2_000n);
      expect(await ctx.emission.shareBps(Category.HUNT)).to.equal(1_000n);
      await time.increaseTo(ctx.genesisTime + 3_333n * DAY);
      const budget = await ctx.emission.budgetToDate();
      let sum = 0n;
      for (const c of ALL) sum += await ctx.emission.categoryBudget(c);
      expect(sum).to.be.lessThanOrEqual(budget);
      expect(budget - sum).to.be.lessThan(3n);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("claims", () => {
    it("mints a valid voucher to its account, whoever submits it", async () => {
      const ctx = await loadFixture(defaultFixture);
      await atDay(ctx, 0n);
      const v = voucher(ctx.alice, Category.WAR, 100n * E18);
      const sig = await signClaim(ctx.signer, ctx.domain, v);
      await expect(ctx.emission.connect(ctx.relayer).claim(v, sig))
        .to.emit(ctx.emission, "Claimed")
        .withArgs(ctx.alice.address, Category.WAR, v.nonce, v.amount, v.amount, ctx.signer.address)
        .and.to.emit(ctx.token, "Transfer")
        .withArgs(ethers.ZeroAddress, ctx.alice.address, v.amount);
      expect(await ctx.token.balanceOf(ctx.alice.address)).to.equal(v.amount);
      expect(await ctx.token.balanceOf(ctx.relayer.address)).to.equal(0n);
      expect(await ctx.emission.mintedByCategory(Category.WAR)).to.equal(v.amount);
      expect(await ctx.emission.totalIssued()).to.equal(v.amount);
      expect(await ctx.emission.totalClaimed()).to.equal(v.amount);
      expect(await ctx.emission.isNonceUsed(ctx.alice.address, v.nonce)).to.equal(true);
      expect(await ctx.emission.remainingSupply()).to.equal(CAP - v.amount);
    });

    it("returns the minted amount", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const v = voucher(ctx.alice, Category.HUNT, 5n * E18);
      const sig = await signClaim(ctx.signer, ctx.domain, v);
      expect(await ctx.emission.claim.staticCall(v, sig)).to.equal(5n * E18);
    });

    it("rejects a replayed voucher", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const v = voucher(ctx.alice, Category.REFINERY, E18);
      const sig = await signClaim(ctx.signer, ctx.domain, v);
      await ctx.emission.claim(v, sig);
      await expect(ctx.emission.claim(v, sig))
        .to.be.revertedWithCustomError(ctx.emission, "NonceAlreadyUsed")
        .withArgs(ctx.alice.address, v.nonce);
      // the same nonce with different fields is also dead
      await expect(claimAs(ctx, { ...v, amount: 2n })).to.be.revertedWithCustomError(ctx.emission, "NonceAlreadyUsed");
    });

    it("accepts any unused nonce once, in any order (bitmap), per account", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const nonces = [7n, 3n, 256n, 255n, 2n ** 255n, 0n, 2n ** 256n - 1n];
      for (const nonce of nonces) {
        expect(await ctx.emission.isNonceUsed(ctx.alice.address, nonce)).to.equal(false);
        await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 1n, { nonce }));
        expect(await ctx.emission.isNonceUsed(ctx.alice.address, nonce)).to.equal(true);
      }
      expect(await ctx.emission.isNonceUsed(ctx.alice.address, 4n)).to.equal(false);
      expect(await ctx.emission.isNonceUsed(ctx.alice.address, 257n)).to.equal(false);
      // same nonce, other account: independent
      await claimAs(ctx, voucher(ctx.bob, Category.REFINERY, 1n, { nonce: 7n }));
    });

    it("lets the signer cancel an outstanding voucher (even while paused)", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const v = voucher(ctx.alice, Category.REFINERY, E18);
      const sig = await signClaim(ctx.signer, ctx.domain, v);
      await expect(ctx.emission.connect(ctx.alice).cancelNonce(ctx.alice.address, v.nonce))
        .to.be.revertedWithCustomError(ctx.emission, "AccessControlUnauthorizedAccount")
        .withArgs(ctx.alice.address, await ctx.emission.SIGNER_ROLE());
      await ctx.emission.connect(ctx.pauser).pause();
      await expect(ctx.emission.connect(ctx.signer).cancelNonce(ctx.alice.address, v.nonce))
        .to.emit(ctx.emission, "NonceCancelled")
        .withArgs(ctx.alice.address, v.nonce, ctx.signer.address);
      await ctx.emission.connect(ctx.pauser).unpause();
      await expect(ctx.emission.claim(v, sig)).to.be.revertedWithCustomError(ctx.emission, "NonceAlreadyUsed");
      await expect(ctx.emission.connect(ctx.signer).cancelNonce(ctx.alice.address, v.nonce)).to.be.revertedWithCustomError(
        ctx.emission,
        "NonceAlreadyUsed",
      );
    });

    it("rejects an expired voucher; the deadline second itself is still valid", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime + 100n);
      const deadline = BigInt(await time.latest()) + 50n;
      const v = voucher(ctx.alice, Category.REFINERY, E18, { deadline });
      const sig = await signClaim(ctx.signer, ctx.domain, v);
      await time.setNextBlockTimestamp(deadline + 1n);
      await expect(ctx.emission.claim(v, sig))
        .to.be.revertedWithCustomError(ctx.emission, "VoucherExpired")
        .withArgs(deadline, deadline + 1n);

      const ctx2 = await loadFixture(defaultFixture);
      await time.increaseTo(ctx2.genesisTime + 100n);
      const d2 = BigInt(await time.latest()) + 50n;
      const v2 = voucher(ctx2.alice, Category.REFINERY, E18, { deadline: d2 });
      const sig2 = await signClaim(ctx2.signer, ctx2.domain, v2);
      await time.setNextBlockTimestamp(d2);
      await ctx2.emission.claim(v2, sig2);
    });

    it("rejects a voucher signed by an address without SIGNER_ROLE", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.REFINERY, E18), ctx.relayer, ctx.mallory))
        .to.be.revertedWithCustomError(ctx.emission, "InvalidSigner")
        .withArgs(ctx.mallory.address);
      // the admin is not a signer either
      await expect(claimAs(ctx, voucher(ctx.alice, Category.REFINERY, E18), ctx.relayer, ctx.admin))
        .to.be.revertedWithCustomError(ctx.emission, "InvalidSigner")
        .withArgs(ctx.admin.address);
    });

    it("binds vouchers to this chain, this contract, and this domain (EIP-712)", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const other = await deploy(); // an identical second deployment
      const wrongDomains = [
        { ...ctx.domain, chainId: 1n }, // another chain
        { ...ctx.domain, chainId: 43_114n },
        { ...ctx.domain, verifyingContract: await other.emission.getAddress() }, // another deployment
        { ...ctx.domain, name: DOMAIN_NAMES.vault }, // another gateway's domain
        { ...ctx.domain, version: "2" },
      ];
      for (const domain of wrongDomains) {
        const v = voucher(ctx.alice, Category.REFINERY, E18);
        const sig = await signClaim(ctx.signer, domain, v);
        const recovered = ethers.verifyTypedData(ctx.domain, CLAIM_TYPES, v, sig);
        expect(recovered).to.not.equal(ctx.signer.address);
        await expect(ctx.emission.claim(v, sig)).to.be.revertedWithCustomError(ctx.emission, "InvalidSigner").withArgs(recovered);
      }
    });

    it("rejects tampered fields", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const v = voucher(ctx.alice, Category.HUNT, E18);
      const sig = await signClaim(ctx.signer, ctx.domain, v);
      for (const t of [
        { ...v, amount: v.amount + 1n },
        { ...v, category: Category.REFINERY },
        { ...v, account: ctx.mallory.address },
        { ...v, deadline: v.deadline + 1n },
        { ...v, nonce: v.nonce + 1n },
      ]) {
        await expect(ctx.emission.claim(t, sig)).to.be.revertedWithCustomError(ctx.emission, "InvalidSigner").withArgs(anyValue);
      }
      await ctx.emission.claim(v, sig); // the original is still good
    });

    it("rejects malformed and malleable signatures", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const v = voucher(ctx.alice, Category.REFINERY, E18);
      const sig = ethers.Signature.from(await signClaim(ctx.signer, ctx.domain, v));
      await expect(ctx.emission.claim(v, "0x" + "11".repeat(64)))
        .to.be.revertedWithCustomError(ctx.emission, "ECDSAInvalidSignatureLength")
        .withArgs(64);
      await expect(ctx.emission.claim(v, ethers.concat([sig.r, sig.s, "0x00"]))).to.be.revertedWithCustomError(ctx.emission, "ECDSAInvalidSignature");
      // the "other" valid ECDSA signature (n - s, flipped v) of the same message is rejected
      const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n; // secp256k1 order
      const highS = ethers.toBeHex(n - BigInt(sig.s), 32);
      const flippedV = sig.v === 27 ? "0x1c" : "0x1b";
      await expect(ctx.emission.claim(v, ethers.concat([sig.r, highS, flippedV])))
        .to.be.revertedWithCustomError(ctx.emission, "ECDSAInvalidSignatureS")
        .withArgs(highS);
      await ctx.emission.claim(v, sig.serialized);
    });

    it("supports signer rotation: revoked keys stop working at once", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const pending = voucher(ctx.alice, Category.REFINERY, E18);
      const pendingSig = await signClaim(ctx.signer, ctx.domain, pending);
      const newKey = ctx.bob;
      await ctx.emission.grantRole(await ctx.emission.SIGNER_ROLE(), newKey.address);
      await ctx.emission.revokeRole(await ctx.emission.SIGNER_ROLE(), ctx.signer.address);
      await expect(ctx.emission.claim(pending, pendingSig))
        .to.be.revertedWithCustomError(ctx.emission, "InvalidSigner")
        .withArgs(ctx.signer.address);
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, E18), ctx.relayer, newKey);
    });

    it("rejects zero amounts, the zero account and unknown categories", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 0n))).to.be.revertedWithCustomError(ctx.emission, "ZeroAmount");
      const z = { ...voucher(ctx.alice, Category.REFINERY, 1n), account: ethers.ZeroAddress };
      await expect(ctx.emission.claim(z, await signClaim(ctx.signer, ctx.domain, z))).to.be.revertedWithCustomError(ctx.emission, "ZeroAddress");
      // category 3 does not exist: the ABI decoder rejects the call
      const bad = { ...voucher(ctx.alice, Category.REFINERY, 1n), category: 3 };
      const sig = await signClaim(ctx.signer, ctx.domain, bad);
      const data = ctx.emission.interface.encodeFunctionData("claim", [bad, sig]);
      await expect(ctx.relayer.sendTransaction({ to: await ctx.emission.getAddress(), data })).to.be.reverted;
    });

    it("does nothing before genesis", async () => {
      const ctx = await loadFixture(defaultFixture);
      const e = ctx.emission;
      expect(await e.hasStarted()).to.equal(false);
      expect(await e.currentDay()).to.equal(0n);
      expect(await e.budgetToDate()).to.equal(0n);
      expect(await e.currentDailyEmission()).to.equal(0n);
      expect(await e.categoryBudget(Category.REFINERY)).to.equal(0n);
      expect(await e.categoryRemaining(Category.REFINERY)).to.equal(0n);
      expect(await e.accountClaimedToday(ctx.alice.address)).to.equal(0n);
      expect(await e.globalClaimedToday()).to.equal(0n);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 1n)))
        .to.be.revertedWithCustomError(e, "EmissionNotStarted")
        .withArgs(ctx.genesisTime);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("category budgets", () => {
    it("rejects a claim above the category's budget to date and accepts exactly the budget", async () => {
      const ctx = await loadFixture(defaultFixture);
      await atDay(ctx, 4n);
      const budget = (refCumulative(prefixDefault, 4n) * 2_000n) / BPS; // WAR, 5 days
      await expect(claimAs(ctx, voucher(ctx.alice, Category.WAR, budget + 1n)))
        .to.be.revertedWithCustomError(ctx.emission, "CategoryBudgetExceeded")
        .withArgs(Category.WAR, budget + 1n, budget);
      await atDay(ctx, 4n, 10n);
      await claimAs(ctx, voucher(ctx.alice, Category.WAR, budget));
      expect(await ctx.emission.categoryRemaining(Category.WAR)).to.equal(0n);
      await expect(claimAs(ctx, voucher(ctx.bob, Category.WAR, 1n)))
        .to.be.revertedWithCustomError(ctx.emission, "CategoryBudgetExceeded")
        .withArgs(Category.WAR, 1n, 0n);
    });

    it("keeps categories independent and carries unclaimed budget over to later days", async () => {
      const ctx = await loadFixture(defaultFixture);
      await atDay(ctx, 0n);
      const refineryDay0 = (INITIAL * 7_000n) / BPS;
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, refineryDay0));
      // WAR and HUNT untouched
      expect(await ctx.emission.categoryRemaining(Category.WAR)).to.equal((INITIAL * 2_000n) / BPS);
      expect(await ctx.emission.categoryRemaining(Category.HUNT)).to.equal((INITIAL * 1_000n) / BPS);
      // nobody claims HUNT for 30 days: it can all be claimed at once on day 29
      await atDay(ctx, 29n);
      const hunt30 = (30n * INITIAL * 1_000n) / BPS;
      await claimAs(ctx, voucher(ctx.bob, Category.HUNT, hunt30));
      expect(await ctx.token.balanceOf(ctx.bob.address)).to.equal(hunt30);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("genesis and the 21M cap", () => {
    it("mints the genesis allocation once, to the treasury, by anyone, after MINTER_ROLE is granted", async () => {
      const genesisAmount = 1_000_000n * E18;
      const ctx = await deploy({ genesisAmount, grantMinter: false });
      expect(await ctx.emission.genesisMinted()).to.equal(false);
      expect(await ctx.emission.totalIssued()).to.equal(genesisAmount); // reserved from construction
      expect(await ctx.emission.remainingSupply()).to.equal(CAP - genesisAmount);
      await expect(ctx.emission.connect(ctx.mallory).mintGenesis()).to.be.revertedWithCustomError(
        ctx.token,
        "AccessControlUnauthorizedAccount",
      );
      await ctx.token.grantRole(await ctx.token.MINTER_ROLE(), await ctx.emission.getAddress());
      await expect(ctx.emission.connect(ctx.mallory).mintGenesis())
        .to.emit(ctx.emission, "GenesisMinted")
        .withArgs(ctx.treasury.address, genesisAmount);
      expect(await ctx.token.balanceOf(ctx.treasury.address)).to.equal(genesisAmount);
      expect(await ctx.token.balanceOf(ctx.mallory.address)).to.equal(0n);
      await expect(ctx.emission.mintGenesis()).to.be.revertedWithCustomError(ctx.emission, "GenesisAlreadyMinted");
      expect(await ctx.emission.genesisTreasury()).to.equal(ctx.treasury.address);
    });

    it("has nothing to mint without a genesis allocation", async () => {
      const ctx = await loadFixture(defaultFixture);
      await expect(ctx.emission.mintGenesis()).to.be.revertedWithCustomError(ctx.emission, "GenesisAlreadyMinted");
    });

    it("clamps a claim that crosses the cap, then reverts (genesis counts toward the cap)", async () => {
      const genesisAmount = CAP - 10_000n * E18; // 10,000 HENIUM left for the emission
      const ctx = await deploy({ genesisAmount });
      await ctx.emission.mintGenesis();
      await atDay(ctx, 1n); // budgets: REFINERY 10,080, WAR 2,880, HUNT 1,440
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 9_000n * E18));
      const v = voucher(ctx.bob, Category.WAR, 2_000n * E18);
      const sig = await signClaim(ctx.signer, ctx.domain, v);
      expect(await ctx.emission.claim.staticCall(v, sig)).to.equal(1_000n * E18);
      await expect(ctx.emission.claim(v, sig))
        .to.emit(ctx.emission, "Claimed")
        .withArgs(ctx.bob.address, Category.WAR, v.nonce, 2_000n * E18, 1_000n * E18, ctx.signer.address);
      expect(await ctx.token.balanceOf(ctx.bob.address)).to.equal(1_000n * E18);
      expect(await ctx.token.totalSupply()).to.equal(CAP);
      expect(await ctx.emission.remainingSupply()).to.equal(0n);
      expect(await ctx.emission.mintedByCategory(Category.WAR)).to.equal(1_000n * E18); // only what was minted
      for (const c of ALL) expect(await ctx.emission.categoryRemaining(c)).to.equal(0n);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.HUNT, 1n))).to.be.revertedWithCustomError(ctx.emission, "SupplyCapReached");
    });

    it("reserves the genesis allocation even before it is minted", async () => {
      const genesisAmount = CAP - 1_000n * E18;
      const ctx = await deploy({ genesisAmount });
      await atDay(ctx, 0n);
      const v = voucher(ctx.alice, Category.REFINERY, 2_000n * E18);
      const sig = await signClaim(ctx.signer, ctx.domain, v);
      await expect(ctx.emission.claim(v, sig))
        .to.emit(ctx.emission, "Claimed")
        .withArgs(ctx.alice.address, Category.REFINERY, v.nonce, 2_000n * E18, 1_000n * E18, ctx.signer.address);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.WAR, 1n))).to.be.revertedWithCustomError(ctx.emission, "SupplyCapReached");
      await ctx.emission.mintGenesis();
      expect(await ctx.token.totalSupply()).to.equal(CAP);
    });

    it("lets the cap truncate the far tail of the emission when there is a genesis allocation", async () => {
      const genesisAmount = 1_000_000n * E18;
      const ctx = await deploy({ genesisAmount });
      await ctx.emission.mintGenesis();
      await time.increaseTo(ctx.genesisTime + (64n * INTERVAL + 5n) * DAY); // ~255 years later
      const total = await ctx.emission.totalScheduledEmission();
      expect(await ctx.emission.budgetToDate()).to.equal(total);
      expect(await ctx.emission.currentDailyEmission()).to.equal(0n);
      const budgets = ALL.map((c) => (total * SHARES[c]) / BPS);
      expect(budgets[0] + budgets[1] + budgets[2] + genesisAmount).to.be.greaterThan(CAP); // the tail does not fit
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, budgets[0]));
      await claimAs(ctx, voucher(ctx.alice, Category.WAR, budgets[1]));
      const left = CAP - genesisAmount - budgets[0] - budgets[1];
      expect(left).to.be.lessThan(budgets[2]);
      const v = voucher(ctx.alice, Category.HUNT, budgets[2]);
      await expect(claimAs(ctx, v))
        .to.emit(ctx.emission, "Claimed")
        .withArgs(ctx.alice.address, Category.HUNT, v.nonce, budgets[2], left, ctx.signer.address);
      expect(await ctx.token.totalSupply()).to.equal(CAP);
      expect(await ctx.emission.totalIssued()).to.equal(CAP);
    });

    it("never reaches the cap without genesis: the whole schedule is ~20,995,200 HENIUM", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime + 64n * INTERVAL * DAY + 1n);
      const total = await ctx.emission.totalScheduledEmission();
      let minted = 0n;
      for (const c of ALL) {
        const b = (total * SHARES[c]) / BPS;
        await claimAs(ctx, voucher(ctx.alice, c, b));
        minted += b;
      }
      expect(await ctx.token.totalSupply()).to.equal(minted);
      expect(minted).to.be.lessThan(CAP);
      await time.increase(1_000n * DAY); // the budget no longer grows
      for (const c of ALL) expect(await ctx.emission.categoryRemaining(c)).to.equal(0n);
    });

    it("does not re-issue burned HENIUM: burns never create emission room", async () => {
      const genesisAmount = CAP - 1_000n * E18;
      const ctx = await deploy({ genesisAmount });
      await ctx.emission.mintGenesis();
      await atDay(ctx, 0n);
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 1_000n * E18));
      await ctx.token.connect(ctx.treasury).burn(500_000n * E18);
      expect(await ctx.token.totalSupply()).to.equal(CAP - 500_000n * E18);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 1n))).to.be.revertedWithCustomError(ctx.emission, "SupplyCapReached");
      expect(await ctx.emission.remainingSupply()).to.equal(0n);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("pause", () => {
    it("PAUSER_ROLE pauses and unpauses claims; nobody else can", async () => {
      const ctx = await loadFixture(defaultFixture);
      await time.increaseTo(ctx.genesisTime);
      const role = await ctx.emission.PAUSER_ROLE();
      await expect(ctx.emission.connect(ctx.admin).pause())
        .to.be.revertedWithCustomError(ctx.emission, "AccessControlUnauthorizedAccount")
        .withArgs(ctx.admin.address, role);
      await expect(ctx.emission.connect(ctx.pauser).pause()).to.emit(ctx.emission, "Paused").withArgs(ctx.pauser.address);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 1n))).to.be.revertedWithCustomError(ctx.emission, "EnforcedPause");
      await expect(ctx.emission.connect(ctx.alice).unpause()).to.be.revertedWithCustomError(ctx.emission, "AccessControlUnauthorizedAccount");
      await expect(ctx.emission.connect(ctx.pauser).unpause()).to.emit(ctx.emission, "Unpaused");
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 1n));
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("daily limits", () => {
    it("enforces an optional per-account daily limit that resets every emission day", async () => {
      const ctx = await loadFixture(defaultFixture);
      const e = ctx.emission;
      await expect(e.connect(ctx.alice).setAccountDailyLimit(1n)).to.be.revertedWithCustomError(e, "AccessControlUnauthorizedAccount");
      expect(await e.accountDailyRemaining(ctx.alice.address)).to.equal(ethers.MaxUint256);
      await expect(e.setAccountDailyLimit(100n * E18)).to.emit(e, "AccountDailyLimitSet").withArgs(0n, 100n * E18);
      await atDay(ctx, 3n);
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 60n * E18));
      expect(await e.accountClaimedToday(ctx.alice.address)).to.equal(60n * E18);
      expect(await e.accountDailyRemaining(ctx.alice.address)).to.equal(40n * E18);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.WAR, 50n * E18)))
        .to.be.revertedWithCustomError(e, "AccountDailyLimitExceeded")
        .withArgs(ctx.alice.address, 50n * E18, 40n * E18);
      await claimAs(ctx, voucher(ctx.alice, Category.WAR, 40n * E18)); // exactly up to the limit
      await claimAs(ctx, voucher(ctx.bob, Category.REFINERY, 100n * E18)); // others are not affected
      // lowering the limit below today's usage: nothing left
      await e.setAccountDailyLimit(10n * E18);
      expect(await e.accountDailyRemaining(ctx.alice.address)).to.equal(0n);
      await expect(claimAs(ctx, voucher(ctx.alice, Category.HUNT, 1n)))
        .to.be.revertedWithCustomError(e, "AccountDailyLimitExceeded")
        .withArgs(ctx.alice.address, 1n, 0n);
      // next day: fresh allowance
      await atDay(ctx, 4n);
      await claimAs(ctx, voucher(ctx.alice, Category.HUNT, 10n * E18));
      expect(await e.accountClaimedToday(ctx.alice.address)).to.equal(10n * E18);
      // disabled: unlimited again
      await e.setAccountDailyLimit(0n);
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 500n * E18));
      expect(await e.accountDailyRemaining(ctx.alice.address)).to.equal(ethers.MaxUint256);
    });

    it("enforces an optional global daily limit (a cap on what a leaked signer key could mint per day)", async () => {
      const ctx = await loadFixture(defaultFixture);
      const e = ctx.emission;
      await expect(e.connect(ctx.signer).setGlobalDailyLimit(1n)).to.be.revertedWithCustomError(e, "AccessControlUnauthorizedAccount");
      expect(await e.globalDailyRemaining()).to.equal(ethers.MaxUint256);
      await expect(e.setGlobalDailyLimit(150n * E18)).to.emit(e, "GlobalDailyLimitSet").withArgs(0n, 150n * E18);
      await atDay(ctx, 2n);
      await claimAs(ctx, voucher(ctx.alice, Category.REFINERY, 100n * E18));
      await expect(claimAs(ctx, voucher(ctx.bob, Category.REFINERY, 60n * E18)))
        .to.be.revertedWithCustomError(e, "GlobalDailyLimitExceeded")
        .withArgs(60n * E18, 50n * E18);
      expect(await e.globalClaimedToday()).to.equal(100n * E18);
      expect(await e.globalDailyRemaining()).to.equal(50n * E18);
      await e.setGlobalDailyLimit(50n * E18);
      expect(await e.globalDailyRemaining()).to.equal(0n);
      await expect(claimAs(ctx, voucher(ctx.bob, Category.REFINERY, 1n)))
        .to.be.revertedWithCustomError(e, "GlobalDailyLimitExceeded")
        .withArgs(1n, 0n);
      await atDay(ctx, 3n);
      await claimAs(ctx, voucher(ctx.bob, Category.REFINERY, 50n * E18));
      expect(await e.globalClaimedToday()).to.equal(50n * E18);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("EIP-712 helpers", () => {
    it("exposes the domain, the type hash and the digest the server signs", async () => {
      const ctx = await loadFixture(defaultFixture);
      const e = ctx.emission;
      expect(await e.CLAIM_TYPEHASH()).to.equal(
        ethers.id("Claim(address account,uint8 category,uint256 amount,uint256 nonce,uint256 deadline)"),
      );
      expect(await e.DOMAIN_SEPARATOR()).to.equal(ethers.TypedDataEncoder.hashDomain(ctx.domain));
      const d = await e.eip712Domain();
      expect([d.name, d.version, d.chainId, d.verifyingContract]).to.deep.equal(["HeniumEmission", "1", ctx.chainId, await e.getAddress()]);
      const v = voucher(ctx.alice, Category.WAR, 42n);
      expect(await e.hashClaim(v)).to.equal(ethers.TypedDataEncoder.hash(ctx.domain, CLAIM_TYPES, v));
    });
  });
});
