import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const secretKey = process.env.JWT_SECRET;
if (!secretKey) {
  console.warn('JWT_SECRET is not set in environment variables');
}
const key = new TextEncoder().encode(secretKey || 'default_secret_key_for_development');

export async function signToken(payload: any, expiresIn: string | number | Date = '8h') {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    return payload;
  } catch (error) {
    return null;
  }
}

export async function getSession(cookieName: string) {
  // cookies() is an async function in modern Next.js
  const cookieStore = await cookies();
  const session = cookieStore.get(cookieName)?.value;
  if (!session) return null;
  return await verifyToken(session);
}

export async function requireAdmin() {
  const session = await getSession('admin_session');
  if (!session) return null;
  return session; // Contains { email, role, etc. }
}

export async function requireManager() {
  const session = await getSession('manager_session');
  if (!session) return null;
  return session; // Contains { email, ma_khoa, etc. }
}
