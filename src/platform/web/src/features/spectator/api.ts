import { verifyReplayResponse } from './verify-replay.ts';
import { SpectatorReplayError, type SpectatorReplay } from './replay-schema.ts';

export { SpectatorReplayError } from './replay-schema.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Importer rule (importer.ts readText): 1..128 chars; additionally no `/`, `?`, `#`, whitespace or control characters so the id is a safe URL path segment. */
export const BUNDLE_ID_PATTERN = /^[^/?#\s\p{Cc}]{1,128}$/u;

export async function fetchPublicReplay(matchId: string, bundleId?: string | null): Promise<SpectatorReplay> {
  if (!uuidPattern.test(matchId)) throw new Error('Invalid replay match ID');
  let response: Response;
  const useBundle = typeof bundleId === 'string' && BUNDLE_ID_PATTERN.test(bundleId);
  const endpoint = useBundle
    ? `/api/v1/public/result-bundles/${encodeURIComponent(bundleId!)}/replays/${encodeURIComponent(matchId)}`
    : `/api/v1/public/replays/${encodeURIComponent(matchId)}`;
  try {
    response = await fetch(endpoint, { credentials: 'omit' });
  } catch {
    throw new SpectatorReplayError('REPLAY_UNAVAILABLE');
  }
  return verifyReplayResponse(response);
}

export async function fetchPrivateReplay(matchId: string): Promise<SpectatorReplay> {
  if (!uuidPattern.test(matchId)) throw new Error('Invalid replay match ID');
  let response: Response;
  try {
    response = await fetch(`/api/v1/replays/${encodeURIComponent(matchId)}`, { credentials: 'include' });
  } catch {
    throw new SpectatorReplayError('REPLAY_UNAVAILABLE');
  }
  return verifyReplayResponse(response);
}
