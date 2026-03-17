import type { Session } from './types.ts'
import type { Context } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import { SessionStore } from './types.ts'


// ─── In-memory store ──────────────────────────────────────────────────────

export function createMemoryStore(): SessionStore {
	const store = new Map<string, Session>()
	return {
		get: sid => store.get(sid),
		set: (sid, s) => store.set(sid, s),
		delete: sid => store.delete(sid),
	}
}

// ─── Deno KV store ────────────────────────────────────────────────────────

export function createDenoKvStore(kv: Deno.Kv, ttl?: number): SessionStore {
	return {
		get: async (sid) => {
			const entry = await kv.get<Session>(['sessions', sid])
			return entry.value ?? undefined
		},
		set: async (sid, session) => {
			const options = ttl ? { expireIn: ttl * 1000 } : undefined
			await kv.set(['sessions', sid], session, options)
		},
		delete: async (sid) => {
			await kv.delete(['sessions', sid])
		},
	}
}

// ─── Cookie helpers ───────────────────────────────────────────────────────

export interface CookieOptions {
	name?: string
	maxAge?: number
	secure?: boolean
	sameSite?: 'Strict' | 'Lax' | 'None'
}

export function setSessionCookie(
	c: Context,
	session: Session,
	store: SessionStore,
	opts: CookieOptions = {}
): string {
	const {
		name = 'sid',
		maxAge = 60 * 60 * 24 * 7,
		secure = false,
		sameSite = 'Lax',
	} = opts

	const sid = crypto.randomUUID()
	store.set(sid, session)

	setCookie(c, name, sid, {
		httpOnly: true,
		sameSite,
		path: '/',
		maxAge,
		secure,
	})

	return sid
}

export function clearSessionCookie(
	c: Context,
	store: SessionStore,
	name: string = 'sid'
): void {
	const sid = getCookie(c, name)
	if (sid) store.delete(sid)
	deleteCookie(c, name, { path: '/' })
}