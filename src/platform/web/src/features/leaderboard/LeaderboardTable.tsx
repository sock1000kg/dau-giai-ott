import { Badge } from '../../ui/index.ts';
import type { LeaderboardEntry } from './api.ts';
import './leaderboard.css';

const numberFormat = new Intl.NumberFormat('vi-VN');
const percentFormat = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 });

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function LeaderboardTable({ items }: Readonly<{ items: readonly LeaderboardEntry[] }>) {
  return (
    <div className="ui-table-scroll pub-table-scroll" role="region" aria-label="Bảng xếp hạng các đội" tabIndex={0}>
      <table className="ui-table pub-table">
        <caption>Thứ hạng và thành tích do máy chủ giải đấu cung cấp</caption>
        <thead><tr>
          <th scope="col">Hạng</th><th scope="col">Đội</th>
          <th scope="col" className="pub-num">Elo</th><th scope="col" className="pub-num">Đối đầu</th>
          <th scope="col" className="pub-num">Thắng / Hòa / Thua</th><th scope="col" className="pub-num">Tỉ lệ thắng</th>
          <th scope="col" className="pub-num">Lỗi kỹ thuật</th><th scope="col" className="pub-num">Bỏ cuộc</th><th scope="col">Cập nhật</th>
        </tr></thead>
        <tbody>{items.map((item) => <tr key={item.team.id} className={item.rank <= 3 ? 'pub-row-top' : undefined}>
          <th scope="row"><span className="pub-rank">
            <span className="pub-rank-value">{item.rank}</span>
            {item.tieBreakStatus === 'BTC_REQUIRED' && <Badge>Đồng hạng</Badge>}
          </span></th>
          <td className="pub-team">{item.team.name}{item.ratingStatus === 'UNRANKED_MIN_SERIES' && <> <Badge>Chưa xếp hạng</Badge></>}</td>
          <td className="pub-num">{numberFormat.format(item.rating)}</td>
          <td className="pub-num">{numberFormat.format(item.headToHeadPoints)}</td>
          <td className="pub-num">{item.series.wins} / {item.series.draws} / {item.series.losses}</td>
          <td className="pub-num">{percentFormat.format(item.winRate)}</td>
          <td className="pub-num">{item.technicalFaultCount}</td>
          <td className="pub-num">{item.forfeitCount}</td>
          <td><time dateTime={item.updatedAt}>{formatShortDate(item.updatedAt)}</time></td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}
