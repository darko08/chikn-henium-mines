/**
 * Deploys and wires the whole Chikn Henium Mines on-chain stack. Used by scripts/deploy.ts and by the tests
 * (test/Deploy.test.ts), so the deployment path itself is covered by the test suite.
 */
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type {
  GameResourceToken,
  HeniumDexFactory,
  HeniumDexPair,
  HeniumDexRouter,
  HeniumEmission,
  HeniumGameVault,
  HeniumToken,
  MockERC20,
  ResourceBridge,
  WETH9,
} from "../../typechain-types";
import { DOMAIN_NAMES, domainFor, signWithdrawal } from "./vouchers";

/** The game's 13 tradeable resources (ids match src/js/data.js `D.res`). */
export const RESOURCES = [
  { id: "stone", name: "Stone", symbol: "STONE" },
  { id: "coal", name: "Coal", symbol: "COAL" },
  { id: "copper", name: "Copper", symbol: "COPPER" },
  { id: "iron", name: "Iron", symbol: "IRON" },
  { id: "heniumOre", name: "Henium Ore", symbol: "HEORE" },
  { id: "rareEarth", name: "Rare Earth", symbol: "RAREEARTH" },
  { id: "crushedOre", name: "Crushed Ore", symbol: "CRUSHED" },
  { id: "copperIngot", name: "Copper Ingot", symbol: "CUINGOT" },
  { id: "ironIngot", name: "Iron Ingot", symbol: "FEINGOT" },
  { id: "components", name: "Components", symbol: "COMPONENTS" },
  { id: "machinePart", name: "Machine Part", symbol: "MPART" },
  { id: "alloy", name: "Alloy", symbol: "ALLOY" },
  { id: "circuit", name: "Circuit", symbol: "CIRCUIT" },
] as const;

export type ResourceId = (typeof RESOURCES)[number]["id"];

/**
 * Seed prices from the prototype (src/js/dex.js `D.dex`): HENIUM = 0.0004 ETH, EGG = 0.25 HENIUM,
 * Stone = D.market.stone (0.0004) * oreValueK (0.1) = 0.00004 HENIUM. Amounts are for SEED_SCALE = 1.
 */
export const SEED = {
  heniumEth: { henium: 10_000n, ethMilli: 4_000n }, // 10,000 HENIUM + 4 ETH
  eggHenium: { egg: 10_000n, henium: 2_500n }, // 10,000 mEGG + 2,500 HENIUM
  stoneHenium: { stone: 100_000_000n, henium: 4_000n }, // 100M STONE + 4,000 HENIUM
};

export interface DeployOptions {
  admin?: string;
  signer?: string;
  pauser?: string;
  burner?: string;
  treasury?: string;
  genesisTime?: bigint;
  initialDailyEmission?: bigint;
  halvingIntervalDays?: bigint;
  genesisAmount?: bigint;
  /** Existing wrapped-native token; a WETH9 mock is deployed when omitted. */
  weth?: string;
  /** Existing EGG-like token for the EGG/HENIUM pool; a MockERC20 "mEGG" is deployed when omitted. */
  egg?: string;
  /** Daily bridge mint cap per resource (whole tokens, 0 = unlimited). */
  resourceDailyCap?: bigint;
  seedPools?: boolean;
  /** Multiplies every seed amount, in thousandths (1000 = the amounts in SEED). */
  seedScaleMilli?: bigint;
  /** Freeze the minter set by renouncing the token's DEFAULT_ADMIN_ROLE after setup. */
  renounceTokenAdmin?: boolean;
  /** Run a small Stone -> HENIUM -> ETH swap at the end (local smoke test). */
  smokeSwap?: boolean;
  log?: (msg: string) => void;
}

export interface Deployment {
  network: string;
  chainId: string;
  deployer: string;
  deployedAt: string;
  blockNumber: number;
  contracts: Record<string, string>;
  resources: Record<string, { address: string; name: string; symbol: string; dailyMintCap: string }>;
  pools: Record<
    string,
    { pair: string; token0: string; token1: string; symbol0: string; symbol1: string; reserve0: string; reserve1: string; lpSupply: string }
  >;
  emission: Record<string, string>;
  roles: Record<string, string>;
  eip712: Record<string, { name: string; version: string; chainId: string; verifyingContract: string }>;
  smokeSwap?: Record<string, string>;
}

export interface DeployedStack {
  token: HeniumToken;
  emission: HeniumEmission;
  vault: HeniumGameVault;
  bridge: ResourceBridge;
  resources: Record<string, GameResourceToken>;
  weth: WETH9;
  egg: MockERC20;
  factory: HeniumDexFactory;
  router: HeniumDexRouter;
  pairs: Record<string, HeniumDexPair>;
  record: Deployment;
}

const E18 = 10n ** 18n;

export async function deployAll(hre: HardhatRuntimeEnvironment, opts: DeployOptions = {}): Promise<DeployedStack> {
  const { ethers, network } = hre;
  const log = opts.log ?? (() => {});
  const [deployer] = await ethers.getSigners();
  const me = await deployer.getAddress();
  const { chainId } = await ethers.provider.getNetwork();

  const admin = opts.admin ?? me;
  const signer = opts.signer ?? me;
  const pauser = opts.pauser ?? me;
  const burner = opts.burner ?? me;
  const treasury = opts.treasury ?? me;
  const latest = await ethers.provider.getBlock("latest");
  const genesisTime = opts.genesisTime ?? BigInt(latest!.timestamp);
  const initialDailyEmission = opts.initialDailyEmission ?? 7_200n * E18;
  const halvingIntervalDays = opts.halvingIntervalDays ?? 1_458n;
  const genesisAmount = opts.genesisAmount ?? 0n;
  const scale = opts.seedScaleMilli ?? 1000n;
  const scaled = (x: bigint) => (x * E18 * scale) / 1000n;

  const deploy = async <T>(name: string, args: unknown[] = [], label = name): Promise<T> => {
    const c = await ethers.deployContract(name, args);
    await c.waitForDeployment();
    log(`  ${label.padEnd(30)} ${await c.getAddress()}`);
    return c as unknown as T;
  };
  const wait = async (tx: Promise<{ wait: () => Promise<unknown> }>) => (await tx).wait();

  log(`Deploying to ${network.name} (chain ${chainId}) from ${me}`);

  // ---- HENIUM and its emission ------------------------------------------------------------------------------
  const token = await deploy<HeniumToken>("HeniumToken", [me]);
  const emission = await deploy<HeniumEmission>("HeniumEmission", [
    await token.getAddress(),
    me,
    genesisTime,
    initialDailyEmission,
    halvingIntervalDays,
    genesisAmount,
    genesisAmount > 0n ? treasury : ethers.ZeroAddress,
  ]);
  await wait(token.grantRole(await token.MINTER_ROLE(), await emission.getAddress()));
  if (genesisAmount > 0n) await wait(emission.mintGenesis());

  // ---- gateways -----------------------------------------------------------------------------------------------
  const vault = await deploy<HeniumGameVault>("HeniumGameVault", [await token.getAddress(), me]);
  const bridge = await deploy<ResourceBridge>("ResourceBridge", [me]);
  for (const c of [emission, vault, bridge] as const) {
    await wait(c.grantRole(await c.SIGNER_ROLE(), signer));
    await wait(c.grantRole(await c.PAUSER_ROLE(), pauser));
  }
  await wait(vault.grantRole(await vault.BURNER_ROLE(), burner));

  const resources: Record<string, GameResourceToken> = {};
  const resourceRecord: Deployment["resources"] = {};
  const cap = (opts.resourceDailyCap ?? 0n) * E18;
  for (const r of RESOURCES) {
    const name = `Henium Mines ${r.name}`;
    const t = await deploy<GameResourceToken>("GameResourceToken", [name, r.symbol, await bridge.getAddress()], `GameResourceToken ${r.symbol}`);
    await wait(bridge.registerToken(await t.getAddress(), cap));
    resources[r.id] = t;
    resourceRecord[r.id] = { address: await t.getAddress(), name, symbol: r.symbol, dailyMintCap: cap.toString() };
  }

  // ---- DEX ------------------------------------------------------------------------------------------------------
  const weth = opts.weth
    ? ((await ethers.getContractAt("WETH9", opts.weth)) as unknown as WETH9)
    : await deploy<WETH9>("WETH9");
  const egg = opts.egg
    ? ((await ethers.getContractAt("MockERC20", opts.egg)) as unknown as MockERC20)
    : await deploy<MockERC20>("MockERC20", ["Mock EGG (test only)", "mEGG", 18]);
  const factory = await deploy<HeniumDexFactory>("HeniumDexFactory");
  const router = await deploy<HeniumDexRouter>("HeniumDexRouter", [await factory.getAddress(), await weth.getAddress()]);

  const H = await token.getAddress();
  const poolTokens: Record<string, [string, string]> = {
    "HENIUM/WETH": [H, await weth.getAddress()],
    "mEGG/HENIUM": [await egg.getAddress(), H],
    "STONE/HENIUM": [await resources.stone.getAddress(), H],
  };
  const pairs: Record<string, HeniumDexPair> = {};
  for (const [label, [a, b]] of Object.entries(poolTokens)) {
    if ((await factory.getPair(a, b)) === ethers.ZeroAddress) await wait(factory.createPair(a, b));
    pairs[label] = (await ethers.getContractAt("HeniumDexPair", await factory.getPair(a, b))) as unknown as HeniumDexPair;
  }

  /** Mints resources to the deployer the way a player's withdrawal works: a signed bridge voucher. When the
   *  game server's key is a different address, the deployer is a signer only for this one voucher. */
  let bridgeNonce = 0n;
  const withdrawResource = async (res: GameResourceToken, amount: bigint) => {
    const role = await bridge.SIGNER_ROLE();
    const iAmSigner = await bridge.hasRole(role, me);
    if (!iAmSigner) await wait(bridge.grantRole(role, me));
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3_600n;
    const voucher = { account: me, token: await res.getAddress(), amount, nonce: bridgeNonce++, deadline };
    const sig = await signWithdrawal(deployer, await domainFor(bridge, DOMAIN_NAMES.bridge, chainId), voucher);
    await wait(bridge.withdraw(voucher, sig));
    if (!iAmSigner) await wait(bridge.revokeRole(role, me));
  };

  // ---- seed liquidity -----------------------------------------------------------------------------------------
  if (opts.seedPools ?? true) {
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3_600n;
    const needHenium = scaled(SEED.heniumEth.henium + SEED.eggHenium.henium + SEED.stoneHenium.henium);
    if ((await token.balanceOf(me)) < needHenium) {
      throw new Error(`Seeding needs ${ethers.formatEther(needHenium)} HENIUM in the deployer (set a genesis amount)`);
    }
    await wait(token.approve(await router.getAddress(), ethers.MaxUint256));

    log("Seeding pools");
    const ethAmount = (SEED.heniumEth.ethMilli * E18 * scale) / 1_000_000n;
    await wait(
      router.addLiquidityETH(H, scaled(SEED.heniumEth.henium), 0n, 0n, me, deadline, { value: ethAmount }),
    );

    if (!opts.egg) await wait(egg.mint(me, scaled(SEED.eggHenium.egg)));
    await wait(egg.approve(await router.getAddress(), ethers.MaxUint256));
    await wait(
      router.addLiquidity(await egg.getAddress(), H, scaled(SEED.eggHenium.egg), scaled(SEED.eggHenium.henium), 0n, 0n, me, deadline),
    );

    // Stone comes from the bridge, exactly as a player's withdrawal would.
    const stone = resources.stone;
    await withdrawResource(stone, scaled(SEED.stoneHenium.stone));
    await wait(stone.approve(await router.getAddress(), ethers.MaxUint256));
    await wait(
      router.addLiquidity(await stone.getAddress(), H, scaled(SEED.stoneHenium.stone), scaled(SEED.stoneHenium.henium), 0n, 0n, me, deadline),
    );
  }

  // ---- optional smoke swap: Stone -> HENIUM -> ETH ------------------------------------------------------------
  let smoke: Deployment["smokeSwap"];
  if (opts.smokeSwap && (opts.seedPools ?? true)) {
    const path = [await resources.stone.getAddress(), H, await weth.getAddress()];
    const amountIn = 100_000n * E18;
    await withdrawResource(resources.stone, amountIn); // a player takes 100,000 Stone out of the game...
    await wait(resources.stone.approve(await router.getAddress(), ethers.MaxUint256));
    const quoted = await router.getAmountsOut(amountIn, path);
    const ethBefore = await ethers.provider.getBalance(me);
    const supplyBefore = await token.totalSupply();
    const stoneSupplyBefore = await resources.stone.totalSupply();
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp) + 3_600n;
    const tx = await router.swapExactTokensForETH(amountIn, quoted[2], path, me, deadline);
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const received = (await ethers.provider.getBalance(me)) + gasCost - ethBefore;
    smoke = {
      path: "STONE -> HENIUM -> ETH",
      amountIn: ethers.formatEther(amountIn),
      quotedOut: ethers.formatEther(quoted[2]),
      receivedEth: ethers.formatEther(received),
      heniumBurned: ethers.formatEther(supplyBefore - (await token.totalSupply())),
      stoneBurned: ethers.formatEther(stoneSupplyBefore - (await resources.stone.totalSupply())),
      gasUsed: receipt!.gasUsed.toString(),
    };
    log(`Smoke swap ${smoke.path}: ${smoke.amountIn} STONE -> ${smoke.receivedEth} ETH (quoted ${smoke.quotedOut})`);
  }

  // ---- admin hand-over ----------------------------------------------------------------------------------------
  const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (opts.renounceTokenAdmin) {
    // Freezes the minter set: HeniumEmission stays the only minter forever.
    log("Renouncing HeniumToken DEFAULT_ADMIN_ROLE: the minter set is now frozen");
    await wait(token.renounceRole(await token.DEFAULT_ADMIN_ROLE(), me));
  }
  if (!sameAddr(admin, me)) {
    log(`Handing DEFAULT_ADMIN_ROLE over to ${admin}`);
    const targets = opts.renounceTokenAdmin ? [emission, vault, bridge] : [token, emission, vault, bridge];
    for (const c of targets) {
      const role = await c.DEFAULT_ADMIN_ROLE();
      await wait(c.grantRole(role, admin));
      await wait(c.renounceRole(role, me));
    }
  }

  // ---- record ---------------------------------------------------------------------------------------------------
  const pools: Deployment["pools"] = {};
  for (const [label, pair] of Object.entries(pairs)) {
    const [r0, r1] = await pair.getReserves();
    const symbolOf = async (t: string) => (await ethers.getContractAt("ERC20", t)).symbol();
    pools[label] = {
      pair: await pair.getAddress(),
      token0: await pair.token0(),
      token1: await pair.token1(),
      symbol0: await symbolOf(await pair.token0()),
      symbol1: await symbolOf(await pair.token1()),
      reserve0: r0.toString(),
      reserve1: r1.toString(),
      lpSupply: (await pair.totalSupply()).toString(),
    };
  }
  const eip712: Deployment["eip712"] = {};
  for (const [label, c, name] of [
    ["HeniumEmission", emission, DOMAIN_NAMES.emission],
    ["HeniumGameVault", vault, DOMAIN_NAMES.vault],
    ["ResourceBridge", bridge, DOMAIN_NAMES.bridge],
  ] as const) {
    eip712[label] = { name, version: "1", chainId: chainId.toString(), verifyingContract: await c.getAddress() };
  }

  const record: Deployment = {
    network: network.name,
    chainId: chainId.toString(),
    deployer: me,
    deployedAt: new Date().toISOString(),
    blockNumber: await ethers.provider.getBlockNumber(),
    contracts: {
      HeniumToken: await token.getAddress(),
      HeniumEmission: await emission.getAddress(),
      HeniumGameVault: await vault.getAddress(),
      ResourceBridge: await bridge.getAddress(),
      HeniumDexFactory: await factory.getAddress(),
      HeniumDexRouter: await router.getAddress(),
      WETH: await weth.getAddress(),
      EGG: await egg.getAddress(),
    },
    resources: resourceRecord,
    pools,
    emission: {
      genesisTime: genesisTime.toString(),
      initialDailyEmission: initialDailyEmission.toString(),
      halvingIntervalDays: halvingIntervalDays.toString(),
      genesisAmount: genesisAmount.toString(),
      genesisTreasury: genesisAmount > 0n ? treasury : ethers.ZeroAddress,
      totalScheduledEmission: (await emission.totalScheduledEmission()).toString(),
      supplyCap: (await emission.supplyCap()).toString(),
    },
    roles: { admin, signer, pauser, burner, treasury },
    eip712,
    ...(smoke ? { smokeSwap: smoke } : {}),
  };

  return { token, emission, vault, bridge, resources, weth, egg, factory, router, pairs, record };
}
