import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')
const sourcePath = path.join(projectRoot, 'src', 'db', 'schema.sql')
const outputDir = path.join(projectRoot, 'dist', 'db')
const outputPath = path.join(outputDir, 'schema.sql')

rmSync(outputPath, { force: true })
mkdirSync(outputDir, { recursive: true })
copyFileSync(sourcePath, outputPath)

console.log('Copied SQL schema into dist/db/schema.sql')
