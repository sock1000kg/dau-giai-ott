# ADR-0006: Nộp OCI image để hỗ trợ bot đa ngôn ngữ

## Status

Accepted

## Date

2026-10-12

## Context

Bot Protocol v1 dùng STDIO/NDJSON nên không phụ thuộc ngôn ngữ, nhưng policy Phase 1 yêu cầu `python3 ... bot.py`. BTC muốn đội được chọn ngôn ngữ hoặc local AI/runtime riêng mà BTC không phải duy trì launcher/SDK theo ngôn ngữ và không nhận network endpoint từ bot.

## Decision

- Phase 1 không đổi: CLI/demo Python và contract v1 hiện có tiếp tục là baseline regression.
- Submission chính thức Phase 2 là một OCI Image Spec 1.1 image trong OCI Image Layout archive không nén (layout marker `imageLayoutVersion: 1.0.0`), đúng platform `linux/amd64`, có OCI `Entrypoint` không rỗng. BTC không nhận Dockerfile, source build context, registry URL, image tag hay command do client khai báo.
- Worker lấy OCI manifest/config digest đã derive và image entrypoint để tạo hai container sandbox. MatchRunner tiếp tục giao tiếp qua `BotPort`; không đổi game core, Bot Protocol hay turn loop.
- Worker là trusted runtime adapter duy nhất có quyền dùng Docker Engine ở local. Bot container chạy non-root, no-network, read-only rootfs, không Docker socket/mount/capability; CPU/RAM/PID/tmp/output/time được worker override từ stage policy versioned.
- Archive được validate cấu trúc trước khi import/chạy và preflight bằng NDJSON v1. Chỉ image VALID mới ACTIVE; `Match` pin identity digest + policy version.

## Alternatives considered

### Profile runtime do BTC cung cấp cho từng ngôn ngữ

Không chọn làm format chính: BTC phải chọn/duy trì interpreter, dependency và entrypoint cho mọi ngôn ngữ. Có thể dùng nội bộ để build fixture nhưng không phải interface nộp bot.

### Đội gửi Dockerfile để BTC build

Không chọn: build là thực thi code không tin cậy, phụ thuộc registry/network và không tái hiện nếu base tag thay đổi.

### Bot mở HTTP/WebSocket endpoint hoặc BTC gọi service của đội

Không chọn: tạo dependency network, khó tái hiện/công bằng và mâu thuẫn sandbox không egress.

## Consequences

- Thay policy Python-only ở Phase 2 bằng OCI artifact contract; Phase 1 Python command không bị sửa.
- Thêm `P2-T14` trước upload/runtime để khóa layout/validation contract.
- `P2-T07`, `P2-T08`, `P2-T09`, `P2-T10` chuyển sang OCI identity, corpus và sandbox adapter; `P2-T15` benchmark rồi khóa profile công bố trước khi mở nhận submission đội thi.
- Tài liệu vận hành phải công bố size/quota/policy version và lệnh đội tự validate archive; resource baseline chỉ được phát hành sau benchmark.
- Chi tiết tại [SAD OCI Bot Submissions](../architecture/sad-oci-bot-submissions.md).
