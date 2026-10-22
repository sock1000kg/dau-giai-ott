import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomePage } from './HomePage.tsx';

function cardLinks() {
  return Array.from(document.querySelectorAll('.ui-card-grid a')).map((link) => link.getAttribute('href'));
}

describe('HomePage', () => {
  it('renders the five BTC cards with their hrefs', () => {
    render(<HomePage role="BTC_ADMIN" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Trung tâm điều hành giải' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Điều hành giải đấu' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mở vận hành round' }).getAttribute('href')).toBe('/admin/rounds');
    expect(cardLinks()).toEqual(['/admin/teams', '/admin/rounds', '/admin/operations', '/admin/results', '/admin/replays']);
  });

  it('renders the two team cards and never a BTC link', () => {
    render(<HomePage role="TEAM_ACCOUNT" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Không gian đội thi' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Sẵn sàng ra sân' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mở nộp bot' }).getAttribute('href')).toBe('/team/submissions');
    expect(cardLinks()).toEqual(['/team/submissions', '/team/results']);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.startsWith('/admin'))).toBe(false);
  });
});
