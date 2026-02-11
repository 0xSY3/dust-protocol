declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<PoseidonFunction>;
  interface PoseidonFunction {
    (inputs: bigint[]): Uint8Array;
    F: {
      toObject(val: Uint8Array): bigint;
    };
  }
}
