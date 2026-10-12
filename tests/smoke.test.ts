import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from '@ott/bot-protocol';
import { createGame } from '@ott/game-core';
import { runMatch } from '@ott/match-runner';
import * as platformWeb from '@ott/platform-web';

describe('Phase 1 workspace', () => {
  it('resolves every public TypeScript package without import side effects', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(createGame).toBeTypeOf('function');
    expect(runMatch).toBeTypeOf('function');
    expect(platformWeb).toBeTypeOf('object');
  });
});
