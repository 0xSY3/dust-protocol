// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {DustSwapAdapterV2} from "../src/DustSwapAdapterV2.sol";

interface IDustPoolV2Admin {
    function setRelayer(address relayer, bool allowed) external;
    function relayers(address) external view returns (bool);
    function owner() external view returns (address);
    function paused() external view returns (bool);
}

interface IAggregatorV3Check {
    function latestRoundData()
        external view returns (uint80, int256, uint256, uint256, uint80);
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
}

/// @title DeploySwapAdapterV2 — Production deployment for DustSwapAdapterV2
///
/// @notice Required environment (addresses only; the signer is passed on the CLI, never read here):
///     DUST_POOL_V2       DustPoolV2 privacy pool
///     POOL_MANAGER       Uniswap V4 PoolManager
///     ANNOUNCER          ERC-5564 announcer indexed by Dust's scanner (src/config/chains.ts `announcer`)
///     CHAINLINK_ETH_USD  Chainlink ETH/USD feed
///
///   Ethereum Sepolia (src/config/chains.ts):
///     DUST_POOL_V2=0x7c4BAfe3DFC50D4c8d84246e4067a0f5d24e360b
///     POOL_MANAGER=0x93805603e0167574dFe2F50ABdA8f42C85002FD8
///     ANNOUNCER=0x64044FfBefA7f1252DdfA931c939c19F21413aB0
///     CHAINLINK_ETH_USD=0x694AA1769357215DE4FAC081bf1f309aDC325306
///
///   Deployment pipeline:
///
///   STEP 1 — Deploy PoseidonT6 library (skip if already deployed):
///     cd contracts/dustswap && forge script script/DeploySwapAdapterV2.s.sol \
///       --sig "deployPoseidon()" \
///       --rpc-url $SEPOLIA_RPC_URL \
///       --private-key $PRIVATE_KEY \
///       --broadcast --slow
///     → Copy logged PoseidonT6 address into foundry.toml libraries[]
///
///   STEP 2 — Simulate (dry run, no broadcast, no key needed):
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --rpc-url $SEPOLIA_RPC_URL \
///       --sender <DUST_POOL_V2_OWNER>
///
///   STEP 3 — Deploy + configure (broadcast):
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --rpc-url $SEPOLIA_RPC_URL \
///       --private-key $PRIVATE_KEY \
///       --broadcast --slow --verify
///
///   STEP 4 — Verify (if --verify failed or skipped):
///     forge verify-contract <ADAPTER_ADDRESS> DustSwapAdapterV2 \
///       --chain 11155111 \
///       --etherscan-api-key $ETHERSCAN_API_KEY \
///       --constructor-args $(cast abi-encode "constructor(address,address,address)" \
///         $POOL_MANAGER $DUST_POOL_V2 $ANNOUNCER)
///
///   STEP 5 — Post-deploy checks:
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --sig "verify(address)" <ADAPTER_ADDRESS> \
///       --rpc-url $SEPOLIA_RPC_URL
///
/// @dev Thanos Sepolia: No Uniswap V4 PoolManager — DustSwapAdapterV2 is Ethereum Sepolia only.
contract DeploySwapAdapterV2 is Script {
    struct DeployConfig {
        address dustPoolV2;
        address poolManager;
        address announcer;
        address chainlinkEthUsd;
    }

    // ─── Step 1: Deploy PoseidonT6 Library ──────────────────────────────────────

    /// @notice Deploy PoseidonT6 library. Run first, record address, update foundry.toml.
    function deployPoseidon() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Step 1: Deploy PoseidonT6 ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);
        address poseidonT6 = deployCode("poseidon-solidity/PoseidonT6.sol:PoseidonT6");
        vm.stopBroadcast();

        console.log("PoseidonT6 deployed:", poseidonT6);
        console.log("");
        console.log("=== ACTION REQUIRED ===");
        console.log("Add to foundry.toml libraries[]:");
        console.log(
            string(abi.encodePacked(
                '  "poseidon-solidity/PoseidonT6.sol:PoseidonT6:',
                vm.toString(poseidonT6),
                '"'
            ))
        );
    }

    // ─── Step 2+3: Full Deployment ──────────────────────────────────────────────

    /// @notice Deploy DustSwapAdapterV2 + configure oracle + authorize relayer on pool.
    ///         Run without --broadcast first to simulate, then with --broadcast --slow.
    ///         The broadcaster is the CLI signer (--private-key / --account / --sender).
    function run() external {
        DeployConfig memory cfg = _loadConfig();
        address deployer = msg.sender;

        // ── Pre-flight checks ───────────────────────────────────────────────
        console.log("========================================");
        console.log("  DustSwapAdapterV2 Production Deploy");
        console.log("========================================");
        console.log("");
        console.log("--- Pre-flight ---");
        console.log("Chain ID:     ", block.chainid);
        console.log("Deployer:     ", deployer);
        console.log("Balance:      ", deployer.balance);
        console.log("PoolManager:  ", cfg.poolManager);
        console.log("DustPoolV2:   ", cfg.dustPoolV2);
        console.log("Announcer:    ", cfg.announcer);
        console.log("Chainlink:    ", cfg.chainlinkEthUsd);

        require(deployer.balance > 0.01 ether, "Insufficient deployer balance");
        require(block.chainid == 11155111, "Not Ethereum Sepolia");

        // Deployer must own DustPoolV2: step [4/4] authorizes the adapter there
        IDustPoolV2Admin pool = IDustPoolV2Admin(cfg.dustPoolV2);
        require(pool.owner() == deployer, "Deployer is not DustPoolV2 owner");
        require(!pool.paused(), "DustPoolV2 is paused");

        // Validate Chainlink feed is responding
        IAggregatorV3Check oracle = IAggregatorV3Check(cfg.chainlinkEthUsd);
        (, int256 price,,uint256 updatedAt,) = oracle.latestRoundData();
        require(price > 0, "Chainlink returning zero price");
        require(block.timestamp - updatedAt < 3600, "Chainlink feed stale");
        console.log("Chainlink ETH/USD: $", uint256(price) / 1e8);
        console.log("Feed description:  ", oracle.description());
        console.log("Feed decimals:     ", oracle.decimals());
        console.log("");

        // ── Deploy ──────────────────────────────────────────────────────────
        vm.startBroadcast();

        // 1. Deploy adapter (announcer is immutable — see DustSwapAdapterV2.ANNOUNCER)
        DustSwapAdapterV2 adapter = new DustSwapAdapterV2(
            cfg.poolManager,
            cfg.dustPoolV2,
            cfg.announcer
        );
        console.log("[1/4] DustSwapAdapterV2 deployed:", address(adapter));

        // 2. Authorize deployer as relayer on the adapter
        adapter.setRelayer(deployer, true);
        console.log("[2/4] Relayer authorized on adapter:", deployer);

        // 3. Configure Chainlink oracle on the adapter (10% max deviation default)
        adapter.setPriceOracle(cfg.chainlinkEthUsd);
        console.log("[3/4] Chainlink oracle configured:", cfg.chainlinkEthUsd);

        // 4. Authorize adapter as relayer on DustPoolV2
        //    (adapter calls pool.withdraw() during swaps, which is relayer-only)
        pool.setRelayer(address(adapter), true);
        console.log("[4/4] Adapter authorized on DustPoolV2:", address(adapter));

        vm.stopBroadcast();

        // ── Post-deploy summary ─────────────────────────────────────────────
        console.log("");
        console.log("========================================");
        console.log("  Deployment Complete");
        console.log("========================================");
        console.log("");
        console.log("DustSwapAdapterV2:    ", address(adapter));
        console.log("Owner:                ", adapter.owner());
        console.log("Announcer:            ", address(adapter.ANNOUNCER()));
        console.log("Relayer authorized:   ", adapter.authorizedRelayers(deployer));
        console.log("Oracle:               ", address(adapter.priceOracle()));
        console.log("Max deviation (bps):  ", adapter.maxOracleDeviationBps());
        console.log("Pool authorized:      ", pool.relayers(address(adapter)));
        console.log("");
        console.log("=== REQUIRED UPDATES ===");
        console.log("1. src/config/chains.ts  -> dustSwapAdapterV2:", address(adapter));
        console.log("2. docs/CONTRACTS.md     -> DustSwapAdapterV2 section");
        console.log("3. Verify on Etherscan:");
        console.log(
            string(abi.encodePacked(
                "   forge verify-contract ",
                vm.toString(address(adapter)),
                " DustSwapAdapterV2 --chain 11155111 --etherscan-api-key $ETHERSCAN_API_KEY"
            ))
        );
    }

    // ─── Step 5: Post-Deploy Verification ───────────────────────────────────────

    /// @notice Read-only verification of a deployed adapter against the same env config. No broadcast needed.
    ///         Usage: forge script script/DeploySwapAdapterV2.s.sol \
    ///           --sig "verify(address)" <ADAPTER_ADDRESS> --rpc-url $SEPOLIA_RPC_URL
    function verify(address adapterAddr) external view {
        DeployConfig memory cfg = _loadConfig();
        DustSwapAdapterV2 adapter = DustSwapAdapterV2(payable(adapterAddr));
        IDustPoolV2Admin pool = IDustPoolV2Admin(cfg.dustPoolV2);

        console.log("========================================");
        console.log("  Post-Deploy Verification");
        console.log("========================================");
        console.log("");

        // Ownership: the deployer is the DustPoolV2 owner (enforced by run())
        address poolOwner = pool.owner();
        address owner = adapter.owner();
        console.log("Owner:             ", owner);
        require(owner == poolOwner, "FAIL: Adapter owner is not the DustPoolV2 owner");
        console.log("  -> PASS: Owner matches deployer");

        // Immutables
        address pm = address(adapter.POOL_MANAGER());
        address dp = address(adapter.DUST_POOL_V2());
        address announcer = address(adapter.ANNOUNCER());
        console.log("PoolManager:       ", pm);
        console.log("DustPoolV2:        ", dp);
        console.log("Announcer:         ", announcer);
        require(pm == cfg.poolManager, "FAIL: Wrong PoolManager");
        require(dp == cfg.dustPoolV2, "FAIL: Wrong DustPoolV2");
        require(announcer == cfg.announcer, "FAIL: Wrong Announcer");
        console.log("  -> PASS: Immutables correct");

        // Relayer
        bool relayerOk = adapter.authorizedRelayers(poolOwner);
        console.log("Relayer authorized:", relayerOk);
        require(relayerOk, "FAIL: Relayer not authorized");
        console.log("  -> PASS: Relayer set");

        // Oracle
        address oracleAddr = address(adapter.priceOracle());
        uint256 deviation = adapter.maxOracleDeviationBps();
        console.log("Oracle:            ", oracleAddr);
        console.log("Max deviation:     ", deviation, "bps");
        require(oracleAddr == cfg.chainlinkEthUsd, "FAIL: Wrong oracle");
        require(deviation == 1000, "FAIL: Unexpected deviation");
        console.log("  -> PASS: Oracle configured");

        // Chainlink liveness
        IAggregatorV3Check feed = IAggregatorV3Check(oracleAddr);
        (, int256 price,, uint256 updatedAt,) = feed.latestRoundData();
        require(price > 0, "FAIL: Oracle returning zero");
        require(block.timestamp - updatedAt < 3600, "FAIL: Oracle stale");
        console.log("ETH/USD price:     $", uint256(price) / 1e8);
        console.log("Last updated:      ", updatedAt);
        console.log("  -> PASS: Oracle live");

        // DustPoolV2 authorization
        bool poolAuth = pool.relayers(adapterAddr);
        console.log("Pool auth:         ", poolAuth);
        require(poolAuth, "FAIL: Adapter not authorized on pool");
        console.log("  -> PASS: Pool authorization");

        console.log("");
        console.log("========================================");
        console.log("  ALL CHECKS PASSED");
        console.log("========================================");
    }

    // ─── Config ─────────────────────────────────────────────────────────────────

    /// @dev Every address must hold code: a typo'd ANNOUNCER would be baked into the adapter forever
    function _loadConfig() internal view returns (DeployConfig memory cfg) {
        cfg = DeployConfig({
            dustPoolV2: vm.envAddress("DUST_POOL_V2"),
            poolManager: vm.envAddress("POOL_MANAGER"),
            announcer: vm.envAddress("ANNOUNCER"),
            chainlinkEthUsd: vm.envAddress("CHAINLINK_ETH_USD")
        });
        require(cfg.dustPoolV2.code.length > 0, "DUST_POOL_V2 has no code");
        require(cfg.poolManager.code.length > 0, "POOL_MANAGER has no code");
        require(cfg.announcer.code.length > 0, "ANNOUNCER has no code");
        require(cfg.chainlinkEthUsd.code.length > 0, "CHAINLINK_ETH_USD has no code");
    }
}
