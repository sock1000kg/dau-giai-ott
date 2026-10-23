import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestRunsPage } from './TestRunsPage.tsx';
import { ids, installRouteFetch } from '../../test/route-fixtures.ts';

describe('TestRunsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads policy, eligible submissions and recent runs', async () => {
    const api = installRouteFetch('TEAM_ACCOUNT');
    render(<TestRunsPage />);

    expect(await screen.findByText(/Còn 2 lượt chạy hôm nay/)).toBeTruthy();
    expect(await screen.findByText(/Lượt thử gần đây/)).toBeTruthy();
    expect(screen.getByLabelText('Bot của đội')).toBeTruthy();
    expect(screen.getByLabelText('Bot đối thủ')).toBeTruthy();
    expect(api.requests).toContain('GET /api/v1/test-run-policy');
    expect(api.requests).toContain('GET /api/v1/test-runs?page=1&pageSize=20');
  });

  it('creates one reference-bot run and keeps success visible', async () => {
    const api = installRouteFetch('TEAM_ACCOUNT');
    render(<TestRunsPage />);

    await screen.findByText(/Còn 2 lượt chạy hôm nay/);
    fireEvent.change(screen.getByLabelText('Bot của đội'), { target: { value: ids.submission } });
    fireEvent.change(screen.getByLabelText('Bot đối thủ'), { target: { value: 'BTC_REFERENCE' } });
    fireEvent.change(screen.getByLabelText('Bot tham chiếu BTC'), { target: { value: 'FIRST_LEGAL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy thử' }));

    await waitFor(() => { if (!api.requests.some((request) => request.startsWith('POST /api/v1/test-runs'))) throw new Error('POST pending'); });
    expect(await screen.findByText(/Đã nhận yêu cầu chạy thử/)).toBeTruthy();
    expect(api.requests.some((request) => request.startsWith('POST /api/v1/test-runs'))).toBe(true);
    expect(api.unhandled).toEqual([]);
    await waitFor(() => expect(screen.getByText(/Lượt thử gần đây/)).toBeTruthy());
  });

  it('explains that BTC reference is unavailable when the deployment has no configured bot', async () => {
    const api = installRouteFetch('TEAM_ACCOUNT');
    api.setNoReferenceBot(true);
    render(<TestRunsPage />);

    expect(await screen.findByText(/Bot tham chiếu BTC chưa được cấu hình/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Chạy thử' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.unhandled).toEqual([]);
  });
});
