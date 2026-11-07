// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {DustPoolV2} from "../src/DustPoolV2.sol";
import {FflonkVerifier} from "../src/FFLONKVerifier.sol";
import {FflonkSplitVerifier} from "../src/FFLONKSplitVerifier.sol";

contract DepositTestToken {
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

/// @notice Deposits against the real transaction verifier. The relayer puts every queued commitment in the tree,
///         so a commitment must not be worth more than was paid for it: a deposit proof fixes the note's value,
///         asset and chain to the deposit's.
/// @dev Inputs: scripts/v2-proof-fixtures.mjs (deposit-eth, deposit-erc20, deposit-withdraw), proved with
///      scripts/prove-v2-fixture.mjs into test/fixtures/. Re-prove when the circuit or setup changes.
contract DustPoolV2DepositTest is Test {
    // Fixture chain, deposit-erc20's token and deposit-withdraw's recipient (scripts/v2-proof-fixtures.mjs)
    uint256 constant FIXTURE_CHAIN_ID = 11155111;
    address constant TOKEN = 0x000000000000000000000000000000000000E20C;
    address constant RECIPIENT = 0xa11ce00000000000000000000000000000000001;
    uint256 constant ETH_NOTE = 1 ether;
    uint256 constant TOKEN_NOTE = 1e9;

    DustPoolV2 pool;
    address relayer = makeAddr("relayer");
    address depositor = makeAddr("depositor");

    event DepositQueued(bytes32 indexed commitment, uint256 queueIndex, uint256 amount, address asset, uint256 timestamp);

    struct Fixture {
        bytes proof;
        uint256[9] signals;
    }

    struct Note {
        uint256 ownerPubKey;
        uint256 blinding;
        address token;
    }

    function setUp() public {
        vm.chainId(FIXTURE_CHAIN_ID);
        pool = new DustPoolV2(address(new FflonkVerifier()), address(new FflonkSplitVerifier()), address(0));
        pool.setRelayer(relayer, true);

        vm.etch(TOKEN, address(new DepositTestToken()).code);
        DepositTestToken(TOKEN).mint(depositor, 10 * TOKEN_NOTE);
        vm.prank(depositor);
        DepositTestToken(TOKEN).approve(address(pool), type(uint256).max);
        vm.deal(depositor, 10 ether);
    }

    function testDepositProofQueuesNoteWorthMsgValue() public {
        Fixture memory f = _load("deposit-eth");
        bytes32 commitment = bytes32(f.signals[3]);
        assertEq(f.signals[5], ETH_NOTE, "fixture deposits 1 ETH");
        assertEq(bytes32(f.signals[4]), pool.DUMMY_COMMITMENT(), "second output is the dummy note");

        vm.prank(depositor);
        vm.expectEmit(true, false, false, true);
        emit DepositQueued(commitment, 0, ETH_NOTE, address(0), block.timestamp);
        pool.depositWithProof{value: ETH_NOTE}(f.proof, commitment);

        assertEq(pool.depositQueue(0), commitment);
        assertEq(pool.totalDeposited(address(0)), ETH_NOTE);
    }

    /// The bug this closes: a bare commitment was queued for whatever was paid, so 1 wei bought a 1 ETH note.
    function testDepositProofRejectsAnyOtherValue() public {
        Fixture memory f = _load("deposit-eth");
        uint256[3] memory values = [uint256(1), ETH_NOTE - 1, ETH_NOTE + 1];

        for (uint256 i = 0; i < values.length; i++) {
            vm.prank(depositor);
            vm.expectRevert(DustPoolV2.InvalidProof.selector);
            pool.depositWithProof{value: values[i]}(f.proof, bytes32(f.signals[3]));
        }
        assertEq(pool.depositQueueTail(), 0, "nothing queued");
        assertEq(pool.totalDeposited(address(0)), 0);
    }

    function testDepositProofRejectsAnotherCommitment() public {
        Fixture memory f = _load("deposit-eth");

        vm.prank(depositor);
        vm.expectRevert(DustPoolV2.InvalidProof.selector);
        pool.depositWithProof{value: ETH_NOTE}(f.proof, bytes32(f.signals[3] ^ 1));
    }

    function testDepositProofIsBoundToItsAsset() public {
        Fixture memory ethDeposit = _load("deposit-eth");
        Fixture memory tokenDeposit = _load("deposit-erc20");

        vm.startPrank(depositor);
        vm.expectRevert(DustPoolV2.InvalidProof.selector);
        pool.depositERC20WithProof(ethDeposit.proof, bytes32(ethDeposit.signals[3]), TOKEN, ETH_NOTE);
        vm.expectRevert(DustPoolV2.InvalidProof.selector);
        pool.depositWithProof{value: TOKEN_NOTE}(tokenDeposit.proof, bytes32(tokenDeposit.signals[3]));
        vm.stopPrank();
    }

    function testDepositProofIsBoundToItsChain() public {
        Fixture memory f = _load("deposit-eth");
        vm.chainId(1);

        vm.prank(depositor);
        vm.expectRevert(DustPoolV2.InvalidProof.selector);
        pool.depositWithProof{value: ETH_NOTE}(f.proof, bytes32(f.signals[3]));
    }

    function testERC20DepositProofQueuesNoteWorthAmount() public {
        Fixture memory f = _load("deposit-erc20");
        bytes32 commitment = bytes32(f.signals[3]);
        assertEq(f.signals[5], TOKEN_NOTE, "fixture deposits 1e9 token units");

        vm.prank(depositor);
        vm.expectEmit(true, false, false, true);
        emit DepositQueued(commitment, 0, TOKEN_NOTE, TOKEN, block.timestamp);
        pool.depositERC20WithProof(f.proof, commitment, TOKEN, TOKEN_NOTE);

        assertEq(pool.depositQueue(0), commitment);
        assertEq(pool.totalDeposited(TOKEN), TOKEN_NOTE);
        assertEq(DepositTestToken(TOKEN).balanceOf(address(pool)), TOKEN_NOTE);
    }

    /// depositNote hashes on chain (poseidon-solidity); the fixtures hash with circomlibjs, as the circuit does.
    function testDepositNoteBuildsTheCircuitCommitment() public {
        Fixture memory ethDeposit = _load("deposit-eth");
        Note memory ethNote = _loadNote("deposit-eth");
        Fixture memory tokenDeposit = _load("deposit-erc20");
        Note memory tokenNote = _loadNote("deposit-erc20");

        vm.startPrank(depositor);
        bytes32 ethCommitment = pool.depositNote{value: ETH_NOTE}(ethNote.ownerPubKey, ethNote.blinding);
        bytes32 tokenCommitment =
            pool.depositERC20Note(tokenNote.ownerPubKey, tokenNote.blinding, tokenNote.token, TOKEN_NOTE);
        vm.stopPrank();

        assertEq(ethCommitment, bytes32(ethDeposit.signals[3]));
        assertEq(tokenCommitment, bytes32(tokenDeposit.signals[3]));
    }

    /// deposit-withdraw spends deposit-eth's note from leaf 0: 0.4 ETH out, 0.6 ETH change.
    function testDepositedNoteIsSpendable() public {
        Fixture memory deposit = _load("deposit-eth");
        Fixture memory spend = _load("deposit-withdraw");
        vm.prank(depositor);
        pool.depositWithProof{value: ETH_NOTE}(deposit.proof, bytes32(deposit.signals[3]));
        assertEq(pool.depositQueue(0), bytes32(deposit.signals[3]), "the spent note is leaf 0 of the fixture tree");

        vm.prank(relayer);
        pool.updateRoot(bytes32(spend.signals[0]));
        vm.prank(relayer);
        pool.withdraw(
            spend.proof,
            bytes32(spend.signals[0]),
            bytes32(spend.signals[1]),
            bytes32(spend.signals[2]),
            bytes32(spend.signals[3]),
            bytes32(spend.signals[4]),
            spend.signals[5],
            spend.signals[6],
            RECIPIENT,
            address(0)
        );

        assertEq(RECIPIENT.balance, 0.4 ether);
        assertTrue(pool.nullifiers(bytes32(spend.signals[1])));
        assertEq(pool.depositQueue(1), bytes32(spend.signals[3]), "change note queued");
        assertEq(pool.totalDeposited(address(0)), 0.6 ether);
    }

    function _load(string memory name) internal view returns (Fixture memory f) {
        string memory json = _read(name);
        bytes32[] memory words = abi.decode(vm.parseJson(json, ".proof"), (bytes32[]));
        require(words.length == 24, "proof must be 24 words");
        f.proof = abi.encodePacked(words);
        string[] memory signals = vm.parseJsonStringArray(json, ".publicSignals");
        require(signals.length == 9, "transaction circuit has 9 public signals");
        for (uint256 i = 0; i < 9; i++) {
            f.signals[i] = vm.parseUint(signals[i]);
        }
    }

    function _loadNote(string memory name) internal view returns (Note memory note) {
        string memory json = _read(name);
        note.ownerPubKey = vm.parseUint(vm.parseJsonString(json, ".note.ownerPubKey"));
        note.blinding = vm.parseUint(vm.parseJsonString(json, ".note.blinding"));
        note.token = vm.parseJsonAddress(json, ".note.token");
    }

    function _read(string memory name) internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/", name, ".json"));
    }
}
