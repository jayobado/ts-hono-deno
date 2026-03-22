# ts-deno-hono

A Hono server factory for TypeScript SPA applications running on Deno. Handles static file serving, on-the-fly TypeScript transpilation, session management, logging, and optional tRPC integration — so your `server.ts` stays under 50 lines.

## What it provides

- **`ui()`** — serves and transpiles a TypeScript SPA with lazy or eager caching
- **`api()`** — standalone API server with tRPC, CORS, and auth middleware
- **`Log`** — file-based logger with daily rotating files per level
- **Session management** — in-memory and Deno KV stores, cookie helpers
- **Middleware** — request ID, security headers, access log, error handler, CORS, auth
- **`buildBundle()`** — pre-bundles your SPA for non-Deno deployment targets

## Requirements

- Deno 1.40+
- Hono 4.12+

## Compatibility

`ts-deno-hono` is **Deno only**. It uses Deno-specific APIs that are not available in Node or Bun:

| API | Used for |
|---|---|
| `Deno.serve` | HTTP server |
| `Deno.readTextFile` | Reading source files for transpilation |
| `Deno.readDir` | Walking file tree for eager cache warm |
| `Deno.mkdir` / `Deno.writeTextFile` | Writing log files and build output |
| `@deno/emit` | TypeScript transpilation |
| `@std/http/file-server` | Static file serving |

For Node or Bun use a different server layer (Fastify, Express, Elysia etc.) and a bundler (Vite, esbuild) for TypeScript transpilation.

## Installation

### Deno (JSR — recommended)
```sh
deno add jsr:@jayobado/ts-deno-hono
```

Or add manually to `deno.json`:
```json
{
  "imports": {
    "@ts-deno-hono": "jsr:@jayobado/ts-deno-hono@^0.1.0"
  }
}
```

### Deno (GitHub — for local development or forks)
```json
{
  "imports": {
    "@ts-deno-hono": "https://raw.githubusercontent.com/jayobado/ts-deno-hono/v0.1.0/mod.ts"
  }
}
```
```bash
export DENO_AUTH_TOKENS="ghp_yourtoken@raw.githubusercontent.com"
```

## Quick start
```typescript
// server.ts
import {
  ui,
  createMemoryStore,
  setSessionCookie,
  clearSessionCookie,
  createAuthMiddleware,
} from '@ts-deno-hono'
import { trpcServer } from '@hono/trpc-server'
import { appRouter }  from './src/trpc/router.ts'

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
      await setSessionCookie(c, session, sessions, { secure: !isDev })
      return c.json({ ok: true, user: session })
    })

    app.post('/auth/logout', async (c) => {
      await clearSessionCookie(c, sessions)
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
```json
{
  "tasks": {
    "dev":   "deno run --watch --allow-all server.ts",
    "start": "ENV=production deno run --allow-all server.ts",
    "build": "deno run --allow-all scripts/build.ts"
  }
}
```
```bash
deno task dev
```

---

## `ui()`

Serves a TypeScript SPA from `fsRoot`. Intercepts `.ts` and `.tsx` requests and transpiles them. Falls back to `index.html` for SPA client-side routes.
```typescript
await ui({
  host:    'localhost',
  port:    3000,

  // Source directory — default './public'
  fsRoot:  './public',

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
  // Only needed for JSX frameworks (React, Solid, Preact)
  // Not needed for ts-ui, vue-ui, or plain TypeScript
  compilerOptions: {
    jsx:             'react-jsx',
    jsxImportSource: 'react',
  },

  // Additional routes mounted before the static file catch-all
  routes: (app) => {
    app.post('/auth/login',  ...)
    app.post('/auth/logout', ...)
    app.use('/api/*',        ...)
  },
})
```

### Transpilation strategies

**Lazy — development**

Transpiles on the first request for each file then caches the result in memory. Subsequent requests return from cache instantly. Import map aliases and private GitHub repos are resolved server-side — the browser never needs auth tokens.

**Eager — production**

Transpiles every `.ts` and `.tsx` file at startup before accepting requests. All files are in memory by the time the first request arrives. Functionally equivalent to serving pre-bundled files with no build artifact on disk.
```bash
# Development — lazy transpilation
deno task dev

# Production on Deno — eager cache at startup
deno task start
```

### Serving private dependencies

When your code imports from a private GitHub repo (`@ts-ui`, `@vue-ui` etc.), `ui()` fetches those files server-side using your `GITHUB_TOKEN`. The browser never makes requests to GitHub directly.
```bash
export GITHUB_TOKEN="ghp_yourtoken"
```

---

## `api()`

Standalone API server. Use when your backend is a separate service from the UI — consumed by multiple clients, deployed independently, or on a different port.
```typescript
import { api, createMemoryStore } from '@ts-deno-hono'

const sessions = createMemoryStore()

api({
  host:    'localhost',
  port:    3001,
  origins: 'https://myapp.com',  // or string[]
  trpc:    appRouter,

  // Extra middleware before tRPC (e.g. rate limiting)
  middleware: [rateLimiter],

  // Extra routes
  routes: (app) => {
    app.post('/webhooks/stripe', handleStripe)
  },
}, sessions)
```

> For a single Deno process serving both UI and API use `ui()` with a `routes` callback instead. `api()` is for separate deployments.

---

## Logging

`Log` writes to `./logs/{level}_{YYYYMMDD}.log` and stdout/stderr simultaneously. A new file is created per level per day automatically.
```typescript
import { Log } from '@ts-deno-hono'

await Log.debug('Cache warmed — 6 files in 2.1s')
await Log.info('Server running at http://localhost:3000')
await Log.warn('Session store nearing capacity')
await Log.error('Database connection failed')
```

Log files created automatically:
```
logs/
├── debug_20250117.log
├── info_20250117.log
├── warn_20250117.log
└── error_20250117.log
```

---

## Session management
```typescript
import {
  createMemoryStore,
  createDenoKvStore,
  setSessionCookie,
  clearSessionCookie,
} from '@ts-deno-hono'

// In-memory — fast, lost on restart
const sessions = createMemoryStore()

// Deno KV — persistent across restarts
const kv       = await Deno.openKv()
const sessions = createDenoKvStore(kv, 60 * 60 * 8) // 8h TTL

// Set cookie on login
await setSessionCookie(c, session, sessions, {
  name:     'sid',        // default
  maxAge:   60 * 60 * 8, // 8 hours in seconds
  secure:   true,         // true in production (requires HTTPS)
  sameSite: 'Lax',        // default
})

// Clear cookie on logout
await clearSessionCookie(c, sessions)
await clearSessionCookie(c, sessions, 'my-custom-sid')
```

### Session type
```typescript
interface Session {
  userId: string
  email:  string
  role:   string
  [key: string]: unknown  // extend with any extra fields
}
```

---

## Middleware

All middleware is exported individually for custom Hono app composition:
```typescript
import {
  setRequestId,              // crypto.randomUUID() per request → ctx variable
  setSecurityHeaders,        // API-oriented security headers
  setBrowserSecurityHeaders, // X-Frame-Options, CSP, Referrer-Policy etc.
  accessLog,                 // method, path, status, duration via Log
  errorHandler,              // catches unhandled errors, logs, returns 500
  corsHandler,               // configures CORS for given origins
  createAuthMiddleware,      // reads session cookie, sets ctx session variable
} from '@ts-deno-hono'
```

### Auth middleware
```typescript
import { createAuthMiddleware, createMemoryStore } from '@ts-deno-hono'

const sessions = createMemoryStore()

// Reads 'sid' cookie, looks up session, sets ctx.get('session')
const auth = createAuthMiddleware(sessions)

// Custom cookie name
const auth = createAuthMiddleware(sessions, 'my-session-id')

app.use('/api/*', auth)
app.use('/api/*', trpcServer({
  router:        appRouter,
  createContext: (_opts, ctx) => ({
    session: ctx.get('session'),
  }),
}))
```

---

## Building for non-Deno targets

When deploying to Cloudflare Pages, Netlify, Vercel, AWS S3, or any static host, pre-bundle your SPA into `./dist`:
```typescript
// scripts/build.ts
import { buildBundle } from '@ts-deno-hono'

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
console.log('dist/index.html written')
```
```bash
deno task build
```

### Deployment targets

| Target | Command | Notes |
|---|---|---|
| Deno VPS | `deno task start` | Eager cache, no build needed |
| Deno Deploy | `deno task start` | Eager cache, no build needed |
| Cloudflare Pages | `deno task build` | Deploy `./dist` folder |
| Netlify | `deno task build` | Deploy `./dist` folder |
| Vercel | `deno task build` | Deploy `./dist` folder |
| AWS S3 + CloudFront | `deno task build` | Deploy `./dist` folder |
| GitHub Pages | `deno task build` | Deploy `./dist` folder |

### Cloudflare Pages config
```toml
# wrangler.toml
name                   = "my-app"
pages_build_output_dir = "dist"

[build]
command = "deno task build"
```

Set `GITHUB_TOKEN` as an environment variable in the Cloudflare dashboard if your app imports from private repos.

---

## Compatible UI frameworks

`ui()` is framework-agnostic — it serves and transpiles whatever is in `fsRoot`.

| Framework | `compilerOptions` needed | Notes |
|---|---|---|
| ts-ui | No | Plain TypeScript, no JSX |
| vue-ui | No | Plain TypeScript, no JSX |
| Vue (h() only) | No | Plain TypeScript, no JSX |
| React | Yes | `jsx: 'react-jsx'`, `jsxImportSource: 'react'` |
| Solid | Yes | `jsx: 'react-jsx'`, `jsxImportSource: 'solid-js/h'` |
| Preact | Yes | `jsx: 'react-jsx'`, `jsxImportSource: 'preact'` |

---

## Updating dependencies

`ts-deno-hono` pins its dependencies explicitly. To pull in new versions:
```bash
deno task update    # re-resolves, updates deno.lock
deno task check     # verify types still pass
git add deno.lock
git commit -m "update dependencies"
git tag v0.2.0
git push origin main --tags
deno publish        # publish new version to JSR
```

---

## Project structure
```
ts-deno-hono/
├── mod.ts           # barrel export
├── types.ts         # interfaces — HonoEnv, Config types, Session
├── logger.ts        # Log — file-based structured logger
├── middleware.ts     # setRequestId, accessLog, errorHandler, corsHandler, createAuthMiddleware
├── session.ts       # createMemoryStore, createDenoKvStore, setSessionCookie, clearSessionCookie
├── transpile.ts     # createTranspileHandler, warmTranspileCache
├── bundle.ts        # buildBundle
└── factory.ts       # ui(), api()
```

## Related packages

| Package | Description |
|---|---|
| [ts-ui-tools](https://github.com/jayobado/ts-ui-tools) | Full-stack SPA toolkit — signals, DOM, CSS, router, services |
| [vue-ui-tools](https://github.com/jayobado/vue-ui-tools) | Vue 3 runtime — typed element factories, CSS engine, components |

## License

Copyright (C) 2026 Jeremy Obado. All rights reserved.