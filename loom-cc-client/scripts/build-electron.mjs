import { build } from 'esbuild'
import {
  readdirSync, lstatSync, readlinkSync, rmSync, cpSync,
  readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

// Step 1: Build electron main + preload with esbuild
async function buildElectron() {
  const shared = {
    bundle: true,
    platform: 'node',
    target: 'node18',
    external: ['electron'],
    sourcemap: true,
    minify: false,
  }

  await build({
    ...shared,
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.js',
    format: 'cjs',
  })

  await build({
    ...shared,
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.js',
    format: 'cjs',
  })

  console.log('✅ Electron main + preload built')
}

// Step 2: Resolve symlinks in .next/standalone
function resolveSymlinks(dir) {
  let resolved = 0
  function walk(d) {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(d, entry.name)
      try {
        const stat = lstatSync(fullPath)
        if (stat.isSymbolicLink()) {
          const realPath = resolve(d, readlinkSync(fullPath))
          rmSync(fullPath, { force: true })
          try {
            const realStat = lstatSync(realPath)
            if (realStat.isDirectory()) {
              cpSync(realPath, fullPath, { recursive: true })
            } else {
              cpSync(realPath, fullPath)
            }
            resolved++
          } catch {
            // Target doesn't exist, just remove the dangling symlink
          }
        } else if (stat.isDirectory()) {
          walk(fullPath)
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }
  walk(dir)
  console.log(`✅ Resolved ${resolved} symlinks in standalone`)
}

function findStandaloneAppRoot(standaloneDir) {
  const directServer = join(standaloneDir, 'server.js')
  if (existsSync(directServer)) return standaloneDir

  const queue = [standaloneDir]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (!dir) continue

    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      const fullPath = join(dir, entry.name)
      if (existsSync(join(fullPath, 'server.js'))) return fullPath
      queue.push(fullPath)
    }
  }

  throw new Error(`Could not find standalone server.js under ${standaloneDir}`)
}

// Step 3: Fix pnpm hoisting gaps in standalone node_modules
function fixPnpmHoisting(standaloneDir) {
  const nodeModules = join(standaloneDir, 'node_modules')
  const pnpmDir = join(nodeModules, '.pnpm')
  if (!existsSync(pnpmDir)) return

  let totalFixed = 0
  for (let pass = 0; pass < 5; pass++) {
    let fixed = 0
    const pnpmEntries = readdirSync(pnpmDir)

    for (const entry of pnpmEntries) {
      const entryModules = join(pnpmDir, entry, 'node_modules')
      if (!existsSync(entryModules)) continue

      let pkgs
      try { pkgs = readdirSync(entryModules) } catch { continue }

      for (const pkg of pkgs) {
        if (pkg === '.pnpm' || pkg === 'node_modules') continue

        if (pkg.startsWith('@')) {
          const scopeDir = join(entryModules, pkg)
          let scopedPkgs
          try { scopedPkgs = readdirSync(scopeDir) } catch { continue }
          for (const scopedPkg of scopedPkgs) {
            const topLevel = join(nodeModules, pkg, scopedPkg)
            if (existsSync(topLevel)) continue
            const source = join(scopeDir, scopedPkg)
            try {
              const stat = lstatSync(source)
              if (stat.isDirectory()) {
                mkdirSync(join(nodeModules, pkg), { recursive: true })
                cpSync(source, topLevel, { recursive: true })
                fixed++
              }
            } catch { /* skip */ }
          }
          continue
        }

        const topLevel = join(nodeModules, pkg)
        if (existsSync(topLevel)) continue

        const source = join(entryModules, pkg)
        try {
          const stat = lstatSync(source)
          if (stat.isDirectory()) {
            cpSync(source, topLevel, { recursive: true })
            fixed++
          }
        } catch { /* skip */ }
      }
    }

    totalFixed += fixed
    if (fixed === 0) break
  }

  if (totalFixed > 0) console.log(`✅ Fixed ${totalFixed} pnpm hoisting gap(s)`)
}

// Step 4: Copy runtime assets into standalone app root
function copyRuntimeAssets(standaloneDir) {
  const appDir = findStandaloneAppRoot(standaloneDir)
  if (!existsSync(appDir)) return

  const staticSrc = join(process.cwd(), '.next', 'static')
  const staticDest = join(appDir, '.next', 'static')
  if (existsSync(staticSrc)) {
    rmSync(staticDest, { recursive: true, force: true })
    cpSync(staticSrc, staticDest, { recursive: true })
    console.log('✅ Copied .next/static to standalone app root')
  }

  const publicSrc = join(process.cwd(), 'public')
  const publicDest = join(appDir, 'public')
  if (existsSync(publicSrc)) {
    rmSync(publicDest, { recursive: true, force: true })
    cpSync(publicSrc, publicDest, { recursive: true })
    console.log('✅ Copied public/ to standalone app root')
  }
}

// Step 5: Strip developer machine paths from standalone build output
function stripDevPaths(standaloneDir) {
  const projectRoot = process.cwd()
  let replaced = 0

  for (const name of ['server.js']) {
    const fp = join(standaloneDir, name)
    try {
      const content = readFileSync(fp, 'utf-8')
      if (content.includes(projectRoot)) {
        writeFileSync(fp, content.replaceAll(projectRoot, '/app'), 'utf-8')
        replaced++
      }
    } catch { /* skip */ }
  }

  function walkAndStrip(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue
      const fullPath = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          walkAndStrip(fullPath)
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
          const content = readFileSync(fullPath, 'utf-8')
          if (content.includes(projectRoot)) {
            writeFileSync(fullPath, content.replaceAll(projectRoot, '/app'), 'utf-8')
            replaced++
          }
        }
      } catch { /* skip */ }
    }
  }

  walkAndStrip(join(standaloneDir, '.next'))
  console.log(`✅ Stripped developer paths from ${replaced} file(s)`)
}

// Step 6: Copy claude CLI binary from SDK platform package into build/claude-cli/
// electron-builder will pick this up via extraResources and put it in Contents/Resources/claude-cli/
function copyClaudeBinary() {
  const platform = process.platform
  const arch = process.arch
  const pkgSuffix = `claude-agent-sdk-${platform}-${arch}`
  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude'
  const srcPath = join(process.cwd(), 'node_modules', '@anthropic-ai', pkgSuffix, binaryName)
  const destDir = join(process.cwd(), 'build', 'claude-cli')
  const destPath = join(destDir, binaryName)

  if (!existsSync(srcPath)) {
    console.warn(`⚠️  Claude binary not found at ${srcPath} — skipping (claude CLI may need to be installed by user)`)
    return
  }

  mkdirSync(destDir, { recursive: true })
  cpSync(srcPath, destPath)

  if (platform !== 'win32') {
    chmodSync(destPath, 0o755)
  }

  console.log(`✅ Copied claude binary (${pkgSuffix}) to build/claude-cli/`)
}

// Main
await buildElectron()
copyClaudeBinary()

const standaloneDir = join(process.cwd(), '.next', 'standalone')
try {
  lstatSync(standaloneDir)
  resolveSymlinks(standaloneDir)
  fixPnpmHoisting(standaloneDir)
  resolveSymlinks(standaloneDir)
  copyRuntimeAssets(standaloneDir)
  stripDevPaths(standaloneDir)
  const appDir = findStandaloneAppRoot(standaloneDir)
  resolveSymlinks(appDir)
  fixPnpmHoisting(appDir)
  resolveSymlinks(appDir)
} catch {
  console.log('⚠️  No .next/standalone found — skipping (dev build?)')
}
