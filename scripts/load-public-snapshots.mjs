import { Agent, createServer, get } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const directory = process.argv[2];
const clients = Number(process.argv[3] ?? 1000);
if (!directory || !Number.isInteger(clients) || clients < 1 || clients > 10000) {
  throw new Error('Usage: node scripts/load-public-snapshots.mjs DIRECTORY [CLIENTS=1000]');
}
const root = resolve(directory);
let requests = 0;
const paths = new Set();
const server = createServer(async (request, response) => {
  requests++; paths.add(request.url);
  const name = request.url?.slice('/snapshots/'.length);
  if (!request.url?.startsWith('/snapshots/') || !/^(latest|snapshot-[a-f0-9]{64})\.json$/.test(name ?? '')) {
    response.writeHead(404).end(); return;
  }
  try {
    const body = await readFile(join(root, name));
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', name === 'latest.json' ? 'no-cache' : 'public, max-age=31536000, immutable');
    response.end(body);
  } catch { response.writeHead(503).end(); }
});
await new Promise((done) => server.listen({ port: 0, host: '127.0.0.1', backlog: 4096 }, done));
const base = `http://127.0.0.1:${server.address().port}`;
// Bound physical sockets for portability; all logical clients start together.
const agent = new Agent({ keepAlive: true, maxSockets: 100 });
function readStatic(path) {
  return new Promise((done, reject) => {
    get(`${base}${path}`, { agent }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => response.statusCode === 200 ? done(Buffer.concat(chunks)) : reject(new Error('Static request failed')));
    }).on('error', reject);
  });
}
const started = performance.now();
try {
  const latencies = await Promise.all(Array.from({ length: clients }, async () => {
    const start = performance.now();
    const pointer = JSON.parse(await readStatic('/snapshots/latest.json'));
    if (pointer.file !== `snapshot-${pointer.sha256}.json` || !/^[a-f0-9]{64}$/.test(pointer.sha256)) throw new Error('Invalid pointer');
    const bytes = await readStatic(`/snapshots/${pointer.file}`);
    if (createHash('sha256').update(bytes).digest('hex') !== pointer.sha256) throw new Error('Checksum mismatch');
    return performance.now() - start;
  }));
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ scenario: 'local-static-only', clients, successful: latencies.length, requests,
    paths: [...paths], elapsedMs: Math.round(performance.now() - started),
    p95Ms: Math.round(latencies[Math.ceil(clients * .95) - 1]),
    databaseConnections: 0, workerRequests: 0, maxConcurrentConnections: 100,
    limitation: 'Does not measure CDN hosting or concurrent match duration.' }, null, 2));
} finally { agent.destroy(); server.closeAllConnections(); await new Promise((done) => server.close(done)); }
