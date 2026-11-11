import { readFileSync, writeFileSync } from 'node:fs'

const path = new URL('../dist/src/data.js', import.meta.url)
const source = readFileSync(path, 'utf8')
const inlined = source.replace(
  /^import (\w+) from '(\.\.\/data\/[\w-]+\.json)' with \{ type: 'json' \};$/gm,
  (_, name, file) => `const ${name} = ${readFileSync(new URL(file, path), 'utf8').trim()};`,
)
if (inlined.includes("with { type: 'json' }")) throw new Error('dist/src/data.js still has JSON import attributes')
writeFileSync(path, inlined)
