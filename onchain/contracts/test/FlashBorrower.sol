// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHeniumDexCallee} from "../dex/interfaces/IHeniumDexCallee.sol";
import {IHeniumDexPair} from "../dex/interfaces/IHeniumDexPair.sol";

/// @notice TEST ONLY. Flash-swaps from a pair and repays (or misbehaves) inside the callback.
contract FlashBorrower is IHeniumDexCallee {
    enum Mode {
        REPAY, // pays back repay0 / repay1
        REENTER_SWAP,
        REENTER_MINT,
        REENTER_BURN,
        REENTER_SKIM,
        REENTER_SYNC
    }

    address public lastSender;
    uint256 public lastAmount0;
    uint256 public lastAmount1;

    error UnexpectedCaller();

    function flash(
        IHeniumDexPair pair,
        uint256 amount0Out,
        uint256 amount1Out,
        Mode mode,
        uint256 repay0,
        uint256 repay1
    ) external {
        pair.swap(amount0Out, amount1Out, address(this), abi.encode(address(pair), mode, repay0, repay1));
    }

    function heniumDexCall(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external {
        (address pairAddr, Mode mode, uint256 repay0, uint256 repay1) = abi.decode(data, (address, Mode, uint256, uint256));
        if (msg.sender != pairAddr) revert UnexpectedCaller();
        lastSender = sender;
        lastAmount0 = amount0;
        lastAmount1 = amount1;
        IHeniumDexPair pair = IHeniumDexPair(pairAddr);

        if (mode == Mode.REENTER_SWAP) pair.swap(1, 0, address(this), "");
        else if (mode == Mode.REENTER_MINT) pair.mint(address(this));
        else if (mode == Mode.REENTER_BURN) pair.burn(address(this));
        else if (mode == Mode.REENTER_SKIM) pair.skim(address(this));
        else if (mode == Mode.REENTER_SYNC) pair.sync();

        if (repay0 != 0) IERC20(pair.token0()).transfer(pairAddr, repay0);
        if (repay1 != 0) IERC20(pair.token1()).transfer(pairAddr, repay1);
    }
}
