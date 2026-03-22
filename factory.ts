import { Hono } from 'hono'
import { trpcServer } from '@hono/trpc-server'
import { serveDir, serveFile } from '@std/http/file-server'
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
import type { SessionStore } from './session.ts'

// ─── run ──────────────────────────────────────────────────────────────────────

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

// ─── api() ────────────────────────────────────────────────────────────────────

export function api(
	opts: ApiOptions,
	sessions: SessionStore
): void {
	const app = new Hono<HonoEnv>()

	app.use('*', setRequestId)
	app.use('*', setSecurityHeaders)
	app.use('*', errorHandler)
	app.use('*', accessLog)
	app.use('*', corsHandler(opts.origins))

	if (opts.trpc) {
		const authMiddleware = createAuthMiddleware(sessions)
		app.use('/api/*', authMiddleware as unknown as Parameters<typeof app.use>[1])

		if (opts.middleware?.length) {
			opts.middleware.forEach(m =>
				app.use('/api/*', m as unknown as Parameters<typeof app.use>[1])
			)
		}

		app.use('/api/*', trpcServer({
			endpoint: '/api',
			router: opts.trpc,
			createContext: (_opts, ctx) => ({
				session: ctx.get('session') as Session | undefined,
			}),
		}) as unknown as Parameters<typeof app.use>[1])
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

// ─── ui() ─────────────────────────────────────────────────────────────────────

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

	app.use('*', setRequestId)
	app.use('*', setSecurityHeaders)
	app.use('*', setBrowserSecurityHeaders)
	app.use('*', errorHandler)
	app.use('*', accessLog)

	if (routes) routes(app)

	if (strategy === 'eager') {
		await warmTranspileCache({
			fsRoot,
			importMap,
			githubToken,
			compilerOptions,
		})
	}

	const handleTranspile = createTranspileHandler({
		fsRoot,
		importMap,
		githubToken,
		compilerOptions,
	})

	app.get('*.ts', (ctx) => handleTranspile(ctx))
	app.get('*.tsx', (ctx) => handleTranspile(ctx))

	app.get('*', async (ctx) => {
		const response = await serveDir(ctx.req.raw, {
			fsRoot,
			urlRoot: '',
			quiet: true,
		})

		if (
			response.status === 404 &&
			!ctx.req.url.split('/').pop()?.includes('.')
		) {
			return serveFile(ctx.req.raw, `${fsRoot}/index.html`)
		}

		return response
	})

	return run(app, { host, port })
}