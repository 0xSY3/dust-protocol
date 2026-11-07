// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import {
    DustSwapAdapterV2,
    PoolKey,
    SwapParams,
    IHooksAdapter,
    IDustPoolV2,
    IPoolManagerAdapter,
    IERC20Adapter,
    IAggregatorV3
} from "../src/DustSwapAdapterV2.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT6} from "poseidon-solidity/PoseidonT6.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

// ─── Mock ERC20 ─────────────────────────────────────────────────────────────

contract MockERC20 is Test {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

// ─── Mock DustPoolV2 ────────────────────────────────────────────────────────

contract MockDustPoolV2 {
    bool public paused;
    uint256 public withdrawAmountToSend;

    struct DepositRecord {
        bytes32 commitment;
        uint256 amount;
        address token;
    }
    DepositRecord[] public ethDeposits;
    DepositRecord[] public erc20Deposits;

    error AssetMismatch();

    function setPaused(bool _paused) external { paused = _paused; }
    function setWithdrawAmount(uint256 _amount) external { withdrawAmountToSend = _amount; }

    function withdraw(
        bytes calldata, bytes32, bytes32, bytes32, bytes32, bytes32,
        uint256, uint256 publicAsset, address recipient, address tokenAddress
    ) external {
        if (publicAsset != _assetId(tokenAddress)) revert AssetMismatch();
        if (tokenAddress == address(0)) {
            (bool ok,) = recipient.call{value: withdrawAmountToSend}("");
            require(ok, "MockPool: ETH send failed");
        } else {
            IERC20Adapter(tokenAddress).transfer(recipient, withdrawAmountToSend);
        }
    }

    function depositNote(uint256 ownerPubKey, uint256 blinding) external payable returns (bytes32 commitment) {
        commitment = _noteCommitment(ownerPubKey, msg.value, address(0), blinding);
        ethDeposits.push(DepositRecord(commitment, msg.value, address(0)));
    }

    function depositERC20Note(uint256 ownerPubKey, uint256 blinding, address token, uint256 amount)
        external
        returns (bytes32 commitment)
    {
        commitment = _noteCommitment(ownerPubKey, amount, token, blinding);
        // Use low-level call for transferFrom (not in IERC20Adapter interface)
        (bool ok,) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        require(ok, "MockPool: transferFrom failed");
        erc20Deposits.push(DepositRecord(commitment, amount, token));
    }

    function ethDepositCount() external view returns (uint256) { return ethDeposits.length; }
    function erc20DepositCount() external view returns (uint256) { return erc20Deposits.length; }

    /// @dev Same formulas as DustPoolV2._noteCommitment and _assetId
    function _noteCommitment(uint256 ownerPubKey, uint256 amount, address token, uint256 blinding)
        internal
        view
        returns (bytes32)
    {
        return bytes32(PoseidonT6.hash([ownerPubKey, amount, _assetId(token), block.chainid, blinding]));
    }

    function _assetId(address token) internal view returns (uint256) {
        return PoseidonT3.hash([block.chainid, uint256(uint160(token))]);
    }

    receive() external payable {}
}

// ─── Mock PoolManager ───────────────────────────────────────────────────────

contract MockPoolManager {
    int256 public swapResult;
    address public adapter;

    function setSwapResult(int256 _result) external { swapResult = _result; }
    function setAdapter(address _adapter) external { adapter = _adapter; }

    function unlock(bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = adapter.call(
            abi.encodeWithSignature("unlockCallback(bytes)", data)
        );
        require(ok, "MockPM: unlockCallback failed");
        return abi.decode(result, (bytes));
    }

    function swap(PoolKey memory, SwapParams memory, bytes calldata) external returns (int256) {
        return swapResult;
    }

    function settle() external payable returns (uint256) { return msg.value; }
    function sync(address) external {}

    function take(address currency, address to, uint256 amount) external {
        if (currency == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "MockPM: ETH take failed");
        } else {
            // Low-level call like v4's CurrencyLibrary.transfer, so no-return (USDT-style) tokens work
            (bool ok,) = currency.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
            require(ok, "MockPM: token take failed");
        }
    }

    receive() external payable {}
}

// ─── Mock ERC5564Announcer (same event and emit as contracts/core/src/ERC5564Announcer.sol) ──

contract MockERC5564Announcer {
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external {
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }
}

// ─── Mock USDT-style ERC20: transfer() returns nothing ──────────────────────

contract MockNoReturnERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}

// ─── Stealth recipients with hostile receive() ──────────────────────────────

contract RejectingReceiver {
    receive() external payable {
        revert("RejectingReceiver: no ETH");
    }
}

/// @dev Re-enters the adapter when paid, records the revert, and still accepts the payment
contract ReentrantReceiver {
    address public immutable target;
    bytes public reentryCalldata;
    bytes4 public reentryRevertSelector;

    constructor(address target_) {
        target = target_;
    }

    function setReentryCalldata(bytes calldata data) external {
        reentryCalldata = data;
    }

    receive() external payable {
        (bool ok, bytes memory reason) = target.call(reentryCalldata);
        require(!ok, "ReentrantReceiver: reentry succeeded");
        reentryRevertSelector = bytes4(reason);
    }
}

/// @dev Exposes the internal metadata builder so it can be checked against vectors from Dust's TS codec
contract DustSwapAdapterV2MetadataHarness is DustSwapAdapterV2 {
    constructor(address poolManager_, address dustPoolV2_, address announcer_)
        DustSwapAdapterV2(poolManager_, dustPoolV2_, announcer_)
    {}

    function stealthMetadata(bytes1 viewTag, address tokenOut, uint256 amount, bytes16 invoiceId)
        external
        view
        returns (bytes memory)
    {
        return _stealthMetadata(viewTag, tokenOut, amount, invoiceId);
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

contract DustSwapAdapterV2Test is Test {
    DustSwapAdapterV2 public adapter;
    MockDustPoolV2 public mockPool;
    MockPoolManager public mockPM;
    MockERC20 public mockToken;
    MockERC5564Announcer public announcer;

    address deployer = makeAddr("deployer");
    address relayer = makeAddr("relayer");
    address alice = makeAddr("alice");

    uint256 constant INPUT_ETH = 1 ether;
    uint256 constant OUTPUT_TOKEN = 2000e18;
    uint256 constant RELAYER_FEE_BPS = 100; // 1%
    uint256 constant OWNER_PUB_KEY = 12345;
    uint256 constant BLINDING = 67890;

    event PrivateSwapExecuted(
        bytes32 indexed nullifier,
        bytes32 indexed outputCommitment,
        address tokenIn,
        address tokenOut,
        uint256 outputAmount,
        uint256 relayerFeeBps
    );

    event RelayerUpdated(address indexed relayer, bool allowed);

    event PrivateSwapToStealthExecuted(
        bytes32 indexed nullifier,
        address indexed stealthAddress,
        address tokenIn,
        address tokenOut,
        uint256 outputAmount,
        uint256 relayerFeeBps
    );

    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    /// @dev secp256k1 generator G in SEC1-compressed form: a valid 33-byte ephemeral public key
    bytes constant EPHEMERAL_PUB_KEY = hex"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    bytes1 constant VIEW_TAG = 0xab;
    bytes32 constant NULLIFIER0 = bytes32(uint256(0x1111));
    bytes16 constant INVOICE_ID = 0x9f2c41d07be35a68c1e0f4b2a7d39e15;
    bytes16 constant NO_INVOICE = bytes16(0);

    /// @dev Output of encodeTokenMetadata (src/lib/stealth/metadata.ts) for viewTag 0xab, chainId 11155111,
    ///      Sepolia USDC, amount 1234567, with and without INVOICE_ID. The adapter must match it byte-for-byte.
    bytes constant TS_CODEC_METADATA_WITH_INVOICE =
        hex"ab5400aa36a71c7d4b196cb0c7b01d743fbc6116a902379c7238000000000000000000000000000000000000000000000000000000000012d687499f2c41d07be35a68c1e0f4b2a7d39e15";
    bytes constant TS_CODEC_METADATA_NO_INVOICE =
        hex"ab5400aa36a71c7d4b196cb0c7b01d743fbc6116a902379c7238000000000000000000000000000000000000000000000000000000000012d687";
    address constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    address stealth = makeAddr("stealth");

    PoolKey poolKey;

    /// @dev publicAsset for tokenIn = ETH / mockToken. Cached because computing one calls the linked PoseidonT3
    ///      library, and that call would consume a pending vm.prank, vm.expectRevert or vm.expectEmit. Both commit
    ///      to block.chainid, so a test that changes the chain id must call _cacheAssetIds again.
    uint256 ethAssetId;
    uint256 tokenAssetId;

    function setUp() public {
        // Deploy Poseidon libraries at their linked addresses (foundry.toml embeds these in bytecode)
        deployCodeTo(
            "PoseidonT3.sol:PoseidonT3",
            0x203a488C06e9add25D4b51F7EDE8e56bCC4B1A1C
        );
        deployCodeTo(
            "PoseidonT6.sol:PoseidonT6",
            0x666333F371685334CdD69bdDdaFBABc87CE7c7Db
        );

        vm.startPrank(deployer);
        mockPool = new MockDustPoolV2();
        mockPM = new MockPoolManager();
        mockToken = new MockERC20();
        announcer = new MockERC5564Announcer();
        adapter = new DustSwapAdapterV2(address(mockPM), address(mockPool), address(announcer));
        adapter.setRelayer(relayer, true);
        vm.stopPrank();

        poolKey = PoolKey({
            currency0: address(0),
            currency1: address(mockToken),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooksAdapter(address(0))
        });

        mockPM.setAdapter(address(adapter));

        vm.deal(address(mockPool), 100 ether);
        mockToken.mint(address(mockPool), 1_000_000e18);
        mockToken.mint(address(mockPM), 1_000_000e18);
        vm.deal(address(mockPM), 100 ether);

        _cacheAssetIds();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// @dev Packs two int128 values into a single int256 (Uniswap V4 BalanceDelta format)
    function _packDelta(int128 amount0, int128 amount1) internal pure returns (int256 result) {
        assembly {
            result := or(
                shl(128, amount0),
                and(amount1, 0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff)
            )
        }
    }

    function _dummyProof() internal pure returns (bytes memory) {
        return new bytes(768);
    }

    /// @dev The withdraw circuit's publicAsset for `token`; DustPoolV2 reverts AssetMismatch on anything else
    function _assetId(address token) internal view returns (uint256) {
        return PoseidonT3.hash([block.chainid, uint256(uint160(token))]);
    }

    function _cacheAssetIds() internal {
        ethAssetId = _assetId(address(0));
        tokenAssetId = _assetId(address(mockToken));
    }

    function _cachedAssetId(address tokenIn) internal view returns (uint256) {
        return tokenIn == address(0) ? ethAssetId : tokenAssetId;
    }

    function _computeExpectedCommitment(
        uint256 ownerPubKey,
        uint256 amount,
        address tokenOut,
        uint256 blinding_
    ) internal view returns (uint256) {
        return PoseidonT6.hash([ownerPubKey, amount, _assetId(tokenOut), block.chainid, blinding_]);
    }

    /// @dev Execute a default ETH→ERC20 swap through the adapter
    function _executeETHToERC20Swap(
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 feeBps,
        uint256 minAmountOut
    ) internal {
        mockPool.setWithdrawAmount(inputAmount);

        // zeroForOne: delta0 = -(input ETH), delta1 = +(output ERC20)
        int256 delta = _packDelta(-int128(int256(inputAmount)), int128(int256(outputAmount)));
        mockPM.setSwapResult(delta);

        vm.prank(relayer);
        adapter.executeSwap(
            _dummyProof(),
            bytes32(uint256(0xAABB)),
            bytes32(uint256(0x1111)),
            bytes32(uint256(0x2222)),
            bytes32(uint256(0x3333)),
            bytes32(uint256(0x4444)),
            inputAmount,
            ethAssetId,
            address(0),             // tokenIn = ETH
            poolKey,
            true,                   // zeroForOne
            minAmountOut,
            OWNER_PUB_KEY,
            BLINDING,
            address(mockToken),     // tokenOut = ERC20
            relayer,
            feeBps
        );
    }

    // ─── Test 1: ETH → ERC20 Happy Path ────────────────────────────────────

    function testExecuteSwap_happyPath_ETH() public {
        uint256 fee = (OUTPUT_TOKEN * RELAYER_FEE_BPS) / 10_000;
        uint256 userAmount = OUTPUT_TOKEN - fee;

        _executeETHToERC20Swap(INPUT_ETH, OUTPUT_TOKEN, RELAYER_FEE_BPS, userAmount);

        assertEq(mockPool.erc20DepositCount(), 1, "Should deposit to pool once");
        (, uint256 amount, address token) = mockPool.erc20Deposits(0);
        assertEq(amount, userAmount, "Deposit amount = userAmount");
        assertEq(token, address(mockToken), "Deposit token");

        assertEq(mockToken.balanceOf(relayer), fee, "Relayer received ERC20 fee");
    }

    // ─── Test 2: ERC20 → ETH Happy Path ────────────────────────────────────

    function testExecuteSwap_happyPath_ERC20() public {
        uint256 inputERC20 = 2000e18;
        uint256 outputETH = 1 ether;
        uint256 feeBps = 100;
        uint256 fee = (outputETH * feeBps) / 10_000;
        uint256 userAmount = outputETH - fee;

        mockPool.setWithdrawAmount(inputERC20);

        // oneForZero: delta0 = +outputETH (receive), delta1 = -inputERC20 (settle)
        int256 delta = _packDelta(int128(int256(outputETH)), -int128(int256(inputERC20)));
        mockPM.setSwapResult(delta);

        vm.prank(relayer);
        adapter.executeSwap(
            _dummyProof(),
            bytes32(uint256(0xAABB)),
            bytes32(uint256(0x1111)),
            bytes32(uint256(0x2222)),
            bytes32(uint256(0x3333)),
            bytes32(uint256(0x4444)),
            inputERC20,
            tokenAssetId,
            address(mockToken),     // tokenIn = ERC20
            poolKey,
            false,                  // oneForZero
            userAmount,
            OWNER_PUB_KEY,
            BLINDING,
            address(0),             // tokenOut = ETH
            relayer,
            feeBps
        );

        assertEq(mockPool.ethDepositCount(), 1, "Should deposit ETH to pool once");
        (bytes32 commitment, uint256 amount,) = mockPool.ethDeposits(0);
        assertEq(amount, userAmount, "Deposit amount = userAmount");
        assertEq(
            commitment,
            bytes32(_computeExpectedCommitment(OWNER_PUB_KEY, userAmount, address(0), BLINDING)),
            "ETH note commits to userAmount of native ETH"
        );
        assertEq(relayer.balance, fee, "Relayer received ETH fee");
    }

    // ─── Test 3: Only Relayer ───────────────────────────────────────────────

    function testExecuteSwap_onlyRelayer() public {
        vm.prank(alice);
        vm.expectRevert(DustSwapAdapterV2.NotRelayer.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, ethAssetId, address(0), poolKey, true, 1,
            OWNER_PUB_KEY, BLINDING, address(mockToken), alice, 0
        );
    }

    // ─── Test 4: Slippage Protection ────────────────────────────────────────

    function testExecuteSwap_slippageProtection() public {
        uint256 smallOutput = 100e18;
        uint256 highMinAmount = 200e18;

        mockPool.setWithdrawAmount(INPUT_ETH);
        int256 delta = _packDelta(-int128(int256(INPUT_ETH)), int128(int256(smallOutput)));
        mockPM.setSwapResult(delta);

        vm.prank(relayer);
        vm.expectRevert(DustSwapAdapterV2.SlippageExceeded.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(uint256(1)), bytes32(uint256(1)), bytes32(0),
            bytes32(0), bytes32(0),
            INPUT_ETH, ethAssetId, address(0), poolKey, true, highMinAmount,
            OWNER_PUB_KEY, BLINDING, address(mockToken), relayer, 0
        );
    }

    // ─── Test 5: Relayer Fee Cap ────────────────────────────────────────────

    function testExecuteSwap_relayerFeeCap() public {
        vm.prank(relayer);
        vm.expectRevert(DustSwapAdapterV2.RelayerFeeTooHigh.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, ethAssetId, address(0), poolKey, true, 1,
            OWNER_PUB_KEY, BLINDING, address(mockToken), relayer, 501
        );
    }

    // ─── Test 6: Zero Min Amount ────────────────────────────────────────────

    function testExecuteSwap_zeroMinAmount() public {
        vm.prank(relayer);
        vm.expectRevert(DustSwapAdapterV2.ZeroMinAmount.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, ethAssetId, address(0), poolKey, true, 0,
            OWNER_PUB_KEY, BLINDING, address(mockToken), relayer, 100
        );
    }

    // ─── Test 7: Relayer Fee Payment ────────────────────────────────────────

    function testExecuteSwap_relayerFeePayment() public {
        uint256 feeBps = 250; // 2.5%
        uint256 fee = (OUTPUT_TOKEN * feeBps) / 10_000;
        uint256 userAmount = OUTPUT_TOKEN - fee;

        _executeETHToERC20Swap(INPUT_ETH, OUTPUT_TOKEN, feeBps, userAmount);

        assertEq(mockToken.balanceOf(relayer), fee, "Relayer receives exact fee");
        (, uint256 depositedAmount,) = mockPool.erc20Deposits(0);
        assertEq(depositedAmount, userAmount, "Pool receives userAmount");
        assertEq(fee + userAmount, OUTPUT_TOKEN, "Fee + user = total output");
    }

    // ─── Test 8: Commitment Emitted ─────────────────────────────────────────

    function testExecuteSwap_commitmentEmitted() public {
        uint256 fee = (OUTPUT_TOKEN * RELAYER_FEE_BPS) / 10_000;
        uint256 userAmount = OUTPUT_TOKEN - fee;

        uint256 expectedCommitment = _computeExpectedCommitment(
            OWNER_PUB_KEY, userAmount, address(mockToken), BLINDING
        );

        // Set up mocks BEFORE vm.expectEmit to avoid interference
        mockPool.setWithdrawAmount(INPUT_ETH);
        int256 delta = _packDelta(-int128(int256(INPUT_ETH)), int128(int256(OUTPUT_TOKEN)));
        mockPM.setSwapResult(delta);

        // Now set up the expected event right before the call
        vm.expectEmit(true, true, true, true, address(adapter));
        emit PrivateSwapExecuted(
            bytes32(uint256(0x1111)),
            bytes32(expectedCommitment),
            address(0),
            address(mockToken),
            userAmount,
            RELAYER_FEE_BPS
        );

        vm.prank(relayer);
        adapter.executeSwap(
            _dummyProof(),
            bytes32(uint256(0xAABB)),
            bytes32(uint256(0x1111)),
            bytes32(uint256(0x2222)),
            bytes32(uint256(0x3333)),
            bytes32(uint256(0x4444)),
            INPUT_ETH,
            ethAssetId,
            address(0),
            poolKey,
            true,
            userAmount,
            OWNER_PUB_KEY,
            BLINDING,
            address(mockToken),
            relayer,
            RELAYER_FEE_BPS
        );
    }

    // ─── Test 8b: Commitment Emitted (ETH Output) ───────────────────────────

    function testExecuteSwap_commitmentEmitted_ETHOut() public {
        uint256 outputETH = 1 ether;
        uint256 userAmount = outputETH - (outputETH * RELAYER_FEE_BPS) / 10_000;
        bytes32 expectedCommitment =
            bytes32(_computeExpectedCommitment(OWNER_PUB_KEY, userAmount, address(0), BLINDING));
        _mockTokenToEthSwap(2000e18, outputETH);

        vm.expectEmit(true, true, true, true, address(adapter));
        emit PrivateSwapExecuted(
            NULLIFIER0, expectedCommitment, address(mockToken), address(0), userAmount, RELAYER_FEE_BPS
        );

        vm.prank(relayer);
        adapter.executeSwap(
            _dummyProof(), bytes32(uint256(0xAABB)), NULLIFIER0, bytes32(0), bytes32(0), bytes32(0),
            2000e18, tokenAssetId, address(mockToken), poolKey, false, userAmount,
            OWNER_PUB_KEY, BLINDING, address(0), relayer, RELAYER_FEE_BPS
        );

        (bytes32 pooledCommitment,,) = mockPool.ethDeposits(0);
        assertEq(pooledCommitment, expectedCommitment, "Event carries the commitment depositNote returned");
    }

    // ─── Test 8c: publicAsset Must Match tokenIn ────────────────────────────

    function testPublicAssetMismatchReverts() public {
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);

        vm.startPrank(relayer);
        vm.expectRevert(MockDustPoolV2.AssetMismatch.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(uint256(0xAABB)), NULLIFIER0, bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, tokenAssetId, address(0), poolKey, true, 1,
            OWNER_PUB_KEY, BLINDING, address(mockToken), relayer, 0
        );

        vm.expectRevert(MockDustPoolV2.AssetMismatch.selector);
        adapter.executeSwapToStealth(
            _dummyProof(), bytes32(uint256(0xAABB)), NULLIFIER0, bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, tokenAssetId, address(0), poolKey, true, 1,
            stealth, EPHEMERAL_PUB_KEY, VIEW_TAG, NO_INVOICE, address(mockToken), relayer, 0
        );
        vm.stopPrank();
    }

    // ─── Test 9: Set Relayer ────────────────────────────────────────────────

    function testSetRelayer() public {
        address newRelayer = makeAddr("newRelayer");

        vm.prank(deployer);
        vm.expectEmit(true, false, false, true, address(adapter));
        emit RelayerUpdated(newRelayer, true);
        adapter.setRelayer(newRelayer, true);
        assertTrue(adapter.authorizedRelayers(newRelayer));

        vm.prank(deployer);
        adapter.setRelayer(newRelayer, false);
        assertFalse(adapter.authorizedRelayers(newRelayer));

        vm.prank(alice);
        vm.expectRevert();
        adapter.setRelayer(newRelayer, true);
    }

    // ─── Test 10: Emergency Withdraw ETH ─────────────────────────────────────

    function testEmergencyWithdrawETH() public {
        vm.deal(address(adapter), 5 ether);
        uint256 balBefore = deployer.balance;

        vm.prank(deployer);
        adapter.emergencyWithdrawETH();

        assertEq(address(adapter).balance, 0, "Adapter drained");
        assertEq(deployer.balance - balBefore, 5 ether, "Owner received ETH");
    }

    function testEmergencyWithdrawETH_onlyOwner() public {
        vm.deal(address(adapter), 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        adapter.emergencyWithdrawETH();
    }

    // ─── Test 11: Emergency Withdraw ERC20 ────────────────────────────────────

    function testEmergencyWithdrawERC20() public {
        mockToken.mint(address(adapter), 1000e18);

        vm.prank(deployer);
        adapter.emergencyWithdrawERC20(address(mockToken));

        assertEq(mockToken.balanceOf(address(adapter)), 0, "Adapter drained");
        assertEq(mockToken.balanceOf(deployer), 1000e18, "Owner received tokens");
    }

    // ─── Test 12: unlockCallback rejects non-PoolManager ──────────────────────

    function testUnlockCallback_onlyPoolManager() public {
        vm.prank(alice);
        vm.expectRevert(DustSwapAdapterV2.NotPoolManager.selector);
        adapter.unlockCallback(new bytes(0));
    }

    // ─── Test 13: Ownable2Step ──────────────────────────────────────────────

    function testOwnable2Step() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(alice);
        vm.expectRevert();
        adapter.transferOwnership(newOwner);

        vm.prank(deployer);
        adapter.transferOwnership(newOwner);
        assertEq(adapter.owner(), deployer, "Owner unchanged until accepted");

        vm.prank(newOwner);
        adapter.acceptOwnership();
        assertEq(adapter.owner(), newOwner, "Ownership transferred");
    }

    // ─── Test 11: Pool Paused ───────────────────────────────────────────────

    function testExecuteSwap_poolPaused() public {
        mockPool.setPaused(true);

        vm.prank(relayer);
        vm.expectRevert(DustSwapAdapterV2.PoolPaused.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, ethAssetId, address(0), poolKey, true, 1,
            OWNER_PUB_KEY, BLINDING, address(mockToken), relayer, 100
        );
    }

    // ─── Test 14: Oracle Admin ───────────────────────────────────────────────

    function testSetPriceOracle() public {
        MockChainlinkOracle oracle = new MockChainlinkOracle(2500e8, 8);
        vm.prank(deployer);
        adapter.setPriceOracle(address(oracle));
        assertEq(address(adapter.priceOracle()), address(oracle));
    }

    function testSetPriceOracle_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        adapter.setPriceOracle(address(1));
    }

    function testSetMaxOracleDeviation() public {
        vm.prank(deployer);
        adapter.setMaxOracleDeviation(500); // 5%
        assertEq(adapter.maxOracleDeviationBps(), 500);
    }

    function testSetMaxOracleDeviation_rejectsTooHigh() public {
        vm.prank(deployer);
        vm.expectRevert(DustSwapAdapterV2.DeviationBpsTooHigh.selector);
        adapter.setMaxOracleDeviation(5001);
    }

    // ─── Test 15: Oracle Bound — Swap Passes Within Bounds ───────────────────

    function testOracleBound_passesWithinBounds() public {
        // Oracle: 2000 USD/ETH. Swap: 1 ETH → 1900 USDC (5% below oracle — within 10%)
        // Use 6-decimal amounts to match _checkOracleBound's USDC assumption
        MockERC20 mockUSDC = new MockERC20();
        mockUSDC.mint(address(mockPool), 1_000_000e6);
        mockUSDC.mint(address(mockPM), 1_000_000e6);

        PoolKey memory usdcPoolKey = PoolKey({
            currency0: address(0),
            currency1: address(mockUSDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooksAdapter(address(0))
        });

        MockChainlinkOracle oracle = new MockChainlinkOracle(2000e8, 8);
        vm.startPrank(deployer);
        adapter.setPriceOracle(address(oracle));
        adapter.setMaxOracleDeviation(1000); // 10%
        vm.stopPrank();

        uint256 outputUSDC = 1900e6; // 1900 USDC = 5% below oracle price of 2000
        mockPool.setWithdrawAmount(INPUT_ETH);
        int256 delta = _packDelta(-int128(int256(INPUT_ETH)), int128(int256(outputUSDC)));
        mockPM.setSwapResult(delta);

        uint256 fee = (outputUSDC * RELAYER_FEE_BPS) / 10_000;
        uint256 userAmount = outputUSDC - fee;

        vm.prank(relayer);
        adapter.executeSwap(
            _dummyProof(), bytes32(uint256(0xAABB)), bytes32(uint256(0x1111)), bytes32(uint256(0x2222)),
            bytes32(uint256(0x3333)), bytes32(uint256(0x4444)),
            INPUT_ETH, ethAssetId, address(0),
            usdcPoolKey, true, userAmount,
            OWNER_PUB_KEY, BLINDING, address(mockUSDC), relayer, RELAYER_FEE_BPS
        );

        assertEq(mockPool.erc20DepositCount(), 1);
    }

    // ─── Test 16: Oracle Deviation Reverts ────────────────────────────────────

    function testOracleBound_deviationReverts() public {
        // Oracle: 2000 USD/ETH. Swap output: 500 USDC = 75% below oracle → revert
        MockERC20 mockUSDC = new MockERC20();
        mockUSDC.mint(address(mockPool), 1_000_000e6);
        mockUSDC.mint(address(mockPM), 1_000_000e6);

        PoolKey memory usdcPoolKey = PoolKey({
            currency0: address(0),
            currency1: address(mockUSDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooksAdapter(address(0))
        });

        MockChainlinkOracle oracle = new MockChainlinkOracle(2000e8, 8);
        vm.startPrank(deployer);
        adapter.setPriceOracle(address(oracle));
        adapter.setMaxOracleDeviation(1000); // 10%
        vm.stopPrank();

        uint256 outputUSDC = 500e6; // 500 USDC = 75% below oracle
        mockPool.setWithdrawAmount(INPUT_ETH);
        int256 delta = _packDelta(-int128(int256(INPUT_ETH)), int128(int256(outputUSDC)));
        mockPM.setSwapResult(delta);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(DustSwapAdapterV2.OracleDeviationExceeded.selector, 2000e18, 500e18));
        adapter.executeSwap(
            _dummyProof(), bytes32(uint256(1)), bytes32(uint256(1)), bytes32(0),
            bytes32(0), bytes32(0),
            INPUT_ETH, ethAssetId, address(0),
            usdcPoolKey, true, 1,
            OWNER_PUB_KEY, BLINDING, address(mockUSDC), relayer, 0
        );
    }

    // ─── Test 17: Oracle Stale Reverts ───────────────────────────────────────

    function testOracleBound_staleReverts() public {
        vm.warp(10_000); // set block.timestamp to avoid underflow

        MockChainlinkOracle oracle = new MockChainlinkOracle(2000e8, 8);
        oracle.setUpdatedAt(block.timestamp - 7200); // 2 hours ago

        vm.startPrank(deployer);
        adapter.setPriceOracle(address(oracle));
        adapter.setMaxOracleDeviation(1000);
        vm.stopPrank();

        MockERC20 mockUSDC = new MockERC20();
        mockUSDC.mint(address(mockPool), 1_000_000e6);
        mockUSDC.mint(address(mockPM), 1_000_000e6);

        PoolKey memory usdcPoolKey = PoolKey({
            currency0: address(0),
            currency1: address(mockUSDC),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooksAdapter(address(0))
        });

        mockPool.setWithdrawAmount(INPUT_ETH);
        int256 delta = _packDelta(-int128(int256(INPUT_ETH)), int128(int256(1900e6)));
        mockPM.setSwapResult(delta);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(DustSwapAdapterV2.OracleStale.selector, block.timestamp - 7200));
        adapter.executeSwap(
            _dummyProof(), bytes32(uint256(1)), bytes32(uint256(1)), bytes32(0),
            bytes32(0), bytes32(0),
            INPUT_ETH, ethAssetId, address(0),
            usdcPoolKey, true, 1,
            OWNER_PUB_KEY, BLINDING, address(mockUSDC), relayer, 0
        );
    }

    // ─── Test 17: No Oracle = Skip Check ─────────────────────────────────────

    function testOracleBound_noOracleSkipsCheck() public {
        // Default: priceOracle = address(0). Swap should pass without oracle check.
        uint256 fee = (OUTPUT_TOKEN * RELAYER_FEE_BPS) / 10_000;
        uint256 userAmount = OUTPUT_TOKEN - fee;
        _executeETHToERC20Swap(INPUT_ETH, OUTPUT_TOKEN, RELAYER_FEE_BPS, userAmount);
        assertEq(mockPool.erc20DepositCount(), 1);
    }

    // ═══ executeSwapToStealth ════════════════════════════════════════════════

    // ─── Stealth Helpers ────────────────────────────────────────────────────

    /// @dev ETH in (currency0) → token out (currency1)
    function _mockEthToTokenSwap(uint256 inputAmount, uint256 outputAmount) internal {
        mockPool.setWithdrawAmount(inputAmount);
        mockPM.setSwapResult(_packDelta(-int128(int256(inputAmount)), int128(int256(outputAmount))));
    }

    /// @dev Token in (currency1) → ETH out (currency0)
    function _mockTokenToEthSwap(uint256 inputAmount, uint256 outputAmount) internal {
        mockPool.setWithdrawAmount(inputAmount);
        mockPM.setSwapResult(_packDelta(int128(int256(outputAmount)), -int128(int256(inputAmount))));
    }

    function _swapToStealth(
        address tokenIn,
        PoolKey memory key,
        bool zeroForOne,
        uint256 minAmountOut,
        address stealthAddress,
        bytes memory ephemeralPubKey,
        address tokenOut,
        uint256 feeBps
    ) internal {
        _swapToStealthWithInvoice(
            tokenIn, key, zeroForOne, minAmountOut, stealthAddress, ephemeralPubKey, NO_INVOICE, tokenOut, feeBps
        );
    }

    function _swapToStealthWithInvoice(
        address tokenIn,
        PoolKey memory key,
        bool zeroForOne,
        uint256 minAmountOut,
        address stealthAddress,
        bytes memory ephemeralPubKey,
        bytes16 invoiceId,
        address tokenOut,
        uint256 feeBps
    ) internal {
        vm.prank(relayer);
        adapter.executeSwapToStealth(
            _dummyProof(), bytes32(uint256(0xAABB)), NULLIFIER0, bytes32(uint256(0x2222)),
            bytes32(uint256(0x3333)), bytes32(uint256(0x4444)), 0, _cachedAssetId(tokenIn),
            tokenIn, key, zeroForOne, minAmountOut,
            stealthAddress, ephemeralPubKey, VIEW_TAG, invoiceId, tokenOut, relayer, feeBps
        );
    }

    function _swapEthToTokenToStealth(uint256 minAmountOut, uint256 feeBps) internal {
        _swapToStealth(address(0), poolKey, true, minAmountOut, stealth, EPHEMERAL_PUB_KEY, address(mockToken), feeBps);
    }

    function _swapTokenToEthToStealth(address recipient, uint256 minAmountOut, uint256 feeBps) internal {
        _swapToStealth(address(mockToken), poolKey, false, minAmountOut, recipient, EPHEMERAL_PUB_KEY, address(0), feeBps);
    }

    /// @dev Mock USDC (6 decimals, as _checkOracleBound assumes) behind a 2000 USD/ETH oracle, 10% max deviation
    function _setUpUsdcPoolWithOracle() internal returns (MockERC20 usdc, PoolKey memory usdcKey) {
        usdc = new MockERC20();
        usdc.mint(address(mockPM), 1_000_000e6);
        usdcKey = PoolKey({
            currency0: address(0),
            currency1: address(usdc),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooksAdapter(address(0))
        });

        MockChainlinkOracle oracle = new MockChainlinkOracle(2000e8, 8);
        vm.startPrank(deployer);
        adapter.setPriceOracle(address(oracle));
        adapter.setMaxOracleDeviation(1000);
        vm.stopPrank();
    }

    /// @dev Reads `length` big-endian bytes at `offset` — the fixed offsets scanner.ts slices as hex
    function _readBigEndian(bytes memory data, uint256 offset, uint256 length) internal pure returns (uint256 value) {
        for (uint256 i; i < length; ++i) {
            value = (value << 8) | uint8(data[offset + i]);
        }
    }

    function _recordedAnnouncement() internal view returns (Vm.Log memory announcement) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(announcer)) {
                assertFalse(found, "exactly one announcement");
                announcement = logs[i];
                found = true;
            }
        }
        assertTrue(found, "announcement emitted");
    }

    // ─── Stealth 1: ETH → ERC20 Happy Path ──────────────────────────────────

    function testSwapToStealth_happyPath_ETHToERC20() public {
        uint256 fee = (OUTPUT_TOKEN * RELAYER_FEE_BPS) / 10_000;
        uint256 userAmount = OUTPUT_TOKEN - fee;
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);

        bytes memory expectedMetadata = bytes.concat(
            VIEW_TAG, bytes1(0x54), bytes4(uint32(block.chainid)), bytes20(address(mockToken)), bytes32(userAmount)
        );
        vm.expectEmit(address(announcer));
        emit Announcement(1, stealth, address(adapter), EPHEMERAL_PUB_KEY, expectedMetadata);
        vm.expectEmit(address(adapter));
        emit PrivateSwapToStealthExecuted(
            NULLIFIER0, stealth, address(0), address(mockToken), userAmount, RELAYER_FEE_BPS
        );

        _swapEthToTokenToStealth(userAmount, RELAYER_FEE_BPS);

        assertEq(mockToken.balanceOf(stealth), userAmount, "Stealth receives exactly userAmount");
        assertEq(mockToken.balanceOf(relayer), fee, "Relayer receives fee");
        assertEq(mockToken.balanceOf(address(adapter)), 0, "No token left on adapter");
        assertEq(address(adapter).balance, 0, "No ETH left on adapter");
        assertEq(mockPool.erc20DepositCount() + mockPool.ethDepositCount(), 0, "Nothing re-deposited");
    }

    // ─── Stealth 2: ERC20 → ETH Happy Path ──────────────────────────────────

    function testSwapToStealth_happyPath_ERC20ToETH() public {
        uint256 outputETH = 1 ether;
        uint256 fee = (outputETH * RELAYER_FEE_BPS) / 10_000;
        uint256 userAmount = outputETH - fee;
        _mockTokenToEthSwap(2000e18, outputETH);

        // ETH payouts carry only the view tag, exactly like sendEthToStealth
        vm.expectEmit(address(announcer));
        emit Announcement(1, stealth, address(adapter), EPHEMERAL_PUB_KEY, bytes.concat(VIEW_TAG));
        vm.expectEmit(address(adapter));
        emit PrivateSwapToStealthExecuted(
            NULLIFIER0, stealth, address(mockToken), address(0), userAmount, RELAYER_FEE_BPS
        );

        _swapTokenToEthToStealth(stealth, userAmount, RELAYER_FEE_BPS);

        assertEq(stealth.balance, userAmount, "Stealth receives exactly userAmount");
        assertEq(relayer.balance, fee, "Relayer receives fee");
        assertEq(address(adapter).balance, 0, "No ETH left on adapter");
        assertEq(mockToken.balanceOf(address(adapter)), 0, "No token left on adapter");
    }

    // ─── Stealth 3: Announcement Decodes Like scanner.ts ────────────────────

    function testSwapToStealth_announcementMatchesScannerLayout() public {
        uint256 userAmount = OUTPUT_TOKEN - (OUTPUT_TOKEN * RELAYER_FEE_BPS) / 10_000;
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);

        vm.recordLogs();
        _swapEthToTokenToStealth(userAmount, RELAYER_FEE_BPS);
        Vm.Log memory announcement = _recordedAnnouncement();

        assertEq(uint256(announcement.topics[1]), 1, "schemeId == SCHEME_ID.SECP256K1 (scanner filter)");
        assertEq(address(uint160(uint256(announcement.topics[2]))), stealth, "stealthAddress");
        assertEq(address(uint160(uint256(announcement.topics[3]))), address(adapter), "caller");

        (bytes memory ephemeralPubKey, bytes memory metadata) = abi.decode(announcement.data, (bytes, bytes));
        assertEq(ephemeralPubKey, EPHEMERAL_PUB_KEY, "ephemeralPubKey");

        assertEq(metadata.length, 58, "viewTag + 'T' + chainId + token + amount, no invoice suffix");
        assertEq(uint8(metadata[0]), uint8(VIEW_TAG), "view tag is byte 0 (ERC-5564)");
        assertEq(uint8(metadata[1]), 0x54, "'T' token marker");
        assertEq(_readBigEndian(metadata, 2, 4), block.chainid, "chainId (4 bytes)");
        assertEq(address(uint160(_readBigEndian(metadata, 6, 20))), address(mockToken), "token (20 bytes)");
        assertEq(_readBigEndian(metadata, 26, 32), userAmount, "amount (32 bytes) == delivered amount");
    }

    // ─── Stealth 4: Slippage ────────────────────────────────────────────────

    function testSwapToStealth_slippageReverts() public {
        _mockEthToTokenSwap(INPUT_ETH, 100e18);
        vm.expectRevert(DustSwapAdapterV2.SlippageExceeded.selector);
        _swapEthToTokenToStealth(200e18, 0);
    }

    // ─── Stealth 5: Recipient + Pool Key Validation ─────────────────────────

    function testSwapToStealth_zeroStealthAddressReverts() public {
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);
        vm.expectRevert(DustSwapAdapterV2.InvalidStealthAddress.selector);
        _swapToStealth(address(0), poolKey, true, 1, address(0), EPHEMERAL_PUB_KEY, address(mockToken), 0);
    }

    function testSwapToStealth_adapterAsStealthAddressReverts() public {
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);
        vm.expectRevert(DustSwapAdapterV2.InvalidStealthAddress.selector);
        _swapToStealth(address(0), poolKey, true, 1, address(adapter), EPHEMERAL_PUB_KEY, address(mockToken), 0);
    }

    function testSwapToStealth_invalidEphemeralPubKeyReverts() public {
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);
        bytes[3] memory invalidKeys = [
            bytes(""),
            bytes(hex"0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
            bytes(
                hex"0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
                hex"483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"
            )
        ];
        for (uint256 i; i < invalidKeys.length; ++i) {
            vm.expectRevert(DustSwapAdapterV2.InvalidEphemeralPubKey.selector);
            _swapToStealth(address(0), poolKey, true, 1, stealth, invalidKeys[i], address(mockToken), 0);
        }
    }

    function testSwapToStealth_poolKeyMismatchReverts() public {
        address otherToken = makeAddr("otherToken");
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);

        vm.expectRevert(DustSwapAdapterV2.PoolKeyMismatch.selector);
        _swapToStealth(address(0), poolKey, true, 1, stealth, EPHEMERAL_PUB_KEY, otherToken, 0);

        vm.expectRevert(DustSwapAdapterV2.PoolKeyMismatch.selector);
        _swapToStealth(address(0), poolKey, false, 1, stealth, EPHEMERAL_PUB_KEY, address(mockToken), 0);
    }

    // ─── Stealth 6: Access Control + Shared Limits ──────────────────────────

    function testSwapToStealth_onlyRelayer() public {
        vm.prank(alice);
        vm.expectRevert(DustSwapAdapterV2.NotRelayer.selector);
        adapter.executeSwapToStealth(
            _dummyProof(), bytes32(0), NULLIFIER0, bytes32(0), bytes32(0), bytes32(0), INPUT_ETH, ethAssetId,
            address(0), poolKey, true, 1, stealth, EPHEMERAL_PUB_KEY, VIEW_TAG, NO_INVOICE, address(mockToken),
            alice, 0
        );
    }

    function testSwapToStealth_poolPausedReverts() public {
        mockPool.setPaused(true);
        vm.expectRevert(DustSwapAdapterV2.PoolPaused.selector);
        _swapEthToTokenToStealth(1, RELAYER_FEE_BPS);
    }

    function testSwapToStealth_sharedLimitsEnforced() public {
        vm.expectRevert(DustSwapAdapterV2.ZeroMinAmount.selector);
        _swapEthToTokenToStealth(0, RELAYER_FEE_BPS);

        vm.expectRevert(DustSwapAdapterV2.RelayerFeeTooHigh.selector);
        _swapEthToTokenToStealth(1, 501);
    }

    // ─── Stealth 7: Oracle Bound ────────────────────────────────────────────

    function testSwapToStealth_oracleDeviationReverts() public {
        (MockERC20 usdc, PoolKey memory usdcKey) = _setUpUsdcPoolWithOracle();
        _mockEthToTokenSwap(INPUT_ETH, 500e6); // 500 USDC per ETH vs oracle 2000 → 75% deviation

        vm.expectRevert(
            abi.encodeWithSelector(DustSwapAdapterV2.OracleDeviationExceeded.selector, 2000e18, 500e18)
        );
        _swapToStealth(address(0), usdcKey, true, 1, stealth, EPHEMERAL_PUB_KEY, address(usdc), 0);
    }

    function testSwapToStealth_oracleWithinBoundsPays() public {
        (MockERC20 usdc, PoolKey memory usdcKey) = _setUpUsdcPoolWithOracle();
        uint256 outputUSDC = 1900e6; // 5% below oracle, inside the 10% bound
        uint256 userAmount = outputUSDC - (outputUSDC * RELAYER_FEE_BPS) / 10_000;
        _mockEthToTokenSwap(INPUT_ETH, outputUSDC);

        _swapToStealth(
            address(0), usdcKey, true, userAmount, stealth, EPHEMERAL_PUB_KEY, address(usdc), RELAYER_FEE_BPS
        );

        assertEq(usdc.balanceOf(stealth), userAmount, "Stealth paid when price is within bounds");
    }

    // ─── Stealth 8: USDT-style Token (no bool return) ───────────────────────

    function testSwapToStealth_noReturnTokenPayout() public {
        MockNoReturnERC20 usdt = new MockNoReturnERC20();
        usdt.mint(address(mockPM), 1_000_000e6);
        PoolKey memory usdtKey = PoolKey({
            currency0: address(0),
            currency1: address(usdt),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooksAdapter(address(0))
        });
        uint256 outputUSDT = 2000e6;
        uint256 fee = (outputUSDT * RELAYER_FEE_BPS) / 10_000;
        _mockEthToTokenSwap(INPUT_ETH, outputUSDT);

        _swapToStealth(
            address(0), usdtKey, true, outputUSDT - fee, stealth, EPHEMERAL_PUB_KEY, address(usdt), RELAYER_FEE_BPS
        );

        assertEq(usdt.balanceOf(stealth), outputUSDT - fee, "Stealth paid despite missing bool return");
        assertEq(usdt.balanceOf(relayer), fee, "Relayer fee paid");
        assertEq(usdt.balanceOf(address(adapter)), 0, "No token left on adapter");
    }

    // ─── Stealth 9: Hostile Recipients ──────────────────────────────────────

    function testSwapToStealth_rejectingRecipientRevertsAtomically() public {
        RejectingReceiver rejecting = new RejectingReceiver();
        _mockTokenToEthSwap(2000e18, 1 ether);
        uint256 poolTokensBefore = mockToken.balanceOf(address(mockPool));

        vm.expectRevert(DustSwapAdapterV2.TransferFailed.selector);
        _swapTokenToEthToStealth(address(rejecting), 1, 0);

        assertEq(mockToken.balanceOf(address(mockPool)), poolTokensBefore, "Withdraw rolled back");
        assertEq(address(adapter).balance, 0, "No ETH stranded on adapter");
    }

    function testSwapToStealth_reentrancyBlocked() public {
        ReentrantReceiver reentrant = new ReentrantReceiver(address(adapter));
        PoolKey memory key = poolKey;
        reentrant.setReentryCalldata(abi.encodeCall(
            adapter.executeSwapToStealth,
            (
                _dummyProof(), bytes32(0), NULLIFIER0, bytes32(0), bytes32(0), bytes32(0), 0, tokenAssetId,
                address(mockToken), key, false, 1, address(reentrant), EPHEMERAL_PUB_KEY, VIEW_TAG,
                NO_INVOICE, address(0), relayer, 0
            )
        ));
        // Authorize the attacker so only the reentrancy guard, not onlyRelayer, can stop the reentry
        vm.prank(deployer);
        adapter.setRelayer(address(reentrant), true);
        _mockTokenToEthSwap(2000e18, 1 ether);

        _swapTokenToEthToStealth(address(reentrant), 1 ether, 0);

        assertEq(reentrant.reentryRevertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(address(reentrant).balance, 1 ether, "Payout still delivered");
    }

    // ─── Stealth 10: Chain ID Must Fit the Scanner's 4-byte Field ───────────

    function testSwapToStealth_chainIdBeyondUint32Reverts() public {
        uint256 hugeChainId = uint256(type(uint32).max) + 1;
        vm.chainId(hugeChainId);
        _cacheAssetIds();
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);

        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, uint8(32), hugeChainId)
        );
        _swapEthToTokenToStealth(1, 0);
    }

    // ─── Stealth 11: Constructor ────────────────────────────────────────────

    function testConstructor_setsAnnouncer() public view {
        assertEq(address(adapter.ANNOUNCER()), address(announcer));
    }

    function testConstructor_rejectsInvalidAnnouncer() public {
        address eoaAnnouncer = makeAddr("eoaAnnouncer");

        vm.expectRevert(DustSwapAdapterV2.ZeroAddress.selector);
        new DustSwapAdapterV2(address(mockPM), address(mockPool), address(0));

        vm.expectRevert(DustSwapAdapterV2.AnnouncerNotContract.selector);
        new DustSwapAdapterV2(address(mockPM), address(mockPool), eoaAnnouncer);
    }

    // ─── Stealth 12: Fuzz Amounts + Invoice Id, Both Directions ─────────────

    function testFuzz_swapToStealth_amounts(
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 feeBps,
        bool ethOut,
        bytes16 invoiceId
    ) public {
        feeBps = bound(feeBps, 0, adapter.MAX_RELAYER_FEE_BPS());
        // Bounds are the balances setUp gives the mocks: 100 ETH each, 1M tokens each
        uint256 maxIn = ethOut ? 1_000_000e18 : 100 ether;
        uint256 maxOut = ethOut ? 100 ether : 1_000_000e18;
        inputAmount = bound(inputAmount, 1, maxIn);
        outputAmount = bound(outputAmount, 1, maxOut);
        uint256 fee = (outputAmount * feeBps) / 10_000;
        uint256 userAmount = outputAmount - fee;

        vm.recordLogs();
        if (ethOut) {
            _mockTokenToEthSwap(inputAmount, outputAmount);
            _swapToStealthWithInvoice(
                address(mockToken), poolKey, false, userAmount, stealth, EPHEMERAL_PUB_KEY, invoiceId, address(0), feeBps
            );
            assertEq(stealth.balance, userAmount, "Stealth gets exactly userAmount");
            assertEq(relayer.balance, fee, "Relayer gets exactly fee");
        } else {
            _mockEthToTokenSwap(inputAmount, outputAmount);
            _swapToStealthWithInvoice(
                address(0), poolKey, true, userAmount, stealth, EPHEMERAL_PUB_KEY, invoiceId, address(mockToken), feeBps
            );
            assertEq(mockToken.balanceOf(stealth), userAmount, "Stealth gets exactly userAmount");
            assertEq(mockToken.balanceOf(relayer), fee, "Relayer gets exactly fee");
        }

        (, bytes memory metadata) = abi.decode(_recordedAnnouncement().data, (bytes, bytes));
        if (ethOut) {
            assertEq(metadata.length, 1, "ETH metadata is the view tag only, invoice id ignored");
        } else {
            assertEq(_readBigEndian(metadata, 26, 32), userAmount, "Announced amount == delivered amount");
            if (invoiceId == NO_INVOICE) {
                assertEq(metadata.length, 58, "No invoice id: no suffix");
            } else {
                assertEq(metadata.length, 75, "Invoice id: 'I' + 16 bytes appended");
                assertEq(uint8(metadata[58]), 0x49, "'I' invoice marker");
                assertEq(bytes16(uint128(_readBigEndian(metadata, 59, 16))), invoiceId, "Announced invoice id");
            }
        }
        assertEq(address(adapter).balance, 0, "No ETH residue");
        assertEq(mockToken.balanceOf(address(adapter)), 0, "No token residue");
    }

    // ─── Stealth 13: Invoice Id (metadata.ts INVOICE_MARKER suffix) ─────────

    function testStealthMetadata_matchesFrontendCodecVectors() public {
        vm.chainId(11155111);
        DustSwapAdapterV2MetadataHarness harness =
            new DustSwapAdapterV2MetadataHarness(address(mockPM), address(mockPool), address(announcer));

        assertEq(
            harness.stealthMetadata(VIEW_TAG, SEPOLIA_USDC, 1234567, INVOICE_ID),
            TS_CODEC_METADATA_WITH_INVOICE,
            "invoice: byte-identical to encodeTokenMetadata"
        );
        assertEq(
            harness.stealthMetadata(VIEW_TAG, SEPOLIA_USDC, 1234567, NO_INVOICE),
            TS_CODEC_METADATA_NO_INVOICE,
            "no invoice: byte-identical to encodeTokenMetadata"
        );
        assertEq(
            harness.stealthMetadata(VIEW_TAG, address(0), 1234567, INVOICE_ID),
            bytes.concat(VIEW_TAG),
            "ETH output ignores the invoice id"
        );
    }

    function testSwapToStealth_invoiceIdAppendedForERC20() public {
        uint256 userAmount = OUTPUT_TOKEN - (OUTPUT_TOKEN * RELAYER_FEE_BPS) / 10_000;
        _mockEthToTokenSwap(INPUT_ETH, OUTPUT_TOKEN);

        bytes memory expectedMetadata = bytes.concat(
            VIEW_TAG, bytes1(0x54), bytes4(uint32(block.chainid)), bytes20(address(mockToken)), bytes32(userAmount),
            bytes1(0x49), INVOICE_ID
        );
        assertEq(expectedMetadata.length, 75, "58-byte token metadata + 'I' + 16-byte invoice id");
        vm.expectEmit(address(announcer));
        emit Announcement(1, stealth, address(adapter), EPHEMERAL_PUB_KEY, expectedMetadata);

        _swapToStealthWithInvoice(
            address(0), poolKey, true, userAmount, stealth, EPHEMERAL_PUB_KEY, INVOICE_ID, address(mockToken),
            RELAYER_FEE_BPS
        );

        assertEq(mockToken.balanceOf(stealth), userAmount, "Payout unaffected by the invoice id");
    }

    function testSwapToStealth_invoiceIdIgnoredForETH() public {
        uint256 outputETH = 1 ether;
        uint256 userAmount = outputETH - (outputETH * RELAYER_FEE_BPS) / 10_000;
        _mockTokenToEthSwap(2000e18, outputETH);

        vm.expectEmit(address(announcer));
        emit Announcement(1, stealth, address(adapter), EPHEMERAL_PUB_KEY, bytes.concat(VIEW_TAG));

        _swapToStealthWithInvoice(
            address(mockToken), poolKey, false, userAmount, stealth, EPHEMERAL_PUB_KEY, INVOICE_ID, address(0),
            RELAYER_FEE_BPS
        );

        assertEq(stealth.balance, userAmount, "Payout unaffected by the invoice id");
    }
}

// ─── Mock Chainlink Oracle ──────────────────────────────────────────────────

contract MockChainlinkOracle {
    int256 public _answer;
    uint8 public _decimals;
    uint256 public _updatedAt;

    constructor(int256 answer_, uint8 decimals_) {
        _answer = answer_;
        _decimals = decimals_;
        _updatedAt = block.timestamp;
    }

    function setAnswer(int256 answer_) external { _answer = answer_; }
    function setUpdatedAt(uint256 ts) external { _updatedAt = ts; }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, _answer, block.timestamp, _updatedAt, 1);
    }

    function decimals() external view returns (uint8) { return _decimals; }
}
