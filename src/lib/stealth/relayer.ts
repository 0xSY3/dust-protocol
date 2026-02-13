// Relayer API client

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:3001';

export interface RelayerInfo {
  relayerAddress: string;
  balance: string;
  feeBps: number;
  minFee: string;
  chainId: number;
}

export interface FeeCalculation {
  balance: string;
  fee: string;
  amountAfterFee: string;
  feeBps: number;
}

export interface WithdrawResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  message: string;
  fee: string;
  amountAfterFee: string;
}

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  stealthAddress: string;
  recipient: string;
  fee: string | null;
  amountAfterFee: string | null;
  txHash: string | null;
  error: string | null;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${RELAYER_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function checkRelayerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${RELAYER_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getRelayerInfo(): Promise<RelayerInfo | null> {
  return fetchJson('/info');
}

export async function calculateRelayerFee(stealthAddress: string): Promise<FeeCalculation | null> {
  return fetchJson('/calculate-fee', {
    method: 'POST',
    body: JSON.stringify({ stealthAddress }),
  });
}

export async function submitRelayerWithdraw(
  stealthAddress: string,
  signature: string,
  recipient: string,
  owner: string,
): Promise<WithdrawResponse | null> {
  const res = await fetch(`${RELAYER_URL}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stealthAddress, signature, recipient, owner }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Withdrawal failed');
  }

  return res.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  return fetchJson(`/status/${jobId}`);
}

export async function waitForJobCompletion(jobId: string, maxAttempts = 60, intervalMs = 2000): Promise<JobStatus | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getJobStatus(jobId);
    if (!status) return null;
    if (status.status === 'completed' || status.status === 'failed') return status;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

export function getRelayerUrl(): string {
  return RELAYER_URL;
}
