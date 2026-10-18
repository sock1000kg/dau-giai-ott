import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Full-suite runs execute many jsdom files in parallel; the default 1000 ms
// findBy/waitFor budget is too tight under that load (intermittent timeouts).
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});
