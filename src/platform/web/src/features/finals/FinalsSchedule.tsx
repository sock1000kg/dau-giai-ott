import type { FinalsSeriesPairing } from './api.ts';

export interface FinalsScheduleProps {
  readonly bracket: readonly FinalsSeriesPairing[];
  readonly bundleId?: string | undefined;
}

export function FinalsSchedule({ bracket, bundleId }: FinalsScheduleProps) {
  return (
    <section aria-label="Lịch thi đấu và Kết quả chi tiết Vòng Chung kết" className="finals-schedule-section" style={{ marginTop: '36px' }}>
      <h2>Lịch thi đấu & Kết quả chi tiết (BO3)</h2>
      <p style={{ color: '#a8b8c8', fontSize: '13px', marginBottom: '20px' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(177, 204, 224, 0.12)', paddingBottom: '10px', marginBottom: '12px' }}>
              <div>
                <span className="eyebrow" style={{ color: '#8ea4b7', fontSize: '11px', textTransform: 'uppercase' }}>
                  {pairing.pairingId} · BO{pairing.bestOf}
                </span>
                <h3 style={{ margin: '4px 0 0', fontSize: '16px' }}>{pairing.roundName}</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="result-status">{pairing.status}</span>
                <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#80e4d0' }}>
                  {pairing.score.winsA} - {pairing.score.winsB}
                </span>
              </div>
            </div>

            {/* Teams Matchup */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: pairing.winnerTeamId === pairing.teamA?.teamId ? 'rgba(128, 228, 208, 0.08)' : 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(177, 204, 224, 0.1)' }}>
                <div style={{ fontSize: '11px', color: '#8ea4b7' }}>Hạt giống #{pairing.teamA?.seedOrdinal ?? 'TBD'}</div>
                <div style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '2px', color: pairing.winnerTeamId === pairing.teamA?.teamId ? '#80e4d0' : '#f3f6fb' }}>
                  {pairing.teamA?.teamName ?? 'Chưa xác định'}
                </div>
              </div>

              <div style={{ padding: '10px 14px', borderRadius: '8px', background: pairing.winnerTeamId === pairing.teamB?.teamId ? 'rgba(128, 228, 208, 0.08)' : 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(177, 204, 224, 0.1)' }}>
                <div style={{ fontSize: '11px', color: '#8ea4b7' }}>Hạt giống #{pairing.teamB?.seedOrdinal ?? 'TBD'}</div>
                <div style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '2px', color: pairing.winnerTeamId === pairing.teamB?.teamId ? '#80e4d0' : '#f3f6fb' }}>
                  {pairing.teamB?.teamName ?? 'Chưa xác định'}
                </div>
              </div>
            </div>

            {/* Individual Games List & Replay Links (AC-3) */}
            {pairing.games.length > 0 && (
              <div style={{ borderTop: '1px solid rgba(177, 204, 224, 0.08)', paddingTop: '12px' }}>
                <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: '#8ea4b7', marginBottom: '8px' }}>
                  Chi tiết từng ván đấu:
                </h4>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {pairing.games.map((game) => (
                    <div
                      key={game.gameNumber}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        padding: '8px 12px',
                        background: 'rgba(0, 0, 0, 0.2)',
                        borderRadius: '6px',
                        fontSize: '13px',
                      }}
                    >
                      <div>
                        <strong>Ván {game.gameNumber}:</strong> Map <code>{game.mapName}</code> (Side: {pairing.teamA?.teamName ?? 'A'} [{game.sideA}] vs {pairing.teamB?.teamName ?? 'B'} [{game.sideB}])
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Winner */}
                        <span style={{ fontSize: '12px' }}>
                          {game.winnerTeamId ? (
                            <span style={{ color: '#80e4d0' }}>
                              Thắng: {game.winnerTeamId === pairing.teamA?.teamId ? pairing.teamA?.teamName : pairing.teamB?.teamName}
                            </span>
                          ) : (
                            <span style={{ color: '#8ea4b7' }}>Đang thi đấu</span>
                          )}
                        </span>

                        {/* AC-3: Replay link ONLY when verified import and published */}
                        {game.replayPublished && game.replayMatchId ? (
                          <a
                            href={
                              bundleId
                                ? `/spectator/replays/${game.replayMatchId}?bundle=${encodeURIComponent(bundleId)}`
                                : `/spectator/replays/${game.replayMatchId}`
                            }
                            className="submission-status"
                            style={{
                              borderColor: '#80e4d0',
                              color: '#80e4d0',
                              textDecoration: 'none',
                              padding: '3px 8px',
                              fontSize: '11px',
                            }}
                            aria-label={`Xem replay ván ${game.gameNumber} trận ${pairing.roundName}`}
                          >
                            ▶ Xem Replay
                          </a>
                        ) : (
                          <span
                            style={{ fontSize: '11px', color: '#8ea4b7' }}
                            aria-label={`Replay ván ${game.gameNumber} chưa công bố`}
                          >
                            Chưa công bố
                          </span>
                        )}
                      </div>

                      {/* Score Breakdown (if adapter criteria present) */}
                      {game.scoreBreakdown && game.scoreBreakdown.length > 0 && (
                        <div style={{ width: '100%', fontSize: '11px', color: '#a8b8c8', marginTop: '4px', borderTop: '1px dashed rgba(255, 255, 255, 0.1)', paddingTop: '4px' }}>
                          <span>Chỉ số phân xử: </span>
                          {game.scoreBreakdown.map((crit) => (
                            <span key={crit.criterionId} style={{ marginRight: '12px' }}>
                              {crit.label}: {crit.valueA} - {crit.valueB}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

