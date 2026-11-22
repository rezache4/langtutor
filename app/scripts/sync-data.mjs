import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../pipeline/out')
const dstDir = resolve(here, '../public/data')
const files = ['core.json', 'examples.json']
const missing = files.filter(f => !existsSync(resolve(out, f)))
if (missing.length) { console.error(`Missing ${missing.join(', ')} in ${out} (run the pipeline first; "build.py split" re-splits an existing bundle.json)`); process.exit(1) }
mkdirSync(dstDir, { recursive: true })
for (const f of files) {
  copyFileSync(resolve(out, f), resolve(dstDir, f))
  console.log(`Copied ${f} (${(statSync(resolve(dstDir, f)).size / 1048576).toFixed(1)} MB) -> ${dstDir}`)
}
