// Shared helpers: id generation, hashing, auth middleware, audit log

import type { Context, Next } from 'hono'

export type Bindings = {
  DB: D1Database
  EVIDENCE: R2Bucket
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
}

export type AppContext = Context<{ Bindings: Bindings; Variables: { user: SessionUser } }>

export interface SessionUser {
  user_id: string
  username: string
  full_name: string
  role: string
  region_id: string
}

export function uid(prefix = ''): string {
  return prefix + crypto.randomUUID()
}

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string): Promise<string> {
  return sha256Hex('lmpc-salt:' + password)
}

export async function audit(
  db: D1Database, actorId: string | null, action: string,
  entity?: string, entityId?: string, detail?: string
) {
  await db.prepare(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
  ).bind(actorId, action, entity ?? null, entityId ?? null, detail ?? null).run()
}

export async function getSessionUser(db: D1Database, token: string): Promise<SessionUser | null> {
  const row = await db.prepare(`
    SELECT u.user_id, u.username, u.full_name, u.role, u.region_id
    FROM sessions s JOIN users u ON u.user_id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).bind(token).first<SessionUser>()
  return row ?? null
}

export function requireAuth(roles?: string[]) {
  return async (c: AppContext, next: Next) => {
    const auth = c.req.header('Authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return c.json({ error: 'Authentication required' }, 401)
    const user = await getSessionUser(c.env.DB, token)
    if (!user) return c.json({ error: 'Session invalid or expired' }, 401)
    if (roles && !roles.includes(user.role)) {
      return c.json({ error: `Forbidden: requires role ${roles.join('/')}` }, 403)
    }
    c.set('user', user)
    await next()
  }
}
