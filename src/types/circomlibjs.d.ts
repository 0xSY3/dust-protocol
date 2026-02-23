declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<PoseidonFunction>;
  interface PoseidonFunction {
    (inputs: bigint[]): Uint8Array;
    F: {
      toObject(val: Uint8Array): bigint;
    };
  }

  export function newMemEmptyTrie(): Promise<SMTInstance>;
  interface SMTInstance {
    root: unknown;
    F: {
      toObject(v: unknown): bigint;
      e(v: bigint | number | string): unknown;
      zero: unknown;
      isZero(v: unknown): boolean;
    };
    insert(key: unknown, value: unknown): Promise<{ newRoot: unknown }>;
    delete(key: unknown): Promise<{ newRoot: unknown }>;
    find(key: unknown): Promise<SMTFindResult>;
  }
  interface SMTFindResult {
    found: boolean;
    siblings: unknown[];
    foundValue?: unknown;
    notFoundKey?: unknown;
    notFoundValue?: unknown;
    isOld0?: boolean;
  }
}
