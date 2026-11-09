import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type {
  GameResourceToken,
  HeniumDexFactory,
  HeniumDexPair,
  HeniumDexRouter,
  HeniumToken,
  MockERC20,
  WETH9,
} from "../../typechain-types";

export const E18 = 10n ** 18n;
export const DEAD = "0x000000000000000000000000000000000000dEaD";
export const MINIMUM_LIQUIDITY = 1_000n;
export const FAR = 2n ** 64n;

/** Router formula (JS mirror): out = in*9970*rOut / (rIn*10000 + in*9970). */
export const amountOut = (amountIn: bigint, rIn: bigint, rOut: bigint) => (amountIn * 9970n * rOut) / (rIn * 10000n + amountIn * 9970n);
/** Router formula (JS mirror): in = rIn*out*10000 / ((rOut-out)*9970) + 1. */
export const amountIn = (out: bigint, rIn: bigint, rOut: bigint) => (rIn * out * 10000n) / ((rOut - out) * 9970n) + 1n;
/** The 0.10% of an input that the pair burns. */
export const burnPart = (amount: bigint) => (amount * 10n) / 10000n;

export function sqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

export interface Erc20Like {
  getAddress(): Promise<string>;
  balanceOf(a: string): Promise<bigint>;
  totalSupply(): Promise<bigint>;
  transfer(to: string, amount: bigint): Promise<unknown>;
  approve(spender: string, amount: bigint): Promise<unknown>;
  connect(s: Signer): Erc20Like;
}

export async function dexFixture() {
  const signers = await ethers.getSigners();
  const [deployer, alice, bob, carol, lp, trader, mallory] = signers;

  const henium = (await ethers.deployContract("HeniumToken", [deployer.address])) as unknown as HeniumToken;
  await henium.grantRole(await henium.MINTER_ROLE(), deployer.address);
  const weth = (await ethers.deployContract("WETH9")) as unknown as WETH9;
  const egg = (await ethers.deployContract("MockERC20", ["Mock EGG (test only)", "mEGG", 18])) as unknown as MockERC20;
  // The deployer acts as the bridge here so tests can mint Stone directly (the bridge itself is tested elsewhere).
  const stone = (await ethers.deployContract("GameResourceToken", ["Henium Mines Stone", "STONE", deployer.address])) as unknown as GameResourceToken;
  const factory = (await ethers.deployContract("HeniumDexFactory")) as unknown as HeniumDexFactory;
  const router = (await ethers.deployContract("HeniumDexRouter", [await factory.getAddress(), await weth.getAddress()])) as unknown as HeniumDexRouter;

  const routerAddr = await router.getAddress();
  const big = 10n ** 30n;
  for (const s of [deployer, alice, bob, carol, lp, trader, mallory]) {
    await henium.mint(s.address, 100_000n * E18);
    await egg.mint(s.address, big);
    await stone.mint(s.address, big);
    await weth.connect(s).deposit({ value: 1_000n * E18 });
    for (const t of [henium, egg, stone, weth] as unknown as Erc20Like[]) await t.connect(s).approve(routerAddr, ethers.MaxUint256);
  }

  const pairOf = async (a: Erc20Like | string, b: Erc20Like | string) => {
    const aa = typeof a === "string" ? a : await a.getAddress();
    const bb = typeof b === "string" ? b : await b.getAddress();
    return (await ethers.getContractAt("HeniumDexPair", await factory.getPair(aa, bb))) as unknown as HeniumDexPair;
  };

  const deadline = async () => BigInt(await time.latest()) + 3_600n;

  /** Adds liquidity through the router from `who` and returns the pair. */
  const addLiquidity = async (a: Erc20Like, b: Erc20Like, amountA: bigint, amountB: bigint, who: Signer = lp) => {
    await router
      .connect(who)
      .addLiquidity(await a.getAddress(), await b.getAddress(), amountA, amountB, 0n, 0n, who.address, await deadline());
    return pairOf(a, b);
  };

  return { signers, deployer, alice, bob, carol, lp, trader, mallory, henium, weth, egg, stone, factory, router, pairOf, addLiquidity, deadline };
}

export type DexCtx = Awaited<ReturnType<typeof dexFixture>>;

/** Reserves of `pair` ordered as (tokenIn, tokenOut). */
export async function reservesFor(pair: HeniumDexPair, tokenIn: string): Promise<[bigint, bigint]> {
  const [r0, r1] = await pair.getReserves();
  return (await pair.token0()) === tokenIn ? [r0, r1] : [r1, r0];
}

/**
 * Swaps `amount` of `tokenIn` directly on the pair for exactly the router-formula output (or `outOverride`).
 * Returns the output amount.
 */
export async function directSwap(
  pair: HeniumDexPair,
  tokenIn: Erc20Like,
  amount: bigint,
  from: Signer,
  to: string,
  outOverride?: bigint,
): Promise<bigint> {
  const inAddr = await tokenIn.getAddress();
  const [rIn, rOut] = await reservesFor(pair, inAddr);
  const out = outOverride ?? amountOut(amount, rIn, rOut);
  await tokenIn.connect(from).transfer(await pair.getAddress(), amount);
  const zeroForOne = (await pair.token0()) === inAddr;
  await pair.connect(from).swap(zeroForOne ? 0n : out, zeroForOne ? out : 0n, to, "0x");
  return out;
}
