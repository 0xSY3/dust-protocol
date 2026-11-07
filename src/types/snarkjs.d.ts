declare module 'snarkjs' {
  export namespace groth16 {
    function fullProve(
      input: Record<string, string | string[]>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{
      proof: {
        pi_a: string[];
        pi_b: string[][];
        pi_c: string[];
        protocol: string;
        curve: string;
      };
      publicSignals: string[];
    }>;

    function verify(
      vkey: unknown,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;
  }

  export namespace fflonk {
    function fullProve(
      input: Record<string, string | string[] | string[][]>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{
      proof: FflonkProof;
      publicSignals: string[];
    }>;

    function verify(
      vkey: unknown,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;

    /** Returns formatted calldata: `"0x<proof_hex>", ["sig0", "sig1", ...]` */
    function exportSolidityCallData(
      publicSignals: string[],
      proof: unknown,
    ): Promise<string>;
  }

  export namespace wtns {
    /** Rejects with "Assert Failed. Error in template <name> line: <n>" when an input breaks a constraint. */
    function calculate(
      input: Record<string, string | string[] | string[][]>,
      wasmFile: string,
      wtnsFile: string | { type: 'mem' },
    ): Promise<void>;
  }

  interface FflonkProof {
    polynomials: {
      C1: string[];
      C2: string[];
      W1: string[];
      W2: string[];
    };
    evaluations: {
      ql: string;
      qr: string;
      qm: string;
      qo: string;
      qc: string;
      s1: string;
      s2: string;
      s3: string;
      a: string;
      b: string;
      c: string;
      z: string;
      zw: string;
      t1w: string;
      t2w: string;
      inv: string;
    };
    protocol: string;
    curve: string;
  }
}
