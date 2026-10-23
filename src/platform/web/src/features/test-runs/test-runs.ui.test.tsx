import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TestRunReplayPage } from './TestRunReplayPage.tsx';
import { ids, installRouteFetch } from '../../test/route-fixtures.ts';

describe('TestRunReplayPage', () => {
  it('renders only a checksum-verified spectator replay', async () => {
    const api = installRouteFetch('TEAM_ACCOUNT');
    render(<TestRunReplayPage testRunId={ids.match} />);

    expect(await screen.findByText('REPLAY ĐÃ XÁC MINH')).toBeTruthy();
    expect(api.requests).toContain(`GET /api/v1/test-runs/${ids.match}/replay`);
  });

  it('shows an unavailable state for a foreign or missing run', async () => {
    const api = installRouteFetch('TEAM_ACCOUNT');
    vi.mocked(fetch).mockImplementationOnce(async () => new Response('', { status: 404 }));
    render(<TestRunReplayPage testRunId={ids.otherTeam} />);

    expect(await screen.findByText(/chưa có replay hoặc bạn không có quyền xem/i)).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });

  it('does not render a replay when the response checksum fails', async () => {
    installRouteFetch('TEAM_ACCOUNT');
    vi.mocked(fetch).mockImplementationOnce(async () => new Response('{"schemaVersion":1}', {
      headers: { 'content-type': 'application/vnd.ott.spectator-replay+json;version=1', 'x-replay-sha256': `sha256:${'0'.repeat(64)}` },
    }));
    render(<TestRunReplayPage testRunId={ids.match} />);

    expect(await screen.findByText(/không vượt qua kiểm tra toàn vẹn/i)).toBeTruthy();
    expect(screen.queryByText('REPLAY ĐÃ XÁC MINH')).toBeNull();
  });
});
