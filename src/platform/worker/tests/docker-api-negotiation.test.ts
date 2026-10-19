import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DockerOciRuntime } from '../src/sandbox/oci-runtime.ts';

interface MockDockerServer {
  readonly socketPath: string;
  readonly recordedPaths: readonly string[];
  readonly versionHits: number;
  readonly setVersionResponse: (apiVersion: unknown, minApiVersion?: unknown, status?: number) => void;
  readonly close: () => Promise<void>;
}

async function createMockDockerServer(): Promise<MockDockerServer> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'ott-docker-api-'));
  const socketPath = join(tmpDir, 'docker.sock');
  const recordedPaths: string[] = [];
  const activeSockets = new Set<import('node:stream').Duplex>();
  let versionHits = 0;
  let versionStatus = 200;
  let currentApiVersion: unknown = '1.41';
  let currentMinApiVersion: unknown = '1.12';

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    recordedPaths.push(url);

    if (url === '/version' || url.endsWith('/version')) {
      if (url === '/version') {
        versionHits++;
      }
      if (versionStatus !== 200) {
        res.writeHead(versionStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Internal Server Error' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ApiVersion: currentApiVersion,
          MinAPIVersion: currentMinApiVersion,
          Version: 'mock-engine-1.0',
        }),
      );
      return;
    }

    if (url.includes('/info')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          OperatingSystem: 'Linux',
          Architecture: 'x86_64',
          KernelVersion: '6.6.0',
          NCPU: 4,
          MemTotal: 8 * 1024 * 1024 * 1024,
          CgroupVersion: '2',
        }),
      );
      return;
    }

    if (url.includes('/containers/create')) {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Id: 'mock-container-id-123' }));
      return;
    }

    if (url.includes('/start')) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.includes('/kill')) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.includes('/json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Id: 'mock-container-id-123', Version: 'mock-engine-1.0' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  });

  server.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
  });

  server.on('upgrade', (req, socket) => {
    const url = req.url ?? '';
    recordedPaths.push(url);
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, () => resolve());
    server.once('error', reject);
  });

  return {
    socketPath,
    get recordedPaths() {
      return recordedPaths;
    },
    get versionHits() {
      return versionHits;
    },
    setVersionResponse: (apiVersion, minApiVersion, status = 200) => {
      currentApiVersion = apiVersion;
      currentMinApiVersion = minApiVersion;
      versionStatus = status;
    },
    close: async () => {
      for (const socket of activeSockets) {
        socket.destroy();
      }
      activeSockets.clear();
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

describe('Docker API Version Negotiation', () => {
  let server: MockDockerServer;

  beforeEach(async () => {
    server = await createMockDockerServer();
  });

  afterEach(async () => {
    await server?.close();
  });

  it('negotiates /v1.41 prefix when server reports {1.41, 1.12}', async () => {
    server.setVersionResponse('1.41', '1.12');
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath });
    const info = await runtime.benchmarkHostInfo();

    expect(info.apiVersion).toBe('1.41');
    expect(server.recordedPaths).toContain('/version');
    expect(server.recordedPaths).toContain('/v1.41/version');
    expect(server.recordedPaths).toContain('/v1.41/info');
  });

  it('negotiates /v1.44 prefix when server reports {1.52, 1.44} (Docker Engine 29)', async () => {
    server.setVersionResponse('1.52', '1.44');
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath });
    const info = await runtime.benchmarkHostInfo();

    expect(info.apiVersion).toBe('1.52');
    expect(server.recordedPaths).toContain('/version');
    expect(server.recordedPaths).toContain('/v1.44/version');
    expect(server.recordedPaths).toContain('/v1.44/info');
  });

  it('negotiates /v1.41 prefix when server reports {1.43, 1.24}', async () => {
    server.setVersionResponse('1.43', '1.24');
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath });
    const info = await runtime.benchmarkHostInfo();

    expect(info.apiVersion).toBe('1.43');
    expect(server.recordedPaths).toContain('/version');
    expect(server.recordedPaths).toContain('/v1.41/version');
    expect(server.recordedPaths).toContain('/v1.41/info');
  });

  it('caps at 1.40 when server reports {1.40, 1.12} (older than our floor)', async () => {
    server.setVersionResponse('1.40', '1.12');
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath });
    const info = await runtime.benchmarkHostInfo();

    expect(info.apiVersion).toBe('1.40');
    expect(server.recordedPaths).toContain('/version');
    expect(server.recordedPaths).toContain('/v1.40/version');
    expect(server.recordedPaths).toContain('/v1.40/info');
  });

  it('throws DOCKER_API_VERSION_UNSUPPORTED on malformed server version response', async () => {
    server.setVersionResponse('not-a-version', '1.12');
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath });
    await expect(runtime.benchmarkHostInfo()).rejects.toThrow('DOCKER_API_VERSION_UNSUPPORTED');
  });

  it('throws DOCKER_API_VERSION_UNSUPPORTED on invalid constructor apiVersion override', () => {
    expect(() => new DockerOciRuntime({ socketPath: server.socketPath, apiVersion: 'invalid-ver' })).toThrow(
      'DOCKER_API_VERSION_UNSUPPORTED',
    );
  });

  it('negotiates once across multiple concurrent calls (single /version hit)', async () => {
    server.setVersionResponse('1.45', '1.40');
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath });

    await Promise.all([
      runtime.benchmarkHostInfo(),
      runtime.benchmarkHostInfo(),
      runtime.benchmarkHostInfo(),
      runtime.kill('mock-container-id-123'),
    ]);

    expect(server.versionHits).toBe(1);
    expect(server.recordedPaths).toContain('/v1.41/containers/mock-container-id-123/kill?signal=KILL');
  });

  it('does not cache failed negotiation (retries on next call after 500)', async () => {
    server.setVersionResponse('1.41', '1.12', 500);
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath });

    await expect(runtime.benchmarkHostInfo()).rejects.toThrow();
    expect(server.versionHits).toBe(1);

    server.setVersionResponse('1.41', '1.12', 200);
    const info = await runtime.benchmarkHostInfo();
    expect(info.apiVersion).toBe('1.41');
    expect(server.versionHits).toBe(2);
  });

  it('skips /version negotiation when explicit apiVersion override is provided', async () => {
    server.setVersionResponse('1.52', '1.44');
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath, apiVersion: '1.45' });
    const info = await runtime.benchmarkHostInfo();

    expect(server.versionHits).toBe(0);
    expect(server.recordedPaths).toContain('/v1.45/version');
    expect(server.recordedPaths).toContain('/v1.45/info');
  });

  it('uses the negotiated API prefix for the attach upgrade request path', async () => {
    server.setVersionResponse('1.52', '1.44');
    const runtime = new DockerOciRuntime({ socketPath: server.socketPath });
    const running = await runtime.createAndStart('mock-img', ['node'], 'mock-bot');

    expect(server.recordedPaths).toContain('/v1.44/containers/create?name=mock-bot');
    expect(
      server.recordedPaths.some((p) =>
        p.startsWith('/v1.44/containers/mock-container-id-123/attach?stream=1&stdin=1&stdout=1&stderr=1'),
      ),
    ).toBe(true);
    expect(server.recordedPaths).toContain('/v1.44/containers/mock-container-id-123/start');

    running.stream.destroy();
  });
});
