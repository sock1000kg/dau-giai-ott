/**
 * One-line help per rule-form field. Sources: timing → docs/contracts/bot-protocol-v2.md,
 * resources → docs/tai-lieu-yeu-cau.md §9.1/D-08/D-18 and `rounds/types.ts` validator ranges,
 * schedule/test run → `rounds/types.ts` (ORDER_VIOLATION, ranges) and the form field names.
 */
export const FIELD_HELP = {
  startupMs: 'Thời gian tối đa từ lúc khởi động bot đến khi bot sẵn sàng nhận INIT (1–60.000 ms).',
  totalBotBudgetMs: 'Tổng thời gian suy nghĩ của mỗi bot trong một trận, như đồng hồ cờ vua; hết quỹ thì bot bị xử thua kỹ thuật (1–3.600.000 ms).',
  matchWallClockMs: 'Giới hạn cứng cho toàn bộ trận, tính theo đồng hồ máy chủ (1–7.200.000 ms).',
  perTurnMode: 'Cách tính giới hạn mỗi lượt: Cố định dùng một mức chung; Dynamic tăng dần theo số lượt.',
  fixedMs: 'Giới hạn cố định cho mỗi lượt, luôn bị chặn bởi quỹ thời gian còn lại của bot (1–3.600.000 ms).',
  baseMs: 'Giới hạn mỗi lượt lúc bắt đầu trận; không được lớn hơn mức Max (ms).',
  stepMs: 'Số ms cộng thêm vào giới hạn mỗi lượt sau mỗi N lượt (ms).',
  everyTurns: 'Cứ sau bao nhiêu lượt (tính cả hai phía) thì tăng giới hạn thêm một bước (1–10.000).',
  maxMs: 'Trần của giới hạn mỗi lượt; không được vượt quá tổng thời gian/bot/trận (ms).',
  memoryMiB: 'RAM tối đa cho mỗi bot khi chạy (1–16.384 MiB).',
  milliCpu: 'CPU tối đa cho mỗi bot, 1000 milliCPU = 1 vCPU (1–4000).',
  pids: 'Số tiến trình/luồng tối đa mỗi bot được tạo (1–1024).',
  tmpfsMiB: 'Dung lượng vùng ghi tạm trong bộ nhớ của bot (1–4096 MiB).',
  archiveMiB: 'Dung lượng tối đa của file image OCI khi nộp (1–8192 MiB).',
  unpackedMiB: 'Dung lượng tối đa của image sau khi giải nén (1–16.384 MiB).',
  maxLayers: 'Số layer tối đa của image OCI (1–128).',
  engineVersion: 'Chọn phiên bản engine có trong danh mục của hệ thống; nếu không tải được danh mục thì nhập tay.',
  maxTurns: 'Số lượt tối đa của một trận; đến giới hạn này trận kết thúc (1–1000).',
  faultPolicyVersion: 'Chọn chính sách xử lý lỗi bot có trong danh mục; nếu không tải được danh mục thì nhập tay (chữ, số, ., _, +, -; tối đa 64 ký tự).',
  mapId: 'Chọn map từ danh mục; không trùng giữa các map. Nếu không tải được danh mục thì nhập tay.',
  checksum: 'Checksum SHA-256 của map, tự điền theo map đã chọn từ danh mục (nhập tay nếu không có danh mục).',
  submissionOpensAt: 'Thời điểm bắt đầu nhận bài nộp (giờ Việt Nam); phải trước hạn nộp.',
  submissionDeadlineAt: 'Hạn nộp bài (giờ Việt Nam); phải sau giờ mở và trước khi hết gia hạn.',
  graceEndsAt: 'Thời điểm kết thúc gia hạn nộp (giờ Việt Nam); không sau giờ bắt đầu chạy.',
  runStartsAt: 'Thời điểm bắt đầu chạy các trận của round (giờ Việt Nam); phải trước khi hết khiếu nại.',
  runMaxHours: 'Khung thời gian tối đa dành cho việc chạy round (1–168 giờ).',
  appealEndsAt: 'Thời điểm kết thúc nhận khiếu nại (giờ Việt Nam); phải sau giờ bắt đầu chạy.',
  quotaPerTeamPerDay: 'Số lần test run mỗi đội được chạy trong một ngày (0–50).',
  opponentBtc: 'Cho phép test run đấu với bot tham chiếu của BTC.',
  opponentOwn: 'Cho phép test run đấu với chính bài nộp của đội; cần chọn ít nhất một đối thủ.',
  teamCount: 'Số đội dùng để ước tính tổng thời gian chạy; mặc định lấy từ danh sách đội.',
  concurrency: 'Số trận chạy song song dùng để ước tính; là giả định, chưa có số đo thực tế.',
  acknowledge: 'Xác nhận đã biết ước tính thời gian chạy vượt khung chạy tối đa của round.',
  reason: 'Lý do tạo phiên bản bộ luật này, 1–500 ký tự; được ghi vào nhật ký.',
} as const satisfies Record<string, string>;

export type FieldId = keyof typeof FIELD_HELP;

/** `rr-mapId-2` → `mapId`; `rrc-startupMs` → `startupMs`. */
export function fieldIdFromDomId(domId: string): string {
  return domId.replace(/^rr[a-z]*-/, '').replace(/-\d+$/, '');
}
