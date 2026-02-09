// Shield base token (TON) into Railgun privacy pool — lazy-loaded
import { ethers } from 'ethers';

const THANOS_RPC = 'https://rpc.thanos-sepolia.tokamak.network';
const RELAY_ADAPT_ADDRESS = '0xD7Ec2400B53c0E51EBd72a962aeF15f6e22B3b89';

// ABI fragments for manual encoding (ethers v5)
const RELAY_ADAPT_ABI = [
  'function multicall(bool requireSuccess, tuple(address to, bytes data, uint256 value)[] calls) external payable',
  'function wrapBase(uint256 amount) external',
  'function shield(tuple(tuple(bytes32 npk, tuple(uint8 tokenType, address tokenAddress, uint256 tokenSubID) token, uint120 value) preimage, tuple(bytes32[3] encryptedBundle, bytes32 shieldKey) ciphertext)[] _shieldRequests) external',
];

export async function getShieldPrivateKey(signer: ethers.Signer): Promise<string> {
  const wallet = await import('@railgun-community/wallet');
  const message = wallet.getShieldPrivateKeySignatureMessage();
  const signature = await signer.signMessage(message);
  return ethers.utils.keccak256(signature);
}

export interface ShieldResult {
  txHash: string;
  amount: string;
}

export async function shieldBaseToken(
  railgunAddress: string,
  shieldPrivateKey: string,
  amountWei: bigint,
  fromAddress: string,
  signer: ethers.Signer,
): Promise<ShieldResult> {
  const wallet = await import('@railgun-community/wallet');
  const { NetworkName, TXIDVersion, EVMGasType, NETWORK_CONFIG } = await import('@railgun-community/shared-models');

  const wtonAddress = NETWORK_CONFIG[NetworkName.ThanosSepolia].baseToken.wrappedAddress;

  const wrappedERC20Amount = {
    tokenAddress: wtonAddress,
    amount: amountWei,
  };

  const gasEstimate = await wallet.gasEstimateForShieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    NetworkName.ThanosSepolia,
    railgunAddress,
    shieldPrivateKey,
    wrappedERC20Amount,
    fromAddress,
  );

  const rpcProvider = new ethers.providers.JsonRpcProvider(THANOS_RPC);
  const feeData = await rpcProvider.getFeeData();

  const gasDetails = {
    evmGasType: EVMGasType.Type2 as typeof EVMGasType.Type2,
    gasEstimate: BigInt(gasEstimate.gasEstimate.toString()),
    maxFeePerGas: feeData.maxFeePerGas ? BigInt(feeData.maxFeePerGas.toString()) : 1000000000n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? BigInt(feeData.maxPriorityFeePerGas.toString()) : 1000000000n,
  };

  const { transaction } = await wallet.populateShieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    NetworkName.ThanosSepolia,
    railgunAddress,
    shieldPrivateKey,
    wrappedERC20Amount,
    gasDetails,
  );

  const tx = await signer.sendTransaction({
    to: transaction.to,
    data: transaction.data,
    value: amountWei.toString(),
    gasLimit: gasDetails.gasEstimate.toString(),
    maxFeePerGas: gasDetails.maxFeePerGas.toString(),
    maxPriorityFeePerGas: gasDetails.maxPriorityFeePerGas.toString(),
    type: 2,
  });

  const receipt = await tx.wait();
  return {
    txHash: receipt.transactionHash,
    amount: ethers.utils.formatEther(amountWei.toString()),
  };
}

// Generate shield request using SDK crypto, then manually encode multicall with ethers v5
// This bypasses the SDK's ethers v6 populateTransaction which produces incompatible calldata
export async function populateShieldTx(
  railgunAddress: string,
  shieldPrivateKey: string,
  amountWei: bigint,
): Promise<{ transaction: { to: string; data: string } }> {
  const engine = await import('@railgun-community/engine');
  const { NETWORK_CONFIG, NetworkName } = await import('@railgun-community/shared-models');

  const wtonAddress = NETWORK_CONFIG[NetworkName.ThanosSepolia].baseToken.wrappedAddress;

  // Step 1: Generate the ShieldRequest using SDK crypto primitives
  const { masterPublicKey, viewingPublicKey } = engine.RailgunEngine.decodeAddress(railgunAddress);
  const random = engine.ByteUtils.randomHex(16);
  const shield = new engine.ShieldNoteERC20(masterPublicKey, random, amountWei, wtonAddress);
  const shieldPrivateKeyBytes = engine.ByteUtils.hexToBytes(shieldPrivateKey);
  const shieldRequest = await shield.serialize(shieldPrivateKeyBytes, viewingPublicKey);

  // Step 2: Extract values from the SDK's ShieldRequest into plain JS
  const npk = String(shieldRequest.preimage.npk);
  const tokenType = Number(shieldRequest.preimage.token.tokenType);
  const tokenAddress = String(shieldRequest.preimage.token.tokenAddress);
  const tokenSubID = String(shieldRequest.preimage.token.tokenSubID);
  const value = ethers.BigNumber.from(String(shieldRequest.preimage.value));

  const encryptedBundle = [
    String(shieldRequest.ciphertext.encryptedBundle[0]),
    String(shieldRequest.ciphertext.encryptedBundle[1]),
    String(shieldRequest.ciphertext.encryptedBundle[2]),
  ];
  const shieldKey = String(shieldRequest.ciphertext.shieldKey);

  console.log('[populateShieldTx] npk:', npk.slice(0, 20) + '...');
  console.log('[populateShieldTx] token:', tokenAddress, 'type:', tokenType, 'subID:', tokenSubID);
  console.log('[populateShieldTx] value:', value.toString());
  console.log('[populateShieldTx] WTON expected:', wtonAddress);

  // Step 3: Manually encode the multicall with ethers v5
  const relayIface = new ethers.utils.Interface(RELAY_ADAPT_ABI);

  const shieldRequestForABI = {
    preimage: {
      npk,
      token: { tokenType, tokenAddress, tokenSubID },
      value,
    },
    ciphertext: { encryptedBundle, shieldKey },
  };

  const wrapBaseData = relayIface.encodeFunctionData('wrapBase', [amountWei.toString()]);
  const shieldData = relayIface.encodeFunctionData('shield', [[shieldRequestForABI]]);

  const calls = [
    { to: RELAY_ADAPT_ADDRESS, data: wrapBaseData, value: 0 },
    { to: RELAY_ADAPT_ADDRESS, data: shieldData, value: 0 },
  ];

  const multicallData = relayIface.encodeFunctionData('multicall', [true, calls]);

  console.log('[populateShieldTx] wrapBase selector:', wrapBaseData.slice(0, 10));
  console.log('[populateShieldTx] shield selector:', shieldData.slice(0, 10));
  console.log('[populateShieldTx] multicall selector:', multicallData.slice(0, 10));
  console.log('[populateShieldTx] multicall length:', multicallData.length);

  return {
    transaction: {
      to: RELAY_ADAPT_ADDRESS,
      data: multicallData,
    },
  };
}
