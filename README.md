# OTT Tournament — Phase 1 local

Phase 1 chạy một trận Rock–Paper–Scissors trên bàn 9×9 giữa hai bot qua Bot Protocol v1.
`main` là nhánh tích hợp/deploy; hướng dẫn bàn giao local chi tiết ở
[docs/runbooks/phase-1-local.md](docs/runbooks/phase-1-local.md).

## Yêu cầu

- Node.js `^22.12.0` và npm (lockfile root).
- Python 3 để chạy các bot mẫu và E2E.
- Không cần Docker, PostgreSQL, Redis hay MinIO cho Phase 1.

## Chạy từ clean checkout

```bash
npm ci
npm run typecheck
npm test
npm run build
python3 -m unittest discover -s src/bots/python/tests
```

Chạy trận mẫu và tạo event log:

```bash
npm --workspace @ott/match-runner run --silent match -- \
  --bot-x python3 --bot-x-arg -I --bot-x-arg -B --bot-x-arg -u --bot-x-arg "$PWD/src/bots/python/first_legal_bot.py" \
  --bot-o python3 --bot-o-arg -I --bot-o-arg -B --bot-o-arg -u --bot-o-arg "$PWD/src/bots/python/capture_first_bot.py" \
  --max-turns 4 --out /tmp/ott-phase-1-match.json
```

Lệnh in đúng một JSON result lên stdout và ghi artifact replayable vào đường dẫn `--out`.

## Phạm vi

Phase 1 chỉ gồm game core thuần, Bot Protocol v1, MatchRunner/CLI, event log và Python bots.
Phase 2 (Fastify, PostgreSQL, Redis/BullMQ, MinIO, React/Vite, Docker Compose) chưa được
khởi tạo; xem task `P2-*` trước khi giả định các service hoặc biến môi trường đó tồn tại.

Nguồn sự thật về task/status là [tasks/todo.md](tasks/todo.md); contract là
[docs/contracts/](docs/contracts/).
