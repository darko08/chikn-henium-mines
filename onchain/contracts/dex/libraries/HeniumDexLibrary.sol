// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title HeniumDexLibrary — fee constants and constant-product math shared by the pair and the router
 * @notice Fee: 0.30% of every swap input. 0.10% of the input is burned (removed from the pool for good) and
 *         0.20% stays in the pool, growing the LPs' share of the reserves.
 *
 * Why the router formula matches the pair's k-check (proof):
 *   Let a swap send `in` of token X into a pool with reserves (rIn, rOut) and take `out` of token Y.
 *   The pair burns b = floor(in * 10 / 10000) of X, so its X balance becomes B = rIn + in - b, and checks
 *       (B * 10000 - in * 20) * ((rOut - out) * 10000) >= rIn * rOut * 10000^2.            (1)
 *   Since b * 10000 <= in * 10:
 *       B * 10000 - in * 20 = rIn*10000 + in*10000 - b*10000 - in*20 >= rIn*10000 + in*9970 =: D.
 *   So (1) holds whenever D * (rOut - out) >= rIn * rOut * 10000, i.e. whenever
 *       out <= rOut - rIn*rOut*10000 / D = in*9970*rOut / D = in*9970*rOut / (rIn*10000 + in*9970).
 *   `getAmountOut` returns exactly floor(in*9970*rOut / (rIn*10000 + in*9970)), the largest integer satisfying
 *   this bound, so every quote passes the k-check; when b has no rounding (in a multiple of 1000) the bound is
 *   tight and `out + 1` fails. `getAmountIn` returns in = floor(rIn*out*10000 / ((rOut-out)*9970)) + 1, which is
 *   strictly above rIn*out*10000 / ((rOut-out)*9970); rearranging gives in*9970*rOut / (rIn*10000 + in*9970) > out,
 *   so getAmountOut(in) >= out and exact-output swaps pass too. Multi-hop paths apply this hop by hop.
 *   The burned part leaves the pool, the LP part stays: new k = (rIn + in - b) * (rOut - out) > rIn * rOut.
 */
library HeniumDexLibrary {
    uint256 internal constant FEE_DENOMINATOR = 10_000;
    /// @dev Total swap fee, in basis points of the input.
    uint256 internal constant SWAP_FEE_BPS = 30;
    /// @dev Part of the input that is burned.
    uint256 internal constant BURN_FEE_BPS = 10;
    /// @dev Part of the input that stays in the pool for LPs.
    uint256 internal constant LP_FEE_BPS = 20;
    /// @dev Input that counts toward the price after fees (9970 / 10000).
    uint256 internal constant INPUT_AFTER_FEE_BPS = FEE_DENOMINATOR - SWAP_FEE_BPS;

    error IdenticalAddresses();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroInputAmount();
    error ZeroOutputAmount();
    error InsufficientLiquidity();

    /// @notice Orders two token addresses the way pairs store them (token0 < token1).
    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
    }

    /// @notice Amount of B worth `amountA` of A at the pool ratio (no fee): used to add liquidity in proportion.
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256) {
        if (amountA == 0) revert ZeroAmount();
        if (reserveA == 0 || reserveB == 0) revert InsufficientLiquidity();
        return (amountA * reserveB) / reserveA;
    }

    /// @notice Output of a swap of `amountIn`: `in*9970*rOut / (rIn*10000 + in*9970)`, rounded down.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountIn == 0) revert ZeroInputAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInAfterFee = amountIn * INPUT_AFTER_FEE_BPS;
        return (amountInAfterFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInAfterFee);
    }

    /// @notice Input needed to receive `amountOut`: `rIn*out*10000 / ((rOut-out)*9970) + 1`.
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountOut == 0) revert ZeroOutputAmount();
        if (reserveIn == 0 || amountOut >= reserveOut) revert InsufficientLiquidity();
        return (reserveIn * amountOut * FEE_DENOMINATOR) / ((reserveOut - amountOut) * INPUT_AFTER_FEE_BPS) + 1;
    }
}
