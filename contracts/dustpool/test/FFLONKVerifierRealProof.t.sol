// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import {FflonkVerifier} from "../src/FFLONKVerifier.sol";
import {FflonkSplitVerifier} from "../src/FFLONKSplitVerifier.sol";
import {IFFLONKVerifier} from "../src/IFFLONKVerifier.sol";
import {IFFLONKSplitVerifier} from "../src/IFFLONKSplitVerifier.sol";

/// @notice Real FFLONK proofs from the C1-fixed circuits, verified by the generated on-chain verifiers
///         through the interfaces DustPoolV2 uses.
/// @dev Artifacts: scripts/build-v2-circuits.sh. Inputs: scripts/v2-proof-fixtures.mjs (a 2-input withdraw
///      spending notes at leaves 37 and 12; an internal split of a note at leaf 22). Re-prove and update the
///      constants below whenever the circuits or the setup change.
contract FFLONKVerifierRealProofTest is Test {
    IFFLONKVerifier verifier;
    IFFLONKSplitVerifier splitVerifier;

    // Nullifier of the leaf-37 note when the prover claims leafIndex 38 over the same Merkle path: the second
    // nullifier of the C1 double spend (input-c1-slot0.json). The pre-C1 circuit could prove it.
    uint256 constant FORGED_TX_NULLIFIER0 =
        12817372182623014957962167559643948064894190876203526635575604935090234433250;
    // Same for the split's leaf-22 note claimed at leafIndex 23.
    uint256 constant FORGED_SPLIT_NULLIFIER0 =
        13366637044426918889610063328099456257975725842566891467461869247401533063887;

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
            bytes32(0x255c32ccfaa87c507bc0223fa99d03239ea2141e833187c22e3b8df4a31062db),
            0x081cabfc531be014b85dd3006bc2ca2d9499e2fb87dff32c1314ce731eef59c5,
            0x2d09ace06829314ae512bcca55e14e64eb94c2e99aec7c3c4f2536a7e599839a,
            0x134db3f3bf505440a3294db61efb8d4b6f46fc8f158d838ba66b10162458aafb,
            0x12380d8119bd957413e17f130906a4f3732f7076130a4730e17231abf05b7d48,
            0x0de57640eb3419a5bd9fa5c28e5a7cd822c13bafa7516dab393e052befa84b12,
            0x045be34048d14d5e5186e4c9bfe425bd80afcc3c86c8412a7ed28dec55f94622,
            0x2655ac4ec818b2a9b965e9741b560db9358d7dad34824ce884744786da659c24,
            0x2993bb344decd79972dc01f889b7feff1f716f6917e8774efa989673aab10a66,
            0x015046988d80643c1acc729115e4ec39cee3100acd5cc04155cad91520925b39,
            0x0acf88663abe0c57476501f948fb6a1bfd5f9b15129da483b212af1f275b9a2c,
            0x0bbdb922551e33ce3c0fd9b5bd42e1cdcc8ccaec315b431f3f45b75e1ef7f2a8,
            0x1554c6f5f20484561d66c485850af1b10e501840fbc7302ee3d03df8755edadb,
            0x0103662aed61ce8da6246222c789d1bca284d355e464c5e1ba70d00018bcc6dc,
            0x2bbe515078b234f9bb04fa31bbb9089b70229cea82a3cc251befbd1d5da137fd,
            0x0d43817612cd442c34be8981893a1d57f70ad70078a05e2fa40b7e76e269efb5,
            0x128a29baaf5ef71d428a262872229f05dfd3d9d50895b4b64081079501845cc3,
            0x1507706cf772d6bf2c4e2b05d0ee57bc56cdcc4565c145a948260925b544da0e,
            0x25391258f702e661a31f2c3693f807ddf19cdb72a6cb94187c0461031b49f2b8,
            0x0149028e7c6145d4adc67ab4c1cd302b874f7b99d30ab7b614c213535e3fa4e7,
            0x1d06b391e9b291fc62dd4cedcfdb1db48cf63bd0e1a79106e55bbfc213fdf123,
            0x0d87968a80f9846808572572b7180f80b89322d11367ea4d634cbf9d57ce1052,
            0x16bbb28152cd98854cf17e62442ed416280f7ed84bc531decda9e5948e70d2de,
            0x0a9833705381b960d1fdf84f1914b39b90306d9ba5679948c1d63e659f0f837c
        ];
    }

    /// @dev [merkleRoot, nullifier0, nullifier1, outputCommitment0, outputCommitment1,
    ///       publicAmount (p - 0.75 ether), publicAsset, recipient, chainId]
    function _transactionPubSignals() internal pure returns (uint256[9] memory) {
        return [
            uint256(21465822726256366111571973001947190313210513435256815070783116873400351746508),
            2974335265009406598393184547875935788395034658614666933714008895327082781464,
            740933889485517728187371381168917498771121216131972530170288012413686788794,
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
            bytes32(0x13c6f81393aca05e3ab6c975a9d059cc16d1f852ffdab17f0cfee94e0948c9df),
            0x104a071123896d51acac54582af99549697f06e0a0c5683ea4ba0c5d631dabf6,
            0x00756770f0b17b885eff4701c9a0af335420be620b25c2a83c6a5b5e76043e3f,
            0x26cce57fcb80dd6deb89a6f4323bcd07e56d9dd7085b33278d0c92b61f03d093,
            0x0c31591d7fc7ffd73b67b79a6bf351639e8eaf07fcba83c97a6b74b366783638,
            0x2075ca32c0409de659dbdba775abba3dcf258b713891e0331ad9706aa99dd9fa,
            0x297737865b3bb6a8c6c65a6ddc1b9a831f6fbe8c6abdfd6fc6c3f1986820dc11,
            0x0687e2386320ba881a6120546cc1198202ac3df26cd9242154fd0516b27f2121,
            0x08e8be1e9bafd778609e64551afc7591825fa11f19f7f6ca6bc155bf11303025,
            0x03db3e11ff41ecbcf488135ec078ed3dddaeb454d7c231bab623106593475784,
            0x25a8819bbabe50ec6ea500d2a8a6c6260f2904aa670ef113290839d1b7f08f1f,
            0x058767341cb707b82f2bf218b7e8d7043f7d0c8ea4af2e654c3677d0f1fc9338,
            0x120adff9954c1e77416a5df0efff7b916e4cfd5fca3664832e98ab27bfab5feb,
            0x04be9b5ca30d13813148158bd7ae5da9ff952f2991abf7a33943ff7a06a3b928,
            0x225fb1efaa7a0ef3e8ed430b65a9fda2938db34871a0ec0a05ca83c42de9ff2a,
            0x099107991577669741235de247f68e0fc12645cb9de289c25af614ff34688ed3,
            0x24fdeee22faa9eec2d115647edee24e212bbe891c727330d5f51cbbe41188d44,
            0x23e0e4c1071e0f2d2dad3141b40e8b390f82eb2afda7244e3353db4902be45a2,
            0x24109893c7f7b3e4df5d3c656a87b376d266566e5b02aaa1713b6ffd94a7cfb6,
            0x28007a53b8ce87f688f948ff66ef727dd051755b61e7d508323ace6b4f51b114,
            0x045ab9715707d892912f351bf57ad23fcc3b61d8e8729daac39f0527bee989d6,
            0x24d04985bda82410b06f4f56fef2a6191d69b9be670f7beb5ff7d87539ff22b6,
            0x0554bb94c5c9e3160b3bd5eb573205b8c6d1eb4f39ab30cfeb8eae83a6be86b5,
            0x07810e87a50c27b93d8a9b39adbe53e42f2b6ca3a1a32d081a208291a6e0abb4
        ];
    }

    /// @dev [merkleRoot, nullifier0, nullifier1, outputCommitment[0..7] (4 real, 4 dummy),
    ///       publicAmount, publicAsset, recipient, chainId]
    function _splitPubSignals() internal pure returns (uint256[15] memory) {
        return [
            uint256(1154886903709167969041374851428701980304212290183881322162127717348902510595),
            2165268301955761352719407584135584360802013595396505096462554750084683646312,
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
