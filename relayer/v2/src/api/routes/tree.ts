import { Router, type Request, type Response } from 'express';
import { GlobalTree } from '../../tree/global-tree';
import { TreeStore } from '../../tree/tree-store';

export function createTreeRouter(tree: GlobalTree, store: TreeStore): Router {
  const router = Router();

  router.get('/root', (_req: Request, res: Response) => {
    try {
      const root = tree.getRoot();
      res.json({
        root: '0x' + root.toString(16).padStart(64, '0'),
        leafCount: tree.leafCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[GET /tree/root] Error:', msg);
      res.status(500).json({ error: 'Failed to get tree root' });
    }
  });

  router.get('/proof/:leafIndex', (req: Request<{ leafIndex: string }>, res: Response) => {
    try {
      const leafIndex = parseInt(req.params.leafIndex, 10);
      if (isNaN(leafIndex) || leafIndex < 0) {
        res.status(400).json({ error: 'Invalid leaf index' });
        return;
      }

      if (leafIndex >= tree.leafCount) {
        res.status(404).json({ error: `Leaf index ${leafIndex} not found (tree has ${tree.leafCount} leaves)` });
        return;
      }

      const proof = tree.getProof(leafIndex);
      res.json({
        pathElements: proof.pathElements.map((e) => '0x' + e.toString(16).padStart(64, '0')),
        pathIndices: proof.pathIndices,
        root: '0x' + proof.root.toString(16).padStart(64, '0'),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[GET /tree/proof] Error: ${msg}`);
      res.status(500).json({ error: 'Failed to generate Merkle proof' });
    }
  });

  return router;
}
