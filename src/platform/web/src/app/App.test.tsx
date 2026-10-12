import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App shell', () => {
  it('renders the tournament identity and an accessible main landmark', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /giải đấu ott/i })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
  });
});
