// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchResultsPage } from './MatchResultsPage.tsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('results filter row', () => {
  it('puts the refresh button in its own container, not in a Field with a help line', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } } }) }));
    render(<MatchResultsPage isAdmin={false} />);
    const refresh = await screen.findByRole('button', { name: 'Làm mới' });
    const container = refresh.parentElement as HTMLElement;
    expect(container.classList.contains('results-refresh')).toBe(true);
    expect(container.parentElement?.classList.contains('results-filters')).toBe(true);
    expect(refresh.closest('.ui-field')).toBeNull();
    expect(container.querySelector('.ui-field-help')).toBeNull();
  });
});
