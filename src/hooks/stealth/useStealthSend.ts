import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import {
  generateStealthAddress, parseStealthMetaAddress, lookupStealthMetaAddress,
  CANONICAL_ADDRESSES, SCHEME_ID, type GeneratedStealthAddress,
} from '@/lib/stealth';

const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external',
];

// Direct RPC for reliable gas estimation
const THANOS_RPC = 'https://rpc.thanos-sepolia.tokamak.network';

function getProvider() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return new ethers.providers.Web3Provider(window.ethereum as ethers.providers.ExternalProvider);
}

function getThanosProvider() {
  return new ethers.providers.JsonRpcProvider(THANOS_RPC);
}

// Estimate gas cost for ETH transfer only (21k gas)
async function estimateEthTransferGasCost(provider: ethers.providers.Provider): Promise<ethers.BigNumber> {
  const feeData = await provider.getFeeData();
  const block = await provider.getBlock('latest');

  const baseFee = block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
  const priorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');

  // maxFeePerGas = max(2x baseFee, 1.2x (baseFee + priorityFee))
  const twoXBaseFee = baseFee.mul(2);
  const basePlusPriority = baseFee.add(priorityFee).mul(12).div(10);
  const maxFeePerGas = twoXBaseFee.gt(basePlusPriority) ? twoXBaseFee : basePlusPriority;

  // Gas for ETH transfer only + 5% buffer for RPC timing differences
  const gasLimit = ethers.BigNumber.from(21000);
  const baseCost = gasLimit.mul(maxFeePerGas);
  const buffer = baseCost.mul(5).div(100);
  return baseCost.add(buffer);
}

// Sponsor the announcement via deployer API (sender doesn't pay gas for this)
async function sponsorAnnounce(
  stealthAddress: string,
  ephemeralPubKey: string,
  metadata: string,
): Promise<string> {
  const res = await fetch('/api/sponsor-announce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stealthAddress, ephemeralPubKey, metadata }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Sponsored announcement failed');
  return data.txHash;
}

// Calculate maximum sendable amount (balance - gas for ETH transfer only; announcement is sponsored)
async function calculateMaxSendable(
  provider: ethers.providers.Provider,
  address: string
): Promise<{ maxAmount: ethers.BigNumber; gasCost: ethers.BigNumber; balance: ethers.BigNumber }> {
  const balance = await provider.getBalance(address);
  // Only need gas for ETH transfer — announcement is sponsored by deployer
  const gasCost = await estimateEthTransferGasCost(provider);
  const maxAmount = balance.sub(gasCost);
  return { maxAmount: maxAmount.gt(0) ? maxAmount : ethers.BigNumber.from(0), gasCost, balance };
}

// Validate amount against balance and gas
function validateSendAmount(
  amount: string,
  balance: ethers.BigNumber,
  gasCost: ethers.BigNumber
): { valid: boolean; error?: string } {
  if (!amount || amount.trim() === '') {
    return { valid: false, error: 'Amount is required' };
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return { valid: false, error: 'Invalid amount' };
  }

  // Check decimals
  const parts = amount.split('.');
  if (parts[1] && parts[1].length > 18) {
    return { valid: false, error: 'Too many decimal places (max 18)' };
  }

  try {
    const amountWei = ethers.utils.parseEther(amount);
    const totalNeeded = amountWei.add(gasCost);

    if (balance.lt(totalNeeded)) {
      const maxSendable = balance.sub(gasCost);
      if (maxSendable.lte(0)) {
        return { valid: false, error: `Insufficient balance for gas (~${ethers.utils.formatEther(gasCost)} TON needed)` };
      }
      return {
        valid: false,
        error: `Insufficient balance. Max sendable: ${parseFloat(ethers.utils.formatEther(maxSendable)).toFixed(6)} TON`
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid amount format' };
  }
}


export function useStealthSend() {
  const { isConnected } = useAccount();
  const [lastGeneratedAddress, setLastGeneratedAddress] = useState<GeneratedStealthAddress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateAddressFor = useCallback((metaAddress: string): GeneratedStealthAddress | null => {
    setError(null);
    try {
      const parsed = parseStealthMetaAddress(metaAddress);
      const generated = generateStealthAddress(parsed);
      setLastGeneratedAddress(generated);
      return generated;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate address');
      return null;
    }
  }, []);

  const generateAddressForAddress = useCallback(async (recipientAddress: string): Promise<GeneratedStealthAddress | null> => {
    setError(null);
    setIsLoading(true);
    try {
      const provider = getProvider();
      if (!provider) throw new Error('No wallet provider');

      const metaBytes = await lookupStealthMetaAddress(provider, recipientAddress);
      if (!metaBytes) throw new Error('Recipient has no registered stealth address');

      const uri = `st:thanos:0x${metaBytes.replace(/^0x/, '')}`;
      const parsed = parseStealthMetaAddress(uri);
      const generated = generateStealthAddress(parsed);
      setLastGeneratedAddress(generated);
      return generated;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate address');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Get maximum sendable amount (exposed for UI "Max" button)
  const getMaxSendable = useCallback(async (): Promise<string | null> => {
    try {
      const provider = getProvider();
      if (!provider) return null;

      const signer = provider.getSigner();
      const address = await signer.getAddress();

      // Use direct RPC for accurate gas estimation
      const thanosProvider = getThanosProvider();
      const { maxAmount } = await calculateMaxSendable(thanosProvider, address);

      if (maxAmount.lte(0)) return '0';
      return ethers.utils.formatEther(maxAmount);
    } catch {
      return null;
    }
  }, []);

  const sendEthToStealth = useCallback(async (metaAddress: string, amount: string, linkSlug?: string): Promise<string | null> => {
    if (!isConnected) { setError('Wallet not connected'); return null; }
    setError(null);
    setIsLoading(true);

    try {
      const provider = getProvider();
      if (!provider) throw new Error('No wallet provider');
      const signer = provider.getSigner();
      const signerAddress = await signer.getAddress();

      // Use direct RPC for reliable balance/gas data
      const thanosProvider = getThanosProvider();

      // Validate balance and gas BEFORE generating address
      const { balance, gasCost } = await calculateMaxSendable(thanosProvider, signerAddress);
      const validation = validateSendAmount(amount, balance, gasCost);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Generate stealth address
      const generated = generateAddressFor(metaAddress);
      if (!generated) throw new Error('Failed to generate stealth address');

      // Send ETH with explicit gas parameters
      const feeData = await thanosProvider.getFeeData();
      const block = await thanosProvider.getBlock('latest');
      const baseFee = block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
      const priorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1', 'gwei');
      const twoXBaseFee = baseFee.mul(2);
      const basePlusPriority = baseFee.add(priorityFee).mul(12).div(10);
      const maxFeePerGas = twoXBaseFee.gt(basePlusPriority) ? twoXBaseFee : basePlusPriority;

      const tx = await signer.sendTransaction({
        to: generated.stealthAddress,
        value: ethers.utils.parseEther(amount),
        gasLimit: 21000,
        maxFeePerGas,
        maxPriorityFeePerGas: priorityFee,
        type: 2,
      });
      const receipt = await tx.wait();
      const sendTxHash = receipt.transactionHash;

      // Announce via sponsored API (deployer pays gas, not sender)
      try {
        const ephPubKey = '0x' + generated.ephemeralPublicKey.replace(/^0x/, '');
        let metadata = '0x' + generated.viewTag;
        if (linkSlug) {
          const slugBytes = new TextEncoder().encode(linkSlug);
          const slugHex = Array.from(slugBytes).map(b => b.toString(16).padStart(2, '0')).join('');
          metadata += slugHex;
        }
        await sponsorAnnounce(generated.stealthAddress, ephPubKey, metadata);
      } catch (announceErr) {
        console.warn('Sponsored announcement failed but ETH sent:', announceErr);
        setError(`Sent successfully but announcement failed. Recipient may need to scan manually.`);
      }

      return sendTxHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send';
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, generateAddressFor]);

  const sendTokenToStealth = useCallback(async (metaAddress: string, tokenAddress: string, amount: string): Promise<string | null> => {
    if (!isConnected) { setError('Wallet not connected'); return null; }
    setError(null);
    setIsLoading(true);

    try {
      const provider = getProvider();
      if (!provider) throw new Error('No wallet provider');
      const signer = provider.getSigner();
      const signerAddress = await signer.getAddress();

      // Check ETH balance for gas (only token transfer gas; announcement is sponsored)
      const thanosProvider = getThanosProvider();
      const ethBalance = await thanosProvider.getBalance(signerAddress);
      const gasCost = await estimateEthTransferGasCost(thanosProvider);

      if (ethBalance.lt(gasCost)) {
        throw new Error(`Insufficient ETH for gas. Need ~${ethers.utils.formatEther(gasCost)} TON`);
      }

      const erc20 = new ethers.Contract(tokenAddress, [
        'function transfer(address to, uint256 amount) returns (bool)',
        'function decimals() view returns (uint8)',
        'function balanceOf(address) view returns (uint256)',
      ], signer);

      // Check token balance
      const decimals = await erc20.decimals();
      const amountWei = ethers.utils.parseUnits(amount, decimals);
      const tokenBalance = await erc20.balanceOf(signerAddress);

      if (tokenBalance.lt(amountWei)) {
        throw new Error(`Insufficient token balance. Have ${ethers.utils.formatUnits(tokenBalance, decimals)}, need ${amount}`);
      }

      const generated = generateAddressFor(metaAddress);
      if (!generated) throw new Error('Failed to generate stealth address');

      const tx = await erc20.transfer(generated.stealthAddress, amountWei);
      const receipt = await tx.wait();
      const sendTxHash = receipt.transactionHash;

      // Announce via sponsored API (deployer pays gas)
      try {
        const ephPubKey = '0x' + generated.ephemeralPublicKey.replace(/^0x/, '');
        const metadata = '0x' + generated.viewTag;
        await sponsorAnnounce(generated.stealthAddress, ephPubKey, metadata);
      } catch (announceErr) {
        console.warn('Sponsored announcement failed but token sent:', announceErr);
        setError(`Sent successfully but announcement failed. Recipient may need to scan manually.`);
      }

      return sendTxHash;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send token');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, generateAddressFor]);

  const announcePayment = useCallback(async (stealthAddress: string, ephemeralPublicKey: string, viewTag: string): Promise<string | null> => {
    if (!isConnected) { setError('Wallet not connected'); return null; }
    setError(null);
    setIsLoading(true);

    try {
      const provider = getProvider();
      if (!provider) throw new Error('No wallet provider');
      const signer = provider.getSigner();

      const announcer = new ethers.Contract(CANONICAL_ADDRESSES.announcer, ANNOUNCER_ABI, signer);
      const tx = await announcer.announce(SCHEME_ID.SECP256K1, stealthAddress, '0x' + ephemeralPublicKey.replace(/^0x/, ''), '0x' + viewTag);
      const receipt = await tx.wait();
      return receipt.transactionHash;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to announce');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isConnected]);

  return {
    generateAddressFor,
    generateAddressForAddress,
    sendEthToStealth,
    sendTokenToStealth,
    announcePayment,
    getMaxSendable,
    lastGeneratedAddress,
    isLoading,
    error
  };
}
