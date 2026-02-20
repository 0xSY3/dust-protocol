import { ethers } from 'ethers';

export interface ParsedDeposit {
  commitment: string;
  queueIndex: number;
  amount: string;
  asset: string;
  timestamp: number;
  chainId: number;
  blockNumber: number;
  txIndex: number;
  logIndex: number;
}

const DEPOSIT_QUEUED_TOPIC = ethers.utils.id(
  'DepositQueued(bytes32,uint256,uint256,address,uint256)'
);

/**
 * Parse a DepositQueued event log into a typed deposit object.
 * Returns null if the log doesn't match the expected event signature.
 */
export function parseDepositEvent(
  log: ethers.providers.Log,
  chainId: number
): ParsedDeposit | null {
  if (log.topics[0] !== DEPOSIT_QUEUED_TOPIC) return null;

  // topic[1] = indexed commitment (bytes32)
  const commitment = log.topics[1];
  if (!commitment || commitment === ethers.constants.HashZero) return null;

  // Non-indexed params: (uint256 queueIndex, uint256 amount, address asset, uint256 timestamp)
  const iface = new ethers.utils.Interface([
    'event DepositQueued(bytes32 indexed commitment, uint256 queueIndex, uint256 amount, address asset, uint256 timestamp)',
  ]);

  try {
    const parsed = iface.parseLog(log);
    return {
      commitment,
      queueIndex: parsed.args.queueIndex.toNumber(),
      amount: parsed.args.amount.toString(),
      asset: parsed.args.asset,
      timestamp: parsed.args.timestamp.toNumber(),
      chainId,
      blockNumber: log.blockNumber,
      txIndex: log.transactionIndex,
      logIndex: log.logIndex,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[event-parser] Failed to parse DepositQueued log: ${msg}`);
    return null;
  }
}

/**
 * Sort deposits in deterministic global order.
 * Order: chainId ASC → blockNumber ASC → txIndex ASC → logIndex ASC
 */
export function sortDeposits(deposits: ParsedDeposit[]): ParsedDeposit[] {
  return [...deposits].sort((a, b) => {
    if (a.chainId !== b.chainId) return a.chainId - b.chainId;
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    if (a.txIndex !== b.txIndex) return a.txIndex - b.txIndex;
    return a.logIndex - b.logIndex;
  });
}
