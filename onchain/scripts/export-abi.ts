/** Re-exports the ABIs to abi/ without deploying:  npx hardhat run scripts/export-abi.ts */
import hre from "hardhat";
import { exportAbis } from "./lib/output";

exportAbis(hre)
  .then((files) => console.log(`Exported ${files.length} ABIs:\n  ${files.join("\n  ")}`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
