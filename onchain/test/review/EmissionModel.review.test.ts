import { strict as assert } from "assert";
import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HeniumEmission, HeniumToken } from "../../typechain-types";
import { Category, DOMAIN_NAMES, domainFor, signClaim } from "../../scripts/lib/vouchers";
import { BPS, DAY, SHARES, buildPrefix, refCumulative, refDaily } from "../helpers/emissionRef";
import { Prng } from "../helpers/prng";

/**
 * SECURITY REVIEW — model-based fuzz of HeniumEmission.
 *
 * Several random schedules (short halving intervals so that many halvings, the end of the schedule and the 21M
 * clamp are all reached; genesis allocations from 0 to most of the cap), each driven through random claims at
 * random times — including exactly on day boundaries — with random amounts around the remaining budget, limits
 * switched on, off and lowered mid-day, pauses, replays, expired vouchers, revoked signers and holder burns.
 *
 * An independent JS model (schedule summed day by day, not in closed form) predicts every outcome: success or
 * revert, the exact amount minted (clamp) and every view. Invariants checked after every step:
 *   totalIssued = genesis + sum(minted) <= 21M;  minted per category <= its budget to date;
 *   token.totalSupply() = genesis (once minted) + claims - burns;  burns never create emission room.
 */
const E18 = 10n ** 18n;
const CAP = 21_000_000n * E18;
const FAR = 2n ** 64n;
const SEEDS = process.env.REVIEW_SEED ? [Number(process.env.REVIEW_SEED)] : [0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8];
const STEPS = 160;

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

describe("REVIEW: HeniumEmission model-based fuzz", () => {
  const seen = new Set<string>();
  for (const seed of SEEDS) {
    it(`matches an independent model on every claim and view (seed ${seed.toString(16)})`, async () => {
      const rng = new Prng(seed);
      const [admin, signer, pauser, relayer, treasury, oldSigner, ...players] = await ethers.getSigners();
      const accounts = players.slice(0, 4);

      // ---- random schedule -------------------------------------------------------------------------------------
      const interval = BigInt(1 + rng.int(3)); // 1..3 days per epoch: 64 epochs within ~200 days
      const initial = rng.pick([CAP / 3n, CAP / 7n, (CAP / 5n) * 3n, 7_200n * E18 + 12_345n, CAP]);
      const genesisAmount = rng.pick([0n, 0n, 4_800n * E18, CAP / 4n, CAP - 1n, CAP]);
      const token = (await ethers.deployContract("HeniumToken", [admin.address])) as unknown as HeniumToken;
      const genesisTime = BigInt(await time.latest()) + 500n;
      const emission = (await ethers.deployContract("HeniumEmission", [
        await token.getAddress(),
        admin.address,
        genesisTime,
        initial,
        interval,
        genesisAmount,
        genesisAmount > 0n ? treasury.address : ethers.ZeroAddress,
      ])) as unknown as HeniumEmission;
      await token.grantRole(await token.MINTER_ROLE(), await emission.getAddress());
      await emission.grantRole(await emission.SIGNER_ROLE(), signer.address);
      await emission.grantRole(await emission.PAUSER_ROLE(), pauser.address);
      const { chainId } = await ethers.provider.getNetwork();
      const domain = await domainFor(emission, DOMAIN_NAMES.emission, chainId);
      const prefix = buildPrefix(initial, interval, 20n);

      // ---- model ---------------------------------------------------------------------------------------------------
      const m = {
        minted: [0n, 0n, 0n],
        totalIssued: genesisAmount,
        claimed: 0n,
        burned: 0n,
        genesisMinted: genesisAmount === 0n,
        accountLimit: 0n,
        globalLimit: 0n,
        accountUsage: new Map<string, { day: bigint; amount: bigint }>(),
        globalUsage: { day: 0n, amount: 0n },
        used: new Set<string>(),
        paused: false,
      };
      const budgetOf = (c: number, day: bigint) => (refCumulative(prefix, day) * SHARES[c]) / BPS;
      let nonce = 0n;
      const usedVouchers: { v: { account: string; category: number; amount: bigint; nonce: bigint; deadline: bigint }; sig: string }[] = [];
      const counts: Record<string, number> = {};
      const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

      const nowDay = async () => (BigInt(await time.latest()) - genesisTime) / DAY;

      const checkViews = async () => {
        const t = BigInt(await time.latest());
        const started = t >= genesisTime;
        const day = started ? (t - genesisTime) / DAY : 0n;
        assert.equal(await emission.totalIssued(), m.totalIssued, "totalIssued");
        assert.ok(m.totalIssued <= CAP, "totalIssued above the cap");
        assert.equal(await emission.totalClaimed(), m.claimed, "totalClaimed");
        assert.equal(await emission.remainingSupply(), CAP - m.totalIssued, "remainingSupply");
        assert.equal(
          await token.totalSupply(),
          (m.genesisMinted ? genesisAmount : 0n) + m.claimed - m.burned,
          "token supply != genesis + claims - burns",
        );
        assert.equal(await emission.currentDay(), day, "currentDay");
        assert.equal(await emission.currentEpoch(), day / interval, "currentEpoch");
        assert.equal(await emission.currentDailyEmission(), started ? refDaily(day, initial, interval) : 0n, "currentDailyEmission");
        assert.equal(await emission.budgetToDate(), started ? refCumulative(prefix, day) : 0n, "budgetToDate");
        for (const c of [0, 1, 2]) {
          const budget = started ? budgetOf(c, day) : 0n;
          assert.ok(m.minted[c] <= budget, `category ${c} minted above its budget`);
          assert.equal(await emission.mintedByCategory(c), m.minted[c], `mintedByCategory ${c}`);
          const left = budget - m.minted[c];
          const capLeft = CAP - m.totalIssued;
          assert.equal(await emission.categoryRemaining(c), left < capLeft ? left : capLeft, `categoryRemaining ${c}`);
        }
        const rem = (limit: bigint, used: bigint) => (limit === 0n ? ethers.MaxUint256 : used >= limit ? 0n : limit - used);
        const g = started && m.globalUsage.day === day ? m.globalUsage.amount : 0n;
        assert.equal(await emission.globalClaimedToday(), g, "globalClaimedToday");
        assert.equal(await emission.globalDailyRemaining(), rem(m.globalLimit, g), "globalDailyRemaining");
        for (const a of accounts) {
          const u = m.accountUsage.get(a.address);
          const used = started && u && u.day === day ? u.amount : 0n;
          assert.equal(await emission.accountClaimedToday(a.address), used, "accountClaimedToday");
          assert.equal(await emission.accountDailyRemaining(a.address), rem(m.accountLimit, used), "accountDailyRemaining");
        }
      };

      /** Model of claim(): returns the amount minted, or the name of the expected custom error. */
      const predict = (account: string, c: number, amount: bigint, n: bigint, deadline: bigint, t: bigint, bySigner: boolean) => {
        if (m.paused) return "EnforcedPause";
        if (t < genesisTime) return "EmissionNotStarted";
        if (t > deadline) return "VoucherExpired";
        if (!bySigner) return "InvalidSigner";
        if (m.used.has(`${account}:${n}`)) return "NonceAlreadyUsed";
        const day = (t - genesisTime) / DAY;
        if (amount > budgetOf(c, day) - m.minted[c]) return "CategoryBudgetExceeded";
        const capLeft = CAP - m.totalIssued;
        if (capLeft === 0n) return "SupplyCapReached";
        const minted = amount < capLeft ? amount : capLeft;
        if (m.accountLimit !== 0n) {
          const u = m.accountUsage.get(account);
          const used = u && u.day === day ? u.amount : 0n;
          if (used + minted > m.accountLimit) return "AccountDailyLimitExceeded";
        }
        if (m.globalLimit !== 0n) {
          const used = m.globalUsage.day === day ? m.globalUsage.amount : 0n;
          if (used + minted > m.globalLimit) return "GlobalDailyLimitExceeded";
        }
        return minted;
      };
      const apply = (account: string, c: number, minted: bigint, n: bigint, t: bigint) => {
        const day = (t - genesisTime) / DAY;
        m.used.add(`${account}:${n}`);
        m.minted[c] += minted;
        m.totalIssued += minted;
        m.claimed += minted;
        if (m.accountLimit !== 0n) {
          const u = m.accountUsage.get(account);
          const used = u && u.day === day ? u.amount : 0n;
          m.accountUsage.set(account, { day, amount: used + minted });
        }
        if (m.globalLimit !== 0n) {
          const used = m.globalUsage.day === day ? m.globalUsage.amount : 0n;
          m.globalUsage = { day, amount: used + minted };
        }
      };

      const claimOp = async () => {
        if (m.paused && rng.next() < 0.8) {
          await emission.connect(pauser).unpause();
          m.paused = false;
        }
        const who = rng.pick(accounts);
        const c = rng.int(3) as Category;
        const t = BigInt(await time.latest()) + 1n; // timestamp of the next block (automine, +1s)
        const started = t >= genesisTime;
        const day = started ? (t - genesisTime) / DAY : 0n;
        const avail = started ? budgetOf(c, day) - m.minted[c] : 0n;
        const capLeft = CAP - m.totalIssued;
        const base = avail < capLeft || capLeft === 0n ? avail : capLeft;
        const x = rng.next();
        const clampProbe = capLeft < avail ? capLeft + 1n + rng.bigint(avail - capLeft) : avail; // in (capLeft, avail]
        let amount =
          x < 0.2 ? avail : x < 0.3 ? clampProbe : x < 0.4 ? avail + 1n : x < 0.5 ? capLeft + BigInt(rng.int(3)) : x < 0.8 ? (base * BigInt(1 + rng.int(100))) / 100n : rng.logRange(1n, CAP);
        if (amount === 0n) amount = 1n;
        let n = nonce++;
        let deadline = rng.next() < 0.05 ? t - 1n : FAR;
        let by = signer;
        const y = rng.next();
        let replay: (typeof usedVouchers)[number] | undefined;
        if (y < 0.05 && usedVouchers.length) replay = rng.pick(usedVouchers);
        else if (y < 0.08) by = oldSigner; // not (or no longer) a signer
        const v = replay ? replay.v : { account: who.address, category: c, amount, nonce: n, deadline };
        const sig = replay ? replay.sig : await signClaim(by, domain, v);
        const expected = predict(v.account, v.category, v.amount, v.nonce, v.deadline, t, by === signer);
        await time.setNextBlockTimestamp(t);
        const call = emission.connect(relayer).claim(v, sig);
        if (typeof expected === "string") {
          await expect(call, `claim expected ${expected}`).to.be.revertedWithCustomError(emission, expected);
          bump(`claim:${expected}`);
        } else {
          await expect(call).to.emit(emission, "Claimed").withArgs(v.account, v.category, v.nonce, v.amount, expected, signer.address);
          apply(v.account, v.category, expected, v.nonce, t);
          usedVouchers.push({ v, sig });
          bump(expected < v.amount ? "claim:clamped" : "claim:ok");
        }
      };

      const adminOp = async () => {
        const x = rng.next();
        const daily = refDaily((await nowDay()) < 0n ? 0n : await nowDay(), initial, interval);
        const pickLimit = () => rng.pick([0n, 0n, 1n, daily / 3n + 1n, daily, daily * 2n, CAP]);
        if (x < 0.35) {
          m.accountLimit = pickLimit();
          await emission.connect(admin).setAccountDailyLimit(m.accountLimit);
          bump("setAccountDailyLimit");
        } else if (x < 0.7) {
          m.globalLimit = pickLimit();
          await emission.connect(admin).setGlobalDailyLimit(m.globalLimit);
          bump("setGlobalDailyLimit");
        } else if (x < 0.8) {
          if (m.paused) await emission.connect(pauser).unpause();
          else await emission.connect(pauser).pause();
          m.paused = !m.paused;
          bump("pause");
        } else if (x < 0.9 && !m.genesisMinted) {
          await emission.mintGenesis();
          m.genesisMinted = true;
          bump("mintGenesis");
        } else {
          // a holder burns: totalSupply goes down, emission room must not come back
          const holder = rng.pick([...accounts, treasury]);
          const bal = await token.balanceOf(holder.address);
          if (bal > 0n) {
            const amt = (bal * BigInt(1 + rng.int(100))) / 100n;
            await token.connect(holder).burn(amt);
            m.burned += amt;
            bump("burn");
          }
        }
      };

      const timeOp = async () => {
        const t = BigInt(await time.latest());
        const x = rng.next();
        let target: bigint;
        if (x < 0.4) {
          // land exactly on, just before, or just after a day boundary
          const dayNow = t < genesisTime ? -1n : (t - genesisTime) / DAY;
          const boundary = genesisTime + (dayNow + 1n + BigInt(rng.int(2))) * DAY;
          target = boundary + BigInt(rng.int(3)) - 2n; // boundary - 2 .. boundary (the claim adds +1s)
        } else {
          target = t + BigInt(rng.int(Number(DAY * 3n)));
        }
        if (target > t) await time.increaseTo(target);
        bump("time");
      };

      await checkViews();
      for (let step = 0; step < STEPS; step++) {
        const x = rng.next();
        if (x < 0.6) await claimOp();
        else if (x < 0.75) await adminOp();
        else await timeOp();
        await checkViews();
      }
      // jump past the end of the schedule (unless the random walk already did) and drain whatever is left
      const endOfSchedule = genesisTime + 64n * interval * DAY + 10n * DAY;
      if (endOfSchedule > BigInt(await time.latest())) await time.increaseTo(endOfSchedule);
      for (const c of [0, 1, 2]) {
        if (m.paused) {
          await emission.connect(pauser).unpause();
          m.paused = false;
        }
        m.accountLimit = 0n;
        m.globalLimit = 0n;
        await emission.connect(admin).setAccountDailyLimit(0n);
        await emission.connect(admin).setGlobalDailyLimit(0n);
        const t = BigInt(await time.latest()) + 1n;
        const day = (t - genesisTime) / DAY;
        const amount = budgetOf(c, day) - m.minted[c];
        if (amount === 0n) continue;
        const v = { account: accounts[0].address, category: c, amount, nonce: nonce++, deadline: FAR };
        const expected = predict(v.account, c, amount, v.nonce, FAR, t, true);
        await time.setNextBlockTimestamp(t);
        const call = emission.connect(relayer).claim(v, await signClaim(signer, domain, v));
        if (typeof expected === "string") await expect(call).to.be.revertedWithCustomError(emission, expected);
        else {
          await call;
          apply(v.account, c, expected, v.nonce, t);
        }
        await checkViews();
      }
      // at the end: either the cap is exhausted, or every category got exactly its full share of the schedule
      const total = await emission.totalScheduledEmission();
      if (m.totalIssued < CAP) {
        for (const c of [0, 1, 2]) assert.equal(m.minted[c], (total * SHARES[c]) / BPS, `category ${c} did not get its full share`);
      }
      if (process.env.REVIEW_DEBUG) console.log(seed.toString(16), { interval, initial: initial / E18, genesis: genesisAmount / E18 }, counts);
      for (const k of Object.keys(counts)) seen.add(k);
      expect(Object.keys(counts).length).to.be.greaterThan(5);
    });
  }

  it("exercised every claim outcome across the runs (clamp, cap, budget, limits, pause, replay, expiry, signer)", function () {
    if (process.env.REVIEW_SEED) this.skip();
    for (const k of [
      "claim:ok",
      "claim:clamped",
      "claim:SupplyCapReached",
      "claim:CategoryBudgetExceeded",
      "claim:AccountDailyLimitExceeded",
      "claim:GlobalDailyLimitExceeded",
      "claim:EnforcedPause",
      "claim:NonceAlreadyUsed",
      "claim:VoucherExpired",
      "claim:InvalidSigner",
      "claim:EmissionNotStarted",
      "burn",
      "mintGenesis",
    ]) {
      expect(seen.has(k), `${k} never happened`).to.equal(true);
    }
  });
});
