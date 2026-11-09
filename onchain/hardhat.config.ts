import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Secrets come from the environment only. Never commit a private key (see .env.example).
const { RPC_URL, PRIVATE_KEY, CHAIN_ID, REPORT_GAS } = process.env;

const testnet =
  RPC_URL && PRIVATE_KEY
    ? {
        testnet: {
          url: RPC_URL,
          accounts: [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`],
          ...(CHAIN_ID ? { chainId: Number(CHAIN_ID) } : {}),
        },
      }
    : {};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Cancun is live on Ethereum, Base, Arbitrum, Optimism and Avalanche C-Chain (Etna).
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    localhost: { url: "http://127.0.0.1:8545" },
    ...testnet,
  },
  gasReporter: {
    enabled: REPORT_GAS === "true",
    offline: true,
    noColors: true,
    reportPureAndViewMethods: false,
    excludeContracts: ["contracts/test/"],
    outputFile: REPORT_GAS === "true" ? "gas-report.txt" : undefined,
    forceTerminalOutput: true,
    forceTerminalOutputFormat: "terminal",
  },
  mocha: { timeout: 600_000 },
  typechain: { outDir: "typechain-types", target: "ethers-v6" },
};

export default config;
