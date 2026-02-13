// Gelato Relay wrapper for gas-sponsored stealth claims
// Uses 1Balance for managed multi-chain gas sponsorship
// Falls back to sponsor wallet on unsupported chains (e.g. Thanos Sepolia)
//
// Uses fetch directly against the Gelato Relay REST API to avoid pulling in
// the heavy @gelatonetwork/relay-sdk dependency.

import { GELATO_API_KEY, isGelatoConfigured, isGelatoSupported } from '@/config/gelato';

const GELATO_RELAY_URL = 'https://api.gelato.digital';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RelayResult {
  taskId: string;
  txHash?: string;
}

export type GelatoTaskState =
  | 'CheckPending'
  | 'ExecPending'
  | 'WaitingForConfirmation'
  | 'ExecSuccess'
  | 'ExecReverted'
  | 'Cancelled';

interface GelatoTaskStatus {
  taskId: string;
  taskState: GelatoTaskState;
  transactionHash?: string;
  lastCheckMessage?: string;
}

interface GelatoSponsoredCallResponse {
  taskId: string;
}

interface GelatoTaskStatusResponse {
  task: GelatoTaskStatus;
}

// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * Submit a sponsored transaction via Gelato Relay.
 *
 * POST https://api.gelato.digital/relays/v2/sponsored-call
 * Body: { chainId, target, data, sponsorApiKey }
 */
export async function sponsoredRelay(
  chainId: number,
  target: string,
  data: string,
): Promise<RelayResult> {
  if (!isGelatoConfigured()) {
    throw new Error('Gelato API key not configured');
  }
  if (!isGelatoSupported(chainId)) {
    throw new Error(`Gelato relay not supported on chain ${chainId}`);
  }

  const response = await fetch(`${GELATO_RELAY_URL}/relays/v2/sponsored-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: Number(chainId),
      target,
      data,
      sponsorApiKey: GELATO_API_KEY,
    }),
  });

  if (response.status === 429) {
    throw new Error('Gelato rate limited — please retry after a short delay');
  }
  if (response.status === 402) {
    throw new Error('Gelato 1Balance credits exhausted — falling back to sponsor wallet');
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Gelato relay request failed (${response.status}): ${errorText}`);
  }

  const result: GelatoSponsoredCallResponse = await response.json();

  if (!result.taskId) {
    throw new Error('Gelato relay returned no taskId');
  }

  return { taskId: result.taskId };
}

/**
 * Poll for task completion with timeout.
 *
 * GET https://api.gelato.digital/tasks/status/{taskId}
 * Polls every 2 seconds, times out after 60 seconds by default.
 */
export async function waitForRelay(
  taskId: string,
  timeoutMs: number = 60_000,
): Promise<{ txHash: string; status: string }> {
  const pollIntervalMs = 2_000;
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${GELATO_RELAY_URL}/tasks/status/${taskId}`);

    if (response.ok) {
      const result: GelatoTaskStatusResponse = await response.json();
      const task = result.task;

      if (task) {
        const state = task.taskState;

        if (state === 'ExecSuccess') {
          return {
            txHash: task.transactionHash || '',
            status: 'ExecSuccess',
          };
        }

        if (state === 'ExecReverted' || state === 'Cancelled') {
          throw new Error(
            `Gelato task ${state}: ${task.lastCheckMessage || 'no details'}`,
          );
        }
      }
    }

    // Still pending or status unavailable -- wait and retry
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  throw new Error(`Gelato relay timeout after ${timeoutMs}ms — taskId: ${taskId} (check manually at https://api.gelato.digital/tasks/status/${taskId})`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if Gelato relay is available for a given chain.
 * Returns true only when the API key is set AND the chain is supported.
 */
export function canUseGelato(chainId: number): boolean {
  return isGelatoConfigured() && isGelatoSupported(chainId);
}
