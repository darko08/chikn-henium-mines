// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHeniumDexPair} from "./interfaces/IHeniumDexPair.sol";
import {IHeniumDexCallee} from "./interfaces/IHeniumDexCallee.sol";
import {IERC20Burnable} from "./interfaces/IERC20Burnable.sol";
import {HeniumDexLibrary as Lib} from "./libraries/HeniumDexLibrary.sol";

/**
 * @title HeniumDexPair — a constant-product (x * y = k) pool whose LP shares are an ERC-20
 * @notice Original implementation of the design popularised by Uniswap V2 (Adams, Zinsmeister, Robinson,
 *         "Uniswap v2 Core", 2020): the same core interface (mint / burn / swap / skim / sync, MINIMUM_LIQUIDITY,
 *         TWAP price accumulators, flash swaps), written from scratch under the MIT license, with a burning fee.
 *
 * Fee: 0.30% of every input. On each swap the pair measures each token's input from its balance, burns 0.10% of
 * it — `IERC20Burnable(token).burn(x)`, or, if that reverts or does not lower the balance, a transfer to
 * 0x…dEaD — then re-reads its actual balances (the burn is never trusted) and requires
 *     (balance0 * 10000 - amount0In * 20) * (balance1 * 10000 - amount1In * 20) >= reserve0 * reserve1 * 10000^2
 * on the post-burn balances. The remaining 0.20% stays in the pool for LPs. See {HeniumDexLibrary} for the proof
 * that this matches the router's `out = in*9970*rOut / (rIn*10000 + in*9970)`.
 *
 * There is no protocol fee and no admin: pairs are immutable once created by {HeniumDexFactory}.
 * Unsupported tokens: fee-on-transfer and rebasing tokens (the pair stays safe — every check uses balances — but
 * router quotes would be off), and tokens with hooks that are not ReentrancyGuard-safe for their own pools.
 */
contract HeniumDexPair is IHeniumDexPair, ERC20Permit, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice LP tokens locked forever at the first deposit (sent to 0x…dEaD), so the pool can never be emptied
    ///         and the price per LP share cannot be inflated cheaply.
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    /// @notice Receives the burned part of swap inputs for tokens that cannot be burned.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;

    uint112 private _reserve0;
    uint112 private _reserve1;
    uint32 private _blockTimestampLast;

    /// @notice Time-weighted price accumulators (UQ112x112 * seconds); overflow is intended, use differences.
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;

    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientOutputAmount();
    error InsufficientInputAmount();
    error InsufficientLiquidity();
    error InvalidTo();
    error Overflow();
    error K();

    /// @dev Deployed by the factory with tokens already sorted (token0 < token1).
    constructor(address token0_, address token1_) ERC20("Henium DEX LP", "HDEX-LP") ERC20Permit("Henium DEX LP") {
        factory = msg.sender;
        token0 = token0_;
        token1 = token1_;
    }

    /// @notice Reserves as of the last interaction, and the (mod 2^32) timestamp of that interaction.
    function getReserves() public view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        blockTimestampLast = _blockTimestampLast;
    }

    // ------------------------------------------------------------------------------------------------------
    // Liquidity
    // ------------------------------------------------------------------------------------------------------

    /**
     * @notice Mints LP shares to `to` for the tokens sent to the pair since the last sync (use the router).
     *         First deposit: sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY. Later: the smaller of the two ratios,
     *         so an unbalanced deposit donates its excess to existing LPs.
     */
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint112 r0, uint112 r1, ) = getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();
        uint256 amount0 = balance0 - r0;
        uint256 amount1 = balance1 - r1;

        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1);
            if (liquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidityMinted();
            unchecked {
                liquidity -= MINIMUM_LIQUIDITY;
            }
            _mint(DEAD, MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min((amount0 * supply) / r0, (amount1 * supply) / r1);
            if (liquidity == 0) revert InsufficientLiquidityMinted();
        }
        _mint(to, liquidity);

        _update(balance0, balance1, r0, r1);
        emit Mint(msg.sender, amount0, amount1);
    }

    /**
     * @notice Burns the LP shares held by the pair (send them first; use the router) and pays `to` their
     *         pro-rata share of both balances.
     */
    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        (uint112 r0, uint112 r1, ) = getReserves();
        IERC20 t0 = IERC20(token0);
        IERC20 t1 = IERC20(token1);
        uint256 liquidity = balanceOf(address(this));
        if (liquidity == 0) revert InsufficientLiquidityBurned();

        uint256 supply = totalSupply();
        amount0 = (liquidity * t0.balanceOf(address(this))) / supply;
        amount1 = (liquidity * t1.balanceOf(address(this))) / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();

        _burn(address(this), liquidity);
        t0.safeTransfer(to, amount0);
        t1.safeTransfer(to, amount1);

        _update(t0.balanceOf(address(this)), t1.balanceOf(address(this)), r0, r1);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    // ------------------------------------------------------------------------------------------------------
    // Swap
    // ------------------------------------------------------------------------------------------------------

    /**
     * @notice Sends `amount0Out` / `amount1Out` to `to`, then requires enough input to have arrived.
     *         Non-empty `data` turns it into a flash swap: `to.heniumDexCall(...)` runs before the check.
     * @dev Use the router unless you are a contract that does its own accounting.
     */
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external nonReentrant {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
        (uint112 r0, uint112 r1, ) = getReserves();
        if (amount0Out >= r0 || amount1Out >= r1) revert InsufficientLiquidity();
        if (to == token0 || to == token1) revert InvalidTo();

        // Optimistic transfers (this is what makes flash swaps possible).
        if (amount0Out != 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out != 0) IERC20(token1).safeTransfer(to, amount1Out);
        if (data.length != 0) IHeniumDexCallee(to).heniumDexCall(msg.sender, amount0Out, amount1Out, data);

        (uint256 amount0In, uint256 amount1In) = _settle(amount0Out, amount1Out, r0, r1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /// @notice Sends any balance above the reserves to `to` (recovers donations without touching the price).
    function skim(address to) external nonReentrant {
        IERC20(token0).safeTransfer(to, IERC20(token0).balanceOf(address(this)) - _reserve0);
        IERC20(token1).safeTransfer(to, IERC20(token1).balanceOf(address(this)) - _reserve1);
    }

    /// @notice Sets the reserves to the actual balances.
    function sync() external nonReentrant {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)), _reserve0, _reserve1);
    }

    // ------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------

    /// @dev Measures the inputs, burns their 0.10%, runs the k-check on the post-burn balances and syncs.
    function _settle(
        uint256 amount0Out,
        uint256 amount1Out,
        uint112 r0,
        uint112 r1
    ) private returns (uint256 amount0In, uint256 amount1In) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        unchecked {
            // amountOut < reserve was checked, so `r - amountOut` cannot underflow.
            uint256 left0 = r0 - amount0Out;
            uint256 left1 = r1 - amount1Out;
            amount0In = balance0 > left0 ? balance0 - left0 : 0;
            amount1In = balance1 > left1 ? balance1 - left1 : 0;
        }
        if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();

        balance0 = _burnFee(token0, amount0In, balance0);
        balance1 = _burnFee(token1, amount1In, balance1);

        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();
        uint256 adjusted0 = balance0 * Lib.FEE_DENOMINATOR;
        uint256 adjusted1 = balance1 * Lib.FEE_DENOMINATOR;
        uint256 lpFee0 = amount0In * Lib.LP_FEE_BPS;
        uint256 lpFee1 = amount1In * Lib.LP_FEE_BPS;
        // Only a token that removed more than asked from the pool can make this true.
        if (adjusted0 < lpFee0 || adjusted1 < lpFee1) revert K();
        // (b0*10000 - in0*20) * (b1*10000 - in1*20) >= r0 * r1 * 10000^2, on post-burn balances.
        // No overflow: each factor < 2^112 * 2^14, the right side < 2^224 * 2^27.
        if ((adjusted0 - lpFee0) * (adjusted1 - lpFee1) < uint256(r0) * r1 * (Lib.FEE_DENOMINATOR ** 2)) revert K();

        _update(balance0, balance1, r0, r1);
    }

    /**
     * @dev Removes 0.10% of `amountIn` of `token` from the pool and returns the pool's fresh balance.
     *  1. `try burn(fee)`: HENIUM and the game's resource tokens burn, so their totalSupply goes down.
     *  2. If the balance did not drop by `fee` — `burn` reverted (a plain ERC-20), or a fallback swallowed the
     *     call without burning (canonical WETH9 does exactly that) — send what is missing to 0x…dEaD, best
     *     effort: a token that refuses even that cannot brick the pool; the fee then stays with LPs.
     *  The caller runs the k-check on the balance returned here, which is always re-read from the token.
     */
    function _burnFee(address token, uint256 amountIn, uint256 balance) private returns (uint256 current) {
        uint256 fee = (amountIn * Lib.BURN_FEE_BPS) / Lib.FEE_DENOMINATOR;
        if (fee == 0) return balance;
        uint256 target = balance - fee; // fee <= amountIn <= balance

        try IERC20Burnable(token).burn(fee) {} catch {}
        current = IERC20(token).balanceOf(address(this));
        if (current > target) {
            IERC20(token).trySafeTransfer(DEAD, current - target);
            current = IERC20(token).balanceOf(address(this));
        }
        if (balance > current) emit FeeBurned(token, balance - current);
    }

    /// @dev Writes reserves and updates the TWAP accumulators with the reserves *before* this interaction.
    function _update(uint256 balance0, uint256 balance1, uint112 r0, uint112 r1) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();
        uint32 blockTimestamp = uint32(block.timestamp); // mod 2^32, like Uniswap V2
        unchecked {
            uint32 timeElapsed = blockTimestamp - _blockTimestampLast; // wrap-around is intended
            if (timeElapsed != 0 && r0 != 0 && r1 != 0) {
                // UQ112x112 price = reserveOther * 2^112 / reserve, accumulated per second (overflow intended).
                price0CumulativeLast += ((uint256(r1) << 112) / r0) * timeElapsed;
                price1CumulativeLast += ((uint256(r0) << 112) / r1) * timeElapsed;
            }
        }
        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
        _blockTimestampLast = blockTimestamp;
        emit Sync(uint112(balance0), uint112(balance1));
    }
}
