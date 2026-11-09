// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IHeniumDexFactory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 allPairsLength);

    function getPair(address tokenA, address tokenB) external view returns (address pair);

    function allPairs(uint256 index) external view returns (address pair);

    function allPairsLength() external view returns (uint256);

    function createPair(address tokenA, address tokenB) external returns (address pair);
}
