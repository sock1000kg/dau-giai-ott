import { startServer } from './runtime/server.ts';

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal error during startup: ${message}\n`);
  process.exit(1);
});
