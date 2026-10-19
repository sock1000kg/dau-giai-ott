import { startCoordinator } from './coordinator/server.ts';

startCoordinator().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal error during coordinator startup: ${message}\n`);
  process.exit(1);
});
