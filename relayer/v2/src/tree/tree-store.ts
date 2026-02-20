import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface LeafRow {
  leafIndex: number;
  commitment: string;
  chainId: number;
  blockNumber: number;
  txIndex: number;
  logIndex: number;
  amount: string;
  asset: string;
  timestamp: number;
  insertedAt: number;
}

export interface RootRow {
  rootIndex: number;
  root: string;
  publishedAt: number;
  txHash: string | null;
}

export interface NullifierRow {
  nullifier: string;
  spentAt: number;
  txHash: string | null;
}

export interface ScanCursorRow {
  chainId: number;
  lastBlock: number;
}

export class TreeStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leaves (
        leaf_index INTEGER PRIMARY KEY,
        commitment TEXT NOT NULL UNIQUE,
        chain_id INTEGER NOT NULL,
        block_number INTEGER NOT NULL,
        tx_index INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        amount TEXT NOT NULL,
        asset TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        inserted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS roots (
        root_index INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        published_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        tx_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS nullifiers (
        nullifier TEXT PRIMARY KEY,
        spent_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        tx_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS scan_cursors (
        chain_id INTEGER PRIMARY KEY,
        last_block INTEGER NOT NULL
      );
    `);
  }

  insertLeaf(leaf: Omit<LeafRow, 'insertedAt'>): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO leaves (leaf_index, commitment, chain_id, block_number, tx_index, log_index, amount, asset, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      leaf.leafIndex,
      leaf.commitment,
      leaf.chainId,
      leaf.blockNumber,
      leaf.txIndex,
      leaf.logIndex,
      leaf.amount,
      leaf.asset,
      leaf.timestamp,
    );
  }

  getLeafByCommitment(commitment: string): LeafRow | undefined {
    return this.db.prepare(`
      SELECT leaf_index as leafIndex, commitment, chain_id as chainId,
             block_number as blockNumber, tx_index as txIndex, log_index as logIndex,
             amount, asset, timestamp, inserted_at as insertedAt
      FROM leaves WHERE commitment = ?
    `).get(commitment) as LeafRow | undefined;
  }

  getLeafByIndex(leafIndex: number): LeafRow | undefined {
    return this.db.prepare(`
      SELECT leaf_index as leafIndex, commitment, chain_id as chainId,
             block_number as blockNumber, tx_index as txIndex, log_index as logIndex,
             amount, asset, timestamp, inserted_at as insertedAt
      FROM leaves WHERE leaf_index = ?
    `).get(leafIndex) as LeafRow | undefined;
  }

  getLeafCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM leaves').get() as { count: number };
    return row.count;
  }

  getAllLeaves(): LeafRow[] {
    return this.db.prepare(`
      SELECT leaf_index as leafIndex, commitment, chain_id as chainId,
             block_number as blockNumber, tx_index as txIndex, log_index as logIndex,
             amount, asset, timestamp, inserted_at as insertedAt
      FROM leaves ORDER BY leaf_index ASC
    `).all() as LeafRow[];
  }

  insertRoot(root: string, txHash: string | null): void {
    this.db.prepare(`
      INSERT INTO roots (root, tx_hash) VALUES (?, ?)
    `).run(root, txHash);
  }

  getLatestRoot(): RootRow | undefined {
    return this.db.prepare(`
      SELECT root_index as rootIndex, root, published_at as publishedAt, tx_hash as txHash
      FROM roots ORDER BY root_index DESC LIMIT 1
    `).get() as RootRow | undefined;
  }

  isKnownRoot(root: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM roots WHERE root = ? LIMIT 1').get(root);
    return !!row;
  }

  insertNullifier(nullifier: string, txHash: string | null): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO nullifiers (nullifier, tx_hash) VALUES (?, ?)
    `).run(nullifier, txHash);
  }

  isNullifierSpent(nullifier: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM nullifiers WHERE nullifier = ? LIMIT 1').get(nullifier);
    return !!row;
  }

  deleteNullifier(nullifier: string): void {
    this.db.prepare('DELETE FROM nullifiers WHERE nullifier = ?').run(nullifier);
  }

  getScanCursor(chainId: number): number {
    const row = this.db.prepare(
      'SELECT last_block as lastBlock FROM scan_cursors WHERE chain_id = ?'
    ).get(chainId) as ScanCursorRow | undefined;
    return row?.lastBlock ?? 0;
  }

  setScanCursor(chainId: number, lastBlock: number): void {
    this.db.prepare(`
      INSERT INTO scan_cursors (chain_id, last_block) VALUES (?, ?)
      ON CONFLICT(chain_id) DO UPDATE SET last_block = ?
    `).run(chainId, lastBlock, lastBlock);
  }

  close(): void {
    this.db.close();
  }
}
