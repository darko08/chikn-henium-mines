// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IHeniumDexFactory} from "./interfaces/IHeniumDexFactory.sol";
import {IHeniumDexPair} from "./interfaces/IHeniumDexPair.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {HeniumDexLibrary as Lib} from "./libraries/HeniumDexLibrary.sol";

/**
 * @title HeniumDexRouter — quotes, liquidity and (multi-hop) swaps with deadlines and slippage limits
 * @notice Design after Uniswap V2's Router02 (original MIT implementation). Pairs are found with
 *         `factory.getPair` (no init-code-hash computation). Native ETH (or AVAX...) goes through WETH.
 *
 * The game's routing: every resource trades against HENIUM, so "anything -> HENIUM -> anything" is a two-hop
 * path such as [STONE, HENIUM, WETH]; EGG and HENIUM can be sold for ETH with {swapExactTokensForETH}.
 *
 * Quotes are exact: swaps send exactly the amounts the quote functions return (for tokens without transfer
 * fees). The router never holds tokens between transactions; it only accepts ETH from WETH.
 */
contract HeniumDexRouter {
    using SafeERC20 for IERC20;

    IHeniumDexFactory public immutable factory;
    // solhint-disable-next-line var-name-mixedcase
    address public immutable WETH;

    error Expired(uint256 deadline);
    error InvalidPath();
    error PairNotFound(address tokenA, address tokenB);
    error InsufficientAAmount(uint256 amountA, uint256 amountAMin);
    error InsufficientBAmount(uint256 amountB, uint256 amountBMin);
    error InsufficientOutputAmount(uint256 amountOut, uint256 amountOutMin);
    error ExcessiveInputAmount(uint256 amountIn, uint256 amountInMax);
    error OnlyWETH();
    error ETHTransferFailed();

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired(deadline);
        _;
    }

    constructor(IHeniumDexFactory factory_, address weth_) {
        if (address(factory_) == address(0) || weth_ == address(0)) revert Lib.ZeroAddress();
        factory = factory_;
        WETH = weth_;
    }

    /// @dev Only WETH sends ETH here (when unwrapping). Cheap enough for WETH9's 2300-gas `transfer`.
    receive() external payable {
        if (msg.sender != WETH) revert OnlyWETH();
    }

    // ------------------------------------------------------------------------------------------------------
    // Liquidity
    // ------------------------------------------------------------------------------------------------------

    /**
     * @notice Adds liquidity in the pool's current ratio (creating the pair on first use). The amounts actually
     *         used are the largest that fit the ratio within the desired amounts, never below the minimums.
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        address pair;
        (amountA, amountB, pair) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        liquidity = _pullAndMint(tokenA, tokenB, pair, amountA, amountB, to);
    }

    /// @notice {addLiquidity} with native ETH as one side; unused ETH is refunded.
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        address pair;
        (amountToken, amountETH, pair) = _addLiquidity(
            token,
            WETH,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountETHMin
        );
        liquidity = _pullAndMintETH(token, pair, amountToken, amountETH, to);
        if (msg.value > amountETH) _sendETH(msg.sender, msg.value - amountETH);
    }

    /// @notice Burns `liquidity` LP shares (needs an allowance) and sends both tokens to `to`.
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) public ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = _pairFor(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IHeniumDexPair(pair).burn(to);
        (amountA, amountB) = tokenA < tokenB ? (amount0, amount1) : (amount1, amount0);
        if (amountA < amountAMin) revert InsufficientAAmount(amountA, amountAMin);
        if (amountB < amountBMin) revert InsufficientBAmount(amountB, amountBMin);
    }

    /// @notice {removeLiquidity} from a token/WETH pool, paying the WETH side out as native ETH.
    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH) {
        (amountToken, amountETH) = removeLiquidity(
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this),
            deadline
        );
        IERC20(token).safeTransfer(to, amountToken);
        IWETH(WETH).withdraw(amountETH);
        _sendETH(to, amountETH);
    }

    // ------------------------------------------------------------------------------------------------------
    // Swaps
    // ------------------------------------------------------------------------------------------------------

    /// @notice Swaps exactly `amountIn` of `path[0]` for at least `amountOutMin` of the last token.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        address[] memory pairs;
        (amounts, pairs) = _amountsOut(amountIn, path);
        _checkOutput(amounts, amountOutMin);
        IERC20(path[0]).safeTransferFrom(msg.sender, pairs[0], amounts[0]);
        _swap(amounts, pairs, path, to);
    }

    /// @notice Swaps at most `amountInMax` of `path[0]` for exactly `amountOut` of the last token.
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        address[] memory pairs;
        (amounts, pairs) = _amountsIn(amountOut, path);
        if (amounts[0] > amountInMax) revert ExcessiveInputAmount(amounts[0], amountInMax);
        IERC20(path[0]).safeTransferFrom(msg.sender, pairs[0], amounts[0]);
        _swap(amounts, pairs, path, to);
    }

    /// @notice Swaps exactly `msg.value` ETH (path must start with WETH) for at least `amountOutMin`.
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256[] memory amounts) {
        _requireFirst(path, WETH);
        address[] memory pairs;
        (amounts, pairs) = _amountsOut(msg.value, path);
        _checkOutput(amounts, amountOutMin);
        _wrapAndSend(pairs[0], amounts[0]);
        _swap(amounts, pairs, path, to);
    }

    /// @notice Swaps at most `amountInMax` of `path[0]` for exactly `amountOut` ETH (path must end with WETH).
    function swapTokensForExactETH(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        _requireLast(path, WETH);
        address[] memory pairs;
        (amounts, pairs) = _amountsIn(amountOut, path);
        if (amounts[0] > amountInMax) revert ExcessiveInputAmount(amounts[0], amountInMax);
        IERC20(path[0]).safeTransferFrom(msg.sender, pairs[0], amounts[0]);
        _swap(amounts, pairs, path, address(this));
        _unwrapAndSend(to, amounts[amounts.length - 1]);
    }

    /// @notice Swaps exactly `amountIn` of `path[0]` for at least `amountOutMin` ETH (path must end with WETH).
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        _requireLast(path, WETH);
        address[] memory pairs;
        (amounts, pairs) = _amountsOut(amountIn, path);
        _checkOutput(amounts, amountOutMin);
        IERC20(path[0]).safeTransferFrom(msg.sender, pairs[0], amounts[0]);
        _swap(amounts, pairs, path, address(this));
        _unwrapAndSend(to, amounts[amounts.length - 1]);
    }

    /// @notice Swaps ETH (path must start with WETH) for exactly `amountOut`; unused ETH is refunded.
    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256[] memory amounts) {
        _requireFirst(path, WETH);
        address[] memory pairs;
        (amounts, pairs) = _amountsIn(amountOut, path);
        if (amounts[0] > msg.value) revert ExcessiveInputAmount(amounts[0], msg.value);
        _wrapAndSend(pairs[0], amounts[0]);
        _swap(amounts, pairs, path, to);
        if (msg.value > amounts[0]) _sendETH(msg.sender, msg.value - amounts[0]);
    }

    // ------------------------------------------------------------------------------------------------------
    // Quotes
    // ------------------------------------------------------------------------------------------------------

    /// @notice `amountA * reserveB / reserveA` (no fee).
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) external pure returns (uint256) {
        return Lib.quote(amountA, reserveA, reserveB);
    }

    /// @notice Output for `amountIn` after the 0.30% fee: `in*9970*rOut / (rIn*10000 + in*9970)`.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256) {
        return Lib.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    /// @notice Input needed for `amountOut` after the 0.30% fee: `rIn*out*10000 / ((rOut-out)*9970) + 1`.
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256) {
        return Lib.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    /// @notice Amounts along `path` when swapping exactly `amountIn` (amounts[0] = amountIn).
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        (amounts, ) = _amountsOut(amountIn, path);
    }

    /// @notice Amounts along `path` needed to receive exactly `amountOut` (last element = amountOut).
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts) {
        (amounts, ) = _amountsIn(amountOut, path);
    }

    /// @notice Reserves of the tokenA/tokenB pool, ordered as (tokenA, tokenB).
    function getReserves(address tokenA, address tokenB) external view returns (uint256 reserveA, uint256 reserveB) {
        return _reserves(_pairFor(tokenA, tokenB), tokenA, tokenB);
    }

    // ------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) private returns (uint256 amountA, uint256 amountB, address pair) {
        pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) pair = factory.createPair(tokenA, tokenB);
        (uint256 reserveA, uint256 reserveB) = _reserves(pair, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) return (amountADesired, amountBDesired, pair);

        uint256 amountBOptimal = Lib.quote(amountADesired, reserveA, reserveB);
        if (amountBOptimal <= amountBDesired) {
            if (amountBOptimal < amountBMin) revert InsufficientBAmount(amountBOptimal, amountBMin);
            return (amountADesired, amountBOptimal, pair);
        }
        // amountBOptimal > amountBDesired implies amountAOptimal <= amountADesired.
        uint256 amountAOptimal = Lib.quote(amountBDesired, reserveB, reserveA);
        if (amountAOptimal < amountAMin) revert InsufficientAAmount(amountAOptimal, amountAMin);
        return (amountAOptimal, amountBDesired, pair);
    }

    /// @dev Pays both sides into `pair` from the caller and mints the LP shares to `to`.
    function _pullAndMint(
        address tokenA,
        address tokenB,
        address pair,
        uint256 amountA,
        uint256 amountB,
        address to
    ) private returns (uint256) {
        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);
        return IHeniumDexPair(pair).mint(to);
    }

    /// @dev Pays `token` from the caller and wrapped ETH from `msg.value` into `pair`, then mints to `to`.
    function _pullAndMintETH(
        address token,
        address pair,
        uint256 amountToken,
        uint256 amountETH,
        address to
    ) private returns (uint256) {
        IERC20(token).safeTransferFrom(msg.sender, pair, amountToken);
        _wrapAndSend(pair, amountETH);
        return IHeniumDexPair(pair).mint(to);
    }

    /// @dev Runs the hops; each pair sends its output straight to the next pair (or to `to` for the last hop).
    function _swap(uint256[] memory amounts, address[] memory pairs, address[] calldata path, address to) private {
        uint256 hops = pairs.length;
        for (uint256 i; i < hops; ++i) {
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = path[i] < path[i + 1]
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
            address recipient = i + 1 < hops ? pairs[i + 1] : to;
            IHeniumDexPair(pairs[i]).swap(amount0Out, amount1Out, recipient, "");
        }
    }

    function _amountsOut(
        uint256 amountIn,
        address[] calldata path
    ) private view returns (uint256[] memory amounts, address[] memory pairs) {
        uint256 hops = _hops(path);
        amounts = new uint256[](hops + 1);
        pairs = new address[](hops);
        amounts[0] = amountIn;
        for (uint256 i; i < hops; ++i) {
            address pair = _pairFor(path[i], path[i + 1]);
            (uint256 reserveIn, uint256 reserveOut) = _reserves(pair, path[i], path[i + 1]);
            amounts[i + 1] = Lib.getAmountOut(amounts[i], reserveIn, reserveOut);
            pairs[i] = pair;
        }
    }

    function _amountsIn(
        uint256 amountOut,
        address[] calldata path
    ) private view returns (uint256[] memory amounts, address[] memory pairs) {
        uint256 hops = _hops(path);
        amounts = new uint256[](hops + 1);
        pairs = new address[](hops);
        amounts[hops] = amountOut;
        for (uint256 i = hops; i > 0; --i) {
            address pair = _pairFor(path[i - 1], path[i]);
            (uint256 reserveIn, uint256 reserveOut) = _reserves(pair, path[i - 1], path[i]);
            amounts[i - 1] = Lib.getAmountIn(amounts[i], reserveIn, reserveOut);
            pairs[i - 1] = pair;
        }
    }

    /// @dev The path must start with `token` (length is checked again by `_hops`).
    function _requireFirst(address[] calldata path, address token) private pure {
        if (path.length == 0 || path[0] != token) revert InvalidPath();
    }

    /// @dev The path must end with `token`.
    function _requireLast(address[] calldata path, address token) private pure {
        if (path.length == 0 || path[path.length - 1] != token) revert InvalidPath();
    }

    function _hops(address[] calldata path) private pure returns (uint256) {
        if (path.length < 2) revert InvalidPath();
        return path.length - 1;
    }

    function _pairFor(address tokenA, address tokenB) private view returns (address pair) {
        pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) revert PairNotFound(tokenA, tokenB);
    }

    function _reserves(address pair, address tokenA, address tokenB) private view returns (uint256, uint256) {
        (uint112 reserve0, uint112 reserve1, ) = IHeniumDexPair(pair).getReserves();
        return tokenA < tokenB ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));
    }

    function _checkOutput(uint256[] memory amounts, uint256 amountOutMin) private pure {
        uint256 out = amounts[amounts.length - 1];
        if (out < amountOutMin) revert InsufficientOutputAmount(out, amountOutMin);
    }

    function _wrapAndSend(address pair, uint256 amount) private {
        IWETH(WETH).deposit{value: amount}();
        IERC20(WETH).safeTransfer(pair, amount);
    }

    function _unwrapAndSend(address to, uint256 amount) private {
        IWETH(WETH).withdraw(amount);
        _sendETH(to, amount);
    }

    function _sendETH(address to, uint256 amount) private {
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
    }
}
