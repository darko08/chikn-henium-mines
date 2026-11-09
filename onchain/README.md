# Chikn Henium Mines — on-chain contracts

Solidity contracts for the economy of the browser game in `../` (see `../docs/VIEW-GUIDE.md`, "Tokenomics v3" and
"Economy rules", and `../src/js/dex.js` / `../src/js/state.js`):

- **HENIUM**: a 21M-capped token whose supply is released by a bitcoin-like schedule (7,200 HENIUM/day, halving every
  1,458 days), split 70% refiners / 20% guild-war fighters / 10% monster hunters. Nothing else mints it.
- **Gateways**: in-game balances move on and off chain through EIP-712 vouchers signed by the game server: an
  emission contract for newly earned HENIUM, an escrow vault for HENIUM that already exists, and a bridge for the 13
  in-game resources (as ERC-20s).
- **DEX**: a constant-product AMM (Uniswap V2 design, original MIT implementation) with a 0.30% fee, of which 0.10%
  is **burned** on every swap. Any resource trades through HENIUM, and EGG and HENIUM sell for ETH.

> **Status: unaudited prototype.** Testnets only. The deploy script refuses known mainnet chain ids. See
> [Before mainnet](#before-mainnet).

Hardhat 2.28.6, `@nomicfoundation/hardhat-toolbox` 6.1.2 (the `hh2` tag; 7.0.0 is a placeholder that refuses to run),
ethers v6, OpenZeppelin Contracts 5.4.0, Solidity 0.8.28 with the optimizer on (200 runs), `evmVersion: cancun`.
All versions are pinned exactly in `package.json`. License: MIT.

---

## Contents

- [Architecture](#architecture)
- [Contracts and roles](#contracts-and-roles)
- [HENIUM emission schedule](#henium-emission-schedule)
- [DEX fee and burn math](#dex-fee-and-burn-math)
- [How the game server uses vouchers](#how-the-game-server-uses-vouchers)
- [Trust model and threat model](#trust-model-and-threat-model)
- [Known limitations](#known-limitations)
- [Before mainnet](#before-mainnet)
- [Networks](#networks)
- [Build, test, coverage, gas, deploy](#build-test-coverage-gas-deploy)
- [Design decisions](#design-decisions)
- [Credits](#credits)

---

## Architecture

```
                 +-------------------------- game server (off-chain player ledger) ---------------------------+
                 |  signs EIP-712 vouchers with SIGNER_ROLE keys (HSM/KMS), watches Deposited events          |
                 +---------+-----------------------------+------------------------------+-------------------+
                    Claim  |                     Release |                   Withdrawal |
                 (earned)  v              (move out)     v           (resources out)    v
+--------------+  mint  +------------------+        +------------------+       +------------------+  mint   +-----------------------+
| HeniumToken  |<-------| HeniumEmission   |        | HeniumGameVault  |       | ResourceBridge   |-------->| GameResourceToken x13 |
| ERC-20, 21M  |        | schedule, 70/20/ |        | escrow: deposit, |       | registry, daily  |<--------| Stone ... Circuit     |
| cap, permit, |        | 10 budgets, cap, |        | release (voucher)|       | mint caps        |  burn   | mint: bridge only     |
| burnable     |        | daily limits     |        | burnSunk         |       |                  | (deposit)| burnable, permit      |
+------+-------+        +------------------+        +--------+---------+       +------------------+         +-----------+-----------+
       |   ^ deposit / release (transfers, never mints)       |                                                         |
       |   +--------------------------------------------------+                                                         |
       v                                                                                                                v
+---------------------------------------------- DEX: permissionless, no admin, no protocol fee ---------------------------------+
|  HeniumDexFactory --CREATE2--> HeniumDexPair  (LP ERC-20 + permit; x*y=k; 0.30% fee = 0.10% burned + 0.20% to LPs;            |
|                                                MINIMUM_LIQUIDITY; reentrancy lock; TWAP accumulators; flash swaps)            |
|  HeniumDexRouter: quotes, add/remove liquidity (ETH via WETH), exact-in / exact-out multi-hop swaps, deadlines, slippage     |
|  seeded pools: HENIUM/WETH, mEGG/HENIUM (mock EGG), STONE/HENIUM;  any RESOURCE/HENIUM pool can be added the same way         |
+--------------------------------------------------------------------------------------------------------------------------------+
```

Player flows:

| Flow | On chain |
|---|---|
| Earn HENIUM (refining, wars, hunts) | server signs a `Claim` -> anyone submits `HeniumEmission.claim` -> HENIUM minted to the player |
| HENIUM into the game | `HeniumGameVault.deposit(amount, playerId)` (or `depositWithPermit`) -> escrow, `Deposited` event |
| HENIUM out of the game | server debits in game, signs a `Release` -> `HeniumGameVault.release` pays from escrow |
| HENIUM spent in game (dig, build, hires...) | server batches it -> `HeniumGameVault.burnSunk(amount, reason)` |
| Resources out of the game | server debits, signs a `Withdrawal` -> `ResourceBridge.withdraw` mints the token |
| Resources into the game | `ResourceBridge.deposit(token, amount, playerId)` burns them (needs an allowance) |
| Trade | `HeniumDexRouter`, e.g. path `[STONE, HENIUM, WETH]` with `swapExactTokensForETH` |

## Contracts and roles

| Contract | Purpose | Roles (holder in production) |
|---|---|---|
| `HeniumToken` | ERC-20 "Henium"/"HENIUM", 18 decimals. OZ `ERC20Capped(21,000,000e18)`, `ERC20Burnable`, `ERC20Permit`, `AccessControl`. No pause, no blacklist, no fee, no other admin power over balances. | `DEFAULT_ADMIN_ROLE` (deployer -> **renounced** after granting `MINTER_ROLE`), `MINTER_ROLE` (`HeniumEmission` only) |
| `HeniumEmission` | The only minter. Immutable schedule; per-category budgets; 21M cap including genesis; EIP-712 `Claim` vouchers; optional per-account and global daily limits; pause. | `DEFAULT_ADMIN_ROLE` (multisig + timelock), `SIGNER_ROLE` (game server keys), `PAUSER_ROLE` (guardian) |
| `HeniumGameVault` | Escrow gateway for existing HENIUM: `deposit`/`depositWithPermit`, `release` (voucher), `burnSunk`; optional daily release cap. Never mints; never pays more than it holds. | admin, `SIGNER_ROLE`, `PAUSER_ROLE`, `BURNER_ROLE` (server's sink-accounting key) |
| `GameResourceToken` | One ERC-20 per resource (13). Mintable only by its immutable `bridge`; burnable; permit. No admin. | none |
| `ResourceBridge` | Mints resources on `Withdrawal` vouchers, burns them on `deposit`. Admin-registered tokens only (must name this bridge as theirs), optional per-token daily mint cap; pause. | admin (registry, caps), `SIGNER_ROLE`, `PAUSER_ROLE` |
| `base/VoucherBase` | Abstract base of the three gateways: EIP-712 domain, signature check against `SIGNER_ROLE`, per-account **nonce bitmap**, `cancelNonce`, deadline, `pause`/`unpause`. | |
| `dex/HeniumDexFactory` | Creates one pair per token pair (CREATE2, salt `keccak256(token0, token1)`); `getPair`, `allPairs`. | none |
| `dex/HeniumDexPair` | Constant-product pool + LP ERC-20 (permit): `mint`/`burn`/`swap`/`skim`/`sync`, `MINIMUM_LIQUIDITY` (1,000 LP locked at `0x…dEaD`), `nonReentrant` lock, TWAP accumulators, flash swaps (`IHeniumDexCallee.heniumDexCall`), fee burn. | none |
| `dex/HeniumDexRouter` | `getAmountOut/In`, `getAmountsOut/In`, `quote`; `addLiquidity(ETH)`, `removeLiquidity(ETH)`; `swapExactTokensForTokens`, `swapTokensForExactTokens`, `swapExactETHForTokens`, `swapTokensForExactETH`, `swapExactTokensForETH`, `swapETHForExactTokens`. Deadlines and slippage limits; pairs via `factory.getPair`. | none |
| `dex/libraries/HeniumDexLibrary` | Fee constants and the shared constant-product math, with the proof below. | |
| `mocks/MockERC20` | **Test/testnet only**, open faucet. Stands in for EGG/FEED (`mEGG`). Deliberately not burnable. | |
| `mocks/WETH9` | Original MIT WETH9-compatible wrapper for local/testnets, including canonical WETH9's catch-all payable fallback. | |
| `test/*` | Test-only attack/edge contracts: re-entrant `HookToken`, misbehaving `TrickyBurnToken`, USDT-style `NoReturnToken`, `FlashBorrower`, ETH-refusing `RejectingCaller`. Excluded from coverage and the gas report. | |

**Do not name a production token EGG or FEED.** The real EGG and FEED are existing Chikn tokens (Avalanche C-Chain);
using them in pools or in the game needs their owners' permission. Here they are replaced by `MockERC20 "mEGG"`.

## HENIUM emission schedule

```
epoch(day)              = day / halvingIntervalDays
dailyEmission(day)      = initialDailyEmission >> epoch(day)        (0 after 64 halvings)
cumulativeEmission(day) = sum of dailyEmission(0..day)               closed form per epoch, <= 64 iterations
budget(category)        = cumulativeEmission(today) * share / 10_000  share: REFINERY 7000, WAR 2000, HUNT 1000
claim allowed iff         mintedByCategory[c] + amount <= budget(c)   (unclaimed budget carries over)
```

Defaults (`DEFAULT_INITIAL_DAILY_EMISSION = 7,200e18`, `DEFAULT_HALVING_INTERVAL_DAYS = 1,458`):

| Epoch | Days | Years | HENIUM per day | Emitted in epoch | Cumulative at epoch end | % of 21M |
|---:|---|---|---:|---:|---:|---:|
| 0 | 0–1457 | 0.0–4.0 | 7,200 | 10,497,600 | 10,497,600 | 49.99% |
| 1 | 1458–2915 | 4.0–8.0 | 3,600 | 5,248,800 | 15,746,400 | 74.98% |
| 2 | 2916–4373 | 8.0–12.0 | 1,800 | 2,624,400 | 18,370,800 | 87.48% |
| 3 | 4374–5831 | 12.0–16.0 | 900 | 1,312,200 | 19,683,000 | 93.73% |
| 4 | 5832–7289 | 16.0–20.0 | 450 | 656,100 | 20,339,100 | 96.85% |
| 5 | 7290–8747 | 20.0–24.0 | 225 | 328,050 | 20,667,150 | 98.42% |
| 6 | 8748–10205 | 24.0–27.9 | 112.5 | 164,025 | 20,831,175 | 99.20% |
| 7 | 10206–11663 | 27.9–31.9 | 56.25 | 82,012.5 | 20,913,187.5 | 99.59% |
| 8 | 11664–13121 | 31.9–35.9 | 28.125 | 41,006.25 | 20,954,193.75 | 99.78% |
| 9 | 13122–14579 | 35.9–39.9 | 14.0625 | 20,503.125 | 20,974,696.875 | 99.88% |
| 10 | 14580–16037 | 39.9–43.9 | 7.03125 | 10,251.5625 | 20,984,948.4375 | 99.93% |
| 20 | 29160–30617 | 79.8–83.8 | 0.0068665 | 10.0113 | 20,995,189.9887 | 99.98% |
| 32 | 46656–48113 | 127.7–131.7 | 0.0000017 | 0.0024 | 20,995,199.9976 | 99.98% |
| 63 | 91854–93311 | 251.5–255.5 | 780 wei | 0.0000000000011 | 20,995,199.999999999998835058 | 99.98% |
| 64+ | 93312– | 255.5+ | 0 | 0 | (same) | |

This mirrors bitcoin (10.5M in the first epoch, halving every ~4 years, ~21M in total). The whole schedule,
`totalScheduledEmission()`, is 20,995,199.999999999998835058 HENIUM: **4,800 HENIUM below the cap**.

**Cap rule (clamp).** `HeniumEmission` counts everything it ever issued in `totalIssued` (the genesis allocation from
construction, plus every claim). A claim that would push `totalIssued` above 21M is **clamped** to what is left: the
`Claimed` event carries both `requested` and `minted`, and `claim` returns the minted amount. Once nothing is left,
claims revert with `SupplyCapReached`. Burns never create emission room: burned HENIUM is gone, as with bitcoin.
Clamping lets the last claims take exactly what is left; like the game prototype, nothing is ever paid out beyond 21M.

**Genesis.** An optional `genesisAmount` for a treasury is reserved at construction and minted once by the
permissionless `mintGenesis()` (after the token grants `MINTER_ROLE`). It counts toward the cap, so **any genesis above
4,800 HENIUM makes the cap truncate the far tail of the emission**: the emission stops when `totalIssued` reaches 21M,
and the categories then compete for the last HENIUM on a first-come basis.

| Genesis | Emission room | Cap reached |
|---:|---:|---|
| ≤ 4,800 | ≥ 20,995,200 | never (full schedule) |
| 100,000 (deploy-script default for local/testnets) | 20,900,000 | day 11,429 (~31.3 years, epoch 7) |
| 1,000,000 | 20,000,000 | day 6,536 (~17.9 years, epoch 4) |
| 2,100,000 (10%) | 18,900,000 | day 4,962 (~13.6 years, epoch 3) |

Days are counted from the immutable `genesisTime` (`(block.timestamp - genesisTime) / 1 days`); day 0's budget is
available from the first second of day 0. Views: `currentDay`, `currentEpoch`, `currentDailyEmission`,
`nextHalvingTime`, `epochStartTime`, `budgetToDate`, `categoryBudget`, `categoryRemaining`, `remainingSupply`,
`accountDailyRemaining`, `globalDailyRemaining`.

## DEX fee and burn math

Every swap pays **0.30% of its input**: **0.10% is burned**, **0.20% stays in the pool** for LPs. Per hop:

```
router quote          out = in * 9970 * rOut / (rIn * 10000 + in * 9970)          (rounded down)
                      in  = rIn * out * 10000 / ((rOut - out) * 9970) + 1           (exact output)
pair, after sending   amountIn_i = balance_i - (reserve_i - amountOut_i)            for each token
the outputs           burn_i     = amountIn_i * 10 / 10000
                      try IERC20Burnable(token).burn(burn_i)
                      if the balance did not drop by burn_i (burn reverted, or a fallback swallowed it -
                        canonical WETH9 does exactly that): transfer the shortfall to 0x…dEaD (best effort)
                      re-read balances (the burn is never trusted), then require
                      (b0*10000 - in0*20) * (b1*10000 - in1*20) >= r0 * r1 * 10000^2
```

**Proof that the k-check accepts exactly the router quotes** (also in `HeniumDexLibrary.sol`). Swap `in` of X for
`out` of Y. The pair burns `b = floor(in*10/10000)`, so `B = rIn + in - b` and, because `b*10000 <= in*10`,

```
B*10000 - in*20  =  rIn*10000 + in*10000 - b*10000 - in*20  >=  rIn*10000 + in*9970  =: D
```

So the check `(B*10000 - in*20) * (rOut - out) * 10000 >= rIn*rOut*10000^2` holds whenever
`D * (rOut - out) >= rIn*rOut*10000`, i.e. whenever `out <= in*9970*rOut / D`, which is exactly the router formula.
When `in` is a multiple of 1,000 wei the burn has no rounding, `B*10000 - in*20 = D`, and `out + 1` fails. The
`getAmountIn` result is strictly above `rIn*out*10000 / ((rOut-out)*9970)`, which rearranges to
`getAmountOut(in) >= out`. Tests check this numerically (`test/dex/FeeMath.test.ts`: 20,000 random cases in BigInt
arithmetic, plus 60 random swaps on chain at exactly the quote, with `quote + 1` rejected when the burn is exact).

Consequences: `k' = (rIn + in - b)(rOut - out) > rIn*rOut`, so k never decreases on swaps and one LP share,
`sqrt(k)/totalSupply`, gains value from the 0.20%. Who burns how:

| Token | What happens to the 0.10% |
|---|---|
| HENIUM, all `GameResourceToken`s | `burn()`: `totalSupply` goes down (`FeeBurned` event on the pair, `Transfer` to `0x0` on the token) |
| WETH9 (WETH, WAVAX) | `burn()` hits the payable fallback and does nothing; the pair detects it and sends the WETH to `0x…dEaD` |
| plain ERC-20s (the mEGG mock, USDT-style tokens) | `burn()` reverts; sent to `0x…dEaD` |
| a token that refuses both | the fee stays in the pool (LPs keep it); the swap still works |

Flash swaps repaid in the borrowed token cost ~0.3009% (as in Uniswap V2), and the repayment's 0.10% is burned too.
Example on a deep pool: 1,000 HENIUM in -> 997 HENIUM-worth out, 1 HENIUM burned, 2 HENIUM added to LP reserves.

## How the game server uses vouchers

Voucher types (EIP-712, domain `{name, version: "1", chainId, verifyingContract}`):

```
HeniumEmission  "HeniumEmission"   Claim(address account,uint8 category,uint256 amount,uint256 nonce,uint256 deadline)
HeniumGameVault "HeniumGameVault"  Release(address account,uint256 amount,uint256 nonce,uint256 deadline)
ResourceBridge  "ResourceBridge"   Withdrawal(address account,address token,uint256 amount,uint256 nonce,uint256 deadline)
```

`scripts/lib/vouchers.ts` is the reference signer (types, domains, `signClaim` / `signRelease` / `signWithdrawal`):

```ts
import { ethers } from "ethers";
import { Category, DOMAIN_NAMES, domainFor, signClaim } from "./scripts/lib/vouchers";

// The server computed this player's share of today's world emission (refinery power, war points, hunt points:
// the game's G.refShare / G.warShare / G.huntShare) and recorded it in its ledger under (wallet, nonce).
const domain = await domainFor(emission, DOMAIN_NAMES.emission, chainId); // chainId + contract address
const voucher = { account: wallet, category: Category.REFINERY, amount: ethers.parseEther("12.5"), nonce, deadline: now + 3600n };
const signature = await signClaim(serverKey, domain, voucher); // EIP-712 signTypedData with CLAIM_TYPES
// the player (or a relayer paying the gas) then calls: await emission.claim(voucher, signature)
```

Server rules:

1. **Ledger first.** Debit the in-game balance (release, withdrawal) or record the earned amount (claim) *before*
   signing, keyed by `(account, nonce)`.
2. **Nonces.** Any unused `uint256` per account; each works once, in any order (a 256-bit bitmap per storage word),
   so several vouchers can be outstanding. Use sequential nonces per account (cheapest: same storage word).
3. **Short deadlines** (minutes to an hour). A voucher whose deadline has passed and whose nonce is still unused
   (`isNonceUsed == false`) can never be redeemed: only then refund the player. To revoke earlier, call
   `cancelNonce(account, nonce)` from a `SIGNER_ROLE` key (only the issuer can cancel, so the server always knows
   whether a nonce was redeemed or cancelled), then refund.
4. **Credit deposits idempotently** from `Deposited(from, playerId, amount)` (vault) and
   `Deposited(account, token, playerId, amount)` (bridge), keyed by `(txHash, logIndex)`, after finality.
5. **Batch sinks**: periodically `burnSunk(total, reason)` the HENIUM players spent in game, so on-chain supply follows
   in-game burns.
6. **Reconcile**: every `Claimed` / `Released` / `Withdrawn` event must match a ledger entry; alert (and pause) on
   any unknown `(account, nonce)`. Events include the `signer`, so a leaked key is identified at once.
7. `hashClaim` / `hashRelease` / `hashWithdrawal` return the exact digest a signer must sign (use them to test a KMS
   integration).

## Trust model and threat model

**Trustless (enforced by code, whatever the server signs):** HENIUM supply never exceeds the schedule or 21M; nothing
but `HeniumEmission` mints (once the token admin is renounced); burns are permanent; the vault never mints and never
pays out more than it holds; vouchers can't be replayed, used after their deadline, or used on another chain, contract
or gateway; resource tokens are minted only by their bridge; the DEX has no admin at all.

**Trusted:** the game server decides *who* receives the emission (fair distribution is an off-chain promise), keeps the
player ledger behind the vault and the bridge, and holds `SIGNER_ROLE` and `BURNER_ROLE`. The admin manages roles,
limits and the token registry.

| If this is compromised | It could | It could not | Mitigations |
|---|---|---|---|
| A `SIGNER_ROLE` key | mint HENIUM to itself up to the *unclaimed* category budgets accrued so far; release the vault's whole escrow; mint unlimited resource tokens and sell them on the DEX (draining the HENIUM side of resource pools); cancel outstanding vouchers (griefing) | exceed the schedule or the 21M cap; mint outside the emission; change any parameter or role; unpause; touch the DEX; move or burn anyone's tokens | **rate limits**: `setGlobalDailyLimit` (e.g. 1–2x the daily emission), `setAccountDailyLimit`, `setDailyReleaseCap`, per-token `setDailyMintCap`; **guardian pause** on the first unknown event; **signer rotation** (several `SIGNER_ROLE` keys, revoke the leaked one: its outstanding vouchers die at once); HSM/KMS keys; a different key per gateway; short deadlines |
| `BURNER_ROLE` | burn the vault's escrow (destroying the backing of in-game balances) | burn anything outside the vault | separate key from the signers; pause; small batches |
| `PAUSER_ROLE` | pause (denial of service), or lift a pause | anything else | a guardian multisig / monitoring bot; keep it separate from the admin |
| `DEFAULT_ADMIN_ROLE` | grant itself every role above, lift limits, register tokens; on the token, while not renounced, add a minter (up to the cap) | change the schedule, the shares or the cap (immutable); touch the DEX | **multisig + timelock** (e.g. a Safe 3-of-5 behind an OZ `TimelockController` with a 48 h delay) so the community can exit before changes; **renounce the token's admin** after granting `MINTER_ROLE` (`RENOUNCE_TOKEN_ADMIN=true`) to freeze the minter set forever |
| A malicious token in a pool | only hurt that pool's own LPs (its hooks run inside the pair's `nonReentrant` lock; burns and balances are always re-checked) | affect other pools, HENIUM, or the router | the game UI lists only vetted pools |
| Traders / MEV | sandwich swaps with loose slippage | break k or steal LP funds | `amountOutMin` / `amountInMax` and deadlines on every router call; UI defaults of 0.5–1% |

## Known limitations

- **Centralised distribution.** The contract bounds the *total* emission per category, not each player's share; the
  server's share formulas (refinery power, war points, hunt points) are off chain. Unclaimed budget carries over, so it
  is available to a leaked signer key: keep the global daily limit on and claim promptly.
- **ERC20Capped bounds `totalSupply`.** If the token admin is not renounced and a second minter is added, burned
  headroom could be re-minted by it (the emission itself never re-issues). Renounce the token admin.
- **Per-account limits are Sybil-able**; the global limit is the real backstop. Emission limits use emission days
  (from `genesisTime`), vault and bridge caps use UTC days; emission usage is tracked only while a limit is enabled.
- **Clamp at the cap**: the claim that crosses 21M consumes its nonce while minting less than requested (the event
  says how much). With a genesis above 4,800 HENIUM the last epochs mint less or nothing.
- **Read-only reentrancy windows** (as in Uniswap V2): during a flash-swap callback, or a malicious token's
  burn/transfer hook, `getReserves()` of that pair is stale. Integrators must use the TWAP accumulators, not spot.
- **Unsupported tokens**: fee-on-transfer and rebasing tokens make router quotes wrong (the pair itself stays safe,
  since it works from balances); there are no `...SupportingFeeOnTransferTokens` router functions. The uint32
  timestamp wraps in 2106 (handled, as in V2).
- **Fees of non-burnable tokens are parked at `0x…dEaD`**, so their `totalSupply()` does not show the burn.
- **No upgradeability.** Everything is immutable; a bug means pausing gateways and migrating. Resource tokens are
  bound to their bridge forever.
- **Signers are EOAs/KMS keys** (ECDSA); ERC-1271 contract signers are not supported.
- **No router permit helpers** (`removeLiquidityWithPermit`); LP tokens support EIP-2612, so a later router can add
  them.

## Before mainnet

1. **An independent security audit** (two firms ideally), then fix and re-test; a public **bug bounty**
   (e.g. Immunefi) and a staged launch with low limits.
2. **Legal review** of HENIUM, its distribution and any token sale (securities law in each target market), of gaming
   and gambling regulations (play-to-earn rewards, loot), consumer protection, tax reporting and sanctions screening.
3. **Brand permission**: Chikn is an existing brand, and EGG and FEED are existing tokens of its owners. Using the name,
   art or tokens needs their written permission.
4. Operations: multisig + timelock admin, renounced token admin, guardian pause with monitoring and alerting,
   HSM/KMS signer keys with rotation runbooks, conservative daily limits, and per-token bridge caps set from observed
   in-game production.
5. Decide the genesis allocation (0, or <= 4,800 HENIUM to keep the full schedule) and `genesisTime`; verify the
   contracts' source code on the block explorer; seed liquidity deliberately (there are no NPC market makers on chain,
   unlike the prototype).

## Networks

| Network | Fit |
|---|---|
| Ethereum L1 | Most secure, but every action costs ~50k–200k gas (a 1-hop swap ~111k, a claim ~83k–134k): from tens of cents to several dollars each, depending on the gas price. Too expensive for a game's frequent small transactions. |
| L2 rollups: **Base**, **Arbitrum One**, Optimism | Cents per transaction, Ethereum security, broad wallet and exchange support. Base's WETH is the canonical WETH9 predeploy `0x4200000000000000000000000000000000000006` (its fallback swallows `burn()`, which the pair handles). Good default. |
| **Avalanche C-Chain** | Where the existing EGG and FEED live, so EGG pools need no bridge (with the owners' permission); low fees; WAVAX is a WETH9 clone. Cancun opcodes are live since the Etna upgrade. |
| Robinhood Chain (Arbitrum-based L2) | Mentioned in the original design notes; check its maturity, tooling and liquidity first. |

Testnets: Base Sepolia (84532), Arbitrum Sepolia (421614), Avalanche Fuji (43113). The contracts target `cancun`.
OpenZeppelin 5.4.0 was chosen partly because nothing used here needs Cancun-only opcodes: the code also compiles for
`shanghai`, for a chain that lacks `MCOPY`/transient storage (change `evmVersion` in `hardhat.config.ts`).

## Build, test, coverage, gas, deploy

```bash
cd onchain
npm ci
npx hardhat compile                         # solc 0.8.28 is downloaded on first use
npx hardhat test                            # 136 tests
npx hardhat coverage                        # report in coverage/index.html
REPORT_GAS=true npx hardhat test            # gas per method over the whole suite -> gas-report.txt
npx hardhat run scripts/gas-benchmark.ts    # gas of the key actions in their typical (warm) form
npm run typecheck                           # tsc --noEmit over scripts and tests
```

Test suites (`test/`): `HeniumToken` (cap, roles, permit, burn), `HeniumEmission` (schedule vs an independent
day-by-day JS reference over all 64 epochs, time travel across halvings, day boundaries, budgets, claims, replay,
expiry, wrong signer / chain / contract / domain, malleable signatures, rotation, the cap with genesis, pause, daily
limits), `HeniumGameVault`, `ResourceBridge`, `dex/FactoryPair` (liquidity, every burn path, skim/sync, overflow,
TWAP incl. same-block and uint32 wrap, flash swaps, reentrancy via callback and via malicious tokens), `dex/Router`
(quotes, liquidity, all six swaps, ETH paths, multi-hop routing through HENIUM, slippage, deadlines),
`dex/FeeMath` (the proof, numerically), `dex/Fuzz` (fixed-seed property test: 300 random operations, invariants checked
after each), `Integration` (the deploy script, and a player's journey end to end), `Mocks`.

Results at the time of writing: **136 passing**; coverage **100% statements, 100% branches, 100% functions, 100% lines**
for every contract in `contracts/` (test-only helpers in `contracts/test/` are excluded). Mutation check: 12 injected
bugs (fee off by 1 bp, k-check removed, LP fee ignored, no dEaD fallback, schedule off by an epoch, no cap clamp,
replayable nonces, no deadline, no escrow check, `getAmountIn` without `+1`, no category budget, no signer check)
were each caught by the suite.

Typical gas (from `scripts/gas-benchmark.ts`; "first" rows include one-time zero-to-non-zero storage writes):

| Action | Gas |
|---|---:|
| `swapExactTokensForTokens` 1 hop, HENIUM -> STONE (HENIUM burned) | 110,892 |
| `swapExactTokensForTokens` 1 hop, mEGG -> HENIUM (fee to dEaD) | 112,867 |
| `swapExactTokensForTokens` 2 hops, STONE -> HENIUM -> mEGG | 175,964 |
| `swapExactETHForTokens` ETH -> HENIUM / `swapExactTokensForETH` HENIUM -> ETH | 127,790 / 132,262 |
| `swapExactTokensForETH` 2 hops, STONE -> HENIUM -> ETH | 197,345 |
| `HeniumDexPair.swap` direct | 83,468 |
| `addLiquidity` / `addLiquidityETH` (existing pool) / `removeLiquidity` | 108,207 / 125,469 / 111,704 |
| `HeniumEmission.claim`: first for an account / next / with both limits on | 133,967 / 82,655 / 93,831 |
| `HeniumGameVault.deposit`: first / later | 83,942 / 49,742 |
| `HeniumGameVault.release`: first / later; `burnSunk` | 122,821 / 71,647; 67,168 |
| `ResourceBridge.withdraw` (new holder / existing); `deposit` | 103,182 / 68,994; 47,121 |
| `HeniumDexFactory.createPair` | ~2.28M |

Voucher calls vary by a few dozen gas between runs: signatures and deadlines differ, and calldata costs 4 gas per zero
byte and 16 per non-zero byte.

### Deploy

```bash
npx hardhat run scripts/deploy.ts                 # in-process Hardhat network (also runs a smoke swap)

# a testnet (throwaway key, never a mainnet key; never commit it):
export RPC_URL=https://sepolia.base.org PRIVATE_KEY=0x... CHAIN_ID=84532
export WETH_ADDRESS=0x4200000000000000000000000000000000000006
npx hardhat run scripts/deploy.ts --network testnet
```

The script deploys HENIUM, the emission (defaults 7,200/day, 1,458-day halvings; genesis 100,000 HENIUM to the
treasury for seeding), the vault, the bridge and the 13 resource tokens (registered), the DEX, WETH9 and the mEGG mock
(unless `WETH_ADDRESS` / `EGG_ADDRESS` are given); grants `MINTER_ROLE`, `SIGNER_ROLE`, `PAUSER_ROLE`, `BURNER_ROLE`;
creates and seeds HENIUM/WETH (10,000 HENIUM + 4 ETH), mEGG/HENIUM (10,000 + 2,500) and STONE/HENIUM (100M + 4,000) at
the prototype's prices (`SEED_SCALE`, default 1 locally and 0.01 elsewhere; Stone comes through a signed bridge voucher,
like a player's); optionally hands every admin role to `ADMIN_ADDRESS` and renounces the token admin
(`RENOUNCE_TOKEN_ADMIN=true`); writes `deployments/<network>.json` (addresses, roles, pools, EIP-712 domains) and exports
ABIs to `abi/`. Other env: `SIGNER_ADDRESS`, `PAUSER_ADDRESS`, `BURNER_ADDRESS`, `TREASURY_ADDRESS`, `GENESIS_AMOUNT`,
`GENESIS_TIME`, `RESOURCE_DAILY_CAP`, `SEED_POOLS`. `npx hardhat run scripts/export-abi.ts` re-exports the ABIs only.
More RESOURCE/HENIUM pools: `router.addLiquidity(resource, HENIUM, ...)` creates the pair on first use.

## Design decisions

- **Clamp, not revert, at the cap**: the last claims get exactly what is left (the prototype never pays beyond 21M
  either), reported in the event and the return value.
- **`totalIssued` includes genesis from construction** (a reservation), so claims can never eat into the genesis, and
  it never decreases, so burns are final. `mintGenesis` is permissionless: amount and recipient are immutable.
- **Nonce bitmap** instead of a counter: out-of-order redemption, many outstanding vouchers, cheap sequential use;
  issuer-only `cancelNonce` keeps the server's view unambiguous.
- **Anyone may submit a voucher** (relayers / gasless UX); tokens always go to `voucher.account`.
- **Optional global daily limit** on the emission in addition to the per-account limit asked for: per-account limits
  alone do not bound a leaked signer key. The vault and bridge get matching daily caps.
- **Pairs take `token0`/`token1` as constructor arguments (immutables)** instead of Uniswap's `initialize`: possible
  because the router looks pairs up with `getPair`, and cheaper on every swap.
- **The fee burn verifies balances.** Canonical WETH9's payable fallback makes `burn()` "succeed" without burning;
  a pair that trusted `try burn()` would silently keep the WETH fee. The pair compares balances and falls back to
  `0x…dEaD`, and a token that refuses both cannot brick its pool.
- **No protocol fee, no factory admin**: nothing on the DEX can be changed after deployment.
- **Resource tokens have no admin**; the bridge is immutable per token, and registration checks `token.bridge()`.

## Credits

The DEX is an original MIT-licensed implementation of the design of **Uniswap V2** by Hayden Adams, Noah Zinsmeister
and Dan Robinson ("Uniswap v2 Core", 2020): constant-product pairs with LP tokens, `MINIMUM_LIQUIDITY`, TWAP price
accumulators (UQ112x112), flash swaps, `skim`/`sync`, and a router with deadlines and multi-hop paths. No Uniswap
(GPL) source code was copied. `WETH9` is an original implementation of the canonical WETH9's behaviour. Token, access
control, EIP-712, ECDSA, `SafeERC20` and reentrancy-guard building blocks are from OpenZeppelin Contracts 5.4.0 (MIT).
