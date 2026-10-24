let buffer = '';

function chooseAction(message) {
  const actions = message.legalActions;
  if (!Array.isArray(actions) || actions.length === 0) return null;
  if (!process.env.BOT_STRATEGY?.startsWith('capture')) return actions[0];

  const enemies = new Set((message.state?.pieces ?? [])
    .filter((piece) => piece.owner !== message.state?.turn)
    .map((piece) => `${piece.position.col}:${piece.position.row}`));
  return actions.find((action) => enemies.has(`${action.to.col}:${action.to.row}`)) ?? actions[0];
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.type !== 'STATE_UPDATE' || message.protocolVersion !== 2) continue;
    const action = chooseAction(message);
    if (action === null) continue;
    process.stdout.write(`${JSON.stringify({
      type: 'ACTION',
      protocolVersion: 2,
      matchId: message.matchId,
      turnId: message.turnId,
      action,
    })}\n`);
  }
});
