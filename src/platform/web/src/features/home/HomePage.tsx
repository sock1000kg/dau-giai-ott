import { Card, LinkButton, Page } from '../../ui/index.ts';

export type HomeRole = 'BTC_ADMIN' | 'TEAM_ACCOUNT';

interface Destination {
  readonly title: string;
  readonly description: string;
  readonly href: string;
}

const BTC_CARDS: readonly Destination[] = [
  { title: 'Quản lý đội thi', description: 'Cấp tài khoản và theo dõi các đội tham gia giải.', href: '/admin/teams' },
  { title: 'Vận hành round', description: 'Cấu hình và điều khiển các round thi đấu.', href: '/admin/rounds' },
  { title: 'Vận hành đặc quyền', description: 'Các thao tác đặc quyền trên hệ thống giải đấu.', href: '/admin/operations' },
  { title: 'Kết quả thi đấu', description: 'Xem kết quả đã chốt của các trận đấu.', href: '/admin/results' },
  { title: 'Phát hành replay', description: 'Quản lý và phát hành replay trận đấu.', href: '/admin/replays' },
];

const TEAM_CARDS: readonly Destination[] = [
  { title: 'Nộp bot và xem trạng thái', description: 'Tải bot lên và theo dõi trạng thái xác thực.', href: '/team/submissions' },
  { title: 'Kết quả thi đấu', description: 'Xem kết quả và replay các trận của đội.', href: '/team/results' },
];

export function destinationsFor(role: HomeRole): readonly Destination[] {
  return role === 'BTC_ADMIN' ? BTC_CARDS : TEAM_CARDS;
}

/** Logout lives in the AppNav rendered by AppShellLayout, so the page itself carries none. */
export function HomePage({ role }: Readonly<{ role: HomeRole }>) {
  const isAdmin = role === 'BTC_ADMIN';
  return (
    <Page
      title={isAdmin ? 'Khu vực BTC' : 'Cổng đội thi'}
      description={isAdmin ? 'Tài khoản Ban tổ chức.' : 'Tài khoản đội thi.'}
    >
      <ul className="ui-card-grid">
        {destinationsFor(role).map((destination) => (
          <li key={destination.href}>
            <Card as="div">
              <h2>{destination.title}</h2>
              <p>{destination.description}</p>
              <LinkButton href={destination.href} aria-label={`Mở ${destination.title}`}>Mở</LinkButton>
            </Card>
          </li>
        ))}
      </ul>
    </Page>
  );
}
