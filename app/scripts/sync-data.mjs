import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../pipeline/out/bundle.json')
const dst = resolve(here, '../public/data/bundle.json')
if (!existsSync(src)) { console.error('Missing ' + src + ' (run the pipeline first)'); process.exit(1) }
mkdirSync(dirname(dst), { recursive: true })
copyFileSync(src, dst)
console.log(`Copied bundle (${(statSync(dst).size / 1048576).toFixed(1)} MB) -> ${dst}`)
