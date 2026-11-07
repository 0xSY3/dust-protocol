// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {FflonkVerifier} from "../src/FFLONKVerifier.sol";
import {FflonkSplitVerifier} from "../src/FFLONKSplitVerifier.sol";
import {IFFLONKVerifier} from "../src/IFFLONKVerifier.sol";
import {IFFLONKSplitVerifier} from "../src/IFFLONKSplitVerifier.sol";

/// @notice Real FFLONK proofs from the current circuits (C1 leafIndex binding, nullifier key binding), verified by
///         the generated on-chain verifiers through the interfaces DustPoolV2 uses.
/// @dev Artifacts: scripts/build-v2-circuits.sh. Inputs: scripts/v2-proof-fixtures.mjs (a 2-input withdraw
///      spending notes at leaves 37 and 12; an internal split of a note at leaf 22). Re-prove and update the
///      constants below whenever the circuits or the setup change.
contract FFLONKVerifierRealProofTest is Test {
    IFFLONKVerifier verifier;
    IFFLONKSplitVerifier splitVerifier;

    // Nullifier of the leaf-37 note when the prover claims leafIndex 38 over the same Merkle path: the second
    // nullifier of the C1 double spend (input-c1-slot0.json). The pre-C1 circuit could prove it.
    uint256 constant FORGED_TX_NULLIFIER0 =
        15291640755119370084393650086739365287053558985640289687466181821513922427204;
    // Same for the split's leaf-22 note claimed at leafIndex 23.
    uint256 constant FORGED_SPLIT_NULLIFIER0 =
        2244529633326355513541044360302015120576124164392371238003375770916897513431;

    // Proof layout: [C1, C2, W1, W2] as (x, y) pairs in slots 0-7, then 16 evaluations; slot 16 is a(xi).
    uint256 constant EVAL_A_SLOT = 16;

    function setUp() public {
        verifier = IFFLONKVerifier(address(new FflonkVerifier()));
        splitVerifier = IFFLONKSplitVerifier(address(new FflonkSplitVerifier()));
    }

    function testTransactionProofVerifies() public view {
        assertTrue(verifier.verifyProof(_transactionProof(), _transactionPubSignals()));
    }

    function testTransactionProofRejectsForgedLeafIndexNullifier() public view {
        uint256[9] memory pubSignals = _transactionPubSignals();
        pubSignals[1] = FORGED_TX_NULLIFIER0;
        assertFalse(verifier.verifyProof(_transactionProof(), pubSignals));
    }

    function testTransactionProofRejectsEachTamperedPublicSignal() public view {
        bytes32[24] memory proof = _transactionProof();
        for (uint256 i = 0; i < 9; i++) {
            uint256[9] memory pubSignals = _transactionPubSignals();
            pubSignals[i] ^= 1;
            assertFalse(verifier.verifyProof(proof, pubSignals), string.concat("public signal ", vm.toString(i)));
        }
    }

    function testTransactionProofRejectsTamperedEvaluation() public view {
        bytes32[24] memory proof = _transactionProof();
        proof[EVAL_A_SLOT] ^= bytes32(uint256(1));
        assertFalse(verifier.verifyProof(proof, _transactionPubSignals()));
    }

    function testSplitProofVerifies() public view {
        assertTrue(splitVerifier.verifyProof(_splitProof(), _splitPubSignals()));
    }

    function testSplitProofRejectsForgedLeafIndexNullifier() public view {
        uint256[15] memory pubSignals = _splitPubSignals();
        pubSignals[1] = FORGED_SPLIT_NULLIFIER0;
        assertFalse(splitVerifier.verifyProof(_splitProof(), pubSignals));
    }

    function testSplitProofRejectsEachTamperedPublicSignal() public view {
        bytes32[24] memory proof = _splitProof();
        for (uint256 i = 0; i < 15; i++) {
            uint256[15] memory pubSignals = _splitPubSignals();
            pubSignals[i] ^= 1;
            assertFalse(splitVerifier.verifyProof(proof, pubSignals), string.concat("public signal ", vm.toString(i)));
        }
    }

    function testSplitProofRejectsTamperedEvaluation() public view {
        bytes32[24] memory proof = _splitProof();
        proof[EVAL_A_SLOT] ^= bytes32(uint256(1));
        assertFalse(splitVerifier.verifyProof(proof, _splitPubSignals()));
    }

    function _transactionProof() internal pure returns (bytes32[24] memory) {
        return [
            bytes32(0x1f5871824abec3d4bf3b0c9d3e1001ad39a612a5ae9eb4e9faf77a27fd4cc93b),
            0x0c5af21ba3eb747430659d843580e2dfab73915e1d72d4ee4040347a72993ab4,
            0x04d4affeafd06be5497a11a034bf09bb6fb9009a4dc80035a710f38b0e06f60a,
            0x128d26d305594cae5013139d834463d85b48d2f6f5b1a1a3e353eb70632a3433,
            0x2053f482fe6ae3e0e60e0e6bb2c92b9bd64e889232b47495e8879456fa96d370,
            0x16b7a29ff9afefadd8833aa2042aeb831189f79b7db46fbfd4ccb847ba4b6312,
            0x24ce995ea56bf29e17bdb4875fba39650339abe01abbab191c93dd84587437bf,
            0x22968a7b7399a8aa90c8981320b3b8c7022cee18859f14759dfc78f459f65835,
            0x0d3184bb5faf9ee28068f41bcbcce22fe223fa359f5a17124fda8a550cacfcfe,
            0x2bd10e10773594a93606eba1d492f54745160bb45922105dafb1423407f79e34,
            0x1f144c4d0e164e27fbdf16257405f6acf27700250b95b6dec61e56f7e2494eb7,
            0x2c78c1d1541a1dc9f72e4516d828e6f1b7f8006f93ba0973dade807563172199,
            0x011f9e2e298736f08e13a8237dee83dd0e047c5b7c93bcf2f492dc5ae7673d8a,
            0x26a0ad7d3e1524963ea267a62f2372271a68892e178c5c7ca55776be3969cda7,
            0x01cba249265505f8e2b559bed68e80208c57267dd9a40fe891c0e4de5dcfcf52,
            0x10a196d6901ba5efef5fbeaaeef9b1634fa1233429bd04ea67e0af674d6ef786,
            0x1563840e848799f1a4575ac693ba6ebea318103f672ac47b42b44d2b680c6cae,
            0x2b3e9c8d2844d549ee95573d9ea77d3bf601b04fa8a4951b18de1cc50957dbb5,
            0x210ca5d8864ad932346aefa0b23cc6347a6b10d80d695d7092464b5b42df19bb,
            0x13f7cb7f85b46f348f99d945aa919b17df3f5a1b96b6058b699bfa7e5de35563,
            0x1f031c665e236efba1413d2de583bbd5afc624129fb33e18b8d39b88a3f1429e,
            0x1e184da435816ef832b2829a80b0b6e9e2664808b86cf6629c5f0108d9f98d14,
            0x0e9c79cd155e4ebce6671df844fa4455353185cd74fe20332939ae949a05454a,
            0x13342e65b0931868a929108087cb6a0f01db8ea8161c1457e1d5ea06e4d24946
        ];
    }

    /// @dev [merkleRoot, nullifier0, nullifier1, outputCommitment0, outputCommitment1,
    ///       publicAmount (p - 0.75 ether), publicAsset, recipient, chainId]
    function _transactionPubSignals() internal pure returns (uint256[9] memory) {
        return [
            uint256(21465822726256366111571973001947190313210513435256815070783116873400351746508),
            5467531839368735091809990924624312717779967268973336568098418754460219788965,
            5905710384241074233663981766246163944883477252267393751701756294677197058167,
            5421146460569079529974432707721889693566010308949481580505918173472015955815,
            14655542659562014735865511769057053982292279840403315552050801315682099828156,
            21888242871839275222246405745257275088548364400416034343697454186575808495617,
            17770791984974583153623454780901856926150256039034439957182982086592874504083,
            919791448120245735144748008190597589268974010369,
            11155111
        ];
    }

    function _splitProof() internal pure returns (bytes32[24] memory) {
        return [
            bytes32(0x2665ac1092541b4940fbf190fa1eada17d28e129e134d8203124608bcf264d35),
            0x05648f4bbe3374f163e9b3016da89eb5d9055b79385124515b1fd6aefa329ea7,
            0x2ab02f0d032f919a01092e32729e8120e30f28207047ebb757d17e3f97a427a6,
            0x06c4ac66ee3680202a1289345f56f959b1a143cdf093b6aa3d6bfd844559aa41,
            0x1fac0cd843527c802c4ae1b1bae2e8c75be70438832d4fe094d7e22a98463c63,
            0x284254006d666c96fe55a6acc742e72a1358801ec9dba5b2d2b397cf84d08e16,
            0x2924116df9be39a4476beaec8fa8c98a9af9de77493be2440fbcc4b1299ce251,
            0x0f96951024ccc10bd6629fce540e15a570ce14001733796c67e8af1e911844ef,
            0x049b563ac4db1778c786aa9ecd944f0902749da2e7084c7b8c52d09258359ddc,
            0x09b5954319212142e5a0e1e6f4f3004a70dd7c10a491f93881c26dc1a42ac4fc,
            0x10f087d2fd3881110b587f76c4cfb668fc70cc895a39f60fe5cef0eb37b3a121,
            0x02453608caaf31c0841c9798bd4cc3c98cf31821b0c9125dba41433b8928f86e,
            0x16a69b40350c3e3a22e97f18d3f7cecdd589e37706debc77c8cb999b6b4d5f7c,
            0x3004663b3af6de8996ee95bd878e37cbc61e755ab125e64f53021b28f4eab3c6,
            0x26fec986385aab83a1a2d62fc59ba8c7f11ee36d015188cb9d42b4b6e9671fba,
            0x10bbb349292c8bda243b11fbad2cf4b0f2b5b0948b2f16733be811d243f8c890,
            0x01c300226473dad7cc8b6a197f6046d2e8c7335d694da22e013d2876df182ecc,
            0x1123326bda0c292d8a8ca8e4b2120af214951770f58bdcfded3a1fc5f4a479a7,
            0x0b8ad436cb5f44c703221eb0d4c694903826c50e67165cff04a4962b07cb51ea,
            0x1b3a45f1f96e4111951e55ea4b8ab7441f8236cc98e631f98cb608d497436bee,
            0x07050ec0b92d48e287f4fa97d0ec41012105db549cf7d0b5b533c9be20b9dc3f,
            0x118d677c35fd8bcb8a9ba7ba38cddb18c85ee823e5edc03198b0340efb58c70f,
            0x2b05cdfb315bf0876eb2700f1e836169b08ab176e357cdae8866b5590e15d8ce,
            0x00fdf3efbfebd72376f3ce34ebd2e384fb9d06bf60d61c4ab53c67ba9b36a553
        ];
    }

    /// @dev [merkleRoot, nullifier0, nullifier1, outputCommitment[0..7] (4 real, 4 dummy),
    ///       publicAmount, publicAsset, recipient, chainId]
    function _splitPubSignals() internal pure returns (uint256[15] memory) {
        return [
            uint256(1154886903709167969041374851428701980304212290183881322162127717348902510595),
            15483780940394050939056907104292210030686239340771533759741935877005583396778,
            0,
            182367818802268510360294589649064600481760161512048515680168511986487978284,
            4946941421183436813312548742691085706729820810734614863741502309252100608940,
            7761267113349816288274275212665352228969361772962423668754887669650028976555,
            10823649401172574698120997964132847980185990654962950459175704570516130653830,
            14655542659562014735865511769057053982292279840403315552050801315682099828156,
            14655542659562014735865511769057053982292279840403315552050801315682099828156,
            14655542659562014735865511769057053982292279840403315552050801315682099828156,
            14655542659562014735865511769057053982292279840403315552050801315682099828156,
            0,
            17770791984974583153623454780901856926150256039034439957182982086592874504083,
            0,
            11155111
        ];
    }
}
