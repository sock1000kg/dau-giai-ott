import { Badge, LinkButton, Table, type TableColumn } from '../../ui/index.ts';
import type { FinalsGameDetail, FinalsSeriesPairing } from './api.ts';
import '../results/results.css';

function teamNameOf(pairing: FinalsSeriesPairing, teamId: string | null | undefined): string {
  if (teamId === pairing.teamA?.teamId) return pairing.teamA?.teamName ?? 'Đội A';
  if (teamId === pairing.teamB?.teamId) return pairing.teamB?.teamName ?? 'Đội B';
  return 'Chưa xác định';
}

function gameColumns(pairing: FinalsSeriesPairing, bundleId: string | undefined): readonly TableColumn<FinalsGameDetail>[] {
  const nameA = pairing.teamA?.teamName ?? 'Đội A';
  const nameB = pairing.teamB?.teamName ?? 'Đội B';
  return [
    { key: 'game', header: 'Ván', render: (game) => `Ván ${game.gameNumber} · ${game.mapName}` },
    {
      key: 'teams',
      header: 'Đội X vs Đội O',
      render: (game) => <strong>{game.sideA === 'X' ? `${nameA} vs ${nameB}` : `${nameB} vs ${nameA}`}</strong>,
    },
    {
      key: 'outcome',
      header: 'Kết quả',
      render: (game) => <div className="results-cell">
        {game.winnerTeamId ? <Badge accent>Thắng: {teamNameOf(pairing, game.winnerTeamId)}</Badge> : <span>Đang thi đấu</span>}
        {game.scoreBreakdown && game.scoreBreakdown.length > 0
          ? <span className="results-muted">Phân xử: {game.scoreBreakdown.map((crit) => `${crit.label} ${crit.valueA}–${crit.valueB}`).join(' · ')}</span>
          : null}
      </div>,
    },
    {
      key: 'replay',
      header: 'Replay',
      render: (game) => game.replayPublished && game.replayMatchId
        ? <LinkButton
            variant="secondary"
            href={bundleId
              ? `/spectator/replays/${game.replayMatchId}?bundle=${encodeURIComponent(bundleId)}`
              : `/spectator/replays/${game.replayMatchId}`}
            aria-label={`Phát replay ván ${game.gameNumber} trận ${pairing.roundName}`}
          >Phát</LinkButton>
        : <span className="results-muted" aria-label={`Replay ván ${game.gameNumber} chưa công bố`}>Chưa công bố</span>,
    },
  ];
}

export interface FinalsScheduleProps {
  readonly bracket: readonly FinalsSeriesPairing[];
  readonly bundleId?: string | undefined;
}

export function FinalsSchedule({ bracket, bundleId }: FinalsScheduleProps) {
  return (
    <section aria-label="Lịch thi đấu và Kết quả chi tiết Vòng Chung kết" className="finals-schedule-section" style={{ marginTop: '36px' }}>
      <h2>Lịch thi đấu & Kết quả chi tiết (BO3)</h2>
      <p style={{ color: 'var(--ui-text-muted)', fontSize: '13px', marginBottom: '20px' }}>
        Tất cả các trận đấu vòng chung kết diễn ra theo thể thức BO3 với đổi bên xen kẽ và map pool không lặp lại.
      </p>

      <div style={{ display: 'grid', gap: '20px' }}>
        {bracket.map((pairing) => (
          <article
            key={pairing.pairingId}
            className="result-card"
            style={{ padding: '16px 20px' }}
            aria-label={`Trận đấu ${pairing.roundName}`}
          >
            {/* Header: Round & Status */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--ui-border)', paddingBottom: '10px', marginBottom: '12px' }}>
              <div>
                <span className="eyebrow" style={{ color: 'var(--ui-text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  {pairing.pairingId} · BO{pairing.bestOf}
                </span>
                <h3 style={{ margin: '4px 0 0', fontSize: '16px' }}>{pairing.roundName}</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="result-status">{pairing.status}</span>
                <span style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--ui-accent)' }}>
                  {pairing.score.winsA} - {pairing.score.winsB}
                </span>
              </div>
            </div>

            {/* Teams Matchup */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: pairing.winnerTeamId === pairing.teamA?.teamId ? 'var(--ui-row-hover)' : 'var(--ui-table-stripe)', border: '1px solid var(--ui-border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--ui-text-muted)' }}>Hạt giống #{pairing.teamA?.seedOrdinal ?? 'TBD'}</div>
                <div style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '2px', color: pairing.winnerTeamId === pairing.teamA?.teamId ? 'var(--ui-accent)' : 'var(--ui-text)' }}>
                  {pairing.teamA?.teamName ?? 'Chưa xác định'}
                </div>
              </div>

              <div style={{ padding: '10px 14px', borderRadius: '8px', background: pairing.winnerTeamId === pairing.teamB?.teamId ? 'var(--ui-row-hover)' : 'var(--ui-table-stripe)', border: '1px solid var(--ui-border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--ui-text-muted)' }}>Hạt giống #{pairing.teamB?.seedOrdinal ?? 'TBD'}</div>
                <div style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '2px', color: pairing.winnerTeamId === pairing.teamB?.teamId ? 'var(--ui-accent)' : 'var(--ui-text)' }}>
                  {pairing.teamB?.teamName ?? 'Chưa xác định'}
                </div>
              </div>
            </div>

            {/* Game list: same table UI as "Kết quả từng trận" on the results page */}
            {pairing.games.length > 0 && (
              <div className="results-table">
                <Table
                  caption={`Kết quả từng ván · ${pairing.roundName}`}
                  columns={gameColumns(pairing, bundleId)}
                  rows={pairing.games}
                  rowKey={(game) => String(game.gameNumber)}
                  emptyMessage="Chưa có ván đấu."
                />
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

