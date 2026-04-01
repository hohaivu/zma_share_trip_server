import { cpSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')
const sourceDir = path.join(projectRoot, 'src', 'db', 'migrations')
const outputDir = path.join(projectRoot, 'dist', 'db', 'migrations')

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(path.dirname(outputDir), { recursive: true })
cpSync(sourceDir, outputDir, { recursive: true })

console.log('Copied SQL migrations into dist/db/migrations')
