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

### DustSwap (Privacy Swaps)

| Contract | Address |
|----------|---------|
| DustSwapPoolETH | `0x52FAc2AC445b6a5b7351cb809DCB0194CEa223D0` |
| DustSwapPoolUSDC | `0xc788576786381d41B8F5180D0B92A15497CF72B3` |
| DustSwapHook | `0x09b6a164917F8ab6e8b552E47bD3957cAe6d80C4` |
| DustSwapVerifier | `0x1677C9c4E575C910B9bCaF398D615B9F3775d0f1` |
| DustSwapRouter | `0x82faD70Aa95480F719Da4B81E17607EF3A631F42` |
| Uniswap V4 PoolManager | `0x93805603e0167574dFe2F50ABdA8f42C85002FD8` |

Deployment block: `10268660`

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

## V2 Contracts (DustPool ZK-UTXO)

### Ethereum Sepolia (chain ID: 11155111)

| Contract | Address |
|----------|---------|
| FflonkVerifier | `0xD1D89bBAeD5b2e4453d6ED59c6e6fa78C13852A7` |
| DustPoolV2 | `0x36ECE3c48558630372fa4d35B1C4293Fcc18F7B6` |

Deployer/Relayer: `0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496`

### Thanos Sepolia (chain ID: 111551119090)

| Contract | Address |
|----------|---------|
| FflonkVerifier | `0x1f01345e6dCccfC3E213C391C81a70FAa20Ea6bc` |
| DustPoolV2 | `0x6987FE79057D83BefD19B80822Decb52235A5a67` |

Deployer/Relayer: `0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496`

---

All chain configuration including RPC URLs, contract addresses, and CREATE2 creation codes lives in `src/config/chains.ts`.
