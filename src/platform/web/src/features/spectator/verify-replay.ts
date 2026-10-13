import {
  isReplaySchemaError,
  parseSpectatorReplay,
  SpectatorReplayError,
  type SpectatorReplayV1,
} from './replay-schema.ts';

const mediaType = 'application/vnd.ott.spectator-replay+json;version=1';
const checksumPattern = /^sha256:[0-9a-f]{64}$/;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  try {
    const digest = await crypto.subtle.digest('SHA-256', digestInput);
    const hex = Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  } catch {
    throw new SpectatorReplayError('REPLAY_UNAVAILABLE');
  }
}

export async function verifyReplayResponse(response: Response): Promise<SpectatorReplayV1> {
  if (response.status === 404) throw new SpectatorReplayError('REPLAY_NOT_FOUND');
  if (!response.ok) throw new SpectatorReplayError('REPLAY_UNAVAILABLE');

  const responseType = response.headers.get('content-type')?.split(',')[0]?.trim().toLowerCase();
  if (responseType !== mediaType) throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');

  const expectedChecksum = response.headers.get('x-replay-sha256');
  if (expectedChecksum === null || !checksumPattern.test(expectedChecksum)) throw new SpectatorReplayError('CHECKSUM_MISMATCH');

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new SpectatorReplayError('INVALID_REPLAY');
  }
  if (await sha256(bytes) !== expectedChecksum) throw new SpectatorReplayError('CHECKSUM_MISMATCH');

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new SpectatorReplayError('INVALID_REPLAY');
  }

  try {
    return parseSpectatorReplay(parsed);
  } catch (error) {
    if (error instanceof SpectatorReplayError) throw error;
    if (isReplaySchemaError(error)) throw new SpectatorReplayError('INVALID_REPLAY');
    throw new SpectatorReplayError('INVALID_REPLAY');
  }
}
