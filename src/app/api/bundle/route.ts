import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig } from '@/config/chains';
import { getServerProvider, getServerSponsor, parseChainId } from '@/lib/server-provider';
import { ENTRY_POINT_ABI, DUST_PAYMASTER_ABI } from '@/lib/stealth/types';

const NO_STORE = { 'Cache-Control': 'no-store' };

interface PartialUserOp {
  sender: string;
  nonce?: string;
  initCode: string;
  callData: string;
  callGasLimit?: string;
  verificationGasLimit?: string;
  preVerificationGas?: string;
}

/**
 * POST /api/bundle — Prepare a UserOperation
 *
 * Receives a partial UserOp (sender, initCode, callData) + chainId.
 * Fills gas fields, builds paymasterAndData with sponsor signature,
 * computes userOpHash, and returns the completed UserOp for client signing.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chainId = parseChainId(body);
    const config = getChainConfig(chainId);
    const { sender, initCode, callData } = body as PartialUserOp & { chainId?: number };

    if (!sender || !callData) {
      return NextResponse.json({ error: 'Missing sender or callData' }, { status: 400, headers: NO_STORE });
    }

    // Whitelist callData selectors to prevent arbitrary contract calls
    const DRAIN_SELECTOR = '0xece53132';   // drain(address)
    const EXECUTE_SELECTOR = '0xb61d27f6'; // execute(address,uint256,bytes)
    const selector = callData.slice(0, 10).toLowerCase();

    if (selector === EXECUTE_SELECTOR) {
      // For execute(), only allow calls targeting the DustPool contract (if available on this chain)
      const dustPool = config.contracts.dustPool;
      if (!dustPool) {
        return NextResponse.json({ error: 'DustPool not available on this chain' }, { status: 400, headers: NO_STORE });
      }
      try {
        const decoded = ethers.utils.defaultAbiCoder.decode(
          ['address', 'uint256', 'bytes'], '0x' + callData.slice(10)
        );
        if (decoded[0].toLowerCase() !== dustPool.toLowerCase()) {
          return NextResponse.json({ error: 'Execute target not allowed' }, { status: 400, headers: NO_STORE });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid execute calldata' }, { status: 400, headers: NO_STORE });
      }
    } else if (selector !== DRAIN_SELECTOR) {
      return NextResponse.json({ error: 'Unsupported operation' }, { status: 400, headers: NO_STORE });
    }

    const provider = getServerProvider(chainId);
    const sponsor = getServerSponsor(chainId);
    const entryPoint = new ethers.Contract(config.contracts.entryPoint, ENTRY_POINT_ABI, provider);

    // Get nonce from EntryPoint
    const nonce = body.nonce || (await entryPoint.getNonce(sender, 0)).toString();

    // Gas params — higher for pool deposits (Poseidon Merkle tree ~6.8M gas)
    const isPoolDeposit = selector === EXECUTE_SELECTOR;
    const callGasLimit = body.callGasLimit || (isPoolDeposit ? '8000000' : '200000');
    const verificationGasLimit = body.verificationGasLimit || (initCode && initCode !== '0x' ? '500000' : '200000');
    const preVerificationGas = body.preVerificationGas || '50000';

    // Fee estimation
    const block = await provider.getBlock('latest');
    const baseFee = block.baseFeePerGas || ethers.utils.parseUnits('1', 'gwei');
    const maxPriorityFeePerGas = ethers.utils.parseUnits('1.5', 'gwei');
    const maxFeePerGas = baseFee.mul(2).add(maxPriorityFeePerGas);

    // Build partial UserOp (without paymasterAndData and signature)
    const userOp = {
      sender,
      nonce,
      initCode: initCode || '0x',
      callData,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
      paymasterAndData: '0x',
      signature: '0x',
    };

    // Build paymaster signature
    const validUntil = Math.floor(Date.now() / 1000) + 600;
    const validAfter = Math.floor(Date.now() / 1000) - 60;

    const paymasterHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'address', 'uint48', 'uint48'],
      [
        sender, nonce,
        ethers.utils.keccak256(userOp.initCode),
        ethers.utils.keccak256(userOp.callData),
        callGasLimit, verificationGasLimit, preVerificationGas,
        maxFeePerGas.toString(), maxPriorityFeePerGas.toString(),
        config.id,
        config.contracts.paymaster,
        validUntil, validAfter,
      ]
    ));

    const sponsorSig = await sponsor.signMessage(ethers.utils.arrayify(paymasterHash));

    const timeRange = ethers.utils.defaultAbiCoder.encode(['uint48', 'uint48'], [validUntil, validAfter]);
    const paymasterAndData = ethers.utils.hexConcat([config.contracts.paymaster, timeRange, sponsorSig]);

    userOp.paymasterAndData = paymasterAndData;

    const userOpHash = await entryPoint.getUserOpHash(userOp);

    console.log(`[Bundle] Prepared UserOp on chain ${config.name}`);

    return NextResponse.json({ userOp, userOpHash }, { headers: NO_STORE });
  } catch (e) {
    console.error('[Bundle] Error:', e);
    return NextResponse.json({ error: 'Bundle preparation failed' }, { status: 500, headers: NO_STORE });
  }
}
