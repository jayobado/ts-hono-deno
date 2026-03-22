import { bundle } from '@deno/emit'
import { Log } from './logger.ts'
import type { BundleOptions } from './types.ts'


export async function buildBundle(opts: BundleOptions): Promise<void> {
	const {
		entry,
		outFile,
		importMap,
		githubToken = Deno.env.get('GITHUB_TOKEN') ?? '',
		onComplete,
	} = opts

	await Log.info(`Building bundle: ${entry}`)

	const { code } = await bundle(entry, {
		importMap,
		load: async (specifier: string) => {
			// Local files
			if (
				specifier.startsWith('file://') ||
				specifier.startsWith('./') ||
				specifier.startsWith('../') ||
				!specifier.startsWith('http')
			) {
				try {
					const path = specifier.startsWith('file://')
						? new URL(specifier).pathname
						: specifier
					const content = await Deno.readTextFile(path)
					return { kind: 'module' as const, specifier, content }
				} catch {
					return undefined
				}
			}

			// Private GitHub
			if (specifier.includes('raw.githubusercontent.com') && githubToken) {
				const res = await fetch(specifier, {
					headers: { Authorization: `token ${githubToken}` },
				})
				if (!res.ok) {
					throw new Error(
						`Failed to fetch ${specifier}: ${res.status} ${res.statusText}`
					)
				}
				const content = await res.text()
				return { kind: 'module' as const, specifier, content }
			}

			// Public CDN
			try {
				const res = await fetch(specifier)
				if (!res.ok) return undefined
				const content = await res.text()
				return { kind: 'module' as const, specifier, content }
			} catch {
				return undefined
			}
		},
	})

	const outDir = outFile.substring(0, outFile.lastIndexOf('/'))
	await Deno.mkdir(outDir, { recursive: true })
	await Deno.writeTextFile(outFile, code)

	const bytes = new TextEncoder().encode(code).length

	if (onComplete) {
		onComplete(outFile, bytes)
	} else {
		const kb = (bytes / 1024).toFixed(1)
		await Log.info(`Bundle complete: ${outFile} (${kb} KB)`)
	}
}