import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
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

const migrationsSrcDir = path.join(projectRoot, 'src', 'db', 'migrations')
const migrationsOutDir = path.join(outputDir, 'migrations')
mkdirSync(migrationsOutDir, { recursive: true })
for (const file of readdirSync(migrationsSrcDir)) {
  if (!file.endsWith('.sql')) continue
  copyFileSync(path.join(migrationsSrcDir, file), path.join(migrationsOutDir, file))
}

console.log('Copied SQL schema into dist/db/schema.sql')
