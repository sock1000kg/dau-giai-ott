import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from './HomePage.tsx';

function cardLinks() {
  return screen.getAllByRole('link', { name: /^Mở / }).map((link) => link.getAttribute('href'));
}

describe('HomePage', () => {
  it('renders the five BTC cards with their hrefs', () => {
    render(<HomePage role="BTC_ADMIN" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Khu vực BTC' })).toBeTruthy();
    expect(cardLinks()).toEqual(['/admin/teams', '/admin/rounds', '/admin/operations', '/admin/results', '/admin/replays']);
  });

  it('renders the two team cards and never a BTC link', () => {
    render(<HomePage role="TEAM_ACCOUNT" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Cổng đội thi' })).toBeTruthy();
    expect(cardLinks()).toEqual(['/team/submissions', '/team/results']);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.startsWith('/admin'))).toBe(false);
  });
});
