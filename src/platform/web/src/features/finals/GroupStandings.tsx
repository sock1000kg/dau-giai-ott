import type { FinalsProofMetadata, FinalsRankingStanding, FinalsSeriesPairing } from './api.ts';

export interface GroupStandingsProps {
  /** Kept for API compatibility; proof metadata is not shown to the public. */
  readonly proof?: FinalsProofMetadata;
  readonly standings: readonly FinalsRankingStanding[];
  readonly bracket: readonly FinalsSeriesPairing[];
  readonly isStale?: boolean;
}

export function GroupStandings({ standings, bracket, isStale }: GroupStandingsProps) {
  // Pure presentation of bracket nodes from server payload (AC-1)
  const qfPairings = bracket.filter((p) => p.pairingId.startsWith('QF'));
  const sfPairings = bracket.filter((p) => p.pairingId.startsWith('SF'));
  const finalPairing = bracket.find((p) => p.pairingId === 'F1');
  const bronzePairing = bracket.find((p) => p.pairingId === 'B1');

  return (
    <section aria-label="Bảng xếp hạng và Nhánh đấu Chung kết" className="finals-standings-section">
      {isStale && (
        <p role="alert" className="finals-stale-note">
          Dữ liệu đang hiển thị từ bản cập nhật gần nhất.
        </p>
      )}

      {/* 8-Team Standings Table */}
      <div className="leaderboard-table-scroll" style={{ marginTop: '24px' }}>
        <table className="leaderboard-table" aria-label="Bảng thứ hạng chung cuộc Vòng Chung kết">
          <thead>
            <tr>
              <th scope="col">Hạng</th>
              <th scope="col">Đội thi</th>
              <th scope="col">Hạt giống</th>
              <th scope="col">Elo Vòng loại</th>
              <th scope="col">Kết quả Chung cuộc</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.teamId}>
                <td><strong>#{row.rank}</strong></td>
                <td>{row.teamName}</td>
                <td>Hạt giống #{row.seedOrdinal}</td>
                <td>{row.qualificationRating}</td>
                <td>
                  <span className={row.rank === 1 ? 'submission-status' : ''}>
                    {row.finalOutcome}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Finals 8-Team Single Elimination Bracket Tree (AC-1) */}
      <div style={{ marginTop: '32px' }} aria-label="Sơ đồ Nhánh đấu Vòng Chung kết">
        <h2>Sơ đồ Nhánh đấu (Finals Bracket)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginTop: '16px' }}>
          {/* Tứ kết */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#8ea4b7' }}>Tứ kết (BO3)</h3>
            {qfPairings.map((pairing) => (
              <PairingCard key={pairing.pairingId} pairing={pairing} />
            ))}
          </div>

          {/* Bán kết */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#8ea4b7' }}>Bán kết (BO3)</h3>
            {sfPairings.map((pairing) => (
              <PairingCard key={pairing.pairingId} pairing={pairing} />
            ))}
          </div>

          {/* Chung kết & Tranh hạng ba */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontSize: '14px', textTransform: 'uppercase', color: '#8ea4b7' }}>Chung kết & Hạng 3</h3>
            {finalPairing && (
              <div>
                <span style={{ fontSize: '11px', color: '#ffd59a', fontWeight: 'bold' }}>TRANH VÔ ĐỊCH</span>
                <PairingCard pairing={finalPairing} isChampMatch />
              </div>
            )}
            {bronzePairing && (
              <div style={{ marginTop: '8px' }}>
                <span style={{ fontSize: '11px', color: '#8ea4b7' }}>TRANH HẠNG BA</span>
                <PairingCard pairing={bronzePairing} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PairingCard({ pairing, isChampMatch }: { readonly pairing: FinalsSeriesPairing; readonly isChampMatch?: boolean }) {
  const isAWin = pairing.winnerTeamId !== null && pairing.teamA !== null && pairing.winnerTeamId === pairing.teamA.teamId;
  const isBWin = pairing.winnerTeamId !== null && pairing.teamB !== null && pairing.winnerTeamId === pairing.teamB.teamId;

  return (
    <article
      className="result-card"
      style={{
        padding: '12px 16px',
        borderColor: isChampMatch ? 'rgba(255, 213, 154, 0.4)' : undefined,
      }}
      aria-label={`${pairing.roundName}: ${pairing.teamA?.teamName ?? 'TBD'} vs ${pairing.teamB?.teamName ?? 'TBD'}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: '#8ea4b7' }}>
        <span>{pairing.roundName}</span>
        <span className="result-status">{pairing.status}</span>
      </div>

      {/* Team A */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: isAWin ? 'bold' : 'normal', color: isAWin ? '#80e4d0' : '#f3f6fb' }}>
        <span>
          {pairing.teamA ? `${pairing.teamA.teamName} (#${pairing.teamA.seedOrdinal})` : 'Chờ xác định'}
        </span>
        <span>{pairing.score.winsA}</span>
      </div>

      {/* Team B */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid rgba(177, 204, 224, 0.1)', fontWeight: isBWin ? 'bold' : 'normal', color: isBWin ? '#80e4d0' : '#f3f6fb' }}>
        <span>
          {pairing.teamB ? `${pairing.teamB.teamName} (#${pairing.teamB.seedOrdinal})` : 'Chờ xác định'}
        </span>
        <span>{pairing.score.winsB}</span>
      </div>
    </article>
  );
}

