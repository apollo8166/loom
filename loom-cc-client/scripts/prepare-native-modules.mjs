/**
 * Rebuilds and verifies native Node.js modules inside .next/standalone against
 * the bundled Node runtime that will be shipped in the Electron app.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const RAW_TARGET_ARCH = process.env.LOOM_TARGET_ARCH || process.arch
const ARCH_MAP = { arm64: 'arm64', x64: 'x64' }
const TARGET_ARCH = ARCH_MAP[RAW_TARGET_ARCH]
if (!TARGET_ARCH) {
  throw new Error(`Unsupported target architecture: ${RAW_TARGET_ARCH}`)
}

const ROOT = process.cwd()
const require = createRequire(import.meta.url)
const STANDALONE_DIR = path.join(ROOT, '.next', 'standalone')
const NODE_RUNTIME_DIR = path.join(ROOT, 'build', 'node-runtime')
const NODE_BIN = process.platform === 'win32'
  ? path.join(NODE_RUNTIME_DIR, 'node.exe')
  : path.join(NODE_RUNTIME_DIR, 'bin', 'node')
const HOST_NODE_BIN = process.execPath
const CAN_EXECUTE_TARGET = TARGET_ARCH === process.arch

function findFirst(dir, predicate) {
  const queue = [dir]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (predicate(fullPath, entry)) return fullPath
      if (entry.isDirectory()) queue.push(fullPath)
    }
  }
  return null
}

function findStandalonePackages(packageName) {
  const nodeModulesDir = path.join(STANDALONE_DIR, 'node_modules')
  if (!fs.existsSync(nodeModulesDir)) return []

  const results = []
  const seen = new Set()
  const queue = [nodeModulesDir]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    let entries
    try { entries = fs.readdirSync(current, { withFileTypes: true }) } catch { continue }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(current, entry.name)

      if (entry.name === packageName && fs.existsSync(path.join(fullPath, 'package.json'))) {
        const realPath = fs.realpathSync(fullPath)
        if (!seen.has(realPath)) {
          seen.add(realPath)
          results.push(fullPath)
        }
        continue
      }

      if (
        entry.name === 'node_modules' ||
        entry.name === '.pnpm' ||
        entry.name.startsWith('@') ||
        current.endsWith(`${path.sep}.pnpm`) ||
        current.includes(`${path.sep}.pnpm${path.sep}`)
      ) {
        queue.push(fullPath)
      }
    }
  }

  return results.sort((a, b) => a.length - b.length)
}

function findInstalledPackage(packageName) {
  const packageJsonPath = requireResolve(`${packageName}/package.json`)
  return packageJsonPath ? path.dirname(packageJsonPath) : null
}

function requireResolve(id) {
  try {
    return require.resolve(id, { paths: [ROOT] })
  } catch {
    return null
  }
}

function expectedFileArch(arch) {
  return arch === 'x64' ? 'x86_64' : arch
}

function copyIfMissingOrDirectory(source, dest) {
  if (!fs.existsSync(source)) return

  const sourceStat = fs.statSync(source)
  if (sourceStat.isDirectory()) {
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(source, dest, { recursive: true })
    return
  }

  if (!fs.existsSync(dest)) fs.cpSync(source, dest)
}

function ensureBetterSqliteBuildInputs(packageDir) {
  if (fs.existsSync(path.join(packageDir, 'binding.gyp')) && fs.existsSync(path.join(packageDir, 'src'))) return

  const installedDir = findInstalledPackage('better-sqlite3')
  if (!installedDir) {
    throw new Error('Installed better-sqlite3 package not found; cannot copy native build inputs.')
  }

  for (const name of ['binding.gyp', 'src', 'deps']) {
    copyIfMissingOrDirectory(path.join(installedDir, name), path.join(packageDir, name))
  }
}

function findNodeGyp() {
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    const found = findFirst(pnpmDir, (fullPath, entry) => (
      entry.isFile() &&
      entry.name === 'node-gyp.js' &&
      fullPath.includes(`${path.sep}node-gyp@`) &&
      fullPath.endsWith(`${path.sep}bin${path.sep}node-gyp.js`)
    ))
    if (found) return found
  }

  const npmNodeGyp = findFirst(path.join(NODE_RUNTIME_DIR, 'lib', 'node_modules', 'npm'), (fullPath, entry) => (
    entry.isFile() && entry.name === 'node-gyp.js' && fullPath.endsWith(`${path.sep}bin${path.sep}node-gyp.js`)
  ))
  if (npmNodeGyp) return npmNodeGyp

  throw new Error('node-gyp not found. Run pnpm install before packaging.')
}

function verifyNodeRuntime() {
  if (!fs.existsSync(NODE_BIN)) {
    throw new Error(`Bundled Node runtime is missing: ${NODE_BIN}`)
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(NODE_BIN, 0o755)
  }

  if (process.platform === 'darwin') {
    const expectedArch = expectedFileArch(TARGET_ARCH)
    const fileOutput = execFileSync('/usr/bin/file', [NODE_BIN], { encoding: 'utf8' })
    if (!fileOutput.includes(expectedArch)) {
      throw new Error(`Bundled Node architecture does not match LOOM_TARGET_ARCH=${TARGET_ARCH}: ${fileOutput.trim()}`)
    }
  }

  const nodeVersionHeader = path.join(NODE_RUNTIME_DIR, 'include', 'node', 'node_version.h')
  if (!fs.existsSync(path.join(NODE_RUNTIME_DIR, 'include', 'node', 'node.h')) || !fs.existsSync(nodeVersionHeader)) {
    throw new Error(`Bundled Node headers are missing under ${path.join(NODE_RUNTIME_DIR, 'include', 'node')}`)
  }

  const versionHeader = fs.readFileSync(nodeVersionHeader, 'utf8')
  const majorMatch = versionHeader.match(/#define NODE_MAJOR_VERSION\s+(\d+)/)
  if (!majorMatch || majorMatch[1] !== '22') {
    throw new Error(`Expected bundled Node headers for v22.x, got: ${majorMatch?.[1] || 'unknown'}`)
  }
  const modulesMatch = versionHeader.match(/#define NODE_MODULE_VERSION\s+(\d+)/)

  if (!CAN_EXECUTE_TARGET) {
    console.log(`Bundled Node for native modules: v22.x modules=${modulesMatch?.[1] || 'unknown'} arch=${TARGET_ARCH} (static verification on host arch=${process.arch})`)
    return
  }

  const version = execFileSync(NODE_BIN, ['-p', "process.version + ' modules=' + process.versions.modules + ' arch=' + process.arch"], {
    encoding: 'utf8',
  }).trim()
  console.log(`Bundled Node for native modules: ${version}`)

  if (!version.startsWith('v22.')) {
    throw new Error(`Expected bundled Node v22.x, got: ${version}`)
  }
  if (!version.includes(`arch=${TARGET_ARCH}`)) {
    throw new Error(`Bundled Node architecture does not match LOOM_TARGET_ARCH=${TARGET_ARCH}: ${version}`)
  }
}

function runBetterSqliteCheck(packageDir) {
  if (!CAN_EXECUTE_TARGET) {
    throw new Error(`Cannot execute ${TARGET_ARCH} native module on host arch=${process.arch}`)
  }

  const script = [
    `const Database = require(${JSON.stringify(packageDir)});`,
    "const db = new Database(':memory:');",
    "const row = db.prepare('select 1 as ok').get();",
    'db.close();',
    "if (!row || row.ok !== 1) throw new Error('better-sqlite3 smoke query failed');",
  ].join(' ')

  execFileSync(NODE_BIN, ['-e', script], {
    cwd: ROOT,
    stdio: 'pipe',
  })
}

function findBetterSqliteNativeModule(packageDir) {
  const primary = path.join(packageDir, 'build', 'Release', 'better_sqlite3.node')
  if (fs.existsSync(primary)) return primary

  return findFirst(packageDir, (fullPath, entry) => (
    entry.isFile() && entry.name === 'better_sqlite3.node'
  ))
}

function verifyBetterSqliteNativeModule(packageDir) {
  const nativeModulePath = findBetterSqliteNativeModule(packageDir)
  if (!nativeModulePath) {
    throw new Error(`better-sqlite3 native module is missing under ${packageDir}`)
  }

  const stat = fs.statSync(nativeModulePath)
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`better-sqlite3 native module is empty or invalid: ${nativeModulePath}`)
  }

  if (process.platform === 'darwin') {
    const expectedArch = expectedFileArch(TARGET_ARCH)
    const fileOutput = execFileSync('/usr/bin/file', [nativeModulePath], { encoding: 'utf8' })
    if (!fileOutput.includes(expectedArch)) {
      throw new Error(`better-sqlite3 has wrong architecture. Expected ${expectedArch}; got: ${fileOutput.trim()}`)
    }
  }

  return nativeModulePath
}

function rebuildBetterSqlite(packageDir) {
  ensureBetterSqliteBuildInputs(packageDir)

  const nodeGyp = findNodeGyp()
  const buildNodeBin = CAN_EXECUTE_TARGET ? NODE_BIN : HOST_NODE_BIN
  const env = {
    ...process.env,
    PATH: [
      path.dirname(buildNodeBin),
      CAN_EXECUTE_TARGET ? path.dirname(HOST_NODE_BIN) : null,
      process.env.PATH || '',
    ].filter(Boolean).join(path.delimiter),
    npm_config_nodedir: NODE_RUNTIME_DIR,
    npm_config_arch: TARGET_ARCH,
    npm_config_target_arch: TARGET_ARCH,
    npm_config_build_from_source: 'true',
  }

  const nodeKind = CAN_EXECUTE_TARGET ? 'bundled Node' : `host Node (${process.arch})`
  console.log(`Rebuilding better-sqlite3 for bundled Node (${TARGET_ARCH}) using ${nodeKind}...`)
  execFileSync(buildNodeBin, [nodeGyp, 'rebuild', '--release', `--nodedir=${NODE_RUNTIME_DIR}`, `--arch=${TARGET_ARCH}`], {
    cwd: packageDir,
    env,
    stdio: 'inherit',
  })
}

function main() {
  if (!fs.existsSync(STANDALONE_DIR)) {
    console.log('No .next/standalone found; skipping native module preparation.')
    return
  }

  verifyNodeRuntime()

  const betterSqliteDirs = findStandalonePackages('better-sqlite3')
  if (betterSqliteDirs.length === 0) {
    console.log('better-sqlite3 not found in standalone output; skipping native module preparation.')
    return
  }

  for (const betterSqliteDir of betterSqliteDirs) {
    if (!CAN_EXECUTE_TARGET) {
      console.log(`Cross-architecture target (${TARGET_ARCH} on host ${process.arch}); rebuilding better-sqlite3 without runtime smoke test: ${betterSqliteDir}`)
      rebuildBetterSqlite(betterSqliteDir)
      const nativeModulePath = verifyBetterSqliteNativeModule(betterSqliteDir)
      console.log(`better-sqlite3 rebuilt and statically verified for ${TARGET_ARCH}: ${nativeModulePath}`)
      continue
    }

    try {
      runBetterSqliteCheck(betterSqliteDir)
      const nativeModulePath = verifyBetterSqliteNativeModule(betterSqliteDir)
      console.log(`better-sqlite3 already matches bundled Node ABI: ${betterSqliteDir}`)
      console.log(`better-sqlite3 native module architecture verified: ${nativeModulePath}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`better-sqlite3 ABI check failed before rebuild (${betterSqliteDir}): ${message}`)
      rebuildBetterSqlite(betterSqliteDir)
      runBetterSqliteCheck(betterSqliteDir)
      const nativeModulePath = verifyBetterSqliteNativeModule(betterSqliteDir)
      console.log(`better-sqlite3 rebuilt and verified against bundled Node ABI: ${betterSqliteDir}`)
      console.log(`better-sqlite3 native module architecture verified: ${nativeModulePath}`)
    }
  }
}

try {
  main()
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`Failed to prepare native modules: ${message}`)
  process.exit(1)
}
