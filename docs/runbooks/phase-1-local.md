# Runbook Phase 1 — local handoff

## Mục đích và phạm vi

Tài liệu này cho Đinh Đức Thuận tái tạo, kiểm tra và chạy một trận Phase 1 từ clean checkout.
Phase 1 không dùng Docker hay service nền: game core, protocol, MatchRunner và bot chạy local.
Các quyết định/contract chính thức vẫn là [ADR-0002](../decisions/0002-phase-1-engine-and-bot-protocol-v1.md),
[Engine API v1](../contracts/engine-api-v1.md) và [Bot Protocol v1](../contracts/bot-protocol-v1.md).

## Prerequisites

- Node.js `^22.12.0`; kiểm tra bằng `node --version`.
- npm; dùng lockfile root, không cài dependency theo từng package.
- Python 3; kiểm tra bằng `python3 --version`.
- Có thể chạy `python3` từ `PATH`.

Không cần `.env` trong Phase 1. `.env.example` chỉ nói rõ boundary này và không chứa secret.

## Cài đặt và kiểm tra clean checkout

Tại root repository:

```bash
npm ci
npm run typecheck
npm test
npm run build
python3 -m unittest discover -s src/bots/python/tests
```

Kỳ vọng: TypeScript test gồm game core, protocol, MatchRunner E2E và root smoke test đều pass;
Python bot test pass. `npm run build` chỉ build source, không build test.

Chạy riêng evidence E2E nếu cần:

```bash
npm --workspace @ott/match-runner test -- tests/e2e
```

Suite E2E chạy Python process thật cho happy path, malformed JSON, illegal/stale action,
timeout, oversized message, crash và determinism; đồng thời kiểm tra không còn PID bot sống.

## Chạy một trận mẫu

```bash
npm --workspace @ott/match-runner run --silent match -- \
  --bot-x python3 --bot-x-arg -I --bot-x-arg -B --bot-x-arg -u --bot-x-arg "$PWD/src/bots/python/first_legal_bot.py" \
  --bot-o python3 --bot-o-arg -I --bot-o-arg -B --bot-o-arg -u --bot-o-arg "$PWD/src/bots/python/capture_first_bot.py" \
  --match-id phase-1-local --seed handoff-seed --max-turns 4 \
  --out /tmp/ott-phase-1-match.json
```

- `-I` chạy Python isolated; `-B` không sinh `__pycache__`; `-u` giữ stdin/stdout unbuffered.
- `--bot-*-arg` nhận từng argv riêng, không truyền shell command string.
- stdout chỉ có một dòng JSON result; stderr chứa diagnostics và summary.
- Exit code `0` là trận đã được phân xử, kể cả khi bot bị fault/forfeit; `1` là lỗi runtime/hạ tầng;
  `2` là lỗi cờ/config.

Ví dụ JSON stdout có các key cố định: `matchId`, `winnerSide`, `reason`, `turnCount`,
`finalStateHash`, `forfeitedSide`, `faults`, `eventLog`.

## Artifact và replay

`--out` tạo event log JSON atomic. Artifact chứa full game config, limits, mọi engine
transition, state hash, result và fault summary; không chứa source/argv/env/stderr/raw stdout của bot.
Artifact phải có thể replay qua `CoreGameAdapter`; các E2E test thực hiện kiểm tra này tự động.

## Cấu hình và limits đã khóa

CLI bắt buộc `--bot-x`, `--bot-o`, `--out`. Có thể điều chỉnh `--match-id`, `--seed`,
`--max-turns`, `--turn-timeout-ms`, `--startup-timeout-ms` và `--schema`.

| Limit | Default |
| --- | ---: |
| `startupTimeoutMs` | 5000 ms |
| `turnTimeoutMs` | 3000 ms |
| `maxTurns` | 200 |
| `maxMessageBytes` | 65,536 bytes |
| `maxStderrBytes` | 1,048,576 bytes |
| `maxConsecutiveFaults` | 3 |
| `maxTotalFaults` | 5 |

Bot phải nói NDJSON UTF-8: `INIT`/`STATE_UPDATE` vào stdin; chỉ `ACTION` ra stdout; diagnostics
ra stderr. Chi tiết semantic của fault và message nằm ở Bot Protocol v1, không ở runbook này.

## Troubleshooting

| Triệu chứng | Kiểm tra / cách xử lý |
| --- | --- |
| `npm ci` từ chối engine | Cài Node `^22.12.0`; workspace bật `engine-strict=true`. |
| `python3: command not found` | Cài Python 3 hoặc thay executable qua `--bot-x`/`--bot-o`. |
| CLI exit `2` | Chạy `npm --workspace @ott/match-runner run match -- --help`; kiểm tra cờ bắt buộc và số nguyên dương. |
| Bot timeout/EOF/crash | Đọc stderr, dùng `-u`, đảm bảo bot flush NDJSON có LF và không log vào stdout. |
| `MESSAGE_TOO_LARGE` hoặc `STDERR_LIMIT_EXCEEDED` | Giảm dòng stdout dưới 65,536 byte hoặc diagnostics stderr dưới 1 MiB. |
| Replay/E2E fail | Chạy `npm --workspace @ott/match-runner test -- tests/e2e`, giữ artifact để đối chiếu hash. |

## Ranh giới Phase 2

Không tự khởi tạo Compose, PostgreSQL, Redis/BullMQ, MinIO, Fastify hay React/Vite từ runbook này.
Những dependency, `.env` variables và service lifecycle thuộc P2-T02 trở đi, sau P2-T01.
Phase 1 handoff chỉ xác nhận local deterministic match execution.
