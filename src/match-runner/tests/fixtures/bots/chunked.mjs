#!/usr/bin/env node
import readline from 'node:readline';

const args = process.argv.slice(2);
const withUtf8 = args.includes('--with-utf8');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.type === 'STATE_UPDATE') {
    const action = withUtf8
      ? { pieceId: 'X-đ-1', to: { col: 0, row: 0 } }
      : (msg.legalActions?.[0] ?? { pieceId: 'X-ROCK-1', to: { col: 0, row: 0 } });

    const reply = {
      type: 'ACTION',
      protocolVersion: 1,
      matchId: msg.matchId,
      turnId: msg.turnId,
      action,
    };
    const replyStr = JSON.stringify(reply) + '\n';
    const buf = Buffer.from(replyStr, 'utf-8');

    if (withUtf8) {
      // Find the index of the multi-byte char "đ" (0xC4 0x91)
      const dIndex = buf.indexOf(0xc4);
      if (dIndex !== -1) {
        // Chunk 1 ends right in the middle of "đ" (includes 0xC4)
        process.stdout.write(buf.subarray(0, dIndex + 1));
        await new Promise((r) => setTimeout(r, 15));
        // Chunk 2 starts with 0x91 and sends the rest
        process.stdout.write(buf.subarray(dIndex + 1));
        return;
      }
    }

    // Default: split into 4 parts with 15ms delays
    const chunkSize = Math.max(1, Math.floor(buf.length / 4));
    for (let offset = 0; offset < buf.length; offset += chunkSize) {
      const part = buf.subarray(offset, Math.min(offset + chunkSize, buf.length));
      process.stdout.write(part);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
});
