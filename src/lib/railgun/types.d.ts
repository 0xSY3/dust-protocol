declare module 'abstract-leveldown' {
  export interface AbstractLevelDOWN {}
}

declare module 'level-js' {
  const LevelJS: new (name: string) => import('abstract-leveldown').AbstractLevelDOWN;
  export default LevelJS;
}

declare module 'snarkjs' {
  export const groth16: {
    fullProve: (...args: unknown[]) => Promise<{ proof: unknown; publicSignals: string[] }>;
    verify: (...args: unknown[]) => Promise<boolean>;
  };
}
