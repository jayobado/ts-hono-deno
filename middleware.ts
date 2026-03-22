import { createMiddleware } from 'hono/factory'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import { getCookie } from 'hono/cookie'
import { Log } from './logger.ts'
import type { HonoEnv } from './types.ts'
import type { SessionStore } from './session.ts'
import type { MiddlewareHandler } from 'hono'

// ─── Request ID ───────────────────────────────────────────────────────────────

export const setRequestId: MiddlewareHandler = createMiddleware<HonoEnv>(
	async (c, next) => {
		c.set('requestId', crypto.randomUUID())
		await next()
	}
)

// ─── Security headers (API) ───────────────────────────────────────────────────

export const setSecurityHeaders: MiddlewareHandler = secureHeaders()

// ─── Browser security headers (UI) ───────────────────────────────────────────

export const setBrowserSecurityHeaders: MiddlewareHandler = createMiddleware<HonoEnv>(
	async (c, next) => {
		await next()
		c.header('X-Frame-Options', 'DENY')
		c.header('X-Content-Type-Options', 'nosniff')
		c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
		c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
	}
)

// ─── Access log ───────────────────────────────────────────────────────────────

export const accessLog: MiddlewareHandler = createMiddleware<HonoEnv>(
	async (c, next) => {
		const start = performance.now()
		await next()
		const ms = (performance.now() - start).toFixed(1)
		const rid = c.get('requestId') ?? '-'
		const method = c.req.method
		const path = new URL(c.req.url).pathname
		const status = c.res.status
		const message = `[${rid}] ${method} ${path} ${status} ${ms}ms`

		if (status >= 500) {
			await Log.error(message)
		} else if (status >= 400) {
			await Log.warn(message)
		} else {
			await Log.info(message)
		}
	}
)

// ─── Error handler ────────────────────────────────────────────────────────────

export const errorHandler: MiddlewareHandler = createMiddleware<HonoEnv>(
	async (c, next) => {
		try {
			await next()
		} catch (err) {
			const rid = c.get('requestId') ?? '-'
			const message = err instanceof Error ? err.message : String(err)
			await Log.error(`[${rid}] Unhandled error: ${message}`)
			return c.json({ message: 'Internal server error', code: 500 }, 500)
		}
	}
)

// ─── CORS ─────────────────────────────────────────────────────────────────────

export function corsHandler(origins: string | string[]): MiddlewareHandler {
	const allowed = Array.isArray(origins) ? origins : [origins]
	return cors({
		origin: allowed,
		credentials: true,
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
	})
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

export function createAuthMiddleware(
	sessions: SessionStore,
	cookieName: string = 'sid'
): MiddlewareHandler {
	return createMiddleware<HonoEnv>(async (c, next) => {
		const sid = getCookie(c, cookieName)
		const session = sid ? await sessions.get(sid) : undefined
		if (session) {
			c.set('session', session)
		}
		await next()
	})
}