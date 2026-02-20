import { ethers, type BigNumber } from 'ethers';
import { getProvider, type V2ChainConfig } from '../config/chains';
import { config } from '../config';

// Estimated gas for DustPoolV2.withdraw() — FFLONK verification + state updates
const ESTIMATED_WITHDRAW_GAS = 450_000;

/**
 * Calculate the relayer fee for a withdrawal on the given chain.
 * Fee = estimatedGasCost * (1 + marginBps/10000)
 */
export async function calculateRelayerFee(chain: V2ChainConfig): Promise<BigNumber> {
  const provider = getProvider(chain);
  const feeData = await provider.getFeeData();

  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.utils.parseUnits('1', 'gwei');
  const gasCost = gasPrice.mul(ESTIMATED_WITHDRAW_GAS);

  // Apply margin: gasCost * (10000 + marginBps) / 10000
  const fee = gasCost.mul(10000 + config.feeMarginBps).div(10000);
  return fee;
}

/**
 * Format fee as a human-readable ETH string.
 */
export function formatFee(fee: BigNumber): string {
  return ethers.utils.formatEther(fee);
}
