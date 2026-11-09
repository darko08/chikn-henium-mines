/**
 * Gas of the key user actions in their typical ("warm") form, on a freshly deployed local stack:
 *   npx hardhat run scripts/gas-benchmark.ts
 * The gas reporter (REPORT_GAS=true npx hardhat test) gives min/max over the whole test suite instead, which mixes in
 * cold first-time storage writes and pair creation.
 */
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll } from "./lib/deploy-all";
import { Category, DOMAIN_NAMES, domainFor, signClaim, signRelease, signWithdrawal } from "./lib/vouchers";

const E18 = 10n ** 18n;

async function main() {
  const { ethers } = hre;
  if (hre.network.name !== "hardhat") throw new Error("Run the benchmark on the in-process hardhat network only");
  const s = await deployAll(hre, { genesisAmount: 1_000_000n * E18, seedPools: true });
  const [server, player, relayer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const rows: [string, string, bigint][] = [];
  const gas = async (label: string, note: string, tx: Promise<{ wait: () => Promise<{ gasUsed: bigint } | null> }>) => {
    const r = await (await tx).wait();
    rows.push([label, note, r!.gasUsed]);
  };
  const d = BigInt(await time.latest()) + 86_400n * 365n;
  const H = await s.token.getAddress();
  const W = await s.weth.getAddress();
  const EGG = await s.egg.getAddress();
  const STONE = await s.resources.stone.getAddress();
  const router = s.router.connect(player);
  const R = await s.router.getAddress();

  // fund the player: HENIUM from the treasury, EGG from the faucet, Stone through the bridge
  await s.token.transfer(player.address, 50_000n * E18);
  await s.egg.mint(player.address, 1_000_000n * E18);
  const bDomain = await domainFor(s.bridge, DOMAIN_NAMES.bridge, chainId);
  const w0 = { account: player.address, token: STONE, amount: 10_000_000n * E18, nonce: 100n, deadline: d };
  await gas("ResourceBridge.withdraw", "first mint to a new holder", s.bridge.connect(relayer).withdraw(w0, await signWithdrawal(server, bDomain, w0)));
  const w1 = { ...w0, nonce: 101n };
  await gas("ResourceBridge.withdraw", "holder already has a balance", s.bridge.connect(relayer).withdraw(w1, await signWithdrawal(server, bDomain, w1)));
  for (const t of [s.token, s.egg, s.resources.stone]) await t.connect(player).approve(R, ethers.MaxUint256);

  // ---- DEX swaps (second swap of each kind: the recipient's balance slot already exists) --------------------
  for (const round of [0, 1]) {
    const keep = round === 1;
    const add = (label: string, note: string, tx: Promise<{ wait: () => Promise<{ gasUsed: bigint } | null> }>) =>
      keep ? gas(label, note, tx) : tx.then((t) => t.wait());
    await add("Router.swapExactTokensForTokens", "HENIUM -> STONE, 1 hop (HENIUM fee burned)", router.swapExactTokensForTokens(100n * E18, 0n, [H, STONE], player.address, d));
    await add("Router.swapExactTokensForTokens", "STONE -> HENIUM, 1 hop (Stone fee burned)", router.swapExactTokensForTokens(1_000_000n * E18, 0n, [STONE, H], player.address, d));
    await add("Router.swapExactTokensForTokens", "mEGG -> HENIUM, 1 hop (fee to 0x…dEaD)", router.swapExactTokensForTokens(100n * E18, 0n, [EGG, H], player.address, d));
    await add("Router.swapExactTokensForTokens", "STONE -> HENIUM -> mEGG, 2 hops", router.swapExactTokensForTokens(1_000_000n * E18, 0n, [STONE, H, EGG], player.address, d));
    await add("Router.swapExactETHForTokens", "ETH -> HENIUM (WETH fee to 0x…dEaD)", router.swapExactETHForTokens(0n, [W, H], player.address, d, { value: E18 / 100n }));
    await add("Router.swapExactTokensForETH", "HENIUM -> ETH", router.swapExactTokensForETH(10n * E18, 0n, [H, W], player.address, d));
    await add("Router.swapExactTokensForETH", "STONE -> HENIUM -> ETH, 2 hops", router.swapExactTokensForETH(1_000_000n * E18, 0n, [STONE, H, W], player.address, d));
    await add("Router.swapTokensForExactTokens", "HENIUM -> exactly 1,000 STONE", router.swapTokensForExactTokens(1_000n * E18, ethers.MaxUint256, [H, STONE], player.address, d));
  }
  // direct pair swap (no router), HENIUM in
  const pair = s.pairs["STONE/HENIUM"];
  const [r0, r1] = await pair.getReserves();
  const heniumIs0 = (await pair.token0()) === H;
  const [rIn, rOut] = heniumIs0 ? [r0, r1] : [r1, r0];
  const amt = 50n * E18;
  const out = (amt * 9970n * rOut) / (rIn * 10000n + amt * 9970n);
  await s.token.connect(player).transfer(await pair.getAddress(), amt);
  await gas("HeniumDexPair.swap", "direct, HENIUM in (transfer done before)", pair.connect(player).swap(heniumIs0 ? 0n : out, heniumIs0 ? out : 0n, player.address, "0x"));

  // ---- liquidity -----------------------------------------------------------------------------------------------
  await router.addLiquidity(EGG, H, 1_000n * E18, 1_000n * E18, 0n, 0n, player.address, d);
  await gas("Router.addLiquidity", "existing pool, LP already holds shares", router.addLiquidity(EGG, H, 1_000n * E18, 1_000n * E18, 0n, 0n, player.address, d));
  await router.addLiquidityETH(H, 100n * E18, 0n, 0n, player.address, d, { value: E18 });
  await gas("Router.addLiquidityETH", "existing pool, with ETH refund", router.addLiquidityETH(H, 100n * E18, 0n, 0n, player.address, d, { value: E18 }));
  const eggPair = s.pairs["mEGG/HENIUM"];
  await eggPair.connect(player).approve(R, ethers.MaxUint256);
  const lp = await eggPair.balanceOf(player.address);
  await gas("Router.removeLiquidity", "half of the position", router.removeLiquidity(EGG, H, lp / 2n, 0n, 0n, player.address, d));

  // ---- emission claims -------------------------------------------------------------------------------------------
  const eDomain = await domainFor(s.emission, DOMAIN_NAMES.emission, chainId);
  const claim = async (nonce: bigint, label: string, note: string) => {
    const v = { account: player.address, category: Category.REFINERY, amount: 10n * E18, nonce, deadline: d };
    await gas(label, note, s.emission.connect(relayer).claim(v, await signClaim(server, eDomain, v)));
  };
  await claim(1n, "HeniumEmission.claim", "first claim of an account (new nonce word)");
  await claim(2n, "HeniumEmission.claim", "next claim, same nonce word");
  await s.emission.setAccountDailyLimit(1_000n * E18);
  await s.emission.setGlobalDailyLimit(100_000n * E18);
  await claim(3n, "HeniumEmission.claim", "limits on, first use (usage slots created)");
  await claim(4n, "HeniumEmission.claim", "limits on, later claim the same day");

  // ---- game vault ----------------------------------------------------------------------------------------------
  await s.token.connect(player).approve(await s.vault.getAddress(), ethers.MaxUint256);
  const pid = ethers.id("player:1");
  await gas("HeniumGameVault.deposit", "first deposit (escrow slot created)", s.vault.connect(player).deposit(100n * E18, pid));
  await gas("HeniumGameVault.deposit", "later deposit", s.vault.connect(player).deposit(100n * E18, pid));
  const vDomain = await domainFor(s.vault, DOMAIN_NAMES.vault, chainId);
  const rel = { account: player.address, amount: 50n * E18, nonce: 1n, deadline: d };
  await gas("HeniumGameVault.release", "first release (counters created)", s.vault.connect(relayer).release(rel, await signRelease(server, vDomain, rel)));
  const rel2 = { ...rel, nonce: 2n };
  await gas("HeniumGameVault.release", "later release the same day", s.vault.connect(relayer).release(rel2, await signRelease(server, vDomain, rel2)));
  await gas("HeniumGameVault.burnSunk", "burn HENIUM spent in game", s.vault.burnSunk(25n * E18, ethers.id("dig")));

  // ---- bridge deposit ------------------------------------------------------------------------------------------
  await s.resources.stone.connect(player).approve(await s.bridge.getAddress(), ethers.MaxUint256);
  await gas("ResourceBridge.deposit", "burn Stone back into the game", s.bridge.connect(player).deposit(STONE, 1_000n * E18, pid));

  const w = Math.max(...rows.map((r) => r[0].length));
  const n = Math.max(...rows.map((r) => r[1].length));
  console.log(`${"Function".padEnd(w)}  ${"Scenario".padEnd(n)}  Gas`);
  console.log(`${"-".repeat(w)}  ${"-".repeat(n)}  ---------`);
  for (const [label, note, g] of rows) console.log(`${label.padEnd(w)}  ${note.padEnd(n)}  ${g.toLocaleString("en-US").padStart(9)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
