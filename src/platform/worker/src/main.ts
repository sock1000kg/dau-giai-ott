import { startWorker } from './runtime/server.ts';

startWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal error during worker startup: ${message}\n`);
  process.exit(1);
});
