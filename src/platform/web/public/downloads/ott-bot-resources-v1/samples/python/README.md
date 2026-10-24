# Python Bot SDK và Bộ Bot Kiểm thử

Module này cung cấp Bot SDK tối thiểu cùng các bot kiểm thử theo đặc tả **Bot Protocol v2** (`protocol/bot-protocol-v2.md`).

Module hoạt động hoàn toàn độc lập, sử dụng thư viện chuẩn của Python 3, không phụ thuộc và không import bất kỳ mã nguồn TypeScript nào từ `game-core` hay `match-runner`.

---

## 1. Cấu trúc thư mục

```text
src/bots/python/
├── __init__.py
├── sdk.py                      # BotSDK cơ sở quản lý vòng lặp NDJSON qua STDIN/STDOUT
├── first_legal_bot.py          # Happy bot: chọn deterministic action đầu tiên từ legalActions
├── capture_first_bot.py        # Tactical bot: ưu tiên nước đi bắt quân đối thủ
├── invalid_bot.py              # Fault bot: vi phạm cú pháp JSON, illegal action hoặc stale turnId
├── process_fault_bot.py        # Fault bot: gây timeout, crash hoặc output vượt quá giới hạn
├── tests/
│   ├── __init__.py
│   ├── fixtures.py             # Helper nạp schema và fixtures chuẩn từ docs/contracts/
│   ├── test_sdk.py             # Unit test cho BotSDK
│   ├── test_first_legal_bot.py # Unit test cho FirstLegalBot
│   ├── test_capture_first_bot.py # Unit test cho CaptureFirstBot
│   ├── test_invalid_bots.py    # Unit test cho InvalidBot
│   ├── test_process_fault_bots.py # Unit test cho ProcessFaultBot
│   └── test_contract.py        # Contract tests đối chiếu schema và transcript mẫu
└── README.md
```

---

## 2. Quy chuẩn I/O và Giao thức

- **Transport:** Standard Streams (STDIN / STDOUT), mã hóa UTF-8, mỗi message đúng một dòng (NDJSON).
- **STDOUT:** Chỉ xuất duy nhất các thông điệp giao thức hợp lệ (`ACTION`), luôn gọi `flush=True`. Tuyệt đối không xuất debug banner, logging hoặc ký tự thừa ra stdout.
- **STDERR:** Dành riêng cho log, debug và chẩn đoán lỗi. Không ảnh hưởng đến luồng giao thức của MatchRunner.
- **Message Protocol v2:**
  - `INIT`: Server gửi thông tin trận đấu, bản đồ và giới hạn.
  - `STATE_UPDATE`: Server gửi trạng thái bàn cờ và danh sách `legalActions`.
  - `ACTION`: Bot phản hồi nước đi hợp lệ (`{"pieceId": ..., "to": {"col": ..., "row": ...}}`).
  - `TURN_RESULT`: Server thông báo kết quả sau mỗi lượt đi.
  - `MATCH_RESULT`: Server thông báo kết thúc trận đấu (bot kết thúc vòng lặp).

---

## 3. Các loại Bot và Cách chạy

### 3.1. FirstLegalBot (Happy Path)
Bot chọn nước đi đầu tiên (`legalActions[0]`). Đảm bảo hành vi deterministic và thoát sạch khi nhận `MATCH_RESULT` hoặc EOF.
```bash
# Chạy trực tiếp qua pipe dữ liệu mẫu
python samples/python/first_legal_bot.py < protocol/bot-protocol-v2-valid.ndjson

# Trên PowerShell:
Get-Content protocol\bot-protocol-v2-valid.ndjson | python samples\python\first_legal_bot.py
```

### 3.2. CaptureFirstBot (Tactical Path)
Bot duyệt danh sách quân cờ đối thủ (`owner != turn`) trong `state.pieces`. Nếu có nước đi trong `legalActions` di chuyển đến vị trí quân cờ đối thủ, bot ưu tiên chọn nước đi đó; nếu không có, bot fallback chọn nước đi đầu tiên.
```bash
python samples/python/capture_first_bot.py < protocol/bot-protocol-v2-valid.ndjson
```

### 3.3. InvalidBot (Protocol Fault Injection)
Cố ý sinh các vi phạm giao thức theo tham số dòng lệnh:
- `--mode=malformed`: Xuất chuỗi JSON dở dang để gây lỗi `MALFORMED_JSON`.
- `--mode=illegal`: Xuất action di chuyển quân cờ không tồn tại để gây lỗi `ILLEGAL_ACTION`.
- `--mode=stale`: Xuất action có `turnId` lệch/cũ để gây lỗi `TURN_ID_MISMATCH`.

```bash
# Ví dụ chạy mode illegal
python src/bots/python/invalid_bot.py --mode=illegal
# hoặc positional argument:
python src/bots/python/invalid_bot.py malformed
```

### 3.4. ProcessFaultBot (Process Lifecycle Fault Injection)
Cố ý vi phạm vòng đời tiến trình hoặc giới hạn tài nguyên:
- `--mode=timeout` (hoặc `--delay=10`): Dừng phản hồi bằng `time.sleep` để MatchRunner kích hoạt `BOT_TIMEOUT`.
- `--mode=crash`: Thoát ngay lập tức với exit code non-zero `1` để kích hoạt `BOT_CRASHED`.
- `--mode=oversized` (hoặc `--size=70000`): Xuất dòng NDJSON vượt ngưỡng 65,536 bytes để kích hoạt `MESSAGE_TOO_LARGE`.

```bash
# Ví dụ chạy mode crash
python src/bots/python/process_fault_bot.py --mode=crash
```

---

## 4. Chạy Kiểm thử (Verification)

Toàn bộ test suite được viết bằng thư viện `unittest` chuẩn của Python và có thể chạy bằng **một lệnh duy nhất** từ thư mục gốc của repository:

```bash
# Chạy toàn bộ 27 test cases (SDK, Bots, Faults, Contract tests):
python -m unittest discover -s src/bots/python/tests
```

Chạy riêng từng nhóm test nếu cần:
```bash
# Chỉ chạy contract tests đối chiếu schema và transcript:
python -m unittest discover -s src/bots/python/tests -p 'test_contract.py'

# Chỉ chạy unit test của từng bot:
python -m unittest discover -s src/bots/python/tests -p 'test_first_legal_bot.py'
python -m unittest discover -s src/bots/python/tests -p 'test_capture_first_bot.py'
python -m unittest discover -s src/bots/python/tests -p 'test_invalid_bots.py'
python -m unittest discover -s src/bots/python/tests -p 'test_process_fault_bots.py'
```
