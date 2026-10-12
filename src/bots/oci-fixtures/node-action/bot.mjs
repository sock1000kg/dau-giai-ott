let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    const message = JSON.parse(line);
    if (message.type === 'STATE_UPDATE' && message.legalActions?.length) {
      process.stdout.write(`${JSON.stringify({ type: 'ACTION', protocolVersion: 1, matchId: message.matchId, turnId: message.turnId, action: message.legalActions[0] })}\n`);
    }
  }
});
