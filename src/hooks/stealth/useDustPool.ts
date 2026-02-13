import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import {
  loadDeposits,
  saveDeposits,
  storedToDepositData,
  buildTreeFromEvents,
  generateWithdrawProof,
  type StoredDeposit,
} from '@/lib/dustpool';
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';
import { getChainProvider } from '@/lib/providers';

export interface ConsolidateProgress {
  phase: 'idle' | 'loading' | 'proving' | 'submitting' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

export function useDustPool(chainId?: number) {
  const activeChainId = chainId ?? DEFAULT_CHAIN_ID;
  const config = getChainConfig(activeChainId);
  const dustPoolAddress = config.contracts.dustPool;
  const dustPoolDeploymentBlock = config.dustPoolDeploymentBlock;
  const hasDustPool = !!dustPoolAddress && !!dustPoolDeploymentBlock;
  const { address } = useAccount();
  const [deposits, setDeposits] = useState<StoredDeposit[]>([]);
  const [poolBalance, setPoolBalance] = useState('0');
  const [progress, setProgress] = useState<ConsolidateProgress>({
    phase: 'idle', current: 0, total: 0, message: '',
  });
  const isConsolidatingRef = useRef(false);

  // Load deposits from storage
  const loadPoolDeposits = useCallback(() => {
    if (!address) return;
    const stored = loadDeposits(address, activeChainId);
    setDeposits(stored);

    // Calculate pool balance from unwithdrawable deposits
    const total = stored
      .filter(d => !d.withdrawn)
      .reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));
    setPoolBalance(ethers.utils.formatEther(total));
  }, [address]);

  useEffect(() => {
    loadPoolDeposits();
  }, [loadPoolDeposits]);

  // Consolidate: generate proofs for all unwithdrawable deposits, submit withdrawals
  const consolidate = useCallback(async (freshRecipient: string) => {
    if (!address || isConsolidatingRef.current || !hasDustPool) return;

    isConsolidatingRef.current = true;
    const unwithdrawn = deposits.filter(d => !d.withdrawn);

    if (unwithdrawn.length === 0) {
      setProgress({ phase: 'error', current: 0, total: 0, message: 'No deposits to withdraw' });
      isConsolidatingRef.current = false;
      return;
    }

    try {
      setProgress({
        phase: 'loading', current: 0, total: unwithdrawn.length,
        message: 'Rebuilding Merkle tree from on-chain events...',
      });

      const provider = getChainProvider(activeChainId);
      const { tree } = await buildTreeFromEvents(
        provider,
        dustPoolAddress!,
        dustPoolDeploymentBlock!,
      );

      const txHashes: string[] = [];

      for (let i = 0; i < unwithdrawn.length; i++) {
        const stored = unwithdrawn[i];
        const depositData = storedToDepositData(stored);

        // Phase 2: Generate ZK proof
        setProgress({
          phase: 'proving', current: i + 1, total: unwithdrawn.length,
          message: `Generating proof ${i + 1}/${unwithdrawn.length}...`,
        });

        const merkleProof = tree.getProof(stored.leafIndex);
        const withdrawProof = await generateWithdrawProof(
          depositData,
          merkleProof,
          freshRecipient,
        );

        // Phase 3: Submit withdrawal
        setProgress({
          phase: 'submitting', current: i + 1, total: unwithdrawn.length,
          message: `Submitting withdrawal ${i + 1}/${unwithdrawn.length}...`,
        });

        const res = await fetch('/api/pool-withdraw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proof: withdrawProof.proof,
            root: withdrawProof.root,
            nullifierHash: withdrawProof.nullifierHash,
            recipient: freshRecipient,
            amount: withdrawProof.amount,
            chainId: activeChainId,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Withdrawal failed');
        }

        txHashes.push(data.txHash);

        // Mark as withdrawn in storage
        stored.withdrawn = true;
      }

      // Save updated deposits
      const allDeposits = loadDeposits(address, activeChainId);
      for (const stored of unwithdrawn) {
        const idx = allDeposits.findIndex(d => d.commitment === stored.commitment);
        if (idx >= 0) allDeposits[idx].withdrawn = true;
      }
      saveDeposits(address, allDeposits, activeChainId);
      setDeposits(allDeposits);

      const totalAmount = unwithdrawn.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));
      setPoolBalance('0');

      setProgress({
        phase: 'done', current: unwithdrawn.length, total: unwithdrawn.length,
        message: `Withdrew ${ethers.utils.formatEther(totalAmount)} ${config.nativeCurrency.symbol} to ${freshRecipient.slice(0, 8)}...`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Withdrawal failed';
      setProgress({
        phase: 'error', current: 0, total: 0,
        message: msg,
      });
    } finally {
      isConsolidatingRef.current = false;
    }
  }, [address, deposits, activeChainId, hasDustPool, dustPoolAddress, dustPoolDeploymentBlock, config.nativeCurrency.symbol]);

  const resetProgress = useCallback(() => {
    setProgress({ phase: 'idle', current: 0, total: 0, message: '' });
  }, []);

  return {
    deposits,
    poolBalance,
    progress,
    consolidate,
    resetProgress,
    loadPoolDeposits,
    hasDustPool,
    isConsolidating: progress.phase === 'proving' || progress.phase === 'submitting' || progress.phase === 'loading',
  };
}
