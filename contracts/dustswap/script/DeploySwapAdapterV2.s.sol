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
/// @notice Deployment pipeline:
///
///   STEP 1 — Deploy PoseidonT6 library (skip if already deployed):
///     cd contracts/dustswap && forge script script/DeploySwapAdapterV2.s.sol \
///       --sig "deployPoseidon()" \
///       --rpc-url $SEPOLIA_RPC_URL \
///       --private-key $PRIVATE_KEY \
///       --broadcast --slow
///     → Copy logged PoseidonT6 address into foundry.toml libraries[]
///
///   STEP 2 — Simulate (dry run, no broadcast):
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --rpc-url $SEPOLIA_RPC_URL \
///       --private-key $PRIVATE_KEY
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
///       --constructor-args $(cast abi-encode "constructor(address,address)" \
///         0x93805603e0167574dFe2F50ABdA8f42C85002FD8 \
///         0x3cbf3459e7E0E9Fd2fd86a28c426CED2a60f023f)
///
///   STEP 5 — Post-deploy checks:
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --sig "verify(address)" <ADAPTER_ADDRESS> \
///       --rpc-url $SEPOLIA_RPC_URL
///
/// @dev Thanos Sepolia: No Uniswap V4 PoolManager — DustSwapAdapterV2 is Ethereum Sepolia only.
contract DeploySwapAdapterV2 is Script {
    // ─── Ethereum Sepolia Constants ─────────────────────────────────────────────

    /// @dev Uniswap V4 PoolManager (Ethereum Sepolia, canonical)
    address constant POOL_MANAGER = 0x93805603e0167574dFe2F50ABdA8f42C85002FD8;

    /// @dev DustPoolV2 privacy pool (Ethereum Sepolia, current deployment)
    address constant DUST_POOL_V2 = 0x3cbf3459e7E0E9Fd2fd86a28c426CED2a60f023f;

    /// @dev PoseidonT3 library (deployed, linked in foundry.toml)
    address constant POSEIDON_T3 = 0x203a488C06e9add25D4b51F7EDE8e56bCC4B1A1C;

    /// @dev Chainlink ETH/USD price feed (Ethereum Sepolia)
    address constant CHAINLINK_ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    /// @dev Deployer / relayer address
    address constant DEPLOYER = 0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496;

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
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // ── Pre-flight checks ───────────────────────────────────────────────
        console.log("========================================");
        console.log("  DustSwapAdapterV2 Production Deploy");
        console.log("========================================");
        console.log("");
        console.log("--- Pre-flight ---");
        console.log("Chain ID:     ", block.chainid);
        console.log("Deployer:     ", deployer);
        console.log("Balance:      ", deployer.balance);
        console.log("PoolManager:  ", POOL_MANAGER);
        console.log("DustPoolV2:   ", DUST_POOL_V2);
        console.log("Chainlink:    ", CHAINLINK_ETH_USD);

        require(deployer == DEPLOYER, "Wrong deployer key");
        require(deployer.balance > 0.01 ether, "Insufficient deployer balance");
        require(block.chainid == 11155111, "Not Ethereum Sepolia");

        // Validate DustPoolV2 is live and deployer is owner
        IDustPoolV2Admin pool = IDustPoolV2Admin(DUST_POOL_V2);
        require(pool.owner() == deployer, "Deployer is not DustPoolV2 owner");
        require(!pool.paused(), "DustPoolV2 is paused");

        // Validate Chainlink feed is responding
        IAggregatorV3Check oracle = IAggregatorV3Check(CHAINLINK_ETH_USD);
        (, int256 price,,uint256 updatedAt,) = oracle.latestRoundData();
        require(price > 0, "Chainlink returning zero price");
        require(block.timestamp - updatedAt < 3600, "Chainlink feed stale");
        console.log("Chainlink ETH/USD: $", uint256(price) / 1e8);
        console.log("Feed description:  ", oracle.description());
        console.log("Feed decimals:     ", oracle.decimals());
        console.log("");

        // ── Deploy ──────────────────────────────────────────────────────────
        vm.startBroadcast(deployerKey);

        // 1. Deploy adapter
        DustSwapAdapterV2 adapter = new DustSwapAdapterV2(
            POOL_MANAGER,
            DUST_POOL_V2
        );
        console.log("[1/4] DustSwapAdapterV2 deployed:", address(adapter));

        // 2. Authorize deployer as relayer on the adapter
        adapter.setRelayer(deployer, true);
        console.log("[2/4] Relayer authorized on adapter:", deployer);

        // 3. Configure Chainlink oracle on the adapter (10% max deviation default)
        adapter.setPriceOracle(CHAINLINK_ETH_USD);
        console.log("[3/4] Chainlink oracle configured:", CHAINLINK_ETH_USD);

        // 4. Authorize adapter as relayer on DustPoolV2
        //    (adapter calls pool.deposit() during swap, needs relayer auth)
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

    /// @notice Read-only verification of a deployed adapter. No broadcast needed.
    ///         Usage: forge script script/DeploySwapAdapterV2.s.sol \
    ///           --sig "verify(address)" <ADAPTER_ADDRESS> --rpc-url $SEPOLIA_RPC_URL
    function verify(address adapterAddr) external view {
        DustSwapAdapterV2 adapter = DustSwapAdapterV2(payable(adapterAddr));

        console.log("========================================");
        console.log("  Post-Deploy Verification");
        console.log("========================================");
        console.log("");

        // Ownership
        address owner = adapter.owner();
        console.log("Owner:             ", owner);
        require(owner == DEPLOYER, "FAIL: Wrong owner");
        console.log("  -> PASS: Owner matches deployer");

        // Immutables
        address pm = address(adapter.POOL_MANAGER());
        address dp = address(adapter.DUST_POOL_V2());
        console.log("PoolManager:       ", pm);
        console.log("DustPoolV2:        ", dp);
        require(pm == POOL_MANAGER, "FAIL: Wrong PoolManager");
        require(dp == DUST_POOL_V2, "FAIL: Wrong DustPoolV2");
        console.log("  -> PASS: Immutables correct");

        // Relayer
        bool relayerOk = adapter.authorizedRelayers(DEPLOYER);
        console.log("Relayer authorized:", relayerOk);
        require(relayerOk, "FAIL: Relayer not authorized");
        console.log("  -> PASS: Relayer set");

        // Oracle
        address oracleAddr = address(adapter.priceOracle());
        uint256 deviation = adapter.maxOracleDeviationBps();
        console.log("Oracle:            ", oracleAddr);
        console.log("Max deviation:     ", deviation, "bps");
        require(oracleAddr == CHAINLINK_ETH_USD, "FAIL: Wrong oracle");
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
        IDustPoolV2Admin pool = IDustPoolV2Admin(DUST_POOL_V2);
        bool poolAuth = pool.relayers(adapterAddr);
        console.log("Pool auth:         ", poolAuth);
        require(poolAuth, "FAIL: Adapter not authorized on pool");
        console.log("  -> PASS: Pool authorization");

        console.log("");
        console.log("========================================");
        console.log("  ALL CHECKS PASSED");
        console.log("========================================");
    }
}
