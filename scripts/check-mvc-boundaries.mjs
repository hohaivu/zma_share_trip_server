import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')
const guardedDirs = [
  path.join(projectRoot, 'src', 'routes'),
  path.join(projectRoot, 'src', 'controllers'),
]
const servicesDir = path.join(projectRoot, 'src', 'services')

/*
 * Services guardrail
 * ------------------
 * Source files under src/services/ must access the database through
 * repositories, never directly. This guard fails the script if a service:
 *   1. Imports the DB connection module (src/db/connection.ts) — relative
 *      or absolute — or the bare "pg" package (or any "pg/..." subpath).
 *   2. Contains raw SQL inside string/template literals, detected by the
 *      uppercase keywords SELECT, INSERT INTO, UPDATE, DELETE FROM.
 * Repositories remain the legitimate owners of both DB connections and
 * raw SQL.
 */

const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

const stripComments = (contents) => {
  let output = ''
  let state = 'code'

  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index]
    const next = contents[index + 1]

    if (state === 'lineComment') {
      output += char === '\n' ? '\n' : ' '
      if (char === '\n') state = 'code'
      continue
    }

    if (state === 'blockComment') {
      output += char === '\n' ? '\n' : ' '
      if (char === '*' && next === '/') {
        output += ' '
        index += 1
        state = 'code'
      }
      continue
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      output += char
      if (char === '\\') {
        output += next ?? ''
        index += 1
        continue
      }
      if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = 'code'
      }
      continue
    }

    if (char === '/' && next === '/') {
      output += '  '
      index += 1
      state = 'lineComment'
      continue
    }

    if (char === '/' && next === '*') {
      output += '  '
      index += 1
      state = 'blockComment'
      continue
    }

    if (char === "'") state = 'single'
    if (char === '"') state = 'double'
    if (char === '`') state = 'template'
    output += char
  }

  return output
}

const stripKnownExtension = (filePath) =>
  filePath.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/, '')

const isStoreImport = (specifier, importerPath) => {
  if (!specifier.startsWith('.')) return false

  const resolved = stripKnownExtension(
    path.resolve(path.dirname(importerPath), specifier),
  )
  return resolved === path.join(projectRoot, 'src', 'store')
}

const dbConnectionPath = path.join(projectRoot, 'src', 'db', 'connection')

const isDbConnectionImport = (specifier, importerPath) => {
  if (specifier.startsWith('.')) {
    const resolved = stripKnownExtension(
      path.resolve(path.dirname(importerPath), specifier),
    )
    return resolved === dbConnectionPath
  }

  if (path.isAbsolute(specifier)) {
    return stripKnownExtension(specifier) === dbConnectionPath
  }

  return false
}

const isPgPackageImport = (specifier) =>
  specifier === 'pg' || specifier.startsWith('pg/')

const rawSqlPattern = /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/
const stringLiteralPattern = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g

const findTypeScriptFiles = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...findTypeScriptFiles(entryPath))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath)
    }
  }

  return files
}

const lineNumberForIndex = (contents, index) => contents.slice(0, index).split('\n').length

const storeViolations = []

for (const dir of guardedDirs) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue

  for (const filePath of findTypeScriptFiles(dir)) {
    const contents = readFileSync(filePath, 'utf8')
    const scanContents = stripComments(contents)

    for (const match of scanContents.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3]

      if (!specifier || !isStoreImport(specifier, filePath)) continue

      storeViolations.push({
        filePath: path.relative(projectRoot, filePath),
        line: lineNumberForIndex(contents, match.index),
        specifier,
      })
    }
  }
}

const serviceViolations = []

if (statSync(servicesDir, { throwIfNoEntry: false })?.isDirectory()) {
  for (const filePath of findTypeScriptFiles(servicesDir)) {
    const contents = readFileSync(filePath, 'utf8')
    const scanContents = stripComments(contents)
    const relativePath = path.relative(projectRoot, filePath)

    for (const match of scanContents.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      if (!specifier) continue

      if (isDbConnectionImport(specifier, filePath)) {
        serviceViolations.push({
          kind: 'db-connection-import',
          filePath: relativePath,
          line: lineNumberForIndex(contents, match.index),
          detail: `imports DB connection "${specifier}"`,
        })
        continue
      }

      if (isPgPackageImport(specifier)) {
        serviceViolations.push({
          kind: 'pg-package-import',
          filePath: relativePath,
          line: lineNumberForIndex(contents, match.index),
          detail: `imports pg package "${specifier}"`,
        })
      }
    }

    for (const stringMatch of scanContents.matchAll(stringLiteralPattern)) {
      const literal = stringMatch[0]
      const sqlMatch = literal.match(rawSqlPattern)
      if (!sqlMatch) continue

      serviceViolations.push({
        kind: 'raw-sql',
        filePath: relativePath,
        line: lineNumberForIndex(contents, stringMatch.index),
        detail: `contains raw SQL keyword "${sqlMatch[1]}" in string literal`,
      })
    }
  }
}

let failed = false

if (storeViolations.length > 0) {
  failed = true
  console.error('MVC boundary guardrail failed: routes/controllers must not import src/store.ts directly.')
  console.error('Move shared-store access behind a service, repository, or approved compatibility facade outside routes/controllers.\n')

  for (const violation of storeViolations) {
    console.error(`- ${violation.filePath}:${violation.line} imports "${violation.specifier}"`)
  }
}

if (serviceViolations.length > 0) {
  failed = true
  if (storeViolations.length > 0) console.error('')
  console.error('MVC boundary guardrail failed: services must not access the DB directly.')
  console.error('Route DB connections and raw SQL through repositories instead of src/services.\n')

  for (const violation of serviceViolations) {
    console.error(`- ${violation.filePath}:${violation.line} [${violation.kind}] ${violation.detail}`)
  }
}

if (failed) {
  process.exit(1)
}

console.log('MVC boundary guardrail passed: no direct store imports in src/routes or src/controllers, and no direct DB access in src/services.')
