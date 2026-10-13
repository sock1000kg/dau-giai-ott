import type { LeaderboardEntry } from './api.ts';

const numberFormat = new Intl.NumberFormat('vi-VN');
const percentFormat = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 });

export function LeaderboardTable({ items }: Readonly<{ items: readonly LeaderboardEntry[] }>) {
  return (
    <div className="leaderboard-table-scroll" role="region" aria-label="Bảng xếp hạng các đội" tabIndex={0}>
      <table className="leaderboard-table">
        <caption className="visually-hidden">Thứ hạng và thành tích do máy chủ giải đấu cung cấp</caption>
        <thead><tr>
          <th scope="col">Hạng</th><th scope="col">Đội</th><th scope="col">Elo</th><th scope="col">Đối đầu</th>
          <th scope="col">Thắng / Hòa / Thua</th><th scope="col">Tỉ lệ thắng</th><th scope="col">Lỗi kỹ thuật</th><th scope="col">Bỏ cuộc</th><th scope="col">Cập nhật</th>
        </tr></thead>
        <tbody>{items.map((item) => <tr key={item.team.id}>
          <th scope="row"><span className="rank-value">{item.rank}</span>{item.tieBreakStatus === 'BTC_REQUIRED' && <span className="tie-break-status">BTC cần quyết định</span>}</th>
          <td className="leaderboard-team">{item.team.name}</td>
          <td>{numberFormat.format(item.rating)}</td>
          <td>{numberFormat.format(item.headToHeadPoints)}</td>
          <td>{item.series.wins} / {item.series.draws} / {item.series.losses}</td>
          <td>{percentFormat.format(item.winRate)}</td>
          <td>{item.technicalFaultCount}</td>
          <td>{item.forfeitCount}</td>
          <td><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString()}</time></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}
