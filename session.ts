import type { Context } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'

export interface SessionStore {
	get: (sid: string) => Promise<Session | undefined>
	set: (sid: string, session: Session) => Promise<void>
	delete: (sid: string) => Promise<void>
}

export interface Session {
	userId: string
	email: string
	role: string
	[key: string]: unknown
}

// ─── In-memory store ──────────────────────────────────────────────────────────

export function createMemoryStore(): SessionStore {
	const store = new Map<string, Session>()
	return {
		get: async (sid) => store.get(sid),
		set: async (sid, session) => { store.set(sid, session) },
		delete: async (sid) => { store.delete(sid) },
	}
}

// ─── Deno KV interface ────────────────────────────────────────────────────────
// Typed minimally to avoid requiring --unstable-kv in the library itself.
// Pass the result of Deno.openKv() from your application code.

interface KvEntry<T> {
	value: T | null
}

interface DenoKv {
	get<T>(key: unknown[]): Promise<KvEntry<T>>
	set(key: unknown[], value: unknown, options?: { expireIn?: number }): Promise<void>
	delete(key: unknown[]): Promise<void>
}

export function createDenoKvStore(kv: DenoKv, ttl?: number): SessionStore {
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

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export interface CookieOptions {
	name?: string
	maxAge?: number
	secure?: boolean
	sameSite?: 'Strict' | 'Lax' | 'None'
}

export async function setSessionCookie(
	c: Context,
	session: Session,
	store: SessionStore,
	opts: CookieOptions = {}
): Promise<string> {
	const {
		name = 'sid',
		maxAge = 60 * 60 * 24 * 7,
		secure = false,
		sameSite = 'Lax',
	} = opts

	const sid = crypto.randomUUID()
	await store.set(sid, session)

	setCookie(c, name, sid, {
		httpOnly: true,
		sameSite,
		path: '/',
		maxAge,
		secure,
	})

	return sid
}

export async function clearSessionCookie(
	c: Context,
	store: SessionStore,
	name: string = 'sid'
): Promise<void> {
	const sid = getCookie(c, name)
	if (sid) await store.delete(sid)
	deleteCookie(c, name, { path: '/' })
}