import {
  isReplaySchemaError,
  parseSpectatorReplay,
  SpectatorReplayError,
  type SpectatorReplay,
} from './replay-schema.ts';

const mediaType = 'application/vnd.ott.spectator-replay+json';
const checksumPattern = /^sha256:[0-9a-f]{64}$/;

function parseMediaTypeVersion(value: string | null): number | null {
  if (value === null) return null;
  const [type, ...parameters] = value.split(';');
  if (type?.trim().toLowerCase() !== mediaType) return null;
  const versions = parameters.flatMap((parameter) => {
    const separator = parameter.indexOf('=');
    if (separator < 0 || parameter.slice(0, separator).trim().toLowerCase() !== 'version') return [];
    const raw = parameter.slice(separator + 1).trim();
    return [raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw];
  });
  if (versions.length !== 1) return null;
  if (versions[0] === '1') return 1;
  if (versions[0] === '2') return 2;
  return null;
}

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

export async function verifyReplayResponse(response: Response): Promise<SpectatorReplay> {
  if (response.status === 401) throw new SpectatorReplayError('UNAUTHENTICATED');
  if (response.status === 404) throw new SpectatorReplayError('REPLAY_NOT_FOUND');
  if (!response.ok) throw new SpectatorReplayError('REPLAY_UNAVAILABLE');

  const mediaTypeVersion = parseMediaTypeVersion(response.headers.get('content-type'));
  if (mediaTypeVersion === null) throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');

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

  if (typeof parsed !== 'object' || parsed === null || (parsed as Record<string, unknown>).schemaVersion !== mediaTypeVersion) {
    throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  }

  try {
    return parseSpectatorReplay(parsed);
  } catch (error) {
    if (error instanceof SpectatorReplayError) throw error;
    if (isReplaySchemaError(error)) throw new SpectatorReplayError('INVALID_REPLAY');
    throw new SpectatorReplayError('INVALID_REPLAY');
  }
}
