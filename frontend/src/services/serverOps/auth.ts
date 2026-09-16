// @ts-ignore
/* eslint-disable */
import { request } from '@umijs/max';

const TOKEN_KEY = 'server_ops_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Compatible with the scaffold's LoginForm onFinish -> login() contract. */
export async function login(
  body: { username?: string; password?: string; type?: string },
  options?: { [key: string]: any },
): Promise<API.LoginResult> {
  if (body.type && body.type !== 'account') {
    return { status: 'error', type: body.type };
  }
  try {
    const res = await request<{ access_token: string; token_type: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        data: { username: body.username, password: body.password },
        skipErrorHandler: true,
        ...(options || {}),
      },
    );
    setToken(res.access_token);
    return { status: 'ok', type: body.type, currentAuthority: 'admin' };
  } catch (error) {
    return { status: 'error', type: body.type };
  }
}

/** Compatible with the scaffold's fetchUserInfo -> currentUser() contract. */
export async function currentUser(options?: { [key: string]: any }) {
  const res = await request<{ username: string; display_name: string; is_admin: boolean }>(
    '/api/auth/me',
    {
      method: 'GET',
      skipErrorHandler: true,
      ...(options || {}),
    },
  );
  return {
    success: true,
    data: {
      name: res.display_name || res.username,
      userid: res.username,
      // Drives frontend/src/access.ts's canAdmin - gates the "Người dùng"
      // tab in Access Control (create/reset-password/lock other accounts).
      access: res.is_admin ? 'admin' : 'user',
    },
  };
}

export async function outLogin() {
  clearToken();
}
