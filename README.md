# ts-hono-deno

A Hono server factory for TypeScript SPA applications running on Deno. Handles static file serving, on-the-fly TypeScript transpilation, session management, logging, and optional tRPC integration — so your `server.ts` stays under 50 lines.

## What it provides

- **`ui()`** — serves and transpiles a TypeScript SPA with lazy or eager caching
- **`api()`** — API server with tRPC, CORS, auth middleware (for separate API deployments)
- **`Log`** — file-based logger with daily rotating files per level
- **Session management** — in-memory and Deno KV stores, cookie helpers
- **Middleware** — request ID, security headers, access log, error handler, CORS, auth
- **`buildBundle()`** — pre-bundles your SPA for non-Deno deployment targets

## Installation

Add to your project's `deno.json`:
```json
{
  "imports": {
    "@ts-hono": "https://raw.githubusercontent.com/yourname/ts-hono/v0.1.0/mod.ts"
  }
}
```

Set your GitHub token for private repo access:
```bash
export DENO_AUTH_TOKENS="ghp_yourtoken@raw.githubusercontent.com"
```

## Quick start
```typescript
// server.ts
import { ui, createMemoryStore,
         setSessionCookie, clearSessionCookie,
         createAuthMiddleware }               from '@ts-hono'
import { trpcServer }                         from '@hono/trpc-server'
import { appRouter }                          from './src/trpc/router.ts'

const sessions = createMemoryStore()
const isDev    = Deno.env.get('ENV') !== 'production'

await ui({
  host:      'localhost',
  port:      3000,
  fsRoot:    './public',
  importMap: './deno.json',
  strategy:  isDev ? 'lazy' : 'eager',

  routes: (app) => {

    // Auth
    app.post('/auth/login', async (c) => {
      const { email, password } = await c.req.json()
      if (password !== 'secret') {
        return c.json({ message: 'Invalid credentials', code: 401 }, 401)
      }
      const session = { userId: '1', email, role: 'admin' }
      setSessionCookie(c, session, sessions, { secure: !isDev })
      return c.json({ ok: true, user: session })
    })

    app.post('/auth/logout', (c) => {
      clearSessionCookie(c, sessions)
      return c.json({ ok: true })
    })

    // tRPC
    app.use('/api/*', createAuthMiddleware(sessions))
    app.use('/api/*', trpcServer({
      endpoint:      '/api',
      router:        appRouter,
      createContext: (_opts, ctx) => ({ session: ctx.get('session') }),
    }))
  },
})
```
```bash
deno run --watch --allow-all server.ts
```

## `ui()`

Serves a TypeScript SPA from `fsRoot`. Intercepts `.ts` and `.tsx` requests and transpiles them on the fly. Falls back to `index.html` for SPA routes.
```typescript
await ui({
  host:      'localhost',
  port:      3000,

  // Source directory — default './public'
  fsRoot:    './public',

  // Path to deno.json or inline object
  // Required when using import map aliases (@ts-ui, @myapp etc.)
  importMap: './deno.json',

  // GitHub token for private repo imports
  // Falls back to GITHUB_TOKEN env var
  githubToken: Deno.env.get('GITHUB_TOKEN'),

  // 'lazy'  — transpile on first request, cache result    (development)
  // 'eager' — transpile everything at startup, serve from cache (production)
  strategy: 'lazy',

  // Compiler options forwarded to the TypeScript transpiler
  // Only needed for JSX (React, Solid, Preact)
  // Not needed for ts-ui, Vue h(), or plain TypeScript
  compilerOptions: {
    jsx:             'react-jsx',
    jsxImportSource: 'react',
  },

  // Additional routes mounted before the static file handler
  routes: (app) => {
    app.post('/auth/login', ...)
    app.post('/auth/logout', ...)
    app.use('/api/*', ...)
  },
})
```

### Transpilation strategies

**Lazy (development)** — transpiles on first request, caches result in memory. Subsequent requests for the same file return from cache instantly. Import map aliases and private GitHub repos are resolved server-side so the browser never needs auth tokens.

**Eager (production)** — transpiles every `.ts` and `.tsx` file at startup before accepting requests. All files are in memory by the time the first request arrives. Functionally equivalent to serving pre-bundled files, with no build artifact on disk.
```typescript
// Development
await ui({ strategy: 'lazy', ... })

// Production on Deno
await ui({ strategy: 'eager', ... })
```

## `api()`

Standalone API server — use when your backend is a separate service from the UI, consumed by multiple clients, or deployed independently.
```typescript
api({
  host:    'localhost',
  port:    3001,
  origins: 'https://myapp.com',  // or string[]
  trpc:    appRouter,

  // Additional middleware before tRPC (e.g. rate limiting)
  middleware: [rateLimiter],

  // Extra routes
  routes: (app) => {
    app.post('/webhooks/stripe', handleStripe)
  },
})
```

> For a single Deno process serving both UI and API, use `ui()` with a `routes` callback instead. `api()` is for separate deployments.

## Logging

`Log` writes to `./logs/{level}_{YYYYMMDD}.log` and to stdout/stderr. A new file is created per level per day automatically.
```typescript
import { Log } from '@ts-hono'

await Log.debug('Cache warmed')
await Log.info('Server started on port 3000')
await Log.warn('Session store approaching capacity')
await Log.error('Database connection failed')
```

Log files:
```
logs/
├── debug_20250117.log
├── info_20250117.log
├── warn_20250117.log
└── error_20250117.log
```

## Session management
```typescript
import {
  createMemoryStore,
  createDenoKvStore,
  setSessionCookie,
  clearSessionCookie,
} from '@ts-hono'

// In-memory — fast, lost on restart
const sessions = createMemoryStore()

// Deno KV — persistent across restarts
const kv       = await Deno.openKv()
const sessions = createDenoKvStore(kv, 60 * 60 * 8) // 8h TTL

// Set cookie on login
setSessionCookie(c, session, sessions, {
  name:     'sid',           // default
  maxAge:   60 * 60 * 8,    // 8 hours
  secure:   true,            // set true in production (requires HTTPS)
  sameSite: 'Lax',           // default
})

// Clear cookie on logout
clearSessionCookie(c, sessions)
```

## Middleware

All middleware is available individually if you need to compose your own Hono app:
```typescript
import {
  setRequestId,            // generates crypto.randomUUID() per request
  setSecurityHeaders,      // API security headers
  setBrowserSecurityHeaders, // X-Frame-Options, CSP etc.
  accessLog,               // logs method, path, status, duration via Log
  errorHandler,            // catches unhandled errors, logs, returns 500
  corsHandler,             // configures CORS for given origins
  createAuthMiddleware,    // reads session cookie, sets ctx session
} from '@ts-hono'
```

## Building for non-Deno targets

When deploying to Cloudflare Pages, Netlify, Vercel, or any static host, pre-bundle your SPA into `./dist`:
```typescript
// scripts/build.ts
import { buildBundle } from '@ts-hono'

await buildBundle({
  entry:     './public/main.ts',
  outFile:   './dist/app.js',
  importMap: './deno.json',
  onComplete: (outFile, bytes) => {
    console.log(`Built ${outFile} (${(bytes / 1024).toFixed(1)} KB)`)
  },
})

// Rewrite index.html to reference the bundle
let html = await Deno.readTextFile('./public/index.html')
html = html.replace(
  '<script type="module" src="/main.ts"></script>',
  '<script type="module" src="/app.js"></script>'
)
await Deno.writeTextFile('./dist/index.html', html)
```
```json
{
  "tasks": {
    "dev":   "deno run --watch --allow-all server.ts",
    "start": "ENV=production deno run --allow-all server.ts",
    "build": "deno run --allow-all scripts/build.ts"
  }
}
```

| Target | Command | Notes |
|---|---|---|
| Deno VPS | `deno task start` | Eager cache, no build needed |
| Deno Deploy | `deno task start` | Eager cache, no build needed |
| Cloudflare Pages | `deno task build` | Deploy `./dist` |
| Netlify / Vercel | `deno task build` | Deploy `./dist` |
| AWS S3 + CloudFront | `deno task build` | Deploy `./dist` |

## Compatible frameworks

`ui()` is framework-agnostic. It serves and transpiles whatever is in `fsRoot`.

| Framework | `compilerOptions` needed |
|---|---|
| ts-ui | No |
| Vue (h() only, no .vue files) | No |
| React / Preact | Yes — `jsx: 'react-jsx'` |
| Solid | Yes — `jsxImportSource: 'solid-js/h'` |

## Updating dependencies

`ts-hono` uses `@latest` for its dependencies pinned by `deno.lock`.

To pull in new versions:
```bash
cd ts-hono
deno task update    # re-resolves @latest, updates deno.lock
deno task check     # verify types still pass
git add deno.lock
git commit -m "update dependencies"
git tag v0.2.0
git push origin main --tags
```

Then bump your project:
```bash
deno run --allow-read --allow-write scripts/bump.ts v0.2.0
```

## Project structure
```
my-app/
├── server.ts            # ~50 lines — ui() + auth + tRPC wiring
├── index.html
├── deno.json
├── scripts/
│   ├── bump.ts          # upgrade @ts-hono version
│   └── build.ts         # pre-bundle for non-Deno targets
└── public/
    └── main.ts
```

## License

MIT
