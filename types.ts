import type { Hono, Context, MiddlewareHandler } from 'hono'
import type { AnyRouter } from '@trpc/server'
import type { SessionStore } from './session.ts'

export type { Hono, Context, AnyRouter, SessionStore }

export interface Session {
	userId: string
	email: string
	role: string
	[key: string]: unknown
}

export interface HonoEnv {
	Variables: {
		requestId: string
		session: Session | undefined
	}
}

export interface ServerResponse {
	message: string
	code: number
	data?: unknown
}

export interface ApiOptions {
	host: string
	port: number
	origins: string | string[]
	trpc?: AnyRouter
	middleware?: MiddlewareHandler[]
	routes?: (app: Hono<HonoEnv>) => void
}

export interface UiOptions {
	host: string
	port: number
	fsRoot?: string
	importMap?: string | { imports: Record<string, string> }
	githubToken?: string
	strategy?: 'lazy' | 'eager'
	compilerOptions?: Record<string, unknown>
	routes?: (app: Hono<HonoEnv>) => void
}

export interface BundleOptions {
	entry: string
	outFile: string
	importMap?: string | { imports: Record<string, string> }
	githubToken?: string
	onComplete?: (outFile: string, bytes: number) => void
}