import { Router, type Request, type Response } from 'express';
import { ethers } from 'ethers';
import { TreeStore } from '../../tree/tree-store';
import { GlobalTree } from '../../tree/global-tree';
import { relayTransfer, type TransferRequest } from '../../relay/proof-relay';
import { chainConfigs } from '../../config/chains';

// Frontend sends { proof, publicSignals, targetChainId }
// publicSignals[0..7] = [merkleRoot, nullifier0, nullifier1, outCommitment0, outCommitment1, publicAmount, publicAsset, recipient]
interface TransferBody {
  proof: string;
  publicSignals: string[];
  targetChainId: number;
}

function toBytes32(value: string): string {
  const bn = ethers.BigNumber.from(value);
  return ethers.utils.hexZeroPad(bn.toHexString(), 32);
}

export function createTransferRouter(store: TreeStore, tree: GlobalTree): Router {
  const router = Router();

  router.post('/', async (req: Request<unknown, unknown, TransferBody>, res: Response) => {
    try {
      const { proof, publicSignals, targetChainId } = req.body;

      if (!proof || !publicSignals || !targetChainId) {
        res.status(400).json({ error: 'Missing required fields: proof, publicSignals, targetChainId' });
        return;
      }

      if (!Array.isArray(publicSignals) || publicSignals.length !== 8) {
        res.status(400).json({ error: 'publicSignals must be an array of 8 elements' });
        return;
      }

      const chain = chainConfigs.find((c) => c.chainId === targetChainId);
      if (!chain) {
        res.status(400).json({ error: `Unsupported chain: ${targetChainId}` });
        return;
      }

      const [merkleRoot, nullifier0, nullifier1, outCommitment0, outCommitment1, publicAmount, publicAsset, recipient] = publicSignals;

      // Transfers must have publicAmount == 0 (no value enters/leaves pool)
      if (publicAmount !== '0') {
        res.status(400).json({ error: 'Transfer publicAmount must be 0' });
        return;
      }

      const request: TransferRequest = {
        proof,
        merkleRoot: toBytes32(merkleRoot),
        nullifier0: toBytes32(nullifier0),
        nullifier1: toBytes32(nullifier1),
        outCommitment0: toBytes32(outCommitment0),
        outCommitment1: toBytes32(outCommitment1),
        publicAmount: publicAmount.toString(),
        publicAsset: publicAsset.toString(),
        recipient: recipient.toString(),
        chainId: targetChainId,
      };

      await relayTransfer(request, store, tree);

      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[POST /transfer] Error: ${msg}`);

      if (msg.includes('Unknown Merkle root') || msg.includes('Nullifier') || msg.includes('Invalid') || msg.includes('publicAmount')) {
        res.status(400).json({ error: msg });
        return;
      }

      res.status(500).json({ error: 'Transfer failed' });
    }
  });

  return router;
}
