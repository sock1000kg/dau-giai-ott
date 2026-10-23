# Hosted PoC và finals — chỉ chạy khi đủ hạ tầng

> Các case này **Blocked**, không phải Pass, nếu chỉ có local demo, Vitest `simulateTournament`, Compose chưa
> chạy thật hoặc thiếu hai deployment LAN/online. Mỗi case phải tuân thủ runbook tương ứng và có owner vận
> hành phê duyệt. Không tự deploy từ branch hiện tại.

## MAN-HOST-001 — Provenance và preflight server lab

**Tiền điều kiện:** host lab được chỉ định; commit/config/image digest đã khóa.

**Bước:** chạy preflight/pilot theo `hosted-poc-operations.md`; thu host inventory, mode guard, storage,
time sync, ports và dependency health.

**Mong đợi:** report gắn host/config/commit/digest; production guard không bị bypass; mọi dependency required
ready trước admission.

**Evidence:** pilot report và manifest đã loại secret.

## MAN-HOST-002 — Qualification hosted từ team đến public

**Bước:** từ máy client khác host, hai team đăng nhập/upload; BTC mở/chạy/publish round; spectator đọc static
public endpoint.

**Mong đợi:** toàn tuyến qua network thật hoàn tất; execution traffic không đi qua public static plane; kết
quả/replay privacy giống local contract; latency/error được ghi thay vì suy diễn từ simulation.

**Evidence:** timestamps client/server, IDs, network endpoint và report.

## MAN-HOST-003 — Worker loss và recovery khi có job

**Bước:** theo runbook, dừng một worker tại điểm được chỉ định khi round có job; chờ heartbeat timeout/retry;
khôi phục worker.

**Mong đợi:** backpressure/heartbeat phản ánh sự cố; rerun chỉ cho lỗi hạ tầng; không duplicate result/rating;
generation/outbox và audit đúng.

**Evidence:** timeline, metric/log, before/after DB assertions theo runbook.

## MAN-HOST-004 — Backup/restore trên host lab

**Bước:** tạo backup DB/artifact, kiểm checksum/manifest, restore vào target sạch theo runbook rồi chạy các
probe đọc.

**Mong đợi:** restore thành công; manifest toàn vẹn; round/result/ledger/artifact đối soát đủ; không ghi đè
target ngoài phạm vi và không dùng backup chưa mã hóa sai policy.

**Evidence:** backup ID, checksum manifest, reconciliation counts và thời lượng.

## MAN-HOST-005 — Finals LAN no-egress

**Tiền điều kiện:** topology `deploy/lan` chạy trên host finals thật, có cửa sổ kiểm thử network được duyệt.

**Bước:** chạy `scripts/lan-smoke.sh` và probe egress/ingress theo `finals-lan.md`; thử từ máy đội và spectator
LAN; kiểm port bindings.

**Mong đợi:** worker/datastore không bind public; execution network không egress WAN; chỉ ingress được phép
vào web/API; việc rút WAN không làm control plane LAN mất chức năng cần thiết.

**Evidence:** compose-resolved config, port list và network probe outputs.

## MAN-HOST-006 — Finals 8 đội, seed và BO3 bracket

**Bước:** provision đúng 8 đội/seed đã duyệt; pin submission/rules/schedule; chạy quarterfinal, semifinal và
final theo BO3, gồm ít nhất một series cần game quyết định nếu fixture cho phép.

**Mong đợi:** bracket deterministic, không reseed ngoài contract; winner đi đúng nhánh; series kết thúc khi
đủ thắng; UI `/finals` thể hiện schedule/bracket/result nhất quán với control plane.

**Evidence:** seed manifest, bracket trước/sau từng vòng và match IDs.

## MAN-HOST-007 — Restart/restore giữa finals

**Bước:** tại safe point trong runbook, restart service/host hoặc restore bản backup được chỉ định; tiếp tục
bracket.

**Mong đợi:** round pin và bracket không đổi; match finalized không chạy lại; pending work phục hồi đúng;
reconciliation không tạo duplicate advancement/result.

**Evidence:** timeline, state hashes và before/after counts.

## MAN-HOST-008 — Export signed ResultBundle

**Bước:** sau finals hoàn tất, export bundle bằng key test/ceremony được phê duyệt; kiểm manifest, signature,
artifact hashes và provenance mà không lộ private key.

**Mong đợi:** bundle đúng schema/version, chữ ký Ed25519 verify được bằng public key tin cậy; chứa đủ bracket,
result và replay artifacts; sửa một byte làm verification fail.

**Evidence:** bundle hash, public-key fingerprint, verify output và tamper-negative output.

## MAN-HOST-009 — Import online idempotent và public finals

**Tiền điều kiện:** online target riêng, sạch và được phép import; có bundle Pass từ case trước.

**Bước:** import bundle một lần, kiểm public pages/replays; import lại chính bundle; thử bundle tampered trên
target test an toàn.

**Mong đợi:** lần đầu tạo đúng dữ liệu; lần hai idempotent, không nhân đôi; tampered bundle bị từ chối; public
bracket/results/replay chỉ xuất hiện sau verify/publish hợp lệ.

**Evidence:** import receipt/correlation ID, before/after counts và public URLs.

## MAN-HOST-010 — Full LAN → online rehearsal và sign-off

**Bước:** nối toàn bộ provenance của `MAN-HOST-005` đến `009`; đối chiếu counts/hashes giữa LAN bundle và
online publication; ghi mọi deviation/waiver; người duyệt kiểm evidence.

**Mong đợi:** chain of custody không đứt; hash/artifact/result khớp; không có secret trong report; mọi AC liên
quan có evidence hoặc waiver được BTC ký. Chỉ người có thẩm quyền mới cập nhật checkpoint trong
`tasks/todo.md`.

**Evidence:** rehearsal report hoàn chỉnh và sign-off thực, không dùng bảng ký mẫu làm bằng chứng phê duyệt.
