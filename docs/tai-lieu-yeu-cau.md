# Đặc tả yêu cầu hệ thống tổ chức giải đấu bot OTTv2

> Trạng thái: **Bản làm việc đã duyệt cho Phase 1–2; các quyết định OPEN tại mục 20 chưa được duyệt**
>
> Phiên bản: **0.4.0**
>
> Ngày cập nhật: **09/10/2026**
>
> Phạm vi: vòng xếp hạng định kỳ, vòng chung kết, vận hành bot, sandbox và replay
>
> Nguồn luật game: [sock1000kg/rock-paper-scissor](https://github.com/sock1000kg/rock-paper-scissor/tree/2956f1601365274eb34d623a9c908900bf43baab), commit `2956f1601365274eb34d623a9c908900bf43baab`

## 1. Mục đích tài liệu

Tài liệu này là nguồn yêu cầu chung cho Ban tổ chức (BTC), đội phát triển, đội vận hành và đội thi. Tài liệu trả lời bốn câu hỏi:

1. Giải đấu được vận hành theo quy trình nào?
2. Bot được nộp, kiểm tra và thi đấu theo hợp đồng nào?
3. Kết quả, Elo, bảng xếp hạng và vòng chung kết được xác định ra sao?
4. Điều kiện nào chứng minh hệ thống đủ an toàn, công bằng và có thể bàn giao?

Các từ **PHẢI**, **KHÔNG ĐƯỢC**, **NÊN** và **CÓ THỂ** thể hiện mức độ bắt buộc của yêu cầu.

### 1.1 Nguồn sự thật và xử lý mâu thuẫn

- Thể lệ giải đã được BTC công bố quyết định chính sách công khai của giải.
- Tài liệu này quyết định nghiệp vụ, luật game và phạm vi sản phẩm.
- ADR quyết định kiến trúc đã được chấp nhận.
- Contract/schema version hóa quyết định chính xác interface kỹ thuật trong phạm vi version đó.
- `tasks/todo.md` quyết định dependency và trạng thái triển khai, nhưng không được sửa nghĩa requirement hoặc contract.
- Code phải tuân theo các nguồn trên; code hiện tại không tự trở thành requirement.

Phần tóm tắt của một contract phải nhường cho contract/schema chính thức. Với mọi xung đột khác, đội phát triển PHẢI dừng phần bị ảnh hưởng, ghi rõ hai nguồn và tạo quyết định do đúng owner phê duyệt; không được âm thầm chọn một cách hiểu. Mục lục quản trị tài liệu nằm tại `docs/README.md`.

### 1.2 Giả định đang dùng trong bản nháp

- Giải có vòng xếp hạng định kỳ bằng Elo, sau đó chốt Top 8 hoặc Top 16 để đấu loại trực tiếp.
- Mỗi đội có một bot Python đang hoạt động tại mỗi thời điểm chốt vòng.
- Bot chạy hoàn toàn trong hạ tầng BTC, không có Internet và không giữ trạng thái bền vững giữa các trận.
- Game Engine là nguồn sự thật duy nhất; bot chỉ đề xuất hành động.
- Vận chuyển mặc định giữa Engine và bot là STDIO dùng NDJSON. Local WebSocket chỉ được bổ sung nếu có nhu cầu đã được chứng minh.
- Các giá trị như số đội vào chung kết, K-factor, giới hạn tài nguyên và lịch thi đấu là cấu hình giải, phải được khóa trước khi giai đoạn tương ứng bắt đầu.

## 2. Mục tiêu, chỉ số thành công và ngoài phạm vi

### 2.1 Mục tiêu

- Tổ chức giải bot OTTv2 công bằng, có thể tái hiện và kiểm toán.
- Tự động hóa nộp bot, kiểm tra, xếp lịch, chạy trận, tính Elo và công bố bảng xếp hạng.
- Cô lập code không tin cậy để một bot không ảnh hưởng bot khác hoặc hạ tầng BTC.
- Tạo replay phục vụ khán giả/caster mà không làm thay đổi kết quả trận.
- Tách luật game khỏi nghiệp vụ giải để có thể tái sử dụng nền tảng cho game khác.

### 2.2 Chỉ số thành công

- 100% trận chính thức truy được về đúng phiên bản bot, map, engine, cấu hình và seed.
- Một job được xử lý lặp lại không làm cập nhật Elo hai lần.
- Không có lưu lượng mạng đi ra từ container bot trong trận chính thức.
- Kết quả Engine và replay khớp nhau theo cùng event log.
- Một lỗi hạ tầng không bị ghi nhận thành lỗi hoặc trận thua của đội thi.
- BTC có thể tạm dừng, chạy lại, hủy hoặc xác nhận trận với đầy đủ audit log.

### 2.3 Ngoài phạm vi phiên bản đầu

- Thanh toán, bán vé, chat và mạng xã hội.
- Cho bot gọi Internet, API LLM hoặc dịch vụ bên ngoài.
- Huấn luyện mô hình trên hạ tầng BTC.
- Stream trạng thái trực tiếp từ sandbox ra Internet.
- “Ô bonus” khi chưa có mô tả hành vi chính thức. Map v1 chỉ có ô thường, ô đích và chướng ngại vật.
- Tự động phát hiện đạo văn/đạo code; BTC xử lý theo quy chế riêng nếu cần.

## 3. Bản đồ năng lực và thứ tự xây dựng

Các mô-đun dưới đây là ranh giới logic, không đồng nghĩa bắt buộc phải là các microservice độc lập.

| Mã mô-đun | Trách nhiệm | Phụ thuộc |
| --- | --- | --- |
| `game-rules` | Luật OTTv2, state transition và kết quả | — |
| `bot-protocol` | Hợp đồng JSON giữa Engine và bot | `game-rules` |
| `bot-submission` | Upload, kiểm tra, version và kích hoạt bot | `bot-protocol` |
| `sandbox-execution` | Chạy code không tin cậy với quota và cách ly | `bot-protocol`, `bot-submission` |
| `match-orchestration` | Xếp hàng, điều phối trận, retry và chốt kết quả | `game-rules`, `sandbox-execution` |
| `ranking-scheduling` | Ghép cặp, Elo, bảng xếp hạng và cutoff | `match-orchestration` |
| `finals-bracket` | Seeding, BO3 và nhánh loại trực tiếp | `ranking-scheduling` |
| `replay-spectator` | Event log, phát lại và giao diện khán giả | `match-orchestration` |
| `tournament-operations` | Cấu hình giải, phân quyền, audit và quan sát hệ thống | Tất cả mô-đun trên |

Thứ tự xây dựng đề xuất:

```text
game-rules → bot-protocol → bot-submission → sandbox-execution
                                      └────→ match-orchestration
                                                ├→ ranking-scheduling → finals-bracket
                                                └→ replay-spectator
tournament-operations được bổ sung xuyên suốt từng giai đoạn
```

## 4. Vai trò và phân quyền

| Vai trò | Quyền chính |
| --- | --- |
| Quản trị viên BTC | Tạo giải, phân quyền, khóa cấu hình, mở/đóng giai đoạn |
| Trọng tài/Vận hành | Duyệt submission, điều khiển job, xem log kỹ thuật, xử lý sự cố |
| Đội trưởng | Quản lý thành viên, nộp và kích hoạt bot, xem kết quả của đội |
| Thành viên đội | Xem thông tin đội và submission; nộp bot nếu được đội trưởng cấp quyền |
| Caster | Xem replay đã được BTC phát hành và dữ liệu phục vụ bình luận |
| Khán giả | Xem lịch, kết quả, bảng xếp hạng và replay công khai |

Yêu cầu phân quyền:

- Mọi thao tác làm thay đổi kết quả, Elo, bracket hoặc trạng thái giải PHẢI yêu cầu vai trò BTC và được ghi audit log.
- Đội thi chỉ được đọc source/log chi tiết của chính đội mình.
- Khán giả không được truy cập source bot, stderr riêng tư, map chưa phát hành hoặc seed chưa công bố.
- Một tài khoản có thể thuộc nhiều vai trò nhưng quyền được kiểm tra ở server, không chỉ ẩn nút trên giao diện.

## 5. Vòng đời giải đấu

```text
DRAFT → REGISTRATION → QUALIFICATION → RANKING_LOCKED → FINALS → COMPLETED
  │           │              │                │            │
  └──────────► CANCELLED ◄────┴────────────────┴────────────┘
```

### 5.1 Quy tắc chuyển giai đoạn

- `DRAFT`: BTC cấu hình luật, lịch, map, quota và thể thức; chưa nhận đăng ký.
- `REGISTRATION`: đội đăng ký và nộp bot thử nghiệm; chưa tính Elo chính thức.
- `QUALIFICATION`: chạy các vòng xếp hạng; mỗi vòng có cutoff submission riêng.
- `RANKING_LOCKED`: không nhận thay đổi làm ảnh hưởng thứ hạng; BTC kiểm tra và công bố seed.
- `FINALS`: chỉ submission đã khóa được thi đấu; mọi thay đổi phải theo quy trình sự cố.
- `COMPLETED`: kết quả cuối, bracket và replay được đóng băng để công bố.
- `CANCELLED`: chỉ quản trị viên được chuyển đến; phải có lý do và audit log.

Sau khi một giai đoạn bắt đầu, BTC KHÔNG ĐƯỢC sửa ngược cấu hình ảnh hưởng tính công bằng. Nếu bắt buộc sửa, phải tạo phiên bản cấu hình mới, nêu phạm vi ảnh hưởng và quyết định chạy lại.

## 6. Luật game chuẩn (`game-rules`)

### 6.1 Bàn cờ và tọa độ

- Bàn cờ có 9 cột `a..i` và 9 hàng `1..9`.
- Tọa độ giao thức dùng số nguyên zero-based: `col`, `row` trong đoạn `0..8`.
- `a1` tương ứng `{ "col": 0, "row": 0 }`; `i9` tương ứng `{ "col": 8, "row": 8 }`.
- Phe `X` (Đỏ) đi trước và có đích `i9`.
- Phe `O` (Xanh) có đích `a1`.

### 6.2 Quân và vị trí ban đầu

Mỗi phe có đúng 9 quân: 3 Búa (`ROCK`), 3 Bao (`PAPER`) và 3 Kéo (`SCISSORS`).

| Phe | Búa | Bao | Kéo |
| --- | --- | --- | --- |
| X | `a4`, `b3`, `c2` | `b4`, `c3`, `d2` | `a3`, `b2`, `c1` |
| O | `i6`, `h7`, `g8` | `h6`, `g7`, `f8` | `i7`, `h8`, `g9` |

```text
9 | . . . . . . O . B
8 | . . . . . O O O .
7 | . . . . . . O O O
6 | . . . . . . . O O
5 | . . . . . . . . .
4 | X X . . . . . . .
3 | X X X . . . . . .
2 | . X X X . . . . .
1 | R . X . . . . . .
    a b c d e f g h i
```

`R` là đích `a1`, `B` là đích `i9`; hai ô đích phải trống khi bắt đầu.

### 6.3 Di chuyển và ăn quân

- Hai phe đi luân phiên; mỗi lượt bot gửi đúng một hành động di chuyển.
- Một quân đi đúng một ô theo một trong 8 hướng như quân vua trong cờ vua.
- Không được ra ngoài bàn, đi vào chướng ngại vật hoặc ô có quân cùng phe.
- Quan hệ ăn quân: Búa ăn Kéo, Kéo ăn Bao, Bao ăn Búa.
- Quân tấn công thắng thì ăn quân tại đích và chiếm ô đó.
- Hai quân cùng loại chặn nhau; quân yếu hơn không được tự sát vào quân mạnh hơn.
- Action sai không làm thay đổi bàn cờ.

### 6.4 Điều kiện kết thúc

Một phe thắng ngay khi:

1. Đưa bất kỳ quân nào tới đích đối diện; hoặc
2. Loại toàn bộ quân đối phương.

Nếu một nước đi thỏa cả hai điều kiện, `REACHED_GOAL` được ưu tiên làm lý do thắng. Kết quả chuẩn gồm:

- `winnerSide`: `X`, `O` hoặc `null` nếu hòa.
- `reason`: `REACHED_GOAL`, `ELIMINATED_ALL_PIECES`, `FORFEIT` hoặc `TURN_LIMIT`.
- `turnCount`, `finalStateHash` và danh sách lỗi kỹ thuật của từng bot.

### 6.5 Giới hạn lượt và tính quyết định

- Mỗi trận PHẢI có `maxTurns` để không chạy vô hạn; Phase 1 và vòng loại dùng giá trị đã khóa là 200 lượt.
- Hết `maxTurns` mà chưa có người thắng thì trận có kết quả hòa `TURN_LIMIT` ở vòng xếp hạng.
- Nếu không phát sinh lỗi phụ thuộc timing/tài nguyên, cùng engine version, map version, hai submission, cấu hình và seed PHẢI tạo cùng chuỗi state/event. Các lỗi timing/tài nguyên phải được ghi riêng để tái hiện theo attempt.
- Engine không được dùng thời gian hệ thống, random không seed hoặc dữ liệu từ bot để quyết định luật.
- Chính sách xử lý hòa ở vòng chung kết phải được BTC chốt trước khi triển khai; xem mục 20.

### 6.6 Map động

Map v1 gồm:

- `schemaVersion`, `mapId`, `version`, `width = 9`, `height = 9`.
- Danh sách `obstacles`.
- Vị trí spawn, đích và metadata công bố.
- `checksum` để xác định chính xác file dùng trong trận.

Map hợp lệ PHẢI bảo đảm:

- Tọa độ nằm trong bàn và không trùng nhau.
- Chướng ngại vật không đè lên vị trí spawn hoặc ô đích.
- Mỗi phe có ít nhất một đường đi hình học tới đích ở trạng thái ban đầu.
- Schema và checksum hợp lệ trước khi map được đưa vào pool.

## 7. Giao thức bot (`bot-protocol`)

Contract v1 đã khóa ngày 09/10/2026 tại:

- `docs/contracts/bot-protocol-v1.md`
- `docs/contracts/bot-protocol-v1.schema.json`
- `docs/contracts/fixtures/`

Khi phần tóm tắt dưới đây thiếu chi tiết, contract/schema đã khóa được ưu tiên.

### 7.1 Nguyên tắc

- Giao thức v1 dùng STDIO và NDJSON: mỗi message là một JSON object trên đúng một dòng.
- Engine ghi yêu cầu vào `stdin`; bot ghi duy nhất message giao thức vào `stdout`.
- Bot ghi log chẩn đoán vào `stderr`; dung lượng log bị giới hạn.
- Mọi message có `type`, `protocolVersion`, `matchId`; message theo lượt có thêm `turnId`.
- Bot không được gửi state mới. Engine tự validate action và cập nhật state authoritative.
- Payload không đúng schema, quá kích thước hoặc sai `matchId`/`turnId` được xem là action lỗi.
- `STATE_UPDATE` PHẢI gửi `legalActions`; bot không phải sao chép game rules.
- Extra field bị từ chối ở mọi object protocol.

### 7.2 Luồng message

```text
Engine  ── INIT ─────────────► Bot (một lần)
Engine  ── STATE_UPDATE ─────► Bot (mỗi lượt của bot)
Engine  ◄─ ACTION ──────────── Bot
Engine  ── TURN_RESULT ──────► Bot (sau khi phân xử)
Engine  ── MATCH_RESULT ─────► Bot (trước khi đóng tiến trình nếu còn hoạt động)
```

Transcript đầy đủ có thể chạy bằng máy nằm tại
`docs/contracts/fixtures/bot-protocol-v1-valid.ndjson`. Không dùng ví dụ rút gọn thay cho JSON Schema khi viết consumer hoặc validator.

### 7.3 Timeout và lỗi bot

- Timeout lượt mặc định là 3.000 ms, tính bằng monotonic clock từ khi Engine ghi xong `STATE_UPDATE` đến khi nhận đủ một dòng `ACTION` hợp lệ.
- Startup timeout Phase 1 là 5.000 ms; Python baseline là 3.12.x với entrypoint `bot.py`.
- Một message tối đa 65.536 byte UTF-8 không tính LF; stderr tối đa 1 MiB cho mỗi bot mỗi trận.
- Timeout, JSON lỗi, schema lỗi hoặc action không hợp lệ làm bot mất lượt và sinh `TURN_SKIPPED`.
- Khi skip, bàn cờ giữ nguyên nhưng `turnCount` và `state.revision` tăng đúng 1; nếu trận tiếp tục thì `turnNumber` tăng và quyền đi chuyển sang đối thủ.
- Crash, EOF không mong đợi, spawn failure, vượt quota/resource hoặc vi phạm sandbox xử thua kỹ thuật `FORFEIT` ngay.
- Với lỗi theo lượt có thể phục hồi, 3 lỗi liên tiếp hoặc 5 lỗi trong một trận dẫn đến `FORFEIT`.
- `NO_LEGAL_ACTION` tạo skip nhưng không tính lỗi bot.
- Response đến muộn hoặc sai `turnId` bị bỏ qua và không được dùng cho lượt sau.

## 8. Đăng ký đội và nộp bot (`bot-submission`)

### 8.1 Đội thi

- Mỗi đội có mã duy nhất, tên hiển thị, đội trưởng và danh sách thành viên.
- Tên đội phải duy nhất trong một giải và tuân theo quy định nội dung của BTC.
- Chỉ đội đủ điều kiện và không bị đình chỉ mới được kích hoạt submission.

### 8.2 Gói nộp

- Hệ thống nhận một file `bot.py` hoặc archive theo định dạng BTC công bố.
- Nếu dùng archive, entrypoint bắt buộc là `bot.py`; cấm path traversal, symlink và file đặc biệt.
- Python version, base image, thư viện cài sẵn, giới hạn dung lượng và cách đóng gói model PHẢI được công bố trước vòng đăng ký.
- Không cài dependency từ Internet khi chạy trận. Dependency bổ sung phải nằm trong gói nộp hoặc whitelist của image.
- Mỗi lần nộp tạo một submission bất biến với `submissionId`, SHA-256, thời gian, chủ sở hữu và trạng thái.

### 8.3 Vòng đời submission

```text
UPLOADED → VALIDATING → VALID ──→ ACTIVE
                  └──→ INVALID      └──→ SUPERSEDED
VALID/ACTIVE ───────────────────────→ REVOKED
```

- Validation gồm kiểm tra archive, entrypoint, protocol smoke test, thời gian khởi động và giới hạn an toàn.
- `INVALID` phải có mã lỗi và thông báo đủ để đội sửa nhưng không lộ cấu hình bảo mật nhạy cảm.
- Mỗi đội chỉ có một submission `ACTIVE` cho một stage.
- Cutoff của vòng sẽ pin đúng `submissionId`/hash; upload sau cutoff không thay đổi các trận đã xếp.
- BTC có thể `REVOKE` submission độc hại và phải ghi lý do/audit.

### 8.4 Chạy thử

- Đội được chạy test match trong quota riêng trước cutoff.
- Test match không cập nhật Elo và có thể dùng map công khai.
- Môi trường test phải gần tương đương môi trường chính thức, ngoại trừ năng lực quan sát bổ sung đã được ghi rõ.

## 9. Sandbox và thực thi (`sandbox-execution`)

Mỗi bot chạy trong một sandbox riêng; Game Engine chạy ngoài sandbox bot.

Sandbox PHẢI:

- Chặn hoàn toàn egress Internet và truy cập mạng tới bot đối thủ.
- Chạy bằng user không đặc quyền, không privileged mode, không mount Docker socket.
- Dùng root filesystem chỉ đọc; chỉ cho ghi vào thư mục tạm có quota.
- Giới hạn CPU, RAM, PID/process, thời gian, dung lượng file và stdout/stderr.
- Hạn chế syscall/capability theo profile; cấm truy cập host filesystem và thiết bị không cần thiết.
- Hủy toàn bộ process con sau trận, timeout hoặc cancellation.
- Không tái sử dụng filesystem ghi được giữa hai trận của hai đội.

Phân loại lỗi:

| Nhóm | Ví dụ | Cách xử lý |
| --- | --- | --- |
| Lỗi bot | Crash, timeout, action sai, vượt quota | Skip/forfeit theo luật; trận vẫn là kết quả hợp lệ |
| Lỗi hạ tầng | Worker mất, Engine lỗi, storage/broker lỗi | Không tính kết quả; retry có kiểm soát |
| Lỗi cấu hình | Map/schema/image không hợp lệ | Chặn job trước khi chạy; báo vận hành |
| Vi phạm an toàn | Cố thoát sandbox, fork bomb | Dừng ngay, revoke submission nếu BTC xác nhận |

Giới hạn cụ thể (CPU, RAM, dung lượng, startup timeout, log limit) là cấu hình giải và phải giống nhau cho mọi đội trong cùng stage.

## 10. Điều phối trận và hàng đợi (`match-orchestration`)

### 10.1 Vòng đời trận

```text
SCHEDULED → QUEUED → RUNNING → COMPLETED → FINALIZED
                │        ├──→ RETRYABLE_ERROR → QUEUED
                │        └──→ FAILED
                └────────────→ CANCELLED
```

- Mỗi match có ID duy nhất và pin hai submission, side, map checksum, engine version, protocol version, seed và resource profile.
- Job phải idempotent. Cùng `matchId` không được tạo hai kết quả chính thức.
- Worker claim job bằng lease; job hết lease có thể được nhận lại nhưng chỉ một kết quả được finalize.
- `COMPLETED` nghĩa là Engine đã sinh kết quả; `FINALIZED` nghĩa là kết quả đã được chấp nhận và các hiệu ứng phụ đã ghi thành công.
- Retry lỗi hạ tầng dùng backoff và giới hạn lần; không retry mù lỗi bot.
- Số trận chạy đồng thời do capacity controller quyết định từ quota máy, không hard-code “5–10 trận”.

### 10.2 Tính công bằng và tái hiện

- Thứ tự xếp job hoặc tốc độ worker không được làm thay đổi đối thủ, map hoặc Elo.
- Seed phải được sinh phía server, lưu trước trận và chỉ công bố theo chính sách của stage.
- Đồng hồ timeout thuộc Engine/worker, không dùng timestamp từ bot.
- Mọi kết quả chính thức phải tái hiện được trong môi trường kiểm tra bằng artifact đã pin.

## 11. Xếp lịch vòng loại và Elo (`ranking-scheduling`)

### 11.1 Điều kiện được xếp lịch

Một đội được đưa vào vòng khi:

- Đăng ký hợp lệ và không bị đình chỉ.
- Có submission `ACTIVE` đã qua validation trước cutoff.
- Không rút khỏi stage.

### 11.2 Ghép cặp đề xuất

- Ghép các đội trong cùng dải Elo cấu hình được; nếu không đủ đối thủ, mở rộng dải theo từng bước.
- Không ghép đội với chính mình.
- Hạn chế lặp lại cùng một cặp trong các vòng gần nhau.
- Lịch được tạo từ snapshot tại cutoff và seed của vòng, sau đó đóng băng.
- Một cặp thi đấu hai game trên cùng map với hai phía X/O hoán đổi để giảm lợi thế đi trước.
- Hai game tạo thành một `series`; kết quả series dùng để cập nhật Elo một lần.
- Mỗi game cho 1 điểm thắng, 0,5 điểm hòa, 0 điểm thua; đội có tổng điểm cao hơn thắng series, bằng điểm thì series hòa.

Nếu BTC muốn mỗi cặp chỉ chơi một game, phải công bố cách cân bằng lợi thế phe trước khi vòng loại bắt đầu.

### 11.3 Công thức Elo

Với rating trước vòng là `R_A`, `R_B`:

```text
E_A = 1 / (1 + 10 ^ ((R_B - R_A) / 400))
R'_A = R_A + K × (S_A - E_A)
```

- `S = 1` nếu thắng series, `0.5` nếu hòa, `0` nếu thua.
- Rating khởi tạo đề xuất: 1000; `K` đề xuất: 32. BTC phải chốt trước giải.
- Mọi series trong cùng một vòng dùng snapshot rating đầu vòng; delta được áp dụng sau khi toàn bộ series của vòng finalize để tránh phụ thuộc thứ tự worker.
- Cập nhật Elo và đánh dấu `ratingApplied` phải nằm trong cùng transaction/idempotency boundary.
- Trận hủy hoặc lỗi hạ tầng không tính Elo. Thua do lỗi bot/forfeit là kết quả hợp lệ và có tính Elo.
- Mọi điều chỉnh thủ công tạo một ledger entry riêng; không sửa mất lịch sử.

### 11.4 Bảng xếp hạng và tie-break

Thứ tự đề xuất:

1. Elo cao hơn.
2. Điểm đối đầu trực tiếp trong stage.
3. Tỷ lệ thắng series cao hơn.
4. Ít lượt lỗi kỹ thuật/forfeit hơn.
5. Đấu tie-break do BTC xếp; nếu không đủ thời gian, dùng bốc thăm có seed và biên bản công khai.

Leaderboard công khai phải thể hiện ít nhất: hạng, đội, Elo, số series thắng-hòa-thua, số forfeit và thời điểm cập nhật.

## 12. Vòng chung kết (`finals-bracket`)

- `FINALIST_COUNT` chỉ nhận 8 hoặc 16 và phải được khóa trước vòng loại.
- `BRACKET_TYPE` là single-elimination hoặc double-elimination và phải được khóa trước khi công bố thể lệ.
- Seed lấy từ leaderboard đã khóa; cặp vòng đầu theo nguyên tắc seed cao gặp seed thấp.
- Submission dùng ở chung kết phải được pin tại finals cutoff; không thay code giữa series trừ quy trình sự cố được BTC công bố trước.
- Mỗi series là BO3: đội đầu tiên đạt 2 game thắng sẽ thắng series; game hòa không được tính là một game thắng.
- Game 1 và Game 2 phải hoán đổi phía X/O. Phía ở game quyết định dùng server seed đã commit trước series.
- Map được chọn không lặp trong một series cho đến khi pool cạn. Map pool 5 hoặc 7 map được công bố; thứ tự chọn và seed được giữ kín đến thời điểm BTC phát hành.
- Bracket chỉ tiến khi series trước đã `FINALIZED`.
- Mọi override của trọng tài phải có lý do, người thực hiện, thời gian và liên kết bằng chứng.

## 13. Replay và giao diện khán giả (`replay-spectator`)

### 13.1 Event log chuẩn

Game Engine tạo một event log bất biến cho mỗi lần chạy, gồm:

- Metadata: match, series, engine, protocol, hai submission hash, map checksum, seed và resource profile.
- `MATCH_STARTED`, `TURN_STARTED`, `ACTION_RECEIVED`, `ACTION_APPLIED`, `TURN_SKIPPED`, `BOT_FAULT`, `MATCH_FINISHED`.
- Số thứ tự event tăng liên tục; mỗi event có state revision và hash cần thiết để kiểm tra toàn vẹn.
- Snapshot ban đầu và snapshot định kỳ hoặc dữ liệu đủ để dựng lại toàn bộ state.
- Không chứa source bot, secret, token hoặc stderr chưa lọc.

Kết quả trận PHẢI được suy ra từ cùng event log dùng cho replay; UI không tự tính lại người thắng.

### 13.2 Phát hành replay

- Sandbox không stream trực tiếp ra Internet.
- Trận được tính xong trước, sau đó BTC phát hành replay tức thời hoặc có trì hoãn.
- Chung kết cho phép operator giữ replay ở trạng thái `STAGED` để caster chuẩn bị rồi mới `PUBLISHED`.
- Replay công khai phải tải được theo `matchId`, kiểm tra schema version và checksum.

### 13.3 Chức năng UI

- Play/pause, tua theo lượt, chỉnh tốc độ (ít nhất 0.5×, 1×, 2×) và xem kết quả.
- Hiển thị map, hai đội, lượt, action, quân bị ăn, lỗi kỹ thuật và lý do kết thúc.
- Seek phải dựa trên event index/snapshot, không dựa vào `setInterval` như nguồn thời gian duy nhất.
- Reload trang không làm thay đổi nội dung replay.
- Giao diện dùng được trên desktop và mobile, có điều khiển bàn phím và nhãn truy cập cơ bản.

## 14. Công cụ vận hành (`tournament-operations`)

BTC cần có khả năng:

- Tạo/clone giải và version cấu hình.
- Mở/đóng đăng ký, cutoff vòng, khóa leaderboard và bắt đầu finals.
- Xem queue, worker, trận đang chạy và nguyên nhân retry/failure.
- Tạm dừng nhận job mới mà không hủy job đang chạy.
- Hủy hoặc chạy lại trận lỗi hạ tầng; không thể vô tình ghi Elo hai lần.
- Revoke submission, đình chỉ đội và ghi quyết định trọng tài.
- Xuất lịch, kết quả, leaderboard, bracket và audit log.
- Kiểm tra sức khỏe sandbox bằng bot canary trước mỗi đợt thi đấu.

Audit log PHẢI append-only ở cấp ứng dụng và ghi actor, action, target, before/after hoặc delta, lý do, timestamp và correlation ID.

## 15. Mô hình dữ liệu tối thiểu

| Thực thể | Trường định danh và quan hệ chính |
| --- | --- |
| `Tournament` | `id`, version cấu hình, stage, mốc thời gian |
| `Team` | `id`, tên, trạng thái, thành viên |
| `Submission` | `id`, `teamId`, hash, runtime, status, artifact URI |
| `MapVersion` | `mapId`, version, checksum, visibility |
| `Round` | `id`, stage, cutoff, rating snapshot, schedule seed |
| `Series` | `id`, hai team, format, status, winner |
| `Match` | `id`, `seriesId`, hai submission, side, map, seed, status |
| `MatchAttempt` | `id`, `matchId`, worker, thời gian, outcome kỹ thuật |
| `MatchResult` | winner, reason, turn count, final hash, log URI |
| `RatingLedger` | team, rating trước/sau, delta, `seriesId`, round |
| `Replay` | `matchId`, schema, checksum, visibility, URI |
| `AuditEvent` | actor, action, target, reason, correlation ID |

Các ràng buộc quan trọng:

- `Submission` và `MapVersion` đã dùng trong trận chính thức là bất biến.
- Một `Match` chỉ có tối đa một `MatchResult` chính thức.
- Một `Series` chỉ tạo tối đa một rating ledger entry cho mỗi đội.
- Xóa đội hoặc tài khoản không được làm mất lịch sử kết quả đã công bố.

## 16. Kiến trúc logic và ranh giới hệ thống

```text
Web/Admin API ──► Control Plane ──► Database
                      │                 │
                      ├──► Object Storage (submission, map, replay)
                      └──► Job Queue ──► Sandbox Worker
                                             │
                                      Authoritative Engine
                                       │               │
                                    Bot A             Bot B
                                  sandbox           sandbox
```

- **Control Plane** quản lý tài khoản, đội, submission, giải, lịch, rating và quyền truy cập.
- **Execution Plane** gồm queue, worker, sandbox và Engine; không tự quyết định Elo.
- **Object Storage** giữ artifact bất biến dung lượng lớn; database giữ metadata và transaction.
- **Replay UI** chỉ đọc dữ liệu đã phát hành; không truy cập trực tiếp worker/sandbox.
- Ban đầu Control Plane có thể là modular monolith. Chỉ tách service khi cần scale, security boundary hoặc ownership độc lập.

### 16.1 Stack công nghệ đã chốt

Quyết định và hệ quả triển khai được ghi tại [ADR-0001](decisions/0001-technology-stack-and-local-development.md).

- Nền tảng chung: **Node.js 22**, **TypeScript** và **Vitest**.
- API của Control Plane ở Phase 2: **Fastify**.
- Dữ liệu giao dịch và metadata: **PostgreSQL**.
- Queue và điều phối job: **Redis** với **BullMQ**.
- Artifact storage: API **S3-compatible**; môi trường phát triển dùng **MinIO**.
- Portal Phase 2: **React** và **Vite**.

### 16.2 Môi trường phát triển cục bộ

- PostgreSQL, Redis và MinIO PHẢI chạy bằng container Docker và được khởi động bằng một Docker Compose project của repository.
- Các dịch vụ trên chỉ được publish lên loopback (`localhost`) trong môi trường phát triển; ứng dụng đọc endpoint và credential từ biến môi trường, không hard-code trong source.
- Compose PHẢI có health check cho cả ba dịch vụ để API/worker và integration test chỉ bắt đầu sau khi dependency sẵn sàng.
- Repository PHẢI cung cấp `.env.example` không chứa secret thật và một lệnh thống nhất để dựng, kiểm tra trạng thái và hạ local stack.
- PostgreSQL và MinIO dùng volume cục bộ để giữ dữ liệu qua lần restart thông thường; phải có lệnh reset rõ ràng cho môi trường kiểm thử sạch.
- Cổng host cụ thể được quản lý trong file môi trường và có thể override để tránh xung đột trên máy thành viên; giao tiếp production không được suy ra từ cấu hình localhost.

## 17. Yêu cầu phi chức năng

### 17.1 Bảo mật

- Mọi upload và input bot phải được xem là không tin cậy.
- Xác thực/ủy quyền ở mọi API thay đổi trạng thái.
- Secret không xuất hiện trong image bot, event log, replay hoặc client bundle.
- Artifact có checksum, kiểm soát truy cập và retention policy.
- Có quy trình vá/rebuild runtime image và pin image bằng digest.

### 17.2 Tin cậy và nhất quán

- Rating, finalize result và bracket advancement phải idempotent.
- Queue hỗ trợ at-least-once nhưng business operation phải cho hiệu ứng exactly-once.
- Backup database và artifact metadata; định kỳ kiểm tra restore.
- Mọi timestamp lưu UTC; UI hiển thị theo múi giờ giải.

### 17.3 Hiệu năng và năng lực

- Scheduler không nhận thêm job vượt tổng quota CPU/RAM của worker pool.
- API đọc bảng xếp hạng/replay không được làm chậm execution plane.
- BTC phải chạy load test theo số đội, số trận/vòng và kích thước replay thực tế trước giải.
- Mục tiêu định lượng về throughput, thời gian chờ và uptime phải được chốt sau khi biết quy mô đội thi.

### 17.4 Quan sát hệ thống

- Log có cấu trúc và correlation theo `tournamentId`, `roundId`, `seriesId`, `matchId`, `attemptId`.
- Metrics tối thiểu: queue depth/age, trận thành công/lỗi, retry, thời gian trận, timeout bot, CPU/RAM sandbox, rating finalize failure.
- Cảnh báo theo triệu chứng: job chờ quá lâu, worker mất heartbeat, tỷ lệ lỗi hạ tầng tăng, finalize bị kẹt.
- Source bot và dữ liệu nhạy cảm không được ghi vào log tập trung.

### 17.5 Khả năng bảo trì

- Schema protocol, map và replay phải có version.
- Game Engine thuần, không phụ thuộc HTTP, queue, database hoặc UI.
- Mỗi thay đổi luật phải tạo engine version mới và không làm thay đổi replay cũ.
- Migrations phải có chiến lược tương thích/rollback phù hợp với dữ liệu đang dùng.

## 18. Chiến lược kiểm thử và tiêu chí nghiệm thu

### 18.1 Các tầng kiểm thử

- **Unit:** luật 8 hướng, biên, chướng ngại, đủ 3 quan hệ ăn quân, thắng và state bất biến khi action lỗi.
- **Contract:** mọi message protocol, map và replay được validate cả trường hợp hợp lệ/không hợp lệ.
- **Integration:** Engine ↔ bot process; queue ↔ worker; finalize ↔ rating ledger.
- **Security:** network isolation, filesystem, resource limit, archive traversal, fork bomb và oversized output.
- **E2E:** nộp hai bot → validate → xếp lịch → chạy → Elo → leaderboard → replay.
- **Determinism:** chạy lại cùng artifact/seed cho cùng event sequence và final hash.
- **Load:** đủ tải vòng thi thật và chứng minh queue không làm quá tải worker.

### 18.2 Kịch bản nghiệm thu bắt buộc

| ID | Kịch bản | Kết quả mong đợi |
| --- | --- | --- |
| AC-01 | Hai bot hợp lệ chơi hết trận | Kết quả, event log và replay nhất quán |
| AC-02 | Bot timeout một lượt | Sinh `TURN_SKIPPED`, đổi lượt, trận tiếp tục |
| AC-03 | Bot gửi JSON/action sai | State không đổi; lỗi được đếm đúng |
| AC-04 | Bot crash hoặc spawn process con | Toàn bộ process bị dọn; áp dụng policy lỗi bot |
| AC-05 | Worker chết giữa trận | Attempt lỗi hạ tầng; retry không tính Elo hai lần |
| AC-06 | Job được giao hai lần | Chỉ một result được finalize |
| AC-07 | Hai game đổi phía trong series | Hai submission và map giữ nguyên; X/O hoán đổi |
| AC-08 | Hoàn tất một vòng Elo | Dùng cùng rating snapshot; ledger và leaderboard khớp |
| AC-09 | Khóa ranking và tạo bracket | Seed đúng tie-break, không đổi sau khi khóa |
| AC-10 | Replay bị sửa một byte | Checksum fail; UI không công bố dữ liệu sai |
| AC-11 | Bot cố truy cập Internet/host | Bị chặn và có bằng chứng kiểm thử |
| AC-12 | Lỗi hạ tầng | Không bị quy thành lỗi/thua của đội |

### 18.3 Definition of Done toàn hệ thống

- [ ] Các quyết định mở ở mục 20 đã được BTC chốt hoặc loại khỏi phạm vi.
- [ ] Luật, protocol, map, replay và runtime image đều có version.
- [ ] Tất cả kịch bản AC-01 đến AC-12 có bằng chứng tự động hoặc biên bản kiểm thử được duyệt.
- [ ] Không có finding bảo mật mức Critical/High chưa xử lý đối với sandbox và upload.
- [ ] Có runbook cho worker lỗi, queue kẹt, storage lỗi, rating finalize lỗi và khôi phục backup.
- [ ] Có diễn tập một vòng loại và một bracket hoàn chỉnh trên môi trường gần production.
- [ ] Thể lệ công khai khớp cấu hình hệ thống đã khóa.

## 19. Phân kỳ bàn giao

### Giai đoạn 1 — Game Engine và Bot Protocol

- Luật chuẩn, map mặc định, STDIO/NDJSON, timeout, bot mẫu và trận E2E cục bộ.
- Chưa có tài khoản, upload, queue, Elo hoặc web replay.
- Cổng nghiệm thu: AC-01 đến AC-03 và determinism pass.

### Giai đoạn 2 — Vòng xếp hạng tự động

- Authentication/RBAC, đội/submission, sandbox, queue/worker, map động, scheduling, Elo và leaderboard.
- Cổng nghiệm thu: AC-04 đến AC-08, AC-11 và AC-12 pass.

### Giai đoạn 3 — Chung kết và trình diễn

- Khóa seed, bracket, BO3, map pool, replay staging/publishing và Spectator UI.
- Cổng nghiệm thu: AC-09, AC-10 và diễn tập live event pass.

Không bắt đầu code giai đoạn kế tiếp trước khi yêu cầu và cổng nghiệm thu của giai đoạn hiện tại được duyệt.

## 20. Quyết định BTC cần chốt

| ID | Quyết định | Giá trị cuối/đề xuất | Trạng thái | Ngày | Người duyệt | Hạn chốt |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | Số đội chung kết | 8 nếu quy mô nhỏ, 16 nếu đủ lịch | OPEN | — | — | Trước mở đăng ký |
| D-02 | Loại bracket | Single-elimination để vận hành đơn giản | OPEN | — | — | Trước mở đăng ký |
| D-03 | Rating khởi tạo và K-factor | 1000 và K=32 | OPEN | — | — | Trước vòng loại |
| D-04 | Chính sách forfeit do lỗi bot | Process fault: ngay; turn fault: 3 liên tiếp hoặc 5 tổng | ACCEPTED | 09/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-05 | Xử lý hòa ở finals | Draw không tính; chơi game bổ sung với map/side mới | OPEN | — | — | Trước finals |
| D-06 | Turn limit | 200 cho Phase 1/vòng loại; finals chốt riêng | ACCEPTED-PHASE-1 | 09/10/2026 | Đinh Đức Thuận | Finals còn mở |
| D-07 | Python/image/thư viện | Python 3.12.x, `bot.py`; image digest chốt ở Phase 2 | ACCEPTED-PHASE-1 | 09/10/2026 | Đinh Đức Thuận | Image còn mở |
| D-08 | CPU/RAM/startup/log quota | Startup 5 s, message 64 KiB, stderr 1 MiB; CPU/RAM/PID benchmark sau | PARTIAL | 09/10/2026 | Đinh Đức Thuận | Trước nhận submission |
| D-09 | Kích thước dải Elo và số series/vòng | Xác định theo số đội và quỹ máy | OPEN | — | — | Trước vòng loại |
| D-10 | Single game hay cặp game đổi phía | Cặp hai game đổi X/O | OPEN | — | — | Trước công bố thể thức |
| D-11 | Thời điểm công bố replay/seed | Ngay ở vòng loại; operator publish ở finals | OPEN | — | — | Trước giải |
| D-12 | Quyền dùng code repo tham chiếu | Chỉ đặc tả lại behavior; không copy source khi chưa có LICENSE | ACCEPTED | 09/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-13 | Authentication/RBAC cho Phase 2 | Chốt identity provider/session model và role mapping trước API | OPEN | — | — | Tại `P2-T01` |

Khi một quyết định được chốt, cập nhật bảng này bằng giá trị cuối, ngày, người duyệt và sửa các yêu cầu phụ thuộc trong cùng thay đổi.

## 21. Ranh giới thực thi cho đội phát triển

### Luôn phải làm

- Validate mọi input và pin version/checksum cho artifact chính thức.
- Chạy test liên quan trước khi merge; giữ yêu cầu, protocol và code đồng bộ.
- Ghi audit cho thao tác đặc quyền và giữ game engine tách khỏi hạ tầng.

### Phải hỏi trước

- Thay đổi luật, Elo, tie-break, timeout, quota hoặc thể thức sau khi đã công bố.
- Đổi schema không tương thích, thêm dependency hạ tầng hoặc tách service.
- Chạy lại/hủy một trận đã ảnh hưởng leaderboard hoặc bracket.

### Tuyệt đối không làm

- Cho bot truy cập Internet hoặc Docker socket.
- Tính Elo từ kết quả chưa finalize hoặc cập nhật Elo hai lần.
- Sửa/xóa lịch sử kết quả, rating ledger hoặc audit để “chữa” dữ liệu.
- Công bố source bot, map bí mật, seed bí mật hoặc log chứa thông tin nhạy cảm.
