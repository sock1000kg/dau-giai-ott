import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

function response(status: number, data?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => data === undefined ? '' : JSON.stringify(data),
  } as Response;
}

const anonymous = () => response(401, { error: { code: 'UNAUTHENTICATED' } });
const mfaChallenge = () => response(200, { data: { mfaRequired: true } });

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const item of responses) fetchMock.mockResolvedValueOnce(item);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openLogin(...next: Response[]) {
  const fetchMock = mockFetch(anonymous(), ...next);
  render(<App />);
  await screen.findByRole('form', { name: 'Đăng nhập' });
  return fetchMock;
}

async function reachMfa(password = 'secret-pass-123') {
  const fetchMock = await openLogin(mfaChallenge());
  fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Đăng nhập' }));
  await screen.findByRole('form', { name: 'Xác thực 2 bước' });
  return fetchMock;
}

describe('login UI', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('renders the password step structure with help and focused username', async () => {
    await openLogin();
    expect(screen.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeTruthy();
    const username = screen.getByLabelText('Tên đăng nhập') as HTMLInputElement;
    expect(username.getAttribute('autocomplete')).toBe('username');
    expect(username.maxLength).toBe(128);
    expect(username.required).toBe(true);
    expect(screen.getByText(/do Ban tổ chức cấp cho đội/)).toBeTruthy();
    expect(username.getAttribute('aria-describedby')).toBeTruthy();
    const password = screen.getByLabelText('Mật khẩu') as HTMLInputElement;
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(password.maxLength).toBe(1024);
    expect(document.activeElement).toBe(username);
    expect(screen.getByText('Không có chức năng tự đăng ký hoặc đặt lại mật khẩu.')).toBeTruthy();
  });

  it('toggles password visibility with aria-pressed', async () => {
    await openLogin();
    const password = screen.getByLabelText('Mật khẩu') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'Hiện mật khẩu' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(password.type).toBe('password');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(password.type).toBe('text');
    fireEvent.click(toggle);
    expect(password.type).toBe('password');
  });

  it('shows the busy state and calls the API once while busy', async () => {
    let resolveLogin: (value: Response) => void = () => undefined;
    const fetchMock = await openLogin();
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveLogin = resolve; }));
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'u' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'p' } });
    const submit = screen.getByRole('button', { name: 'Đăng nhập' });
    fireEvent.click(submit);
    const busy = await screen.findByRole('button', { name: 'Đang đăng nhập…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/login'))).toHaveLength(1);
    resolveLogin(response(401, { error: { code: 'INVALID_CREDENTIALS' } }));
    await screen.findByRole('alert');
  });

  it.each([
    [401, 'Tên đăng nhập hoặc mật khẩu không đúng.'],
    [429, 'Bạn đã thử đăng nhập quá nhiều lần. Hãy thử lại sau.'],
    [500, 'Không thể đăng nhập lúc này. Vui lòng thử lại.'],
  ])('maps password-step status %i to its message in an alert', async (status, text) => {
    await openLogin(response(status, { error: { code: 'X' } }));
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: 'u' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'p' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Đăng nhập' }));
    expect((await screen.findByRole('alert')).textContent).toBe(text);
  });

  it('shows the MFA step indicator, hints, maxLength and focus', async () => {
    await reachMfa();
    expect(screen.getByText('Bước 2/2 — Xác thực 2 bước')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Xác thực 2 bước' })).toBeTruthy();
    const code = screen.getByLabelText('Mã xác thực 2 bước') as HTMLInputElement;
    expect(code.maxLength).toBe(6);
    expect(code.getAttribute('inputmode')).toBe('numeric');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(screen.getByText('Mã 6 chữ số trong ứng dụng Authenticator')).toBeTruthy();
    expect(document.activeElement).toBe(code);
  });

  it('switches TOTP and recovery code, moving focus into the field', async () => {
    await reachMfa();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã khôi phục' }));
    const recovery = screen.getByLabelText('Mã khôi phục') as HTMLInputElement;
    expect(recovery.maxLength).toBe(32);
    expect(screen.getByText('Mỗi mã khôi phục chỉ dùng được một lần')).toBeTruthy();
    expect(document.activeElement).toBe(recovery);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã xác thực (TOTP)' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Mã xác thực 2 bước'));
  });

  it('does not keep the password in the DOM after MFA starts', async () => {
    await reachMfa('secret-pass-123');
    expect(screen.queryByDisplayValue('secret-pass-123')).toBeNull();
  });

  it('goes back to the password step with empty password, cleared codes and error', async () => {
    const fetchMock = await reachMfa();
    fetchMock.mockResolvedValueOnce(response(401, { error: { code: 'X' } }));
    fireEvent.change(screen.getByLabelText('Mã xác thực 2 bước'), { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Xác thực 2 bước' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).type).toBe('password');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByDisplayValue('123456')).toBeNull();
    fetchMock.mockResolvedValueOnce(mfaChallenge());
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'again' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Đăng nhập' }));
    await screen.findByRole('form', { name: 'Xác thực 2 bước' });
    expect((screen.getByLabelText('Mã xác thực 2 bước') as HTMLInputElement).value).toBe('');
  });

  it.each([
    [401, 'Mã không đúng hoặc đã hết hạn'],
    [429, 'Bạn đã thử đăng nhập quá nhiều lần. Hãy thử lại sau.'],
    [500, 'Không thể xác thực lúc này. Vui lòng thử lại.'],
  ])('maps MFA status %i to its message', async (status, text) => {
    const fetchMock = await reachMfa();
    fetchMock.mockResolvedValueOnce(response(status, { error: { code: 'X' } }));
    fireEvent.change(screen.getByLabelText('Mã xác thực 2 bước'), { target: { value: '000000' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Xác thực 2 bước' }));
    expect((await screen.findByRole('alert')).textContent).toBe(text);
  });

  it('submits the MFA code once while busy and stores nothing credential-like', async () => {
    let resolveMfa: (value: Response) => void = () => undefined;
    const fetchMock = await reachMfa('secret-pass-123');
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveMfa = resolve; }));
    fireEvent.change(screen.getByLabelText('Mã xác thực 2 bước'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    const busy = await screen.findByRole('button', { name: 'Đang xác thực…' });
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('login/mfa'))).toHaveLength(1);
    resolveMfa(response(401, { error: { code: 'X' } }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    for (const store of [window.localStorage, window.sessionStorage]) {
      expect(JSON.stringify({ ...store })).not.toMatch(/secret-pass-123|654321/);
    }
  });

  it('never puts the typed password in title or aria-label attributes', async () => {
    await openLogin();
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'secret-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    const leaking = Array.from(document.querySelectorAll('[title],[aria-label]')).filter((el) =>
      `${el.getAttribute('title') ?? ''}${el.getAttribute('aria-label') ?? ''}`.includes('secret-pass-123'));
    expect(leaking).toHaveLength(0);
  });
});
