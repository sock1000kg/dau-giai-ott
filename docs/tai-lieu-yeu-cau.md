# Đặc tả yêu cầu hệ thống tổ chức giải đấu bot OTTv2

> Trạng thái: **Baseline yêu cầu Phase 1–3 đã được BTC duyệt. Việc duyệt requirement không đồng nghĩa
> implementation Phase 3 đã hoàn tất; trạng thái triển khai nằm duy nhất trong `tasks/todo.md`.**
>
> Phiên bản: **0.5.0**
>
> Ngày cập nhật: **14/10/2026**
>
> Phạm vi: vòng xếp hạng online theo tuần, vòng chung kết offline, vận hành bot, sandbox, replay và
> trang công khai cho PoC chạy trên một server lab
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

### 1.2 Baseline đã duyệt

- Giải có vòng xếp hạng định kỳ bằng Elo, sau đó chốt đúng 8 đội vào nhánh loại trực tiếp.
- Mỗi đội có một bot đang hoạt động tại mỗi thời điểm chốt vòng; bot chính thức Phase 2 được đóng gói thành OCI image độc lập ngôn ngữ.
- Bot chạy hoàn toàn trong hạ tầng BTC, không có Internet và không giữ trạng thái bền vững giữa các trận.
- Game Engine là nguồn sự thật duy nhất; bot chỉ đề xuất hành động.
- Vận chuyển mặc định giữa Engine và bot là STDIO dùng NDJSON. Local WebSocket chỉ được bổ sung nếu có nhu cầu đã được chứng minh.
- Các giá trị như số đội vào chung kết, K-factor, giới hạn tài nguyên và lịch thi đấu là cấu hình giải, phải được khóa trước khi giai đoạn tương ứng bắt đầu.
- [v0.5] Giải chia hai giai đoạn: **vòng loại online** gồm các round theo tuần tính Elo, và
  **vòng chung kết offline** tại địa điểm của BTC, chạy qua mạng LAN theo nhánh loại trực tiếp; xem mục 5.2 và 12.

### 1.3 Ràng buộc PoC đã duyệt [v0.5]

Phase 3 phải tạo PoC hoạt động được qua URL public, ưu tiên UI và vận hành giải đấu tốt, hardening thực dụng
và chi phí thấp. PoC chưa phải production HA. Mọi thiết kế PHẢI đáp ứng các ràng buộc sau:

- **Đối tượng:** giải **nội bộ của một trường đại học**; người tham gia là thành viên của trường.
- **Quy mô PoC:** tối đa khoảng **200 đội**, khoảng **100 phiên đăng nhập đồng thời** ở thời điểm sát hạn,
  burst khoảng **50 upload/reservation đồng thời** và khoảng **1.000 người xem đồng thời** qua static
  hosting/CDN. Đây là acceptance target cho PoC, không phải tuyên bố năng lực production.
- **Tài nguyên:** toàn bộ API, PostgreSQL, Redis/BullMQ, S3-compatible storage và worker chạy trên **một
  server lab**. Mặc định tối đa 4 game sandbox đồng thời; capacity controller PHẢI tự giảm concurrency
  theo CPU/RAM thay vì làm host mất ổn định.
- **Tiêu chí "ngon, bổ, rẻ":** ưu tiên giải pháp miễn phí hoặc chi phí thấp; không thiết kế phụ thuộc
  vào việc mua thêm máy chủ. Mọi tính năng tốn compute PHẢI có giới hạn, hàng đợi ưu tiên và cách
  từ chối có kiểm soát khi quá tải.
- **Môi trường đối kháng:** phải giả định có người cố phá luật, gian lận, tấn công web, gửi tải đột biến
  và tạo áp lực truyền thông lên BTC khi kết quả chậm. Minh bạch trạng thái là yêu cầu chức năng, không
  phải tính năng phụ.
- Khi quá tải, hệ thống PHẢI xếp hàng và trả queue position/`Retry-After`, hoặc tạm dừng job ưu tiên thấp;
  không được mất submission hay result. Phase 3 chỉ yêu cầu smoke/load test vừa đủ trên server lab.
- HA, cụm bốn laptop, HSM, tự động xoay khóa, DR/monitoring 24/7 và tuyên bố chịu tải 4.000 đội nằm ngoài
  phạm vi PoC.

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
- Tự động phát hiện đạo văn/đạo code; BTC xử lý theo quy chế riêng nếu cần. Ngoại lệ [v0.5]:
  phát hiện submission **trùng hệt** theo digest nằm trong phạm vi (mục 17.6), vì gần như không tốn chi phí.

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
| Tài khoản đội | Đăng nhập portal, nộp/kích hoạt bot và xem dữ liệu thuộc đúng một đội |
| Caster | Xem replay đã được BTC phát hành và dữ liệu phục vụ bình luận |
| Khán giả | Xem lịch, kết quả, bảng xếp hạng và replay công khai |

Yêu cầu phân quyền:

- Mọi thao tác làm thay đổi kết quả, Elo, bracket hoặc trạng thái giải PHẢI yêu cầu vai trò BTC và được ghi audit log.
- Đội thi chỉ được đọc source/log chi tiết của chính đội mình.
- Khán giả không được truy cập source bot, stderr riêng tư, map chưa phát hành hoặc seed chưa công bố.
- Quyền được kiểm tra ở server, không chỉ ẩn nút trên giao diện. `TEAM_ACCOUNT` Phase 2 luôn gắn đúng một team; các vai trò BTC/vận hành có thể được gán theo policy server-side.

### 4.1 Tài khoản và đăng nhập Phase 2

- Xác thực dùng username/password nội bộ; không có đăng ký tự phục vụ, OAuth/email login hoặc trang đăng ký.
- Một `TEAM_ACCOUNT` dùng chung cho đúng một đội. BTC tạo đội từ console bằng tên đội; server tạo
  username duy nhất và mật khẩu ngẫu nhiên, lưu password hash và chỉ trả plaintext credential đúng một lần
  khi tạo hoặc reset. BTC tự gửi credential qua kênh chat ngoài hệ thống.
- Chỉ `BTC_ADMIN` tạo hoặc reset `TEAM_ACCOUNT`; reset phải vô hiệu session cũ. Audit chỉ ghi actor,
  team/account, thời điểm và loại thao tác, tuyệt đối không ghi password.
- Đội đã đăng nhập được tự đổi mật khẩu của account dùng chung bằng cách xác minh mật khẩu hiện tại.
  Đổi mật khẩu thu hồi toàn bộ session của account; audit ghi account/team và loại thao tác, không ghi password.
  Không có luồng tự reset khi quên mật khẩu; trường hợp đó BTC vẫn reset credential.
- `BTC_ADMIN` đầu tiên được bootstrap bằng biến môi trường local không commit; sau đó đăng nhập như bình
  thường. Team portal không có đăng ký hoặc endpoint đặt lại mật khẩu khi chưa đăng nhập.
- Session là opaque server-side session trong Redis, phát cho browser bằng cookie `HttpOnly`, `SameSite=Lax`
  và `Secure` ở môi trường HTTPS. Password hash dùng Argon2id; rate limit login và error response không được
  tiết lộ username có tồn tại hay không.

#### Công cụ reset mật khẩu demo

- Job reset về mật khẩu demo là công cụ vận hành local/test ngoài API chính thức. Mặc định tắt; chỉ chạy
  khi `OTT_DEMO_PASSWORD_RESET_ENABLED=true`, `OTT_DEMO_MODE=true`, `OTT_DEPLOYMENT_MODE=dev` hoặc `test`,
  và target username nằm trong `OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES`.
- Job chỉ được đặt lại `TEAM_ACCOUNT` thử nghiệm đã chỉ định, dùng `OTT_DEMO_TEAM_PASSWORD` làm mật khẩu
  mặc định. Lịch mặc định là 03:00 mỗi ngày theo `OTT_DEMO_PASSWORD_RESET_TIMEZONE` (mặc định
  `Asia/Ho_Chi_Minh`); có thể đổi bằng `OTT_DEMO_PASSWORD_RESET_CRON`. Mỗi lần chạy thu hồi session và
  audit thao tác mà không ghi secret.
- Public demo, hosted PoC, finals và production không bật hoặc chạy job này. Public demo tiếp tục dùng
  credential ngẫu nhiên và BTC reset credential theo luồng chính thức.

## 5. Vòng đời giải đấu

```text
DRAFT → REGISTRATION → QUALIFICATION → RANKING_LOCKED → FINALS → COMPLETED
  │           │              │                │            │
  └──────────► CANCELLED ◄────┴────────────────┴────────────┘
```

### 5.1 Quy tắc chuyển giai đoạn

- `DRAFT`: BTC cấu hình luật, lịch, map, quota và thể thức; chưa nhận đăng ký.
- `REGISTRATION`: BTC provision team account và đội nộp bot thử nghiệm; chưa tính Elo chính thức.
- `QUALIFICATION`: chạy các vòng xếp hạng; mỗi vòng có cutoff submission riêng.
- `RANKING_LOCKED`: không nhận thay đổi làm ảnh hưởng thứ hạng; BTC kiểm tra và công bố seed.
- `FINALS`: chỉ submission đã khóa được thi đấu; mọi thay đổi phải theo quy trình sự cố.
- `COMPLETED`: kết quả cuối, bracket và replay được đóng băng để công bố.
- `CANCELLED`: chỉ quản trị viên được chuyển đến; phải có lý do và audit log.

Sau khi một giai đoạn bắt đầu, BTC KHÔNG ĐƯỢC sửa ngược cấu hình ảnh hưởng tính công bằng. Nếu bắt buộc sửa, phải tạo phiên bản cấu hình mới, nêu phạm vi ảnh hưởng và quyết định chạy lại.

### 5.2 Hai giai đoạn thi đấu [v0.5]

| Giai đoạn | Hình thức | Hạ tầng | Công chúng xem được |
| --- | --- | --- | --- |
| Vòng loại online (`QUALIFICATION`) | Round theo tuần, ghép cặp theo Elo (mục 11) | Một server lab + trang công khai qua CDN/static hosting | Bảng xếp hạng, tiến độ round, trạng thái hàng đợi (mục 13.4) |
| Chung kết offline (`FINALS`) | 8 đội, single-elimination BO3 tại địa điểm BTC (mục 12) | Mạng LAN cách ly; kết quả được đồng bộ lên web online sau mỗi vòng | Bracket, kết quả và replay từng trận |

### 5.3 Vòng đời một round online theo tuần [v0.5]

```text
DRAFT_RULES → SUBMISSION_OPEN → SUBMISSION_CLOSED → RUNNING → SETTLING → RATED → PUBLISHED
                    │                                  │
                    └──── (gia hạn nếu có sự cố) ◄───────┘ (tạm dừng/tiếp tục)
```

- `DRAFT_RULES`: BTC soạn bộ luật của tuần (`RoundRuleSet`, mục 14.1): map set, engine version, chính
  sách thời gian suy nghĩ, giới hạn bộ nhớ/CPU, `maxTurns` và lịch.
- `SUBMISSION_OPEN`: bộ luật tuần được **khóa và công bố** trên trang luật (mục 13.5) ngay khi mở cổng.
  Cổng nộp mở trong nhiều ngày để tránh dồn tải upload; đội có thể nộp lại bao nhiêu lần tùy thích trong
  quota (mục 8.5).

  Lịch mặc định của một tuần (D-14, giờ Việt Nam, BTC chỉnh được trong `RoundRuleSet`):

  | Mốc | Thời điểm |
  | --- | --- |
  | Công bố kết quả tuần trước và mở cổng nộp | Thứ Ba 14:00 |
  | Hạn bấm "Nộp" (mục 8.5) | Thứ Sáu 23:59 |
  | Hết ân hạn cho file đang truyền dở, đóng cổng | Thứ Bảy 12:00 |
  | BTC bấm "Bắt đầu round" | Thứ Bảy 14:00 |
  | Round chạy xong (tối đa 48 giờ) | Chậm nhất Thứ Hai 14:00 |
  | Hết cửa sổ khiếu nại (mục 17.6) | Thứ Ba 12:00 |
- `SUBMISSION_CLOSED`: BTC đóng cổng nộp. Submission `ACTIVE` của mỗi đội được pin cho round.
- `RUNNING`: chỉ bắt đầu khi BTC bấm **"Bắt đầu round"**. Thao tác này PHẢI có xác nhận hai bước,
  idempotent, ghi audit, và chỉ chạy được khi cổng nộp đã đóng. Lịch được tạo và đóng băng từ snapshot
  tại thời điểm bấm (mục 11.2).
- `SETTLING` → `RATED`: Elo được tính lại **một lần cho cả tuần**, sau khi mọi series của round finalize
  (mục 11.3). Trong lúc round chạy, kết quả từng trận hiện ngay nhưng Elo trên bảng xếp hạng là Elo đầu
  tuần, kèm nhãn rõ ràng.
- `PUBLISHED`: bảng xếp hạng chính thức của tuần được công bố; khi đó cổng nộp của tuần sau mới được mở.
  Vòng loại tự chuyển sang `PUBLISHED` ngay khi xếp hạng xong, không cần BTC bấm công bố. (Đồng bộ docs-as-code, loop 101.)
- `CANCELLED`: BTC có thể hủy một round chưa bắt đầu (trước `RUNNING`) kèm lý do; trạng thái cuối, bản nộp của đội giữ nguyên và round mới có thể được tạo ngay. (Đồng bộ docs-as-code, loop 101.)
- BTC CÓ THỂ tạm dừng round (không nhận job mới, job đang chạy vẫn chạy xong) và tiếp tục; KHÔNG ĐƯỢC
  sửa bộ luật của round đang chạy. Thay đổi luật chỉ có hiệu lực từ round sau.

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

- Mỗi trận PHẢI có `maxTurns` để không chạy vô hạn. Phase 1/v1 dùng 200; Phase 3 dùng giá trị trong
  versioned `RoundRuleSet`/`FinalsRuleSet`, default PoC là 200 và BTC được đổi trước khi lock.
- Hết `maxTurns` mà chưa có người thắng thì trận có kết quả hòa `TURN_LIMIT` ở vòng xếp hạng.
- Nếu không phát sinh lỗi phụ thuộc timing/tài nguyên, cùng engine version, map version, hai submission, cấu hình và seed PHẢI tạo cùng chuỗi state/event. Các lỗi timing/tài nguyên phải được ghi riêng để tái hiện theo attempt.
- Engine không được dùng thời gian hệ thống, random không seed hoặc dữ liệu từ bot để quyết định luật.
- Chính sách xử lý hòa vòng chung kết đã chốt tại mục 12.1/D-05: game adapter criteria rồi qualification seed fallback.

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

- `docs/contracts/bot-protocol-v2.md` và `docs/contracts/bot-protocol-v2.schema.json` (giao thức duy nhất được hỗ trợ)
- `docs/contracts/bot-protocol-v1.md` và `docs/contracts/bot-protocol-v1.schema.json` — **deprecated, không dùng**; chỉ lưu lịch sử Phase 1
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
- [v0.5] Timeout 3.000 ms ở trên chỉ là giá trị của Protocol v1. Trận official Phase 3 dùng Protocol v2
  và thời gian suy nghĩ do `RoundRuleSet` của từng round quyết định; xem D-15 và
  [Bot Protocol v2](contracts/bot-protocol-v2.md).

### 7.4 Chính sách thời gian suy nghĩ [v0.5]

Về cuối trận, bot cần nhiều thời gian suy nghĩ hơn. Admin chọn một chính sách cho mỗi round trong trang
cấu hình (mục 14.1):

| Lựa chọn trong UI | Ý nghĩa |
| --- | --- |
| `No limit` | Không giới hạn thời gian từng nước; vẫn bị chặn bởi trần cứng của mỗi trận (bên dưới) |
| `3s` | Mỗi nước tối đa 3 giây (giá trị Protocol v1 hiện hành) |
| `30s` | Mỗi nước tối đa 30 giây |
| `1min` | Mỗi nước tối đa 60 giây |
| `Dynamic` | Đầu trận cho nghĩ ít, càng về sau cho nghĩ nhiều hơn |

Yêu cầu:

- `Dynamic` PHẢI là hàm **xác định theo số lượt**, không phụ thuộc đồng hồ thực, để mọi bot và replay đều
  biết chính xác giới hạn của từng lượt. Dạng đề xuất:
  `limit(turn) = min(maxMs, baseMs + stepMs × floor(turn / everyTurns))`, với các tham số do admin nhập.
- Mọi chính sách, kể cả `No limit`, PHẢI kèm **trần cứng cho mỗi bot mỗi trận** (tổng thời gian suy nghĩ,
  kiểu đồng hồ cờ vua) và **trần wall-clock cho cả trận**. Hết tổng thời gian thì áp dụng policy timeout
  hiện hành. Thiếu trần cứng, một trận có thể giữ worker vô thời hạn.
- Giới hạn của lượt hiện tại PHẢI được gửi cho bot trong message của lượt đó. Protocol v1 từ chối mọi
  field lạ, nên việc này cần **Bot Protocol v2**; xem D-15.
- Trang cấu hình PHẢI hiển thị **thời lượng xấu nhất ước tính của round** (mục 10.4) ngay khi admin chọn
  chính sách, và chặn hoặc bắt xác nhận lại nếu ước tính vượt khung thời gian chạy round. `30s`, `1min`
  và `No limit` chỉ được dùng cho chung kết offline hoặc test run riêng, không dùng cho qualification online.
- Chính sách đã chọn được ghi vào `RoundRuleSet`, pin vào từng `Match` và hiển thị trên trang luật tuần.
- Default qualification: 60 giây tổng thời gian suy nghĩ cho mỗi bot/game; `Dynamic` bắt đầu 1.000 ms,
  tăng 500 ms sau mỗi 40 lượt, tối đa 3.000 ms/lượt; startup 5 giây; wall-clock tối đa 150 giây/game.
  BTC được đổi các giá trị cho round sau, nhưng mọi trận official phải có tổng thời gian và wall-clock hữu hạn.

## 8. Đăng ký đội và nộp bot (`bot-submission`)

### 8.1 Đội thi

- Mỗi đội có mã duy nhất, tên hiển thị và đúng một `TEAM_ACCOUNT` ở Phase 2.
- Tên đội phải duy nhất trong một giải và tuân theo quy định nội dung của BTC.
- Chỉ đội đủ điều kiện và không bị đình chỉ mới được kích hoạt submission.
- Username của đội do server tạo từ tên đội với hậu tố chống trùng; BTC chỉ cần nhập tên đội. Không có
  self-service roster, self-service password reset hoặc tạo tài khoản đội từ portal trong Phase 2.

### 8.2 Gói nộp

- Hệ thống nhận OCI Image Spec 1.1 trong một OCI Image Layout archive không nén (`imageLayoutVersion: 1.0.0`) cho `linux/amd64`; không nhận `bot.py`, source archive, Dockerfile, registry URL hoặc image tag làm submission chính thức Phase 2.
- Image phải có OCI `Entrypoint` không rỗng. BTC không nhận language, command hay runtime do client khai báo; worker derive entrypoint/digest từ OCI config và override sandbox policy.
- Định dạng OCI, giới hạn archive/layer, quota và cách đóng gói local model PHẢI được công bố trước vòng đăng ký. Dependency và model cần thiết phải nằm trong image; không cài từ Internet khi chạy trận.
- Mỗi lần nộp tạo một submission bất biến với `submissionId`, SHA-256, thời gian, chủ sở hữu và trạng thái.
- [v0.5] Dung lượng image là ràng buộc cứng về đĩa và băng thông của server lab. Vì vậy:
  - Trần dung lượng archive do **BTC đặt trong trang cấu hình** (`RoundRuleSet`, mục 14.1) và được công bố
    trên trang luật tuần (D-18). Trần mới chỉ áp dụng từ round sau. Khi BTC hạ trần, trang cấu hình PHẢI
    cho biết có bao nhiêu submission `ACTIVE` đang vượt trần mới, để BTC báo trước cho các đội nộp lại.
    Trang cấu hình cũng NÊN hiển thị ước tính dung lượng đĩa cần dùng với trần đang chọn.
  - Default PoC là archive tối đa **512 MiB**, filesystem sau unpack tối đa **1 GiB**, tối đa **20 layer**
    và writable tmpfs **64 MiB**. BTC được cấu hình giá trị cho round sau nhưng không được sửa hồi tố round
    đã khóa.
  - BTC PHẢI phát hành sẵn **base image chính thức theo digest** (ví dụ Python, Node, native) để đội chỉ
    thêm một layer nhỏ chứa code của mình.
  - Hệ thống PHẢI lưu layer theo digest và **khử trùng lặp** layer giữa các đội, để base image chung chỉ
    lưu một lần. Một OCI image gồm nhiều lớp (layer) xếp chồng, mỗi layer được định danh bằng SHA-256
    (digest) của chính nội dung nó. Hai đội cùng build trên một base image Python thì layer Python của họ có
    cùng digest, nên chỉ cần lưu một bản; chỉ layer chứa code riêng của từng đội là khác nhau.
  - Retention: chỉ giữ submission `ACTIVE`, các submission đã dùng trong trận chính thức và 3 bản gần nhất
    của mỗi đội (D-18); phần còn lại được xóa theo chính sách công bố trước.

### 8.3 Vòng đời submission

```text
UPLOADED → VALIDATING → VALID ──→ ACTIVE
                  └──→ INVALID      └──→ SUPERSEDED
VALID/ACTIVE ───────────────────────→ REVOKED
```

- Validation gồm kiểm tra tar/OCI layout/digest/platform/entrypoint, protocol smoke test trong sandbox, thời gian khởi động và giới hạn an toàn.
- `INVALID` phải có mã lỗi và thông báo đủ để đội sửa nhưng không lộ cấu hình bảo mật nhạy cảm.
- Mỗi đội chỉ có một submission `ACTIVE` cho một stage.
- Cutoff của vòng sẽ pin đúng `submissionId`/hash; upload sau cutoff không thay đổi các trận đã xếp.
- BTC có thể `REVOKE` submission độc hại và phải ghi lý do/audit.

### 8.4 Chạy thử

- Đội được chạy test match trong quota riêng trước cutoff.
- Test match không cập nhật Elo và có thể dùng map công khai.
- Môi trường test phải gần tương đương môi trường chính thức, ngoại trừ năng lực quan sát bổ sung đã được ghi rõ.

Chi tiết [v0.5]:

- **Quota** là số test run một đội được chạy trong một khoảng thời gian (ví dụ mỗi ngày), không phải
  giới hạn tài nguyên của image. Mọi đội có quota bằng nhau: mặc định **2 test run/đội/ngày** (D-17), BTC chỉnh được trong `RoundRuleSet`. Quota được tính
  khi test run bắt đầu chạy; run bị hủy do lỗi hạ tầng được hoàn lại.
- **Đối thủ** của test run (D-17):
  1. Bot tham chiếu do BTC phát hành (ví dụ `first_legal_bot`, `capture_first_bot` và các bot mạnh hơn).
  2. Một submission khác của chính đội đó (để so sánh hai phiên bản).

  Test run **không** được đấu với submission của đội khác, để tránh do thám đối thủ.
- Test run dùng đúng sandbox, engine version và `RoundRuleSet` của round hiện tại, nhưng có **ưu tiên thấp
  nhất** trong hàng đợi (mục 10.4) và PHẢI tự động tạm dừng khi round chính thức đang chạy.
- Kết quả, replay và stderr (đã cắt ngắn) của test run chỉ đội sở hữu được xem; không bao giờ được tính
  vào Elo hay bảng xếp hạng.

### 8.5 Cửa sổ nộp bot và chống quá tải upload [v0.5]

Vấn đề: khi round mới bắt đầu hoặc sát hạn, nhiều đội có thể upload cùng lúc; uplink của server lab và
preflight sandbox đều có thể bị dồn tải.

- Cổng nộp mở **nhiều ngày**, mặc định từ đầu tuần đến hạn đóng do BTC công bố (mục 5.3).
- Upload PHẢI có giới hạn đồng thời toàn hệ thống và theo từng đội. Khi quá tải, hệ thống trả queue
  position hoặc `Retry-After`, thay vì để request treo; PoC phải chứng minh burst 50 reservation/upload.
- Preflight của submission đi vào hàng đợi riêng, ưu tiên thấp hơn trận chính thức. Đội xem được vị trí
  của mình trong hàng preflight.
- **Một lần bấm "Nộp", hệ thống tự giữ chỗ (đã chọn, D-19):** đội chỉ thao tác **một lần** như upload
  bình thường. Khi đội bấm "Nộp", portal tự tính SHA-256 của file ngay trên máy đội và gửi lên trước (request
  rất nhỏ, gọi là "giữ chỗ"), rồi mới truyền file.
  - Upload xong trước hạn: không có gì khác biệt so với upload thường.
  - Hạn đóng đến khi file vẫn đang truyền (do nghẽn mạng sát hạn): bản nộp vẫn được tính đúng hạn, miễn là
    file truyền xong trong thời gian ân hạn (mặc định 12 giờ, mục 5.3) và có đúng hash đã giữ chỗ. Nếu mạng
    đứt, đội bấm "Nộp" lại **cùng file** là được.
  - File có hash khác hash đã giữ chỗ bị từ chối, nên không ai có thêm thời gian để sửa bot sau hạn.

  Ví dụ: đội A bấm "Nộp" lúc 23:58 Thứ Sáu. Portal gửi hash `3f9a…` ngay lập tức, nhưng do nghẽn mạng
  file chỉ truyền xong lúc 00:40. Hệ thống thấy hash khớp chỗ đã giữ lúc 23:58 nên chấp nhận.
  Đội B bấm "Nộp" lúc 00:05 thì đã quá hạn và bị từ chối như bình thường.

  Lý do cần "giữ chỗ" bằng hash thay vì chỉ ghi giờ bắt đầu upload: nếu chỉ ghi giờ bắt đầu, một đội có thể
  mở kết nối lúc 23:58, truyền thật chậm rồi sửa phần còn lại của file sau hạn. Hash chốt nội dung ngay từ
  đầu nên chặn được cách này.
- **Không dùng Google Forms để nhận bot** (D-19). Phương án này đã được cân nhắc và loại vì: file nằm trong
  Google Drive của chủ form (bản miễn phí 15 GB, không đủ cho hàng nghìn image); người nộp phải đăng nhập
  Google; file nằm ngoài pipeline validate; và kênh này mâu thuẫn với ADR-0006 và mục 8.2.

### 8.6 Cấp tài khoản hàng loạt [v0.5]

Quy trình hiện tại là BTC nhập tên từng đội trên console rồi tự gửi mật khẩu qua chat. Quy trình này không
phù hợp với PoC tới khoảng 200 đội.

- BTC PHẢI có chức năng **nhập hàng loạt** (CSV) từ danh sách đăng ký đã duyệt; mỗi dòng vẫn tạo đúng một
  `TEAM_ACCOUNT` với username và mật khẩu do server sinh (tương thích D-13).
- Phát credential hàng loạt (D-20): sau khi nhập CSV, hệ thống trả về **một file credential tải được đúng
  một lần**, gồm tên đội, email người đại diện, username và mật khẩu của từng đội. BTC tự gửi bằng mail merge
  (Gmail hoặc hệ thống mail của trường), giống tinh thần D-13: credential được gửi ngoài hệ thống.
  - Hệ thống không gửi email và không cần hạ tầng mail riêng.
  - Server chỉ lưu password hash. File được sinh tại thời điểm tải và không được lưu lại trên server hay
    trong log; mất file thì BTC dùng chức năng reset (từng đội hoặc hàng loạt) để sinh mật khẩu mới.
  - File chứa mật khẩu dạng rõ, nên BTC PHẢI xóa file ngay sau khi gửi xong. Audit chỉ ghi ai nhập/tải, lúc
    nào, bao nhiêu đội; không ghi mật khẩu.
  - Đổi lại, cách này không cần endpoint đặt mật khẩu qua email: luồng đăng nhập của đội giữ nguyên.
- Danh sách đăng ký (CÓ THỂ thu bằng Google Forms) PHẢI xác minh mỗi thành viên bằng **email do trường cấp**
  (giải nội bộ, mục 1.3), để hạn chế một người lập nhiều đội (mục 17.6). Một email chỉ thuộc một đội.
- Mỗi đội có số thành viên tối đa và một người đại diện chịu trách nhiệm; quy chế do BTC công bố.

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

### 9.1 Giới hạn bộ nhớ và giám sát tài nguyên [v0.5]

Luật CÓ THỂ giới hạn bộ nhớ bot được dùng, để hạn chế bot "thuần AI" (mô hình lớn nhúng trong image) và
giữ cuộc thi tập trung vào thuật toán.

- **Thực thi** giới hạn bộ nhớ ở tầng sandbox/worker bằng cgroup (`memory.max`, swap bằng 0 hoặc bằng
  giới hạn). Vượt giới hạn là lỗi tài nguyên và bị `FORFEIT` ngay theo mục 7.3. "Check ở core" trong yêu
  cầu được hiểu là lõi thực thi (worker/sandbox), **không phải** `game-core` (D-30): `game-core` phải giữ thuần
  (mục 17.5, ADR-0002) và không đo được tài nguyên của tiến trình khác.
- **Giám sát** bằng Prometheus: thu số đo bộ nhớ/CPU của từng container bot và đỉnh bộ nhớ của mỗi trận,
  lưu kèm `MatchAttempt`. Prometheus chỉ để quan sát, cảnh báo và làm bằng chứng; không phải cơ chế chặn.
  Lưu ý: trên cgroup v2, Docker stats không trả high-water mark (đã ghi nhận trong benchmark P2-T15), nên
  đỉnh bộ nhớ phải đọc từ `memory.peak` của cgroup.
- Giới hạn bộ nhớ, CPU và trần dung lượng image là một phần của `RoundRuleSet` (mục 14.1). Admin chỉnh
  được trong trang cấu hình; giá trị chỉ có hiệu lực từ round sau và được công bố trên trang luật tuần.
- Trần dung lượng image (mục 8.2) đi cùng giới hạn RAM: không thể chặn mô hình lớn chỉ bằng RAM nếu image
  được phép nặng hàng GB.

### 9.2 Công bằng tài nguyên trên server lab [v0.5]

Server lab có thể giảm xung hoặc thiếu CPU/RAM dưới tải kéo dài. Capacity controller phải ưu tiên ổn định
và công bằng hơn việc cố giữ concurrency danh nghĩa.

- Hai bot của một trận PHẢI chạy trên cùng một máy, đồng thời.
- Mỗi bot NÊN được gắn cố định vào nhân vật lý riêng (cpuset) và không dùng chung nhân với bot khác.
- BTC PHẢI benchmark server lab và công bố **profile tham chiếu**. Mặc định tối đa 4 game đồng thời;
  worker phải giảm admission khi CPU/RAM/nhiệt độ vượt ngưỡng.
- Server chạy worker PHẢI tắt sleep/hibernate, dùng chế độ hiệu năng ổn định và được theo dõi nhiệt độ,
  dung lượng đĩa và áp lực bộ nhớ. Worker quá tải PHẢI tự ngừng nhận job mới.
- Giới hạn thời gian NÊN đủ rộng để bot điển hình chỉ dùng một phần nhỏ, giảm tác động của chênh lệch máy.

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

### 10.3 Hàng đợi bền vững và minh bạch [v0.5]

Compute không đủ để chạy mọi trận cùng lúc, nên trận phải xếp hàng. Trang công khai phải giúp đội và
khán giả hiểu tiến độ mà không tạo thêm tải lên control/execution plane.

- Hàng đợi PHẢI bền vững: restart server/worker không được làm mất hoặc chạy trùng trận.
  Nguồn sự thật là PostgreSQL (lịch + outbox) và Redis/BullMQ (có AOF) theo ADR-0001.
- **Google Sheets** (đề xuất của BTC) CÓ THỂ dùng làm **bản sao chỉ-đọc** của hàng đợi, phục vụ hiển thị và
  dự phòng thủ công. Google Sheets KHÔNG ĐƯỢC làm nguồn sự thật hay cơ chế phân phối job: API có quota
  giới hạn vài trăm request mỗi phút, không có transaction, và ai có quyền sửa là đổi được thứ tự trận.
  Xem D-16.
- Trang công khai và portal đội PHẢI hiển thị:
  - trận đang được chấm (hai đội, game số mấy, máy nào, đã chạy bao lâu);
  - độ dài hàng đợi và số trận đã xong / tổng số trận của round;
  - **thứ tự trận trong hàng đợi**, với ô tìm theo tên đội để mỗi đội thấy vị trí và thời gian chờ ước
    tính của trận mình;
  - ngay khi một trận finalize: kết quả và lý do kết thúc. Ở vòng loại, **khán giả không xem được replay**
    (đã xác nhận 13/10/2026; replay công khai chỉ có ở chung kết, mục 13.4). Hai đội trong trận được xem
    riêng nút **Replay** và danh sách nước đi của chính trận mình ngay sau kiểm tra toàn vẹn (D-21).
- Thứ tự hàng đợi được xác định bằng seed của round tại thời điểm "Bắt đầu round". Không ai, kể cả BTC, được
  chèn hay đẩy trận lên trước, trừ khi chạy lại trận lỗi hạ tầng; mọi thay đổi như vậy được ghi audit và
  hiển thị công khai.
- Dữ liệu trạng thái hàng đợi được tính sẵn định kỳ (ví dụ 15–30 giây) thành snapshot tĩnh. Lượt xem của
  khán giả không bao giờ được truy vấn trực tiếp vào database hay worker (mục 13.4).

### 10.4 Ngân sách compute và ưu tiên hàng đợi [v0.5]

Hàng đợi có ba mức ưu tiên, từ cao xuống thấp: **trận chính thức → preflight submission → test run**.
Mức thấp hơn chỉ chạy khi mức cao hơn trống.

PoC dùng tối đa khoảng 200 đội (100 series, 200 game) và mặc định 4 game chạy song song trên server lab.
Capacity controller có thể giảm concurrency dựa trên CPU/RAM. Ví dụ ước tính trước benchmark:

| Chính sách thời gian | Thời lượng một game (xấu nhất) | Thời lượng round (xấu nhất) |
| --- | ---: | ---: |
| Bot điển hình khoảng 0,3 s/nước | ~70 s | ~1 giờ |
| Default tổng 60 s/bot/game | ≤150 s wall-clock | ~2 giờ 5 phút |
| Worker giảm còn 2 game đồng thời | ≤150 s wall-clock | ~4 giờ 10 phút |

Bảng trên chỉ minh họa cách tính và PHẢI được thay bằng số đo thật. Yêu cầu:

- Trước khi cho bấm "Bắt đầu round", hệ thống PHẢI tính thời lượng xấu nhất từ số đội, `maxTurns`, chính
  sách thời gian và năng lực worker đo được, rồi cảnh báo nếu vượt khung chạy round đã công bố.
- Vòng loại online PHẢI dùng **tổng thời gian mỗi bot mỗi trận** (D-15) (đồng hồ cờ vua) thay cho giới hạn rộng
  từng nước: chặn được trường hợp xấu nhất mà vẫn cho phép nghĩ lâu ở những nước quan trọng.
- Worker phải nạp image của đội trước khi chạy. Hệ thống NÊN nạp sẵn image khi round bắt đầu, nhóm các
  trận dùng chung image trên cùng máy, và có chính sách dọn cache image trên đĩa worker.
- Worker dùng lease + heartbeat. Restart/crash làm attempt thành lỗi hạ tầng có thể retry, không làm sai
  kết quả hoặc cập nhật Elo hai lần.

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
- Rating khởi tạo là 1000. Phase 3 dùng `K = 64` trong 5 series đầu của đội, sau đó `K = 32`; policy
  được pin theo stage/rule version để ledger Phase 2 cũ vẫn tái lập được.
- Mọi series trong cùng một vòng dùng snapshot rating đầu vòng; delta được áp dụng sau khi toàn bộ series của vòng finalize để tránh phụ thuộc thứ tự worker.
- Cập nhật Elo và đánh dấu `ratingApplied` phải nằm trong cùng transaction/idempotency boundary.
- Trận hủy hoặc lỗi hạ tầng không tính Elo. Thua do lỗi bot/forfeit là kết quả hợp lệ và có tính Elo.
- Mọi điều chỉnh thủ công tạo một ledger entry riêng; không sửa mất lịch sử.

### 11.4 Bảng xếp hạng và tie-break

Qualification seed là thứ tự toàn phần, theo đúng thứ tự:

1. Elo cao hơn.
2. Số series thắng cao hơn.
3. Hiệu số điểm game cao hơn.
4. Kết quả đối đầu trực tiếp nếu đúng hai đội đang hòa.
5. Bốc thăm xác định bằng seed đã commit và công bố kèm biên bản.

Leaderboard công khai phải thể hiện ít nhất: hạng, đội, Elo, số series thắng-hòa-thua, số forfeit và thời điểm cập nhật.

### 11.5 Điều kiện đủ dữ liệu Elo [v0.5]

Với 1 series/đội/tuần (D-09), sau vài tuần mỗi đội mới đấu vài series. Đã chọn (D-22) ba biện pháp sau:

- **Vòng gác cổng rẻ:** mỗi submission mới phải đạt **ít nhất 1 điểm trong 2 game đổi phía** với bot tham
  chiếu `capture_first_bot` mới được vào pool xếp hạng. Bot tham chiếu chạy rất nhanh, nên chi phí thấp, và
  loại được phần lớn bot không hoạt động hoặc quá yếu trước khi tốn compute cho Elo. Gác cổng chạy cùng
  hàng preflight; BTC có thể đổi bot gác cổng trong `RoundRuleSet`.
- **K lớn cho đội mới:** K = 64 trong 5 series đầu tiên của đội, sau đó K = 32 (D-22, mở rộng D-03 cho Phase 3).
- **Số series tối thiểu:** đội phải có ít nhất 5 series đã finalize mới được xét vào chung kết. Nếu giải có
  ít hơn 6 round thì BTC hạ ngưỡng này và công bố trước.

Phương án "thêm series cho nhóm Top N" đã được cân nhắc và **không** chọn, để giữ D-09 (1 series/đội/round)
và ngân sách compute.

Đội chưa đủ số series tối thiểu được hiển thị tách riêng hoặc gắn nhãn "chưa xếp hạng" trên bảng xếp hạng.

## 12. Vòng chung kết (`finals-bracket`) [v0.5]

- Có đúng **8 đội**, không chia bảng, thi đấu nhánh **single-elimination**: tứ kết → bán kết → chung kết.
- Trận tranh hạng ba giữa hai đội thua bán kết do `bronzeMatchEnabled` quyết định và mặc định bật.
- Seed lấy từ qualification seed đã khóa; cặp tứ kết theo nguyên tắc `1–8`, `4–5`, `2–7`, `3–6`.
- Submission dùng ở chung kết phải được pin tại finals cutoff; không thay code giữa series trừ quy trình sự cố được BTC công bố trước. [v0.5] Finals cutoff là hạn đóng cổng nộp qua LAN (mục 12.2, D-24), không phải bản đã pin ở vòng loại.
- Mỗi cặp là BO3; game phải có winner sau chuỗi tiêu chí phụ, nên đội đầu tiên đạt 2 game thắng sẽ thắng series.
- Game 1 và Game 2 phải hoán đổi phía X/O. Phía ở game quyết định dùng server seed đã commit trước series.
- Map được chọn không lặp trong một series cho đến khi pool đã khóa cạn. Kích thước pool do
  `FinalsRuleSet`/game adapter quyết định và phải được công bố; thứ tự chọn/seed giữ kín đến policy release.
- Bracket chỉ tiến khi series trước đã `FINALIZED`.
- Mọi override của trọng tài phải có lý do, người thực hiện, thời gian và liên kết bằng chứng.

### 12.1 Rule set và xử lý hòa [v0.5]

- `FinalsRuleSet` version hóa và khóa trước finals, tối thiểu gồm `maxTurns` mỗi game, tổng wall-clock cap
  mỗi cặp, timing policy, map pool, side policy, scoring adapter/version và `bronzeMatchEnabled`.
- Default PoC là `maxTurns = 200` và tổng wall-clock cap **30 phút/cặp**. BTC được chọn giá trị khác trước
  khi khóa rule set; match official không được vô hạn.
- `30s`, `1min`, `Dynamic` và `No limit` có thể dùng cho giới hạn mỗi lượt ở finals/test run, nhưng vẫn
  phải nằm trong tổng cap hữu hạn của game/cặp.
- Platform không hard-code “điểm ăn quân” hay “ô cộng điểm”. Game adapter đã pin trả winner trực tiếp hoặc
  `scoreBreakdown` gồm các tiêu chí phụ có thứ tự và version. UI chỉ hiển thị breakdown, không tự tính luật.
- Thứ tự phân xử một game: winner trực tiếp → các tiêu chí phụ do game adapter/`FinalsRuleSet` khai báo →
  qualification seed cao hơn làm fallback cuối cùng. Vì qualification seed là thứ tự toàn phần, game không hòa.

### 12.2 Vận hành offline qua LAN [v0.5]

- Chung kết chạy trên mạng LAN **cách ly Internet**, gồm một bản triển khai riêng của nền tảng: control
  plane, worker và lưu trữ đặt trong LAN.
- Đội vào chung kết **được nộp lại bot qua LAN** (portal nội bộ hoặc thiết bị lưu trữ do BTC kiểm soát),
  để sửa bot theo luật chung kết mới của BTC (D-24). Bản nộp vẫn đi qua đúng validation/preflight.
- BTC PHẢI công bố `RoundRuleSet` của chung kết (map pool, giới hạn thời gian, bộ nhớ, thay đổi luật) trên
  trang luật trước khi mở khung nộp LAN, với thời gian đủ để đội sửa bot.
- Bản nộp cuối cùng trước khi đóng khung nộp LAN được pin cho toàn bộ chung kết. Đội không nộp lại thì dùng
  bản `ACTIVE` cuối cùng của vòng loại, với điều kiện bản đó vẫn hợp lệ theo luật chung kết.
- Mạng LAN thi đấu PHẢI tách khỏi Wi-Fi khán giả/khách, và máy của đội thi không được truy cập worker.
- Phải có backup cục bộ của database/artifact và quy trình restore/retry khi lỗi hạ tầng. Worker spare và
  HA không phải acceptance bắt buộc của PoC một server.

### 12.3 Đồng bộ kết quả chung kết lên web online [v0.5]

- Sau mỗi vòng, BTC xuất một **ResultBundle**: bracket, kết quả trận, event log và manifest RFC 8785 chứa
  SHA-256 của từng file. Manifest được ký Ed25519 bằng private key chỉ tồn tại ở phía offline/finals.
- BTC upload gói lên hệ thống online. Hệ thống online PHẢI kiểm tra chữ ký và checksum trước khi công bố;
  gói sai chữ ký hoặc thiếu file bị từ chối toàn bộ.
- Hệ thống online chỉ giữ public key, verify phía server rồi công bố `bundleId`, `keyId`, checksum, thời điểm
  import và trạng thái `VERIFIED`; sau đó khán giả xem bracket và replay từng trận chung kết.
- Upload lại cùng một gói phải idempotent; gói sửa lỗi phải là phiên bản mới, có audit và lý do.
- PoC cho phép export/import thủ công và test key riêng; demo bắt buộc có một bundle hợp lệ và một bundle
  bị sửa một byte. HSM, tự động rotate key và đồng bộ tự động không thuộc phạm vi PoC.

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
- Trận phải được tính xong, event log phải qua kiểm tra toàn vẹn trước khi BTC phát hành replay;
  không có live stream hoặc can thiệp vào trận đang chạy.
- BTC chọn replay terminal trong console để giữ `STAGED` trước khi công bố `PUBLISHED`; khán giả
  chỉ xem replay `PUBLISHED` qua control plane.
- Replay công khai phải tải được theo `matchId`, kiểm tra schema version và checksum.
- [v0.5] Vòng loại **không phát hành replay công khai**; replay công khai chỉ dành cho chung kết và vẫn qua
  quy trình stage/publish của D-11. Hai đội xem riêng replay trận của mình sau integrity check. Đây là dự án
  mới, chưa có replay public cũ; policy áp dụng từ dữ liệu đầu tiên và không có migration/hồi tố.

### 13.3 Chức năng UI

- Play/pause, tua theo lượt, chỉnh tốc độ (ít nhất 0.5×, 1×, 2×) và xem kết quả.
- Hiển thị map, hai đội, lượt, action, quân bị ăn, lỗi kỹ thuật và lý do kết thúc.
- Seek phải dựa trên event index/snapshot, không dựa vào `setInterval` như nguồn thời gian duy nhất.
- Reload trang không làm thay đổi nội dung replay.
- Giao diện dùng được trên desktop và mobile, có điều khiển bàn phím và nhãn truy cập cơ bản.
- [v0.5] Có danh sách nước đi (dạng văn bản, ví dụ `b3→c4`) đồng bộ với vị trí đang phát; bấm vào
  một nước sẽ nhảy tới lượt đó.

### 13.4 Trang công khai theo dõi tiến độ giải [v0.5]

Một trang web công khai, không cần đăng nhập, cho người ngoài theo dõi giải:

| Giai đoạn | Nội dung tối thiểu |
| --- | --- |
| Vòng loại online | Bảng xếp hạng (mục 11.4), round hiện tại và trạng thái (mục 5.3), tiến độ và hàng đợi (mục 10.3), kết quả trận đã xong. **Không có replay** |
| Chung kết offline | Bracket, lịch/kết quả các cặp, trạng thái `VERIFIED` của ResultBundle và replay từng trận sau đồng bộ (mục 12.3) |
| Mọi lúc | Trang luật tuần hiện tại (mục 13.5), thông báo của BTC, lịch các mốc |

Chống quá tải truy cập khi gần có kết quả:

- Trang công khai PHẢI tách khỏi hạ tầng chạy trận. Server worker KHÔNG ĐƯỢC nhận trực tiếp lưu lượng của
  khán giả.
- Dữ liệu công khai (bảng xếp hạng, hàng đợi, kết quả, replay) được xuất thành **file tĩnh** (JSON/HTML) theo
  chu kỳ hoặc theo sự kiện, rồi phục vụ qua CDN hoặc static hosting có bậc miễn phí, kết hợp tunnel có WAF
  (D-25). PoC phải chứng minh khoảng 1.000 public clients đọc snapshot mà không chạm database/worker.
- Client cập nhật bằng polling có cache (ví dụ 15–30 giây), không giữ kết nối realtime tới máy BTC. "Thời
  gian thực" nghĩa là trễ tối đa bằng chu kỳ snapshot, và trang PHẢI hiển thị thời điểm cập nhật cuối.
- Khi nguồn dữ liệu gặp sự cố, trang vẫn phục vụ snapshot cuối cùng kèm cảnh báo "dữ liệu cập nhật lúc …",
  thay vì trả lỗi.

### 13.5 Trang luật của tuần hiện tại [v0.5]

Mỗi round online có một trang công bố luật, được tạo tự động từ `RoundRuleSet` đã khóa (mục 14.1), gồm:

- **Map set** của tuần: hình bàn cờ, chướng ngại, vị trí spawn/đích, `mapId`, version và checksum để tải về.
- **Thay đổi luật game** so với tuần trước (changelog dễ đọc) và engine version áp dụng.
- **Giới hạn thời gian** suy nghĩ (chính sách ở mục 7.4 cùng tham số và trần cứng), `maxTurns`, policy lỗi bot.
- **Giới hạn bộ nhớ, CPU, PID, dung lượng image**, startup timeout và các giới hạn sandbox khác.
- Lịch của tuần: mở cổng, hạn bấm "Nộp", hết ân hạn cho file đang truyền, dự kiến "Bắt đầu round", dự kiến công bố kết quả.
- Quota test run và các bot tham chiếu có sẵn.

Trang luật bị khóa khi cổng nộp mở; sửa lỗi chính tả được, nhưng sửa giá trị thì phải tạo phiên bản mới của
round. Luật của các tuần trước được lưu trữ và vẫn xem được. Replay của một trận luôn được dựng theo đúng
engine version và bộ luật của tuần mà trận đó đã đấu.

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

### 14.1 Trang cấu hình luật và giới hạn của round [v0.5]

Admin UI PHẢI có trang soạn `RoundRuleSet` cho round kế tiếp, gồm tối thiểu:

| Nhóm | Thiết lập |
| --- | --- |
| Thời gian suy nghĩ | Dropdown `No limit` / `3s` / `30s` / `1min` / `Dynamic`. Chọn `Dynamic` thì hiện thêm `baseMs`, `stepMs`, `everyTurns`, `maxMs`. Mọi lựa chọn đều có trần tổng thời gian mỗi bot mỗi trận và trần wall-clock mỗi trận (mục 7.4) |
| Bộ nhớ và tài nguyên | RAM tối đa, số vCPU, số PID, tmpfs, dung lượng archive tối đa (mục 9.1) |
| Luật game | Engine version, map set, `maxTurns`, policy lỗi bot |
| Lịch | Mở cổng nộp, hạn bấm "Nộp", hết ân hạn truyền file, khung chạy round dự kiến |
| Test run | Quota mỗi đội, đối thủ được phép (mục 8.4) |

- Trang hiển thị ước tính thời lượng xấu nhất của round (mục 10.4) và cảnh báo khi vượt khung.
- Lưu bộ luật tạo một phiên bản mới, không ghi đè. Bộ luật chỉ áp dụng cho round chưa mở cổng; round đã
  `SUBMISSION_OPEN` trở đi dùng bộ luật đã khóa.
- Mỗi thay đổi được ghi audit (ai, khi nào, giá trị trước/sau, lý do).
- Admin CÓ THỂ chạy "dry-run" bộ luật với bot tham chiếu trước khi khóa, để kiểm tra map và giới hạn hợp lệ.
- Ngoài bộ luật, BTC cần các nút vận hành: mở/đóng cổng nộp, gia hạn, "Bắt đầu round" (mục 5.3), tạm
  dừng/tiếp tục round, công bố kết quả tuần, và nhập/xuất gói kết quả chung kết (mục 12.3).

## 15. Mô hình dữ liệu tối thiểu

| Thực thể | Trường định danh và quan hệ chính |
| --- | --- |
| `Tournament` | `id`, version cấu hình, stage, mốc thời gian |
| `Account` | `id`, `username`, password hash, loại account, `teamId` nullable, status |
| `Session` | `id`, account, opaque token hash, expiry, revoked time |
| `Team` | `id`, tên, trạng thái, `TEAM_ACCOUNT` 1:1 |
| `Submission` | `id`, `teamId`, archive hash, OCI manifest/config digest, platform, derived entrypoint, policy version, status, artifact URI |
| `MapVersion` | `mapId`, version, checksum, visibility |
| `Round` | `id`, stage, cutoff, rating snapshot, schedule seed |
| `Series` | `id`, hai team, format, status, winner |
| `Match` | `id`, `seriesId`, hai submission, side, map, seed, status |
| `MatchAttempt` | `id`, `matchId`, worker, thời gian, outcome kỹ thuật |
| `MatchResult` | winner, reason, turn count, final hash, game adapter/version, ordered score breakdown, log URI |
| `RatingLedger` | team, rating trước/sau, delta, `seriesId`, round |
| `Replay` | `matchId`, schema, checksum, visibility, URI |
| `AuditEvent` | actor, action, target, reason, correlation ID |
| `RoundRuleSet` [v0.5] | `id`, version, round, engine version, map set, chính sách thời gian và tham số, giới hạn tài nguyên, lịch, trạng thái khóa |
| `SubmissionReservation` [v0.5] | `teamId`, round, archive SHA-256 giữ chỗ, thời điểm bấm "Nộp", hạn ân hạn, submission khớp |
| `TestRun` [v0.5] | `id`, `teamId`, submission, đối thủ (bot tham chiếu/submission), rule set, trạng thái, kết quả riêng tư |
| `QueueSnapshot` [v0.5] | round, thời điểm, trận đang chạy, thứ tự chờ, tiến độ; là dữ liệu dẫn xuất để công bố, không phải nguồn sự thật |
| `ResultBundle` [v0.5] | vòng chung kết, bundle/key/version, canonical manifest checksum, chữ ký Ed25519, trạng thái kiểm tra, thời điểm đồng bộ |

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
- Artifact storage: API **S3-compatible**; môi trường phát triển dùng **SeaweedFS** và production có thể dùng AWS S3 theo ADR-0007.
- Portal Phase 2: **React** và **Vite**.

### 16.2 Môi trường phát triển cục bộ

- PostgreSQL, Redis và SeaweedFS PHẢI chạy bằng container Docker và được khởi động bằng một Docker Compose project của repository.
- Các dịch vụ trên chỉ được publish lên loopback (`localhost`) trong môi trường phát triển; ứng dụng đọc endpoint và credential từ biến môi trường, không hard-code trong source.
- Compose PHẢI có health check cho cả ba dịch vụ để API/worker và integration test chỉ bắt đầu sau khi dependency sẵn sàng.
- Repository PHẢI cung cấp `.env.example` không chứa secret thật và một lệnh thống nhất để dựng, kiểm tra trạng thái và hạ local stack.
- PostgreSQL và SeaweedFS dùng volume cục bộ để giữ dữ liệu qua lần restart thông thường; phải có lệnh reset rõ ràng cho môi trường kiểm thử sạch.
- Cổng host cụ thể được quản lý trong file môi trường và có thể override để tránh xung đột trên máy thành viên; giao tiếp production không được suy ra từ cấu hình localhost.

Ranh giới module, transaction/outbox, contract job, trust boundary và thứ tự delivery Phase 2 được cụ thể hóa tại [Solution Architecture Phase 2](architecture/solution-architecture-phase-2.md). Kiến trúc này tuân theo ADR-0005; requirement hiện hành vẫn là nguồn nghiệp vụ ưu tiên.

Kiến trúc đã duyệt cho Phase 2B carry-over và chung kết offline được mô tả tại
[Solution Architecture Phase 3](architecture/solution-architecture-phase-3.md) và các ADR Phase 3. SA không
thay thế contract version hóa; trạng thái implementation vẫn nằm trong `tasks/todo.md`.

## 17. Yêu cầu phi chức năng

### 17.1 Bảo mật

- Mọi upload và input bot phải được xem là không tin cậy.
- Xác thực/ủy quyền ở mọi API thay đổi trạng thái.
- Secret không xuất hiện trong image bot, event log, replay hoặc client bundle.
- Artifact có checksum, kiểm soát truy cập và retention policy.
- Có quy trình vá/rebuild runtime image và pin image bằng digest.
- [v0.5] Hardening cho PoC public, giả định có người sẽ cố tấn công:
  - Server lab KHÔNG ĐƯỢC mở cổng dịch vụ dữ liệu trực tiếp ra Internet. Lưu lượng vào đi qua reverse proxy/tunnel có
    WAF và chống DDoS (ví dụ bậc miễn phí của một CDN), D-25.
  - Admin console và API quản trị **chỉ truy cập được từ các mạng được phép** (LAN hoặc VPN). Tài khoản BTC
    dùng **xác thực hai lớp (TOTP)**: sau mật khẩu, nhập mã 6 số từ ứng dụng authenticator, có mã khôi phục
    khi mất điện thoại. Đây là phần mở rộng của D-13 (D-28).
  - Cả hai là **cấu hình bật/tắt** (ví dụ danh sách mạng được phép và cờ bắt buộc TOTP), để giai đoạn thử
    nghiệm dễ tiếp cận nhất:
    - Môi trường dev/test/thử nghiệm: **tắt mặc định**. Danh sách mạng trống nghĩa là admin truy cập được từ
      mọi nơi, như hiện nay; BTC đăng nhập bằng mật khẩu như cũ.
    - Môi trường hosted PoC/giải chính thức: **bắt buộc bật**, là một mục trong checklist trước khi mở đăng
      ký. Ứng dụng ở chế độ hosted/production PHẢI từ chối khởi động nếu TOTP tắt hoặc danh sách mạng trống.
    - Test tự động (kể cả qualification E2E) chạy được với TOTP bật bằng secret thử nghiệm đã biết.
  - Trang công khai là site tĩnh chỉ-đọc, tách khỏi portal đội, để giảm bề mặt tấn công.
  - Rate limit theo IP và theo tài khoản cho login, upload, test run và mọi API ghi; giới hạn kích thước body
    ở proxy; dùng header bảo mật (CSP, HSTS, `X-Content-Type-Options`, frame-ancestors).
  - Quét lỗ hổng dependency trong CI, có quy trình vá khẩn cấp, quản lý secret ngoài repository và xoay vòng
    secret sau sự kiện.
  - Kiểm thử xâm nhập (hoặc ít nhất một vòng tự tấn công có checklist OWASP Top 10) trước khi mở đăng ký.
  - Có quy trình ứng phó sự cố: ai có quyền tắt cổng nộp, đưa site về chế độ chỉ-đọc, và thông báo công khai.

### 17.2 Tin cậy và nhất quán

- Rating, finalize result và bracket advancement phải idempotent.
- Queue hỗ trợ at-least-once nhưng business operation phải cho hiệu ứng exactly-once.
- Backup database và artifact metadata; định kỳ kiểm tra restore.
- [v0.5] Server lab là điểm lỗi duy nhất của PoC, nên phải tính đến mất điện, mất mạng và hỏng đĩa:
  - Có backup ra **ngoài server** trước/sau mỗi round và quy trình restore đã smoke-test. HA/DR 24/7 không
    thuộc acceptance PoC.
  - NÊN dùng UPS và mạng có dây để có thể tắt an toàn.
  - Mất kết nối Internet chỉ làm trang công khai chậm cập nhật; không được làm mất trận hay kết quả.
- Mọi timestamp lưu UTC; UI hiển thị theo múi giờ giải.

### 17.3 Hiệu năng và năng lực

- Scheduler không nhận thêm job vượt tổng quota CPU/RAM của worker pool.
- API đọc bảng xếp hạng/replay không được làm chậm execution plane.
- BTC phải chạy smoke/load test theo target PoC ở mục 1.3 trên đúng server lab trước buổi demo.
- [v0.5] Mục tiêu D-26:
  - Round tối đa khoảng 200 đội chạy xong trong khung đã công bố, tối đa 48 giờ.
  - Khoảng 100 session đăng nhập đồng thời và burst 50 reservation/upload có backpressure rõ ràng.
  - Mặc định 4 game sandbox đồng thời, tự giảm theo tài nguyên mà không mất job/result.
  - Trang công khai chịu được khoảng 1.000 người xem đồng thời qua CDN/static mà không ảnh hưởng execution plane.
  - Trạng thái công khai trễ không quá 60 giây so với thực tế.
  - Upload chịu được việc toàn bộ đội nộp trong ngày cuối nhờ cơ chế giữ chỗ bằng hash khi bấm "Nộp" (mục 8.5).

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
- [v0.5] Luật có thể đổi hằng tuần, nên hệ thống PHẢI chạy trận theo đúng engine version pin trong
  `RoundRuleSet`, và vẫn kiểm tra/phát lại được replay của các tuần cũ sau khi engine đã có version mới.

### 17.6 Chống gian lận và toàn vẹn kết quả [v0.5]

| Rủi ro | Biện pháp tối thiểu |
| --- | --- |
| Một người lập nhiều đội để "nuôi" Elo hoặc dàn xếp kết quả | Xác minh danh tính khi đăng ký (mục 8.6); quy chế cấm và chế tài công bố trước |
| Hai bot nhận ra nhau bằng chuỗi nước đi "bắt tay" rồi một bên cố tình thua | Ghép cặp theo seed nên khó chọn đối thủ; phát hiện thống kê các trận thua bất thường (forfeit/thua rất nhanh lặp lại với cùng nhóm đội); BTC xem replay của Top N trước khi chốt vé chung kết |
| Bot biết đối thủ là ai rồi đổi chiến thuật | `matchId` gửi cho bot PHẢI là định danh mờ, không chứa tên/mã đội; bot không nhận thông tin danh tính đối thủ |
| Seed bị lộ qua bot | Protocol v2 không gửi `engineSeed`; mỗi bot nhận `botSeed` riêng được HMAC từ match/game/team/protocol context. Replay riêng lưu dữ liệu cần để tái hiện nhưng không lộ seed đối thủ |
| Nộp bot y hệt bot của đội khác hoặc bot mẫu của BTC | Đối chiếu tự động manifest/config digest và digest các layer không thuộc base image chính thức; trùng hệt thì gắn cờ cho BTC xem xét |
| Cố tình thua để tụt xuống dải Elo dễ hơn | Theo dõi biến động Elo bất thường; quy chế xử lý |
| Dùng test run để do thám đối thủ | Test run không được đấu với bot của đội khác (mục 8.4, D-17) |
| Sửa event log hoặc kết quả | Checksum và kiểm tra toàn vẹn (đã có); gói kết quả chung kết có chữ ký (mục 12.3); công bố hash kết quả mỗi round để cộng đồng đối chiếu |
| Khiếu nại kết quả | Có cửa sổ khiếu nại sau mỗi round, trước khi kết quả tuần được công bố chính thức; chỉ chạy lại khi có lỗi hạ tầng đã xác minh |

### 17.7 Đối tượng tham gia và dữ liệu cá nhân [v0.5]

Đã chốt (D-29): đây là giải **nội bộ trường đại học**, không đặt điều kiện độ tuổi. Điều kiện tham gia là có
email do trường cấp (mục 8.6).

- Chỉ thu dữ liệu tối thiểu cần cho xác minh và liên lạc (họ tên, email trường); trang công khai chỉ hiện tên đội.
- Tên đội được kiểm duyệt nội dung (mục 8.1) vì xuất hiện trên trang công khai.

### 17.8 Hỗ trợ người tham gia và truyền thông [v0.5]

Phần lớn áp lực lên BTC đến từ câu hỏi lặp lại và việc thiếu thông tin:

- Lỗi `INVALID` và lỗi preflight PHẢI tự giải thích được (mã lỗi + hướng sửa), kèm stderr đã cắt ngắn của
  chính bot đó, để đội tự sửa mà không cần hỏi BTC.
- Có FAQ, bộ khởi tạo bot (starter kit) theo từng ngôn ngữ trên base image chính thức, và hướng dẫn tự build
  OCI archive.
- Có kênh thông báo chính thức và trang trạng thái hệ thống (đang chạy round, đang bảo trì, sự cố).
- Khi có sự cố làm chậm round, trang công khai hiển thị thông báo và thời gian dự kiến, không im lặng.

## 18. Chiến lược kiểm thử và tiêu chí nghiệm thu

### 18.1 Các tầng kiểm thử

- **Unit:** luật 8 hướng, biên, chướng ngại, đủ 3 quan hệ ăn quân, thắng và state bất biến khi action lỗi.
- **Contract:** mọi message protocol, map và replay được validate cả trường hợp hợp lệ/không hợp lệ.
- **Integration:** Engine ↔ bot process; queue ↔ worker; finalize ↔ rating ledger.
- **Security:** network isolation, filesystem, resource limit, archive traversal, fork bomb và oversized output.
- **E2E:** nộp hai bot → validate → xếp lịch → chạy → Elo → leaderboard → replay.
- **Determinism:** chạy lại cùng artifact/seed cho cùng event sequence và final hash.
- **Load/smoke:** đạt target PoC vừa phải và chứng minh backpressure không làm mất submission/result.

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
| AC-13 [v0.5] | Smoke/load một round PoC khoảng 200 đội trên một server lab, mặc định 4 game đồng thời | Round nằm trong khung công bố; controller giảm concurrency an toàn khi CPU/RAM cao; không mất/nhân đôi result |
| AC-14 [v0.5] | Khoảng 1.000 client cùng mở trang công khai lúc có kết quả | Thời gian chạy trận không đổi; trang trả snapshot từ CDN/static |
| AC-15 [v0.5] | Burst 50 reservation/upload, một số file truyền xong sau hạn | Không mất bản nộp; upload sai hash bị từ chối; overload trả queue position/`Retry-After` |
| AC-16 [v0.5] | Bot vượt giới hạn bộ nhớ của round | Bị chặn bằng cgroup, `FORFEIT` đúng policy; đỉnh bộ nhớ có trên Prometheus |
| AC-17 [v0.5] | Chính sách `Dynamic` | Giới hạn từng lượt khớp công thức; bot nhận đúng giới hạn; replay ghi lại được |
| AC-18 [v0.5] | Admin đổi bộ luật khi round đang chạy | Bị từ chối; thay đổi chỉ áp dụng round sau; có audit |
| AC-19 [v0.5] | Restart worker/server có kiểm soát giữa pilot round | Attempt dở được nhận diện là lỗi hạ tầng; sau restore/retry không trùng kết quả hoặc Elo |
| AC-20 [v0.5] | Gói kết quả chung kết bị sửa một byte hoặc sai chữ ký | Web online từ chối toàn bộ gói |
| AC-21 [v0.5] | Test run khi round chính thức đang chạy | Test run chờ; không làm chậm trận chính thức; không ảnh hưởng Elo |
| AC-22 [v0.5] | Hai đội nộp image trùng digest | Hệ thống gắn cờ cho BTC |
| AC-23 [v0.5] | Khởi động hosted PoC/production khi TOTP tắt hoặc danh sách mạng admin trống | Ứng dụng từ chối khởi động; ở dev/test cấu hình tắt vẫn đăng nhập bình thường |

### 18.3 Definition of Done toàn hệ thống

- [ ] Các quyết định mở ở mục 20 đã được BTC chốt hoặc loại khỏi phạm vi.
- [ ] Luật, protocol, map, replay và runtime image đều có version.
- [ ] Tất cả kịch bản AC-01 đến AC-12 có bằng chứng tự động hoặc biên bản kiểm thử được duyệt.
- [ ] Không có finding bảo mật mức Critical/High chưa xử lý đối với sandbox và upload.
- [ ] Có runbook cho worker lỗi, queue kẹt, storage lỗi, rating finalize lỗi và khôi phục backup.
- [ ] Có diễn tập một vòng loại và bracket 8 đội hoàn chỉnh trên server lab/isolated LAN.
- [ ] Thể lệ công khai khớp cấu hình hệ thống đã khóa.

## 19. Phân kỳ bàn giao

### Giai đoạn 1 — Game Engine và Bot Protocol

- Luật chuẩn, map mặc định, STDIO/NDJSON, timeout, bot mẫu và trận E2E cục bộ.
- Chưa có tài khoản, upload, queue, Elo hoặc web replay.
- Cổng nghiệm thu: AC-01 đến AC-03 và determinism pass.

### Giai đoạn 2 — Vòng xếp hạng tự động

- Authentication/RBAC, đội/submission, sandbox, queue/worker, map động, scheduling, Elo,
  leaderboard, replay staging/publishing và Spectator UI.
- Cổng nghiệm thu: AC-04 đến AC-08, AC-10, AC-11 và AC-12 pass.

### Giai đoạn 2B — PoC vòng loại online vận hành được [v0.5]

- Round theo tuần và nút "Bắt đầu round" (mục 5.3); trang cấu hình luật/giới hạn (mục 14.1); chính sách
  thời gian (mục 7.4, cần Protocol v2); giới hạn bộ nhớ và giám sát Prometheus (mục 9.1); hàng đợi minh bạch
  và ưu tiên (mục 10.3–10.4); giữ chỗ bằng hash khi nộp (mục 8.5); nhập tài khoản hàng loạt (mục 8.6); test run
  (mục 8.4); trang công khai tĩnh và trang luật tuần (mục 13.4–13.5); hardening (mục 17.1); chống gian lận
  (mục 17.6).
- Cổng nghiệm thu: AC-13 đến AC-19, AC-21 đến AC-23 pass, kèm một round thử nghiệm với người dùng thật quy mô nhỏ.

### Giai đoạn 3 — Chung kết và trình diễn

- Khóa seed, bracket, BO3 và map pool; BTC dùng replay đã phát hành để trình diễn.
- [v0.5] Chung kết offline 8 đội single-elimination BO3 qua LAN (mục 12.1–12.2) và đồng bộ kết quả có
  chữ ký lên web online (mục 12.3).
- Cổng nghiệm thu: AC-09, AC-20 và diễn tập sự kiện pass.

Không bắt đầu code giai đoạn kế tiếp trước khi yêu cầu và cổng nghiệm thu của giai đoạn hiện tại được duyệt.

## 20. Quyết định BTC cần chốt

| ID | Quyết định | Giá trị cuối/đề xuất | Trạng thái | Ngày | Người duyệt | Hạn chốt |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | Số đội chung kết | 8 đội | ACCEPTED | 14/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-02 | Loại bracket | Single-elimination, không vòng bảng; trận hạng ba cấu hình được và mặc định bật | ACCEPTED | 14/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-03 | Rating khởi tạo và K-factor | 1000 và K=32; cập nhật một lần cho mỗi series terminal | ACCEPTED | 12/10/2026 | Đinh Đức Thuận | Đã chốt cho Phase 2 local |
| D-04 | Chính sách forfeit do lỗi bot | Process fault: ngay; turn fault: 3 liên tiếp hoặc 5 tổng | ACCEPTED | 09/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-05 | Xử lý hòa ở finals | Game adapter trả ordered `scoreBreakdown`; qualification seed là fallback cuối, nên game finals không hòa | ACCEPTED | 14/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-06 | Turn/time cap | `maxTurns` và tổng wall-clock cap do BTC đặt trong `FinalsRuleSet`; default PoC 200 lượt/game và 30 phút/cặp | ACCEPTED | 14/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-07 | Runtime/image/thư viện | OCI Image Spec 1.1 in OCI Image Layout (`imageLayoutVersion: 1.0.0`), `linux/amd64`, OCI Entrypoint; worker pin manifest/config digest và policy version, từ chối Dockerfile/registry URL/tag/client command | ACCEPTED | 12/10/2026 | Đinh Đức Thuận | Xem ADR-0006 và SAD OCI |
| D-08 | CPU/RAM/time/image quota | Default qualification: startup 5 s, total 60 s/bot/game, Dynamic 1.000 ms + 500 ms/40 lượt tới 3.000 ms, wall 150 s/game, message 64 KiB, stderr 1 MiB, 1 vCPU, 256 MiB RAM, 64 PID, tmpfs 64 MiB, no egress; OCI archive 512 MiB, unpacked 1 GiB, 20 layer. BTC chỉnh cho round sau | ACCEPTED | 14/10/2026 | Đinh Đức Thuận | Benchmark/smoke lại trên server lab trước demo |
| D-09 | Kích thước dải Elo và số series/vòng | 1 series/team/round; dải Elo 200, mở rộng +100 deterministic đến khi ghép được; capacity controller giới hạn theo quota worker | ACCEPTED | 12/10/2026 | Đinh Đức Thuận | Đã chốt cho Phase 2 local |
| D-10 | Single game hay cặp game đổi phía | Vòng loại dùng cặp 2 game cùng map/submission, đổi X/O; tổng điểm hòa thì series hòa | ACCEPTED | 12/10/2026 | Đinh Đức Thuận | Đã chốt cho Phase 2 local |
| D-11 | Phát hành replay | Chỉ replay sau trận terminal/integrity check; BTC stage/publish, không live stream | ACCEPTED | 12/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-12 | Quyền dùng code repo tham chiếu | Chỉ đặc tả lại behavior; không copy source khi chưa có LICENSE | ACCEPTED | 09/10/2026 | Đinh Đức Thuận | Đã chốt |
| D-13 | Authentication/RBAC cho Phase 2 | Username/password nội bộ; bootstrap BTC qua env local; `BTC_ADMIN` provision/reset một `TEAM_ACCOUNT`/team; Argon2id + Redis cookie session; không self-register | ACCEPTED | 12/10/2026 | Đinh Đức Thuận | Đã chốt |

### 20.1 Quyết định bổ sung Phase 3 [v0.5]

Đinh Đức Thuận duyệt toàn bộ baseline dưới đây ngày 14/10/2026. Contract/ADR Phase 3 mở rộng version mới;
không sửa nghĩa artifact v1 dùng cho regression Phase 1–2.

| ID | Quyết định đã duyệt | Trạng thái | Ngày | Người duyệt |
| --- | --- | --- | --- | --- |
| D-14 | Lịch mặc định Thứ Ba 14:00 → Thứ Sáu 23:59 → Thứ Bảy 12:00 → Thứ Bảy 14:00 → chạy tối đa 48 giờ → khiếu nại đến Thứ Ba 12:00; BTC chỉnh trong versioned `RoundRuleSet` | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-15 | Qualification dùng chess clock + Dynamic per-turn cap qua Protocol v2; default 60 s/bot/game, 1.000 ms + 500 ms/40 lượt tới 3.000 ms, wall 150 s/game | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-16 | PostgreSQL/outbox là nguồn lịch; Redis/BullMQ phân phối; Google Sheets chỉ có thể là bản sao chỉ-đọc | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-17 | 2 test run/đội/ngày mặc định; chỉ bot BTC hoặc submission cùng đội; không chạy khi official round cần capacity | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-18 | Default OCI: archive 512 MiB, unpacked 1 GiB, 20 layer, tmpfs 64 MiB; base image pin digest; retention ACTIVE + official + 3 bản gần nhất; đổi từ round sau | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-19 | Một lần bấm nộp tạo hash reservation; file đúng hash được hoàn tất trong grace window; không dùng Google Forms nhận bot | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-20 | CSV bulk provision; file credential tải đúng một lần, không persist/log; BTC gửi ngoài hệ thống | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-21 | Qualification replay private cho đúng hai đội và BTC từ dữ liệu đầu tiên; public replay chỉ finals; không có migration dữ liệu cũ | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-22 | Gate ≥1 điểm/2 game với bot tham chiếu; K=64 trong 5 series đầu rồi K=32; tối thiểu 5 series để xét finals | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-23 | 8 đội, không vòng bảng, single-elimination BO3; bronze match cấu hình được, mặc định bật; game adapter scoring và qualification seed fallback | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-24 | Cho nộp lại bot qua LAN; pin artifact cuối tại finals cutoff sau validation/preflight | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-25 | Static hosting/CDN cho public snapshot; HTTPS proxy/tunnel có WAF tới API; PostgreSQL/Redis/storage/worker không public port | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-26 | Target PoC một server: ~200 đội, ~100 session, 4 game adaptive, ~1.000 public viewers qua CDN, burst 50 upload/reservation; smoke/load vừa phải | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-27 | Protocol v2 không gửi `engineSeed`; mỗi bot nhận `botSeed` HMAC-derived riêng theo match/game/team/protocol context | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-28 | TOTP + admin network allowlist; tắt được ở dev/test, hosted PoC/production fail closed nếu thiếu | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-29 | Giải nội bộ trường; không điều kiện tuổi; email trường; tối thiểu hóa dữ liệu cá nhân | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |
| D-30 | cgroup ở worker/sandbox enforce tài nguyên; metrics chỉ quan sát; `game-core` giữ thuần | ACCEPTED | 14/10/2026 | Đinh Đức Thuận |

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
