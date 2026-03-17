import { Hono } from 'hono'
import { trpcServer } from '@hono/trpc-server'
import { serveDir, serveFile } from 'jsr:@std/http/file-server'
import {
	setRequestId,
	setSecurityHeaders,
	setBrowserSecurityHeaders,
	errorHandler,
	accessLog,
	corsHandler,
	createAuthMiddleware,
} from './middleware.ts'
import {
	createTranspileHandler,
	warmTranspileCache,
} from './transpile.ts'
import { Log } from './logger.ts'
import type {
	HonoEnv,
	ApiOptions,
	UiOptions,
	ServerResponse,
	Session,
} from './types.ts'

// ─── run ──────────────────────────────────────────────────────────────────

function run(
	app: Hono<HonoEnv>,
	opts: { host: string; port: number }
): void {
	Deno.serve({
		port: opts.port,
		hostname: opts.host,
		onListen: () => {
			Log.info(`Server running at http://${opts.host}:${opts.port}`)
			console.log(`\n  ⬡  Running at http://${opts.host}:${opts.port}\n`)
		},
	}, app.fetch)
}

// ─── api() ────────────────────────────────────────────────────────────────

export function api(opts: ApiOptions): void {
	const app = new Hono<HonoEnv>()

	app.use('*', setRequestId)
	app.use('*', setSecurityHeaders)
	app.use('*', errorHandler)
	app.use('*', accessLog)
	app.use('*', corsHandler(opts.origins))

	if (opts.trpc) {
		const sessions = new Map<string, Session>()
		const authMiddleware = createAuthMiddleware(sessions)

		app.use('/api/*', authMiddleware)

		if (opts.middleware?.length) {
			opts.middleware.forEach(m => app.use('/api/*', m))
		}

		app.use('/api/*', trpcServer({
			endpoint: '/api',
			router: opts.trpc,
			createContext: (_opts, ctx) => ({
				session: ctx.get('session') as Session | undefined,
			}),
		}))
	}

	if (opts.routes) opts.routes(app)

	app.get('/', (c) => {
		const response: ServerResponse = { message: 'Welcome to the API', code: 200 }
		return c.json(response)
	})

	app.notFound((c) => {
		const response: ServerResponse = { message: 'Not Found', code: 404 }
		return c.json(response, 404)
	})

	return run(app, { host: opts.host, port: opts.port })
}

// ─── ui() ─────────────────────────────────────────────────────────────────

export async function ui(opts: UiOptions): Promise<void> {
	const {
		host,
		port,
		fsRoot = './public',
		importMap,
		githubToken = Deno.env.get('GITHUB_TOKEN') ?? '',
		strategy = 'lazy',
		compilerOptions,
		routes,
	} = opts

	const app = new Hono<HonoEnv>()

	// ── Middleware ────────────────────────────────────────────────────────────

	app.use('*', setRequestId)
	app.use('*', setSecurityHeaders)
	app.use('*', setBrowserSecurityHeaders)
	app.use('*', errorHandler)
	app.use('*', accessLog)

	// ── Project routes ────────────────────────────────────────────────────────

	if (routes) routes(app)

	// ── Eager warm ────────────────────────────────────────────────────────────

	if (strategy === 'eager') {
		await warmTranspileCache({
			fsRoot,
			importMap,
			githubToken,
			compilerOptions,
		})
	}

	// ── TypeScript transpilation ──────────────────────────────────────────────

	const handleTranspile = createTranspileHandler({
		fsRoot,
		importMap,
		githubToken,
		compilerOptions,
	})

	app.get('*.ts', handleTranspile)
	app.get('*.tsx', handleTranspile)

	// ── Static files + SPA catch-all ─────────────────────────────────────────

	app.get('*', async (c) => {
		const response = await serveDir(c.req.raw, {
			fsRoot,
			urlRoot: '',
			quiet: true,
		})

		if (
			response.status === 404 &&
			!c.req.url.split('/').pop()?.includes('.')
		) {
			return serveFile(c.req.raw, `${fsRoot}/index.html`)
		}

		return response
	})

	return run(app, { host, port })
}