import { hash, verify } from '@node-rs/argon2';

import type { PasswordHasher } from './types.ts';

export interface PasswordHashPolicy {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism?: number;
}

const productionPasswordHashPolicy: PasswordHashPolicy = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function createPasswordHasher(policy: PasswordHashPolicy = productionPasswordHashPolicy): PasswordHasher {
  const options = {
    // Algorithm.Argon2id is the documented value 2. Avoid importing its ambient
    // const enum so TypeScript can emit this module without a transpiler rewrite.
    algorithm: 2 as never,
    memoryCost: policy.memoryCost,
    timeCost: policy.timeCost,
    parallelism: policy.parallelism ?? 1,
  } as const;

  return {
    hash: async (password) => hash(password, options),
    verify: async (passwordHash, password) => verify(passwordHash, password),
  };
}
