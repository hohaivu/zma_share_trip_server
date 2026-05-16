import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptsDir, '..')
const guardedDirs = [
  path.join(projectRoot, 'src', 'routes'),
  path.join(projectRoot, 'src', 'controllers'),
]

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

const violations = []

for (const dir of guardedDirs) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue

  for (const filePath of findTypeScriptFiles(dir)) {
    const contents = readFileSync(filePath, 'utf8')
    const scanContents = stripComments(contents)

    for (const match of scanContents.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3]

      if (!specifier || !isStoreImport(specifier, filePath)) continue

      violations.push({
        filePath: path.relative(projectRoot, filePath),
        line: lineNumberForIndex(contents, match.index),
        specifier,
      })
    }
  }
}

if (violations.length > 0) {
  console.error('MVC boundary guardrail failed: routes/controllers must not import src/store.ts directly.')
  console.error('Move shared-store access behind a service, repository, or approved compatibility facade outside routes/controllers.\n')

  for (const violation of violations) {
    console.error(`- ${violation.filePath}:${violation.line} imports "${violation.specifier}"`)
  }

  process.exit(1)
}

console.log('MVC boundary guardrail passed: no direct store imports in src/routes or src/controllers.')
