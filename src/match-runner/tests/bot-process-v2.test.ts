import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { compileProtocolValidator, type InitMessageV2, type StateUpdateMessageV2 } from '@ott/bot-protocol';
import { BotProcess } from '../src/bot-process.ts';

const fixtures = readFileSync(new URL('../../../docs/contracts/fixtures/bot-protocol-v2-valid.ndjson', import.meta.url), 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));
const init = fixtures.find((message) => message.type === 'INIT') as InitMessageV2;
const update = fixtures.find((message) => message.type === 'STATE_UPDATE') as StateUpdateMessageV2;
const schema = (version: number) => compileProtocolValidator(JSON.parse(readFileSync(
  new URL(`../../../docs/contracts/bot-protocol-v${version}.schema.json`, import.meta.url), 'utf8')));
const bots: BotProcess[] = [];
afterEach(async () => { await Promise.all(bots.splice(0).map((bot) => bot.stop())); });

function bot(validatorVersion: number, replyVersion: number) {
  const instance = new BotProcess({
    executable: process.execPath,
    args: ['--input-type=module', '-e', `
      import readline from 'node:readline';
      readline.createInterface({input:process.stdin}).on('line', line => {
        const m = JSON.parse(line);
        if (m.type === 'STATE_UPDATE') setTimeout(() => process.stdout.write(JSON.stringify({
          type:'ACTION', protocolVersion:${replyVersion}, matchId:m.matchId, turnId:m.turnId, action:m.legalActions[0]
        })+'\\n'), 10);
      });`],
    validator: schema(validatorVersion), maxMessageBytes: 65536, stopGraceMs: 30,
  });
  bots.push(instance);
  return instance;
}

describe('BotProcess v2 pinned protocol', () => {
  it('exchanges a real v2 INIT/STATE_UPDATE/ACTION', async () => {
    const processBot = bot(2, 2);
    expect(await processBot.start(init)).toEqual({ ok: true });
    expect(await processBot.requestAction(update, 1500)).toMatchObject({ ok: true, message: { protocolVersion: 2 } });
  });
  it('rejects v1 replies when the match pins v2', async () => {
    const processBot = bot(2, 1);
    expect(await processBot.start(init)).toEqual({ ok: true });
    expect(await processBot.requestAction(update, 1500)).toEqual({ ok: false, code: 'SCHEMA_VIOLATION' });
  });
  it('fails closed when INIT v2 is wired to a v1 validator', async () => {
    const processBot = bot(1, 1);
    expect(await processBot.start(init)).toEqual({ ok: false, code: 'BOT_SPAWN_FAILED' });
    expect(processBot.pid).toBeUndefined();
  });
});
