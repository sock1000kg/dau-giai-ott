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
    expect(screen.getByRole('option', { name: 'Bot tham chiếu BTC' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Bot của đội' })).toBeTruthy();
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

  it('hides BTC reference option when deployment has no configured bot', async () => {
    const api = installRouteFetch('TEAM_ACCOUNT');
    api.setNoReferenceBot(true);
    render(<TestRunsPage />);

    await screen.findByText(/Còn 2 lượt chạy hôm nay/);
    expect(screen.queryByRole('option', { name: 'Bot tham chiếu BTC' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Bot của đội' })).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });

  it('defaults to self-play and allows submitting against own submission with selected map', async () => {
    const api = installRouteFetch('TEAM_ACCOUNT');
    render(<TestRunsPage />);

    await screen.findByText(/Còn 2 lượt chạy hôm nay/);
    expect((screen.getByLabelText('Bot đối thủ') as HTMLSelectElement).value).toBe('OWN_SUBMISSION');
    expect(screen.getByLabelText('Bản đồ')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Xem/tải bản đồ' }) as HTMLAnchorElement).getAttribute('href')).toContain('/api/v1/public/maps/default');

    // Submit self-play test run
    fireEvent.click(screen.getByRole('button', { name: 'Chạy thử' }));

    await waitFor(() => {
      if (!api.requests.some((request) => request.startsWith('POST /api/v1/test-runs'))) throw new Error('POST pending');
    });
    expect(await screen.findByText(/Đã nhận yêu cầu chạy thử/)).toBeTruthy();
    expect(api.unhandled).toEqual([]);
  });
});
