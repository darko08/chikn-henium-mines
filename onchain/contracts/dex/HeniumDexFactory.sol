// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHeniumDexFactory} from "./interfaces/IHeniumDexFactory.sol";
import {HeniumDexPair} from "./HeniumDexPair.sol";
import {HeniumDexLibrary as Lib} from "./libraries/HeniumDexLibrary.sol";

/**
 * @title HeniumDexFactory — creates one {HeniumDexPair} per token pair
 * @notice Permissionless and admin-free (no protocol fee switch). Design after Uniswap V2's factory; original
 *         MIT implementation. Pairs are deployed with CREATE2 (salt = keccak256(token0, token1)), but nothing
 *         depends on the init-code hash: the router looks pairs up with {getPair}.
 */
contract HeniumDexFactory is IHeniumDexFactory {
    /// @inheritdoc IHeniumDexFactory
    mapping(address tokenA => mapping(address tokenB => address pair)) public getPair;
    /// @inheritdoc IHeniumDexFactory
    address[] public allPairs;

    error PairExists(address pair);
    error NotAContract(address token);

    /// @inheritdoc IHeniumDexFactory
    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @inheritdoc IHeniumDexFactory
    function createPair(address tokenA, address tokenB) external returns (address pair) {
        (address token0, address token1) = Lib.sortTokens(tokenA, tokenB);
        address existing = getPair[token0][token1];
        if (existing != address(0)) revert PairExists(existing);
        // An EOA "token" would make every swap revert (and `try burn` cannot catch a missing contract).
        if (token0.code.length == 0) revert NotAContract(token0);
        if (token1.code.length == 0) revert NotAContract(token1);

        pair = address(new HeniumDexPair{salt: keccak256(abi.encode(token0, token1))}(token0, token1));
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }
}
