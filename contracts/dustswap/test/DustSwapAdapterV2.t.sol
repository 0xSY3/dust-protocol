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
    IERC20Adapter
} from "../src/DustSwapAdapterV2.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {PoseidonT6} from "poseidon-solidity/PoseidonT6.sol";

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

    function setPaused(bool _paused) external { paused = _paused; }
    function setWithdrawAmount(uint256 _amount) external { withdrawAmountToSend = _amount; }

    function withdraw(
        bytes calldata, bytes32, bytes32, bytes32, bytes32, bytes32,
        uint256, uint256, address recipient, address tokenAddress
    ) external {
        if (tokenAddress == address(0)) {
            (bool ok,) = recipient.call{value: withdrawAmountToSend}("");
            require(ok, "MockPool: ETH send failed");
        } else {
            IERC20Adapter(tokenAddress).transfer(recipient, withdrawAmountToSend);
        }
    }

    function deposit(bytes32 commitment) external payable {
        ethDeposits.push(DepositRecord(commitment, msg.value, address(0)));
    }

    function depositERC20(bytes32 commitment, address token, uint256 amount) external {
        // Use low-level call for transferFrom (not in IERC20Adapter interface)
        (bool ok,) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        require(ok, "MockPool: transferFrom failed");
        erc20Deposits.push(DepositRecord(commitment, amount, token));
    }

    function ethDepositCount() external view returns (uint256) { return ethDeposits.length; }
    function erc20DepositCount() external view returns (uint256) { return erc20Deposits.length; }

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
            IERC20Adapter(currency).transfer(to, amount);
        }
    }

    receive() external payable {}
}

// ─── Tests ──────────────────────────────────────────────────────────────────

contract DustSwapAdapterV2Test is Test {
    DustSwapAdapterV2 public adapter;
    MockDustPoolV2 public mockPool;
    MockPoolManager public mockPM;
    MockERC20 public mockToken;

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

    PoolKey poolKey;

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
        adapter = new DustSwapAdapterV2(address(mockPM), address(mockPool));
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

    function _computeExpectedCommitment(
        uint256 ownerPubKey,
        uint256 amount,
        address tokenOut,
        uint256 blinding_
    ) internal view returns (uint256) {
        uint256 assetId = PoseidonT3.hash([block.chainid, uint256(uint160(tokenOut))]);
        return PoseidonT6.hash([ownerPubKey, amount, assetId, block.chainid, blinding_]);
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
            uint256(0x5555),
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
            uint256(0x5555),
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
        (, uint256 amount,) = mockPool.ethDeposits(0);
        assertEq(amount, userAmount, "Deposit amount = userAmount");
        assertEq(relayer.balance, fee, "Relayer received ETH fee");
    }

    // ─── Test 3: Only Relayer ───────────────────────────────────────────────

    function testExecuteSwap_onlyRelayer() public {
        vm.prank(alice);
        vm.expectRevert(DustSwapAdapterV2.NotRelayer.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, 0, address(0), poolKey, true, 1,
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
            INPUT_ETH, 0, address(0), poolKey, true, highMinAmount,
            OWNER_PUB_KEY, BLINDING, address(mockToken), relayer, 0
        );
    }

    // ─── Test 5: Relayer Fee Cap ────────────────────────────────────────────

    function testExecuteSwap_relayerFeeCap() public {
        vm.prank(relayer);
        vm.expectRevert(DustSwapAdapterV2.RelayerFeeTooHigh.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, 0, address(0), poolKey, true, 1,
            OWNER_PUB_KEY, BLINDING, address(mockToken), relayer, 501
        );
    }

    // ─── Test 6: Zero Min Amount ────────────────────────────────────────────

    function testExecuteSwap_zeroMinAmount() public {
        vm.prank(relayer);
        vm.expectRevert(DustSwapAdapterV2.ZeroMinAmount.selector);
        adapter.executeSwap(
            _dummyProof(), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            INPUT_ETH, 0, address(0), poolKey, true, 0,
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
            uint256(0x5555),
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
            INPUT_ETH, 0, address(0), poolKey, true, 1,
            OWNER_PUB_KEY, BLINDING, address(mockToken), relayer, 100
        );
    }
}
