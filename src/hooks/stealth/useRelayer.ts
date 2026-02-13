import { useState, useCallback, useEffect } from 'react';
import {
  checkRelayerHealth, getRelayerInfo, calculateRelayerFee, submitRelayerWithdraw,
  waitForJobCompletion, type RelayerInfo, type FeeCalculation, type JobStatus,
} from '@/lib/stealth/relayer';

export function useRelayer() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [relayerInfo, setRelayerInfo] = useState<RelayerInfo | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshRelayerInfo = useCallback(async () => {
    setIsChecking(true);
    setError(null);

    try {
      const healthy = await checkRelayerHealth();
      setIsAvailable(healthy);
      setRelayerInfo(healthy ? await getRelayerInfo() : null);
    } catch {
      setIsAvailable(false);
      setRelayerInfo(null);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => { refreshRelayerInfo(); }, [refreshRelayerInfo]);

  const calculateFee = useCallback(async (stealthAddress: string): Promise<FeeCalculation | null> => {
    if (!isAvailable) {
      setError('Relayer not available');
      return null;
    }
    try {
      return await calculateRelayerFee(stealthAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to calculate fee');
      return null;
    }
  }, [isAvailable]);

  const withdraw = useCallback(async (
    stealthAddress: string,
    signature: string,
    recipient: string,
    owner: string,
  ): Promise<JobStatus | null> => {
    if (!isAvailable) {
      setError('Relayer not available');
      return null;
    }

    setIsWithdrawing(true);
    setError(null);
    setJobStatus(null);
    setCurrentJobId(null);

    try {
      const response = await submitRelayerWithdraw(stealthAddress, signature, recipient, owner);
      if (!response) throw new Error('Failed to submit withdrawal');

      setCurrentJobId(response.jobId);
      const finalStatus = await waitForJobCompletion(response.jobId, 60, 2000);
      setJobStatus(finalStatus);

      if (finalStatus?.status === 'failed') {
        setError(finalStatus.error || 'Withdrawal failed');
      }
      return finalStatus;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Withdrawal failed');
      return null;
    } finally {
      setIsWithdrawing(false);
    }
  }, [isAvailable]);

  const clearError = useCallback(() => setError(null), []);

  return {
    isAvailable, isChecking, relayerInfo, calculateFee, withdraw,
    isWithdrawing, currentJobId, jobStatus, error, refreshRelayerInfo, clearError,
  };
}
