// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {StealthPaymentRouter, IERC5564Announcer} from "../src/StealthPaymentRouter.sol";
import {ERC5564Announcer} from "../src/ERC5564Announcer.sol";

interface ITetherTokenV2 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function TRANSFER_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Runs the router against Whitechain Sepolia's official test USDT (TetherTokenV2).
/// @dev `WHITECHAIN_RPC_URL=https://rpc.testnet.whitechain.io forge test --match-contract Fork`
contract StealthPaymentRouterForkTest is Test {
    address internal constant WHITECHAIN_USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;
    uint256 internal constant PAYER_KEY = 0xB0B;
    uint256 internal constant AMOUNT = 12_500_000;

    function test_fork_routesOfficialUsdtAuthorization() public {
        string memory rpc = vm.envOr("WHITECHAIN_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 1874);

        // given
        ERC5564Announcer announcer = new ERC5564Announcer();
        StealthPaymentRouter router = new StealthPaymentRouter(IERC5564Announcer(address(announcer)));
        ITetherTokenV2 usdt = ITetherTokenV2(WHITECHAIN_USDT);
        address payer = vm.addr(PAYER_KEY);
        address stealth = makeAddr("stealth");
        deal(WHITECHAIN_USDT, payer, AMOUNT);

        bytes memory eph = hex"02a1b2c3d4e5f60718293a4b5c6d7e8f9001122334455667788990aabbccddeeff";
        bytes memory metadata = abi.encodePacked(bytes1(0xa7), bytes1(0x54), uint32(1874), WHITECHAIN_USDT, AMOUNT);
        bytes32 nonce = router.announcementNonce(stealth, eph, metadata);
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdt.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(usdt.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), payer, stealth, AMOUNT, 0, validBefore, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PAYER_KEY, digest);
        StealthPaymentRouter.Authorization memory auth =
            StealthPaymentRouter.Authorization(payer, AMOUNT, 0, validBefore, nonce, abi.encodePacked(r, s, v));

        // when
        vm.prank(makeAddr("relayer"));
        router.payWithAuthorization(WHITECHAIN_USDT, stealth, auth, eph, metadata);

        // then
        assertEq(usdt.balanceOf(stealth), AMOUNT);
        assertEq(usdt.balanceOf(payer), 0);
    }
}
