// Unshield base token from Railgun pool — lazy-loaded
import { ethers } from 'ethers';

const THANOS_RPC = 'https://rpc.thanos-sepolia.tokamak.network';

export type ProofProgressCallback = (progress: number) => void;

export interface UnshieldResult {
  txHash: string;
  amount: string;
  toAddress: string;
}

export async function unshieldBaseToken(
  destinationAddress: string,
  railgunWalletID: string,
  encryptionKey: string,
  amountWei: bigint,
  signer: ethers.Signer,
  onProgress?: ProofProgressCallback,
): Promise<UnshieldResult> {
  const wallet = await import('@railgun-community/wallet');
  const { NetworkName, TXIDVersion, EVMGasType, NETWORK_CONFIG } = await import('@railgun-community/shared-models');

  const fromAddress = await signer.getAddress();
  const wtonAddress = NETWORK_CONFIG[NetworkName.ThanosSepolia].baseToken.wrappedAddress;

  const wrappedERC20Amount = {
    tokenAddress: wtonAddress,
    amount: amountWei,
  };

  const rpcProvider = new ethers.providers.JsonRpcProvider(THANOS_RPC);
  const feeData = await rpcProvider.getFeeData();

  const initialGasDetails = {
    evmGasType: EVMGasType.Type2 as typeof EVMGasType.Type2,
    gasEstimate: 1_500_000n,
    maxFeePerGas: feeData.maxFeePerGas ? BigInt(feeData.maxFeePerGas.toString()) : 1000000000n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? BigInt(feeData.maxPriorityFeePerGas.toString()) : 1000000000n,
  };

  const gasEstimate = await wallet.gasEstimateForUnprovenUnshieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    NetworkName.ThanosSepolia,
    fromAddress,
    railgunWalletID,
    encryptionKey,
    wrappedERC20Amount,
    initialGasDetails,
    undefined,
    true,
  );

  const gasDetails = {
    ...initialGasDetails,
    gasEstimate: BigInt(gasEstimate.gasEstimate.toString()),
  };

  // Generate ZK proof (20-30s in browser)
  await wallet.generateUnshieldBaseTokenProof(
    TXIDVersion.V2_PoseidonMerkle,
    NetworkName.ThanosSepolia,
    fromAddress,
    railgunWalletID,
    encryptionKey,
    wrappedERC20Amount,
    undefined,
    true,
    0n,
    (progress: number) => onProgress?.(progress),
  );

  const { transaction } = await wallet.populateProvedUnshieldBaseToken(
    TXIDVersion.V2_PoseidonMerkle,
    NetworkName.ThanosSepolia,
    fromAddress,
    railgunWalletID,
    wrappedERC20Amount,
    undefined,
    true,
    0n,
    gasDetails,
  );

  const tx = await signer.sendTransaction({
    to: transaction.to,
    data: transaction.data,
    gasLimit: gasDetails.gasEstimate.toString(),
    maxFeePerGas: gasDetails.maxFeePerGas.toString(),
    maxPriorityFeePerGas: gasDetails.maxPriorityFeePerGas.toString(),
    type: 2,
  });

  const receipt = await tx.wait();
  return {
    txHash: receipt.transactionHash,
    amount: ethers.utils.formatEther(amountWei.toString()),
    toAddress: destinationAddress,
  };
}
