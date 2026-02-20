import { Router, type Request, type Response } from 'express';
import { TreeStore } from '../../tree/tree-store';

export function createDepositRouter(store: TreeStore): Router {
  const router = Router();

  router.get('/status/:commitment', (req: Request<{ commitment: string }>, res: Response) => {
    try {
      const { commitment } = req.params;

      if (!commitment || !commitment.startsWith('0x') || commitment.length !== 66) {
        res.status(400).json({ error: 'Invalid commitment format (expected 0x-prefixed bytes32)' });
        return;
      }

      const leaf = store.getLeafByCommitment(commitment);
      if (!leaf) {
        res.json({ confirmed: false, leafIndex: -1 });
        return;
      }

      res.json({
        confirmed: true,
        leafIndex: leaf.leafIndex,
        chainId: leaf.chainId,
        amount: leaf.amount,
        asset: leaf.asset,
        timestamp: leaf.timestamp,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[GET /deposit/status] Error: ${msg}`);
      res.status(500).json({ error: 'Failed to check deposit status' });
    }
  });

  return router;
}
