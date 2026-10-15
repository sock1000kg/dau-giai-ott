import { verifyReplayResponse } from './verify-replay.ts';
import { SpectatorReplayError, type SpectatorReplayV1 } from './replay-schema.ts';

export { SpectatorReplayError } from './replay-schema.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function fetchPublicReplay(matchId: string): Promise<SpectatorReplayV1> {
  if (!uuidPattern.test(matchId)) throw new Error('Invalid replay match ID');
  let response: Response;
  try {
    response = await fetch(`/api/v1/public/replays/${encodeURIComponent(matchId)}`, { credentials: 'omit' });
  } catch {
    throw new SpectatorReplayError('REPLAY_UNAVAILABLE');
  }
  return verifyReplayResponse(response);
}

export async function fetchPrivateReplay(matchId: string): Promise<SpectatorReplayV1> {
  if (!uuidPattern.test(matchId)) throw new Error('Invalid replay match ID');
  let response: Response;
  try {
    response = await fetch(`/api/v1/replays/${encodeURIComponent(matchId)}`, { credentials: 'include' });
  } catch {
    throw new SpectatorReplayError('REPLAY_UNAVAILABLE');
  }
  return verifyReplayResponse(response);
}
