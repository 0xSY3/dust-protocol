declare module 'circomlibjs' {
  interface PoseidonFunction {
    (inputs: bigint[]): Uint8Array;
    F: {
      toObject(hash: Uint8Array): bigint;
    };
  }
  export function buildPoseidon(): Promise<PoseidonFunction>;
}
