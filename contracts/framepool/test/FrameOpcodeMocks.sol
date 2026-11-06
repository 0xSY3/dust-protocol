// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// Foundry's EVM has no frame opcodes. HegotaSupport deploys one helper per opcode in its constructor, in a fixed
/// order, so their addresses are known. For ERC8421_WORKSHOP: Approve (create nonce 1), TxParam (2),
/// FrameDataLoad (3), FrameDataCopy (4), FrameParam (5), SigParam (6), SigDataCopy (7). These stand-ins sit at
/// those addresses and answer from values a test sets, in the helpers' calling convention: operands as 32-byte
/// words, no selector. Same approach as the ERC-8421 workshop's HegotaMocks.
abstract contract FrameOpcodeMocks is Test {
    uint256 private constant APPROVE_NONCE = 1;
    uint256 private constant TX_PARAM_NONCE = 2;
    uint256 private constant FRAME_DATA_LOAD_NONCE = 3;
    uint256 private constant FRAME_DATA_COPY_NONCE = 4;
    uint256 private constant FRAME_PARAM_NONCE = 5;

    MockTxParam internal txParams;
    MockFrameParam internal frameParams;
    MockFrameData internal frameDataLoad;
    MockFrameData internal frameDataCopy;

    function installFrameMocks(address account) internal {
        vm.etch(vm.computeCreateAddress(account, APPROVE_NONCE), address(new MockApprove()).code);
        txParams = MockTxParam(_etch(account, TX_PARAM_NONCE, address(new MockTxParam()).code));
        frameDataLoad = MockFrameData(_etch(account, FRAME_DATA_LOAD_NONCE, address(new MockFrameData()).code));
        frameDataCopy = MockFrameData(_etch(account, FRAME_DATA_COPY_NONCE, address(new MockFrameData()).code));
        frameParams = MockFrameParam(_etch(account, FRAME_PARAM_NONCE, address(new MockFrameParam()).code));
    }

    function setFrameData(uint256 frameIndex, bytes memory data) internal {
        frameDataLoad.set(frameIndex, data);
        frameDataCopy.set(frameIndex, data);
    }

    function _etch(address account, uint256 nonce, bytes memory code) private returns (address helper) {
        helper = vm.computeCreateAddress(account, nonce);
        vm.etch(helper, code);
    }
}

/// APPROVE runs by delegatecall, so this event is emitted by the approving account.
contract MockApprove {
    event Approved(uint256 scope);

    fallback() external payable {
        emit Approved(abi.decode(msg.data, (uint256)));
    }
}

contract MockTxParam {
    mapping(uint256 => uint256) internal values;

    function set(uint256 param, uint256 value) external {
        values[param] = value;
    }

    fallback() external {
        uint256 value = values[abi.decode(msg.data, (uint256))];
        assembly {
            mstore(0, value)
            return(0, 32)
        }
    }
}

contract MockFrameParam {
    mapping(uint256 => mapping(uint256 => uint256)) internal values;

    function set(uint256 frameIndex, uint256 param, uint256 value) external {
        values[frameIndex][param] = value;
    }

    fallback() external {
        (uint256 frameIndex, uint256 param) = abi.decode(msg.data, (uint256, uint256));
        uint256 value = values[frameIndex][param];
        assembly {
            mstore(0, value)
            return(0, 32)
        }
    }
}

/// FRAMEDATALOAD takes (offset, frameIndex) and answers one word; FRAMEDATACOPY takes (dataOffset, length,
/// frameIndex) and answers the raw bytes. Both zero-pad past the end of the frame's data.
contract MockFrameData {
    mapping(uint256 => bytes) internal data;

    function set(uint256 frameIndex, bytes calldata frameData) external {
        data[frameIndex] = frameData;
    }

    fallback() external {
        bytes memory out;
        if (msg.data.length == 64) {
            (uint256 offset, uint256 frameIndex) = abi.decode(msg.data, (uint256, uint256));
            out = _slice(data[frameIndex], offset, 32);
        } else {
            (uint256 offset, uint256 length, uint256 frameIndex) = abi.decode(msg.data, (uint256, uint256, uint256));
            out = _slice(data[frameIndex], offset, length);
        }
        assembly {
            return(add(out, 32), mload(out))
        }
    }

    function _slice(bytes memory src, uint256 offset, uint256 length) private pure returns (bytes memory out) {
        out = new bytes(length);
        for (uint256 i = 0; i < length && offset + i < src.length; i++) {
            out[i] = src[offset + i];
        }
    }
}

/// Records stakes the way the devnet's NaiveStakingRegistry does: per msg.sender.
contract MockStakingRegistry {
    mapping(address => uint256) public stakes;
    mapping(address => uint32) public unstakeDelays;

    function addStake(uint32 unstakeDelaySec) external payable {
        stakes[msg.sender] += msg.value;
        unstakeDelays[msg.sender] = unstakeDelaySec;
    }

    function unlockStake() external {}

    function withdrawStake(address payable withdrawAddress) external {
        uint256 amount = stakes[msg.sender];
        stakes[msg.sender] = 0;
        (bool ok,) = withdrawAddress.call{value: amount}("");
        require(ok, "withdraw failed");
    }
}

/// A recipient whose receive() needs more than the 2300-gas stipend.
contract GasHungryRecipient {
    uint256 public received;

    receive() external payable {
        received += msg.value;
    }
}
