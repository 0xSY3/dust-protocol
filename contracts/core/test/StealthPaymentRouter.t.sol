// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {StealthPaymentRouter, IERC5564Announcer} from "../src/StealthPaymentRouter.sol";
import {ERC5564Announcer} from "../src/ERC5564Announcer.sol";

/// @dev EIP-3009 token with TetherTokenV2's EIP-712 domain ("Tether USD", version "1") and checks.
contract MockERC3009 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Tether USD"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        require(block.timestamp > validAfter, "authorization not yet valid");
        require(block.timestamp < validBefore, "authorization expired");
        require(!authorizationState[from][nonce], "authorization used");
        require(signature.length == 65, "bad signature length");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
            )
        );
        address signer = ecrecover(digest, uint8(signature[64]), bytes32(signature[0:32]), bytes32(signature[32:64]));
        require(signer == from && signer != address(0), "invalid signature");

        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

contract StealthPaymentRouterTest is Test {
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    uint256 internal constant PAYER_KEY = 0xA11CE;
    uint256 internal constant STARTING_BALANCE = 100_000_000;
    uint256 internal constant AMOUNT = 25_000_000;

    ERC5564Announcer internal announcer;
    StealthPaymentRouter internal router;
    MockERC3009 internal usdt;
    address internal payer;
    address internal relayer = makeAddr("relayer");
    address internal stealth = makeAddr("stealth");
    bytes internal eph = hex"02a1b2c3d4e5f60718293a4b5c6d7e8f9001122334455667788990aabbccddeeff";
    bytes internal metadata;

    function setUp() public {
        // Dust invoice metadata: view tag | 'T' | chainId | token | amount | 'I' | invoice id
        metadata = abi.encodePacked(
            bytes1(0xa7),
            bytes1(0x54),
            uint32(1874),
            address(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7),
            AMOUNT,
            bytes1(0x49),
            bytes16(0x00112233445566778899aabbccddeeff)
        );
        announcer = new ERC5564Announcer();
        router = new StealthPaymentRouter(IERC5564Announcer(address(announcer)));
        usdt = new MockERC3009();
        payer = vm.addr(PAYER_KEY);
        usdt.mint(payer, STARTING_BALANCE);
        vm.warp(1_000_000);
    }

    function _authorize(address to, uint256 value, bytes32 nonce)
        internal
        view
        returns (StealthPaymentRouter.Authorization memory)
    {
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdt.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(usdt.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), payer, to, value, 0, validBefore, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PAYER_KEY, digest);
        return StealthPaymentRouter.Authorization(payer, value, 0, validBefore, nonce, abi.encodePacked(r, s, v));
    }

    function test_payWithAuthorization_transfersAndAnnouncesInOneTransaction() public {
        // given
        StealthPaymentRouter.Authorization memory auth =
            _authorize(stealth, AMOUNT, router.announcementNonce(stealth, eph, metadata));

        // then
        vm.expectEmit(true, true, true, true, address(announcer));
        emit Announcement(1, stealth, address(router), eph, metadata);

        // when
        vm.prank(relayer);
        router.payWithAuthorization(address(usdt), stealth, auth, eph, metadata);

        assertEq(usdt.balanceOf(stealth), AMOUNT);
        assertEq(usdt.balanceOf(payer), STARTING_BALANCE - AMOUNT);
    }

    function test_payWithAuthorization_revertsWhenNonceIsNotBoundToAnnouncement() public {
        // given
        bytes32 unboundNonce = keccak256("random");
        StealthPaymentRouter.Authorization memory auth = _authorize(stealth, AMOUNT, unboundNonce);
        bytes32 expected = router.announcementNonce(stealth, eph, metadata);

        // when / then
        vm.expectRevert(
            abi.encodeWithSelector(StealthPaymentRouter.NonceNotBoundToAnnouncement.selector, expected, unboundNonce)
        );
        router.payWithAuthorization(address(usdt), stealth, auth, eph, metadata);
    }

    function test_payWithAuthorization_revertsWhenSubmitterSwapsMetadata() public {
        // given: payer signed for `metadata`
        StealthPaymentRouter.Authorization memory auth =
            _authorize(stealth, AMOUNT, router.announcementNonce(stealth, eph, metadata));
        bytes memory forged = hex"a700";

        // when / then
        vm.expectRevert(
            abi.encodeWithSelector(
                StealthPaymentRouter.NonceNotBoundToAnnouncement.selector,
                router.announcementNonce(stealth, eph, forged),
                auth.nonce
            )
        );
        router.payWithAuthorization(address(usdt), stealth, auth, eph, forged);
    }

    function test_payWithAuthorization_revertsWhenSubmitterRedirectsStealthAddress() public {
        // given
        StealthPaymentRouter.Authorization memory auth =
            _authorize(stealth, AMOUNT, router.announcementNonce(stealth, eph, metadata));
        address attacker = makeAddr("attacker");

        // when / then
        vm.expectRevert(
            abi.encodeWithSelector(
                StealthPaymentRouter.NonceNotBoundToAnnouncement.selector,
                router.announcementNonce(attacker, eph, metadata),
                auth.nonce
            )
        );
        router.payWithAuthorization(address(usdt), attacker, auth, eph, metadata);
    }

    function test_payWithAuthorization_revertsOnReplay() public {
        // given
        StealthPaymentRouter.Authorization memory auth =
            _authorize(stealth, AMOUNT, router.announcementNonce(stealth, eph, metadata));
        router.payWithAuthorization(address(usdt), stealth, auth, eph, metadata);

        // when / then
        vm.expectRevert("authorization used");
        router.payWithAuthorization(address(usdt), stealth, auth, eph, metadata);
        assertEq(usdt.balanceOf(stealth), AMOUNT);
    }

    function test_payWithAuthorization_revertsAfterDirectSubmissionWithoutDoubleSpend() public {
        // given: the authorization is front-run straight to the token
        StealthPaymentRouter.Authorization memory auth =
            _authorize(stealth, AMOUNT, router.announcementNonce(stealth, eph, metadata));
        usdt.transferWithAuthorization(
            auth.from, stealth, auth.value, auth.validAfter, auth.validBefore, auth.nonce, auth.signature
        );

        // when / then
        vm.expectRevert("authorization used");
        router.payWithAuthorization(address(usdt), stealth, auth, eph, metadata);
        assertEq(usdt.balanceOf(payer), STARTING_BALANCE - AMOUNT);
    }

    function testFuzz_announcementNonce_commitsToEveryField(bytes calldata ephA, bytes calldata metaA, address to)
        public
        view
    {
        bytes32 base = router.announcementNonce(to, ephA, metaA);
        assertTrue(base != router.announcementNonce(to, bytes.concat(ephA, hex"00"), metaA));
        assertTrue(base != router.announcementNonce(to, ephA, bytes.concat(metaA, hex"00")));
        assertTrue(base != router.announcementNonce(address(uint160(to) ^ 1), ephA, metaA));
    }

    function test_constructor_rejectsZeroAnnouncer() public {
        vm.expectRevert(StealthPaymentRouter.ZeroAddress.selector);
        new StealthPaymentRouter(IERC5564Announcer(address(0)));
    }
}
