import fs from "fs";
import path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { Deployment } from "./deploy-all";

/** Contracts whose ABIs the game client / server needs. */
export const ABI_CONTRACTS = [
  "HeniumToken",
  "HeniumEmission",
  "HeniumGameVault",
  "GameResourceToken",
  "ResourceBridge",
  "HeniumDexFactory",
  "HeniumDexPair",
  "HeniumDexRouter",
  "WETH9",
  "MockERC20",
] as const;

/** Writes abi/<Contract>.json (the ABI array only) for every contract in ABI_CONTRACTS. */
export async function exportAbis(hre: HardhatRuntimeEnvironment, outDir = path.join(hre.config.paths.root, "abi")) {
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const name of ABI_CONTRACTS) {
    const artifact = await hre.artifacts.readArtifact(name);
    const file = path.join(outDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(artifact.abi, null, 2) + "\n");
    written.push(file);
  }
  return written;
}

/** Writes deployments/<network>.json. */
export function writeDeployment(hre: HardhatRuntimeEnvironment, record: Deployment, dir = path.join(hre.config.paths.root, "deployments")) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.network}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  return file;
}
