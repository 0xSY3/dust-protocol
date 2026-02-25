# Contract Addresses

## Ethereum Sepolia (chain ID: 11155111)

### Core Stealth

| Contract | Address |
|----------|---------|
| ERC5564Announcer | `0x64044FfBefA7f1252DdfA931c939c19F21413aB0` |
| ERC6538Registry | `0xb848398167054cCb66264Ec25C35F8CfB1EF1Ca7` |
| StealthNameRegistry | `0x857e17A85891Ef1C595e51Eb7Cd56c607dB21313` |

### ERC-4337

| Contract | Address |
|----------|---------|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| StealthAccountFactory | `0xc73fce071129c7dD7f2F930095AfdE7C1b8eA82A` |
| StealthWalletFactory | `0x1c65a6F830359f207e593867B78a303B9D757453` |
| DustPaymaster | `0x20C28cbF9bc462Fb361C8DAB0C0375011b81BEb2` |

### DustPool

| Contract | Address |
|----------|---------|
| DustPool | `0xc95a359E66822d032A6ADA81ec410935F3a88bcD` |
| Groth16Verifier | `0x17f52f01ffcB6d3C376b2b789314808981cebb16` |

Deployment block: `10251347` · DustPool: `10259728`

### DustSwap (Privacy Swaps) — chainId + relayerFee Range Check

| Contract | Address |
|----------|---------|
| DustSwapPoolETH | `0xE30Cd101AA3d58A5124E8fF8Dda825F1bA5f8799` |
| DustSwapPoolUSDC | `0x1791D13995FfA9e00a9A2C07A9ad1251a668A669` |
| DustSwapHook | `0xCb2e9147B96e385c2c00A11D92026eb16eB400c4` |
| DustSwapVerifier | `0x629A2d1CDB1E4510b95a42c64aF2754Ac1dd6a7F` |
| DustSwapRouter | `0xDC839820cc24f312f10945939C4aCa41887FC78F` |
| Uniswap V4 PoolManager | `0x93805603e0167574dFe2F50ABdA8f42C85002FD8` |

Deployment block: `10313992`

#### Previous DustSwap Deployments (deprecated)

| Contract | Address | Note |
|----------|---------|------|
| DustSwapHook | `0x78139b89777bAC63B346C2DA4829667529E5c0C4` | Poseidon-binding, no chainId |
| DustSwapVerifier | `0xD7Ec2400B53c0E51EBd72a962aeF15f6e22B3b89` | Pre-chainId verifier |
| DustSwapPoolETH | `0x52FAc2AC445b6a5b7351cb809DCB0194CEa223D0` | Original pools (V1) |
| DustSwapPoolUSDC | `0xc788576786381d41B8F5180D0B92A15497CF72B3` | Original pools (V1) |
| DustSwapHook | `0x09b6a164917F8ab6e8b552E47bD3957cAe6d80C4` | Original hook (V1) |
| DustSwapVerifier | `0x1677C9c4E575C910B9bCaF398D615B9F3775d0f1` | Original verifier (V1) |
| DustSwapRouter | `0x82faD70Aa95480F719Da4B81E17607EF3A631F42` | Original router (V1) |

---

## Thanos Sepolia (chain ID: 111551119090)

### Core Stealth

| Contract | Address |
|----------|---------|
| ERC5564Announcer | `0x2C2a59E9e71F2D1A8A2D447E73813B9F89CBb125` |
| ERC6538Registry | `0x9C527Cc8CB3F7C73346EFd48179e564358847296` |
| StealthNameRegistry | `0xD06389cEEd802817C439E0F803E71b02ceb132b4` |

### ERC-4337

| Contract | Address |
|----------|---------|
| EntryPoint v0.6 | `0x5c058Eb93CDee95d72398E5441d989ef6453D038` |
| StealthAccountFactory | `0xfE89381ae27a102336074c90123A003e96512954` |
| StealthWalletFactory | `0xbc8e75a5374a6533cD3C4A427BF4FA19737675D3` |
| DustPaymaster | `0x9e2eb36F7161C066351DC9E418E7a0620EE5d095` |

### DustPool

| Contract | Address |
|----------|---------|
| DustPool | `0x16b8c82e3480b1c5B8dbDf38aD61a828a281e2c3` |
| Groth16Verifier | `0x9914F482c262dC8BCcDa734c6fF3f5384B1E19Aa` |

Deployment block: `6272527` · DustPool: `6372598`

*DustSwap not yet deployed on Thanos Sepolia.*

---

## V2 Contracts (DustPool ZK-UTXO) — With Split Circuit

Deployed with: Pausable, Ownable2Step, chainId, I1 recipient binding, 2-in-8-out split verifier.

### Ethereum Sepolia (chain ID: 11155111)

| Contract | Address |
|----------|---------|
| FflonkVerifier (9 signals) | `0xd4B52Fd4CDFCCA41E6F88f1a1AfA9A0B715290e7` |
| FflonkSplitVerifier (15 signals) | `0x2c53Ea8983dCA7b2d4cA1aa4ECfBc6e513e0Fc6E` |
| DustPoolV2 | `0x03D52fd442965cD6791Ce5AFab78C60671f9558A` |
| DustSwapVerifierProduction | `0x629A2d1CDB1E4510b95a42c64aF2754Ac1dd6a7F` |

Deployer/Relayer: `0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496`

### DustSwap V2 — Adapter (Ethereum Sepolia)

Atomic private swaps: withdraw from DustPoolV2 → swap on Uniswap V4 → deposit output back.

| Contract | Address |
|----------|---------|
| DustSwapAdapterV2 | `0xb91Afd19FeB4000E228243f40B8d98ea07127400` |
| Chainlink ETH/USD Oracle | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| PoseidonT3 (library) | `0x203a488C06e9add25D4b51F7EDE8e56bCC4B1A1C` |
| PoseidonT6 (library) | `0x666333F371685334CdD69bdDdaFBABc87CE7c7Db` |
| Uniswap V4 PoolManager | `0x93805603e0167574dFe2F50ABdA8f42C85002FD8` |

Oracle: Chainlink ETH/USD, 10% max deviation, 1-hour stale threshold.

Verified: [Blockscout](https://eth-sepolia.blockscout.com/address/0xb91afd19feb4000e228243f40b8d98ea07127400)

#### Previous DustSwap V2 Adapter Deployments (deprecated)

| Contract | Address | Note |
|----------|---------|------|
| DustSwapAdapterV2 | `0xe2bE4d7b5C1952B3DDB210499800A45aa0DD097C` | Pre-oracle, no Chainlink bound |

### Thanos Sepolia (chain ID: 111551119090)

| Contract | Address |
|----------|---------|
| FflonkVerifier (9 signals) | `0x51B2936AF26Df0f087C18E5B478Ae2bda8AD5325` |
| FflonkSplitVerifier (15 signals) | `0x4031D4559ba1D5878caa8Acc627555748D528AE4` |
| DustPoolV2 | `0x283800e6394DF6ad17aC53D8d48CD8C0c048B7Ad` |

Deployer/Relayer: `0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496`

### Previous V2 Deployments (deprecated)

| Chain | FflonkVerifier | DustPoolV2 |
|-------|-------|-------|
| Ethereum Sepolia (pre-split) | `0xC639C2594cf2841a7aC2E8298208fe33a98Dc98D` | `0x6f37E2Df430E1c516148157E6d42db6a3747eB8f` |
| Thanos Sepolia (pre-split) | `0x301e16F08238e6414ff8Ea3B1F2A85387e9453Df` | `0x29f4822161bcf02687e02bDD48850C0385a5eEd2` |
| Ethereum Sepolia (1st gen) | `0xD1D89bBAeD5b2e4453d6ED59c6e6fa78C13852A7` | `0x36ECE3c48558630372fa4d35B1C4293Fcc18F7B6` |
| Thanos Sepolia (1st gen) | `0x1f01345e6dCccfC3E213C391C81a70FAa20Ea6bc` | `0x6987FE79057D83BefD19B80822Decb52235A5a67` |

---

All chain configuration including RPC URLs, contract addresses, and CREATE2 creation codes lives in `src/config/chains.ts`.
