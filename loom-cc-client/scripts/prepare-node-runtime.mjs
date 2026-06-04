/**
 * Downloads Node.js LTS (v22) for the current platform/arch and extracts to build/node-runtime/.
 *
 * Run manually before building:
 *   node scripts/prepare-node-runtime.mjs
 *
 * Output structure:
 *   build/node-runtime/          (macOS/Linux)
 *     bin/node
 *     include/node/              (needed for native module rebuilds)
 *     lib/node_modules/npm/      (needed for local npm rebuilds)
 *   build/node-runtime/          (Windows)
 *     node.exe
 *
 * Only uses built-in Node.js modules — no npm packages required.
 */

import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

const BUILD_DIR = path.join(process.cwd(), 'build')
const DEST_DIR = path.join(process.cwd(), 'build', 'node-runtime')
const STAGING_DIR = path.join(process.cwd(), 'build', '.node-runtime-staging')
const TMP_DIR = path.join(process.cwd(), 'build', '.tmp-node-download')

/** Fetch a URL and return the response body as a string. */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = (reqUrl) => {
      https.get(reqUrl, { headers: { 'User-Agent': 'loom-cc-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        res.on('error', reject)
      }).on('error', reject)
    }
    request(url)
  })
}

/** Download a URL to a file on disk. */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = (reqUrl) => {
      https.get(reqUrl, { headers: { 'User-Agent': 'loom-cc-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`))
          return
        }
        const fileStream = fs.createWriteStream(destPath)
        let downloaded = 0
        const contentLength = parseInt(res.headers['content-length'] || '0', 10)
        res.on('data', (chunk) => {
          downloaded += chunk.length
          if (contentLength > 0) {
            const pct = ((downloaded / contentLength) * 100).toFixed(1)
            process.stdout.write(`\r  Downloading... ${pct}%`)
          }
        })
        pipeline(res, fileStream).then(() => {
          process.stdout.write('\n')
          resolve()
        }).catch(reject)
      }).on('error', reject)
    }
    request(url)
  })
}

/** Resolve the latest Node.js v22.x version string from nodejs.org. */
async function getLatestV22Version() {
  const shasumsUrl = 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt'
  const text = await fetchText(shasumsUrl)
  // First line looks like: <hash>  node-v22.x.x-darwin-arm64.tar.gz
  const firstLine = text.split('\n')[0]
  const match = firstLine.match(/node-(v22\.\d+\.\d+)/)
  if (!match) {
    throw new Error(`Could not parse Node.js version from SHASUMS256.txt: ${firstLine}`)
  }
  return match[1]
}

function parseOptions() {
  const rawPlatform = process.platform
  const archArg = process.argv.find(arg => arg.startsWith('--arch='))
  const archiveArg = process.argv.find(arg => arg.startsWith('--archive='))
  const rawArch = archArg ? archArg.slice('--arch='.length) : process.arch
  const archivePath = archiveArg ? path.resolve(archiveArg.slice('--archive='.length)) : null
  const verifyOnly = process.argv.includes('--verify-only')

  // Map platform names
  const platformMap = { darwin: 'darwin', win32: 'win', linux: 'linux' }
  const platform = platformMap[rawPlatform]
  if (!platform) {
    throw new Error(`Unsupported platform: ${rawPlatform}`)
  }

  // Map arch names
  const archMap = { arm64: 'arm64', x64: 'x64' }
  const arch = archMap[rawArch]
  if (!arch) {
    throw new Error(`Unsupported arch: ${rawArch}`)
  }

  return { rawArch, platform, arch, archivePath, verifyOnly }
}

function compareVersionsDesc(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da !== db) return db - da
  }
  return 0
}

function findLocalArchive(platform, arch, ext) {
  const downloadsDir = path.join(process.env.HOME || '', 'Downloads')
  if (!downloadsDir || !fs.existsSync(downloadsDir)) return null

  const escapedExt = ext.replace('.', '\\.')
  const archivePattern = new RegExp(`^node-(v22\\.\\d+\\.\\d+)-${platform}-${arch}\\.${escapedExt}$`)
  const matches = fs.readdirSync(downloadsDir)
    .map((name) => {
      const match = name.match(archivePattern)
      return match ? { name, version: match[1] } : null
    })
    .filter(Boolean)
    .sort((a, b) => compareVersionsDesc(a.version.slice(1), b.version.slice(1)))

  return matches.length > 0 ? path.join(downloadsDir, matches[0].name) : null
}

function nodeBinaryPath(rootDir, platform) {
  return platform === 'win'
    ? path.join(rootDir, 'node.exe')
    : path.join(rootDir, 'bin', 'node')
}

function repairRuntimeSymlinks(rootDir, platform) {
  if (platform === 'win') return

  const links = [
    ['bin', 'corepack', '..', 'lib', 'node_modules', 'corepack', 'dist', 'corepack.js'],
    ['bin', 'npm', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'],
    ['bin', 'npx', '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'],
  ]

  for (const [dirName, linkName, ...targetParts] of links) {
    const linkPath = path.join(rootDir, dirName, linkName)
    const relativeTarget = path.join(...targetParts)
    const absoluteTarget = path.resolve(path.dirname(linkPath), relativeTarget)

    if (!fs.existsSync(absoluteTarget)) continue

    try {
      const stat = fs.lstatSync(linkPath)
      if (stat.isSymbolicLink()) {
        const currentTarget = fs.readlinkSync(linkPath)
        if (currentTarget === relativeTarget) continue
      }
    } catch {
      // Missing links are recreated below.
    }

    fs.rmSync(linkPath, { recursive: true, force: true })
    fs.symlinkSync(relativeTarget, linkPath)
  }
}

function verifyPreparedRuntime(rootDir, platform, arch, { requireExecutable = false } = {}) {
  repairRuntimeSymlinks(rootDir, platform)

  const nodeBin = nodeBinaryPath(rootDir, platform)
  if (!fs.existsSync(nodeBin)) {
    throw new Error(`Node.js runtime binary is missing: ${nodeBin}`)
  }

  const stat = fs.statSync(nodeBin)
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Node.js runtime binary is empty or invalid: ${nodeBin}`)
  }

  if (platform !== 'win') {
    fs.chmodSync(nodeBin, 0o755)
  }

  if (platform === 'darwin') {
    const expectedArch = arch === 'x64' ? 'x86_64' : arch
    const fileOutput = execFileSync('/usr/bin/file', [nodeBin], { encoding: 'utf-8' })
    if (!fileOutput.includes(expectedArch)) {
      throw new Error(`Node.js runtime has wrong architecture. Expected ${expectedArch}; got: ${fileOutput.trim()}`)
    }
  }

  if (requireExecutable) {
    const version = execFileSync(nodeBin, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim()
    if (!version.startsWith('v22.')) {
      throw new Error(`Node.js runtime has unexpected version: ${version}`)
    }
    console.log(`Verified executable Node.js runtime: ${version}`)
  }

  return nodeBin
}

async function main() {
  const { rawArch, platform, arch, archivePath: localArchivePath, verifyOnly } = parseOptions()

  console.log(`Platform: ${platform}, Arch: ${arch}`)

  const hostPlatform = { darwin: 'darwin', win32: 'win', linux: 'linux' }[process.platform]
  const canExecuteTarget = platform === hostPlatform && rawArch === process.arch

  if (verifyOnly) {
    const nodeBin = verifyPreparedRuntime(DEST_DIR, platform, arch, { requireExecutable: canExecuteTarget })
    console.log(`Node.js runtime verified at: ${nodeBin}`)
    return
  }

  const isWin = platform === 'win'
  const ext = isWin ? 'zip' : 'tar.gz'
  const resolvedLocalArchivePath = localArchivePath || findLocalArchive(platform, arch, ext)

  let version = 'v22.x.x'
  if (resolvedLocalArchivePath) {
    const archiveName = path.basename(resolvedLocalArchivePath)
    const match = archiveName.match(/^node-(v22\.\d+\.\d+)-/)
    if (!match) {
      throw new Error(`Could not parse Node.js v22 version from archive name: ${archiveName}`)
    }
    version = match[1]
    console.log(`Using local Node.js archive: ${resolvedLocalArchivePath}`)
  } else {
    console.log('Resolving latest Node.js v22 LTS version...')
    version = await getLatestV22Version()
    console.log(`Latest v22 LTS: ${version}`)
  }

  fs.mkdirSync(BUILD_DIR, { recursive: true })
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
  fs.rmSync(STAGING_DIR, { recursive: true, force: true })
  fs.mkdirSync(TMP_DIR, { recursive: true })
  fs.mkdirSync(STAGING_DIR, { recursive: true })

  const archiveName = `node-${version}-${platform}-${arch}.${ext}`
  const downloadUrl = `https://nodejs.org/dist/${version}/${archiveName}`
  const archivePath = resolvedLocalArchivePath || path.join(TMP_DIR, archiveName)

  const extractedDirName = `node-${version}-${platform}-${arch}`

  try {
    if (resolvedLocalArchivePath) {
      if (!fs.existsSync(resolvedLocalArchivePath)) {
        throw new Error(`Local Node.js archive is missing: ${resolvedLocalArchivePath}`)
      }
    } else {
      console.log(`Downloading ${downloadUrl}`)
      await downloadFile(downloadUrl, archivePath)
    }

    if (isWin) {
      // Windows: extract .zip using PowerShell
      console.log('Extracting with PowerShell...')
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${TMP_DIR}' -Force`],
        { stdio: 'inherit' },
      )
      fs.cpSync(path.join(TMP_DIR, extractedDirName), STAGING_DIR, { recursive: true })
    } else {
      // macOS/Linux: extract .tar.gz using tar command
      console.log('Extracting with tar...')
      execFileSync('tar', ['-xzf', archivePath, '-C', TMP_DIR], { stdio: 'inherit' })
      fs.cpSync(path.join(TMP_DIR, extractedDirName), STAGING_DIR, { recursive: true, verbatimSymlinks: true })
    }

    verifyPreparedRuntime(STAGING_DIR, platform, arch, { requireExecutable: canExecuteTarget })

    fs.rmSync(DEST_DIR, { recursive: true, force: true })
    fs.renameSync(STAGING_DIR, DEST_DIR)
  } finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
    fs.rmSync(STAGING_DIR, { recursive: true, force: true })
  }

  console.log(`\nNode.js runtime ready at: ${DEST_DIR}`)
  console.log('You can now run: pnpm build:mac:current (or build:win)')
}

main().catch((err) => {
  console.error('❌ Failed to prepare Node.js runtime:', err.message)
  process.exit(1)
})
