/**
 * Deploys the full stack, wires roles, registers the 13 resource tokens, creates and seeds the
 * HENIUM/WETH, mEGG/HENIUM and STONE/HENIUM pools, writes deployments/<network>.json and exports ABIs to abi/.
 *
 *   npx hardhat run scripts/deploy.ts                       # in-process Hardhat network
 *   RPC_URL=... PRIVATE_KEY=... npx hardhat run scripts/deploy.ts --network testnet
 *
 * Testnets only. Known mainnet chain ids are refused: these contracts are not audited (see README).
 * Optional env: ADMIN_ADDRESS, SIGNER_ADDRESS, PAUSER_ADDRESS, BURNER_ADDRESS, TREASURY_ADDRESS,
 * GENESIS_AMOUNT (whole HENIUM, default 100000), GENESIS_TIME (unix seconds, default now), WETH_ADDRESS,
 * EGG_ADDRESS, RESOURCE_DAILY_CAP (whole tokens, default 0 = unlimited), SEED_POOLS (default true),
 * SEED_SCALE (default 1 locally, 0.01 elsewhere), RENOUNCE_TOKEN_ADMIN (default false).
 */
import hre from "hardhat";
import { deployAll } from "./lib/deploy-all";
import { exportAbis, writeDeployment } from "./lib/output";

/** Mainnets (Ethereum, OP, BNB, Gnosis, Polygon, Fantom, zkSync, Mantle, Base, Arbitrum One/Nova, Avalanche, Linea, Blast, Scroll, Zora). */
const MAINNET_CHAIN_IDS = new Set([1, 10, 56, 100, 137, 250, 324, 5000, 8453, 42161, 42170, 43114, 59144, 81457, 534352, 7777777]);

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function parseUnits(v: string, label: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`${label} must be a non-negative number, got "${v}"`);
  return hre.ethers.parseUnits(v, 18);
}

function addressOrUndefined(name: string): string | undefined {
  const v = env(name);
  if (v === undefined) return undefined;
  if (!hre.ethers.isAddress(v)) throw new Error(`${name} is not an address: ${v}`);
  return hre.ethers.getAddress(v);
}

async function main() {
  const { chainId } = await hre.ethers.provider.getNetwork();
  if (MAINNET_CHAIN_IDS.has(Number(chainId))) {
    throw new Error(`Refusing to deploy to mainnet chain ${chainId}: unaudited contracts (see README "Before mainnet").`);
  }
  const local = hre.network.name === "hardhat" || hre.network.name === "localhost";
  const seedScale = env("SEED_SCALE") ?? (local ? "1" : "0.01");
  const seedScaleMilli = parseUnits(seedScale, "SEED_SCALE") / 10n ** 15n;

  const started = Date.now();
  const stack = await deployAll(hre, {
    admin: addressOrUndefined("ADMIN_ADDRESS"),
    signer: addressOrUndefined("SIGNER_ADDRESS"),
    pauser: addressOrUndefined("PAUSER_ADDRESS"),
    burner: addressOrUndefined("BURNER_ADDRESS"),
    treasury: addressOrUndefined("TREASURY_ADDRESS"),
    weth: addressOrUndefined("WETH_ADDRESS"),
    egg: addressOrUndefined("EGG_ADDRESS"),
    genesisAmount: parseUnits(env("GENESIS_AMOUNT") ?? "100000", "GENESIS_AMOUNT"),
    genesisTime: env("GENESIS_TIME") ? BigInt(env("GENESIS_TIME")!) : undefined,
    resourceDailyCap: env("RESOURCE_DAILY_CAP") ? BigInt(env("RESOURCE_DAILY_CAP")!) : 0n,
    seedPools: (env("SEED_POOLS") ?? "true") !== "false",
    seedScaleMilli,
    renounceTokenAdmin: env("RENOUNCE_TOKEN_ADMIN") === "true",
    smokeSwap: local,
    log: (m) => console.log(m),
  });

  const file = writeDeployment(hre, stack.record);
  const abis = await exportAbis(hre);
  console.log(`\nPools:`);
  for (const [label, p] of Object.entries(stack.record.pools)) {
    const fmt = (v: string) => Number(hre.ethers.formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: 6 });
    console.log(`  ${label.padEnd(13)} ${p.pair}  ${fmt(p.reserve0)} ${p.symbol0} / ${fmt(p.reserve1)} ${p.symbol1}`);
  }
  console.log(`\nWrote ${file}`);
  console.log(`Exported ${abis.length} ABIs to abi/`);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
