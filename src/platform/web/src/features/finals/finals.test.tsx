import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { FinalsPage } from './FinalsPage.tsx';
import {
  parseFinalsProof,
  parseFinalsSnapshot,
  type FinalsSnapshotPayload,
} from './api.ts';

const VALID_MANIFEST_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function createFinalsFixture(): FinalsSnapshotPayload {
  return {
    schemaVersion: 1,
    tournamentId: 'TOURNAMENT_FINALS_2026',
    finalsRuleSetId: 'ruleset-finals-v1',
    stage: 'FINALS',
    updatedAt: new Date().toISOString(),
    proof: {
      bundleId: 'bundle-finals-official-001',
      bundleVersion: 1,
      keyId: 'poc-test-key',
      manifestSha256: VALID_MANIFEST_HASH,
      importedAt: '2026-10-20T08:00:00Z',
      status: 'VERIFIED',
    },
    standings: [
      { rank: 1, teamId: 't1', teamName: 'Đội Alpha', seedOrdinal: 1, qualificationRating: 1800, finalOutcome: 'Vô địch' },
      { rank: 2, teamId: 't2', teamName: 'Đội Beta', seedOrdinal: 2, qualificationRating: 1750, finalOutcome: 'Á quân' },
      { rank: 3, teamId: 't3', teamName: 'Đội Gamma', seedOrdinal: 3, qualificationRating: 1700, finalOutcome: 'Hạng 3' },
      { rank: 4, teamId: 't4', teamName: 'Đội Delta', seedOrdinal: 4, qualificationRating: 1650, finalOutcome: 'Hạng 4' },
      { rank: 5, teamId: 't5', teamName: 'Đội Epsilon', seedOrdinal: 5, qualificationRating: 1600, finalOutcome: 'Tứ kết' },
      { rank: 6, teamId: 't6', teamName: 'Đội Zeta', seedOrdinal: 6, qualificationRating: 1550, finalOutcome: 'Tứ kết' },
      { rank: 7, teamId: 't7', teamName: 'Đội Eta', seedOrdinal: 7, qualificationRating: 1500, finalOutcome: 'Tứ kết' },
      { rank: 8, teamId: 't8', teamName: 'Đội Theta', seedOrdinal: 8, qualificationRating: 1450, finalOutcome: 'Tứ kết' },
    ],
    bracket: [
      {
        pairingId: 'QF1',
        roundName: 'Tứ kết 1',
        bestOf: 3,
        status: 'FINALIZED',
        winnerTeamId: 't1',
        score: { winsA: 2, winsB: 0 },
        teamA: { teamId: 't1', teamName: 'Đội Alpha', seedOrdinal: 1 },
        teamB: { teamId: 't8', teamName: 'Đội Theta', seedOrdinal: 8 },
        games: [
          {
            gameNumber: 1,
            sideA: 'X',
            sideB: 'O',
            mapName: 'map-alpha-v1',
            winnerTeamId: 't1',
            replayMatchId: '00000000-0000-4000-8000-000000000001',
            replayPublished: true,
            scoreBreakdown: [{ criterionId: 'captures', label: 'Điểm bắt quân', valueA: 12, valueB: 4 }],
          },
          {
            gameNumber: 2,
            sideA: 'O',
            sideB: 'X',
            mapName: 'map-beta-v1',
            winnerTeamId: 't1',
            replayMatchId: '00000000-0000-4000-8000-000000000002',
            replayPublished: true,
          },
        ],
      },
      {
        pairingId: 'QF2',
        roundName: 'Tứ kết 2',
        bestOf: 3,
        status: 'FINALIZED',
        winnerTeamId: 't4',
        score: { winsA: 2, winsB: 1 },
        teamA: { teamId: 't4', teamName: 'Đội Delta', seedOrdinal: 4 },
        teamB: { teamId: 't5', teamName: 'Đội Epsilon', seedOrdinal: 5 },
        games: [
          {
            gameNumber: 1,
            sideA: 'X',
            sideB: 'O',
            mapName: 'map-alpha-v1',
            winnerTeamId: 't4',
            replayMatchId: '00000000-0000-4000-8000-000000000003',
            replayPublished: false, // NOT published yet
          },
        ],
      },
      {
        pairingId: 'F1',
        roundName: 'Chung kết',
        bestOf: 3,
        status: 'FINALIZED',
        winnerTeamId: 't1',
        score: { winsA: 2, winsB: 1 },
        teamA: { teamId: 't1', teamName: 'Đội Alpha', seedOrdinal: 1 },
        teamB: { teamId: 't2', teamName: 'Đội Beta', seedOrdinal: 2 },
        games: [
          {
            gameNumber: 1,
            sideA: 'X',
            sideB: 'O',
            mapName: 'map-final-v1',
            winnerTeamId: 't1',
            replayMatchId: '00000000-0000-4000-8000-000000000010',
            replayPublished: true,
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('Finals UI — AC-1: Server Bracket & Score Presentation', () => {
  it('renders bracket and breakdown directly from server without client recalculation', async () => {
    const fixture = createFinalsFixture();
    render(<FinalsPage initialSnapshot={fixture} />);

    // 1. Bracket pairings from server are rendered
    expect(screen.getAllByText('Tứ kết 1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Chung kết').length).toBeGreaterThanOrEqual(1);

    // 2. Teams with seeds are displayed
    expect(screen.getAllByText(/Đội Alpha \(#1\)/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Đội Theta \(#8\)/).length).toBeGreaterThanOrEqual(1);

    // 3. Score breakdown criterion provided by adapter is rendered verbatim
    expect(screen.getByText(/Điểm bắt quân 12–4/)).toBeTruthy();

    // 4. Standings table renders exact outcomes from server
    expect(screen.getByText('Vô địch')).toBeTruthy();
    expect(screen.getByText('Á quân')).toBeTruthy();
  });
});

describe('Finals UI — AC-2: Proof Metadata & Stale State', () => {
  it('does not show cryptographic proof metadata to the public', () => {
    const fixture = createFinalsFixture();
    render(<FinalsPage initialSnapshot={fixture} />);

    // Bundle id, key id, manifest hash, tournament and rule-set ids are meaningless to spectators.
    expect(screen.queryByText(/bundle-finals-official-001/)).toBeNull();
    expect(screen.queryByText(/poc-test-key/)).toBeNull();
    expect(screen.queryByText(VALID_MANIFEST_HASH)).toBeNull();
    expect(screen.queryByText(/Cryptographic Proof/)).toBeNull();
    expect(screen.queryByText(/TOURNAMENT_FINALS_2026/)).toBeNull();
    expect(screen.queryByText(/ruleset-finals-v1/)).toBeNull();
  });

  it('does not render stale warning for published snapshot with old verifiedAt/updatedAt', () => {
    const oldSnapshot = {
      ...createFinalsFixture(),
      updatedAt: '2025-01-01T00:00:00.000Z',
      verifiedAt: '2025-01-01T00:00:00.000Z',
    };
    render(<FinalsPage initialSnapshot={oldSnapshot} />);
    expect(screen.queryByText(/Dữ liệu cũ - Đang giữ bản cập nhật cuối/i)).toBeNull();
  });

  it('renders stale warning badge when background refresh fails after data was loaded', async () => {
    const fixture = createFinalsFixture();
    const fetchMock = vi.fn(async () => {
      throw new Error('Network error');
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FinalsPage initialSnapshot={fixture} />);

    // Initial data is rendered, and background refresh fails, setting stale warning badge
    expect(await screen.findByText(/Dữ liệu cũ - Đang giữ bản cập nhật cuối/i)).toBeTruthy();
  });

  it('validates proof parser strictly and rejects tampered hash or status', () => {
    expect(() => parseFinalsProof({
      bundleId: 'b1',
      bundleVersion: 1,
      keyId: 'k1',
      manifestSha256: 'tampered-not-64-hex',
      importedAt: '2026-10-20T08:00:00Z',
      status: 'VERIFIED',
    })).toThrow();

    expect(() => parseFinalsProof({
      bundleId: 'b1',
      bundleVersion: 1,
      keyId: 'k1',
      manifestSha256: VALID_MANIFEST_HASH,
      importedAt: '2026-10-20T08:00:00Z',
      status: 'UNVERIFIED', // Non-verified must throw
    })).toThrow();
  });
});

describe('Finals UI — AC-3: Replay Publication Privacy & Accessibility', () => {
  it('renders replay link ONLY when replay is verified and published', () => {
    const fixture = createFinalsFixture();
    render(<FinalsPage initialSnapshot={fixture} />);

    // QF1 Game 1 has replayPublished: true -> link exists and carries bundleId
    const replayLinkGame1 = screen.getByRole('link', { name: 'Phát replay ván 1 trận Tứ kết 1' });
    expect(replayLinkGame1).toBeTruthy();
    expect(replayLinkGame1.getAttribute('href')).toBe('/spectator/replays/00000000-0000-4000-8000-000000000001?bundle=bundle-finals-official-001');

    // QF2 Game 1 has replayPublished: false -> link MUST NOT be rendered
    expect(screen.queryByRole('link', { name: 'Phát replay ván 1 trận Tứ kết 2' })).toBeNull();
    expect(screen.getByText('Chưa công bố')).toBeTruthy();
  });

  it('integrates into App routing under /finals with accessible navigation', async () => {
    const fixture = createFinalsFixture();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/public/finals/snapshot') || url.includes('/snapshots/finals-latest.json')) {
        return new Response(JSON.stringify({ data: fixture }));
      }
      return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    window.history.replaceState({}, '', '/finals');
    render(<App />);

    // Navigation link is present in header
    const navLink = screen.getByRole('link', { name: 'Vòng chung kết' });
    expect(navLink).toBeTruthy();
    expect(navLink.getAttribute('href')).toBe('/finals');

    // Finals page rendered
    await screen.findByRole('heading', { level: 1, name: 'Vòng Chung kết' });
    expect(screen.getByRole('heading', { level: 2, name: 'Nhánh đấu chính thức' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Bảng xếp hạng và Nhánh đấu Chung kết' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Lịch thi đấu và Kết quả chi tiết Vòng Chung kết' })).toBeTruthy();
  });

  it('renders demo footer label when tournamentId starts with OTT_DEMO_', () => {
    const demoFixture = {
      ...createFinalsFixture(),
      tournamentId: 'OTT_DEMO_FINALS_2026',
    };
    render(<FinalsPage initialSnapshot={demoFixture} />);
    expect(screen.getByText('* Dữ liệu chung kết mẫu')).toBeTruthy();
  });

  it('does not render demo footer label for standard production tournaments', () => {
    const prodFixture = {
      ...createFinalsFixture(),
      tournamentId: 'tournament-prod-2026',
    };
    render(<FinalsPage initialSnapshot={prodFixture} />);
    expect(screen.queryByText('* Dữ liệu chung kết mẫu')).toBeNull();
  });
});
