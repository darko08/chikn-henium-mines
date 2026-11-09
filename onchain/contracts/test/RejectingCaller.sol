// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice TEST ONLY. Forwards arbitrary calls (so it can be `msg.sender` of router calls) and rejects plain ETH
///         transfers, to exercise ETH refund / payout failure paths.
contract RejectingCaller {
    function execute(address target, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
    // no receive / fallback: incoming ETH without calldata reverts
}
