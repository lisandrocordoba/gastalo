import type { Context } from 'hono';
import type { Env } from './types';

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(keyData: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
}

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  allowedUserId?: string
): Promise<boolean> {
  if (!initData || !botToken) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  const authDateStr = params.get('auth_date');
  if (authDateStr) {
    const authDate = Number(authDateStr);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(authDate) || nowSec - authDate > 86400) {
      return false;
    }
  }

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') {
      pairs.push(`${key}=${value}`);
    }
  });
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  const computed = await hmacSha256(secretKey, dataCheckString);
  const computedHex = bufferToHex(computed);

  if (!timingSafeEqualHex(computedHex, hash.toLowerCase())) {
    return false;
  }

  if (allowedUserId) {
    const userJson = params.get('user');
    if (!userJson) return false;
    try {
      const user = JSON.parse(userJson) as { id?: number | string };
      if (String(user.id) !== String(allowedUserId)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export async function isAuthorizedRequest(
  headers: Headers,
  env: Pick<Env, 'APP_ENV' | 'DASHBOARD_TOKEN' | 'TELEGRAM_BOT_TOKEN' | 'ALLOWED_TELEGRAM_USER_ID'>
): Promise<boolean> {
  const authHeader = headers.get('Authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (env.DASHBOARD_TOKEN && timingSafeEqualHex(token, env.DASHBOARD_TOKEN)) {
      return true;
    }
  }

  const initData = headers.get('X-Telegram-Init-Data') ?? '';
  if (initData) {
    return verifyTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN, env.ALLOWED_TELEGRAM_USER_ID);
  }

  if (env.APP_ENV === 'development' && !env.DASHBOARD_TOKEN) {
    return true;
  }

  return false;
}

export async function verifyDashboardAuth(
  c: Context<{ Bindings: Env }>,
  next: () => Promise<void>
): Promise<Response | void> {
  const ok = await isAuthorizedRequest(c.req.raw.headers, c.env);
  if (!ok) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
}
