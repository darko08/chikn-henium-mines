// solidity-coverage: test-only helper contracts (malicious tokens, flash borrowers) are not measured.
module.exports = {
  skipFiles: ["test/"],
  configureYulOptimizer: true,
  mocha: { timeout: 600000 },
};
