/**
 * Downloads the Claude Agent SDK platform CLI package for a target architecture
 * and places the binary under build/claude-cli-cache/<platform>-<arch>/.
 */

import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

const VERSION = '0.3.145'
const BUILD_DIR = path.join(process.cwd(), 'build')
const CACHE_DIR = path.join(BUILD_DIR, 'claude-cli-cache')
const TMP_ROOT = path.join(BUILD_DIR, '.tmp-claude-cli-download')

function parseOptions() {
  const rawPlatform = process.platform
  const archArg = process.argv.find(arg => arg.startsWith('--arch='))
  const archiveArg = process.argv.find(arg => arg.startsWith('--archive='))
  const rawArch = archArg ? archArg.slice('--arch='.length) : process.arch
  const archivePath = archiveArg ? path.resolve(archiveArg.slice('--archive='.length)) : null
  const verifyOnly = process.argv.includes('--verify-only')

  const platformMap = { darwin: 'darwin', win32: 'win32', linux: 'linux' }
  const platform = platformMap[rawPlatform]
  if (!platform) throw new Error(`Unsupported platform: ${rawPlatform}`)

  const archMap = { arm64: 'arm64', x64: 'x64' }
  const arch = archMap[rawArch]
  if (!arch) throw new Error(`Unsupported arch: ${rawArch}`)

  return { rawArch, platform, arch, archivePath, verifyOnly }
}

function binaryName(platform) {
  return platform === 'win32' ? 'claude.exe' : 'claude'
}

function cachedBinaryPath(platform, arch) {
  return path.join(CACHE_DIR, `${platform}-${arch}`, binaryName(platform))
}

function packageName(platform, arch) {
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
}

function tarballUrl(platform, arch) {
  const scopedName = `claude-agent-sdk-${platform}-${arch}`
  return `https://registry.npmjs.org/@anthropic-ai/${scopedName}/-/${scopedName}-${VERSION}.tgz`
}

function findLocalArchive(platform, arch) {
  const downloadsDir = path.join(process.env.HOME || '', 'Downloads')
  if (!downloadsDir || !fs.existsSync(downloadsDir)) return null

  const archiveName = `claude-agent-sdk-${platform}-${arch}-${VERSION}.tgz`
  const archivePath = path.join(downloadsDir, archiveName)
  return fs.existsSync(archivePath) ? archivePath : null
}

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
        pipeline(res, fileStream).then(resolve).catch(reject)
      }).on('error', reject)
    }
    request(url)
  })
}

function verifyBinary(platform, arch, { requireExecutable = false } = {}) {
  const binPath = cachedBinaryPath(platform, arch)
  if (!fs.existsSync(binPath)) throw new Error(`Claude CLI binary is missing: ${binPath}`)
  const stat = fs.statSync(binPath)
  if (!stat.isFile() || stat.size === 0) throw new Error(`Claude CLI binary is empty or invalid: ${binPath}`)

  if (platform !== 'win32') fs.chmodSync(binPath, 0o755)

  if (platform === 'darwin') {
    const expectedArch = arch === 'x64' ? 'x86_64' : arch
    const fileOutput = execFileSync('/usr/bin/file', [binPath], { encoding: 'utf-8' })
    if (!fileOutput.includes(expectedArch)) {
      throw new Error(`Claude CLI has wrong architecture. Expected ${expectedArch}; got: ${fileOutput.trim()}`)
    }
  }

  if (requireExecutable) {
    const version = execFileSync(binPath, ['--version'], { encoding: 'utf-8', timeout: 10000 }).trim()
    if (!version) throw new Error('Claude CLI did not print a version')
    console.log(`Verified executable Claude CLI: ${version}`)
  }

  return binPath
}

async function main() {
  const { rawArch, platform, arch, archivePath: localArchivePath, verifyOnly } = parseOptions()
  const canExecuteTarget = platform === ({ darwin: 'darwin', win32: 'win32', linux: 'linux' })[process.platform] && rawArch === process.arch

  console.log(`Platform: ${platform}, Arch: ${arch}`)

  if (verifyOnly) {
    const binPath = verifyBinary(platform, arch, { requireExecutable: canExecuteTarget })
    console.log(`Claude CLI verified at: ${binPath}`)
    return
  }

  const destDir = path.dirname(cachedBinaryPath(platform, arch))
  const tmpDir = path.join(TMP_ROOT, `${platform}-${arch}`)
  const resolvedLocalArchivePath = localArchivePath || findLocalArchive(platform, arch)
  const archivePath = resolvedLocalArchivePath || path.join(tmpDir, `${packageName(platform, arch).replace('/', '+')}-${VERSION}.tgz`)
  const url = tarballUrl(platform, arch)

  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  fs.mkdirSync(destDir, { recursive: true })

  try {
    if (resolvedLocalArchivePath) {
      if (!fs.existsSync(resolvedLocalArchivePath)) throw new Error(`Local Claude CLI archive is missing: ${resolvedLocalArchivePath}`)
      console.log(`Using local Claude CLI archive: ${resolvedLocalArchivePath}`)
    } else {
      console.log(`Downloading ${url}`)
      await downloadFile(url, archivePath)
    }
    console.log('Extracting Claude CLI...')
    execFileSync('tar', ['-xzf', archivePath, '-C', tmpDir], { stdio: 'inherit' })

    const extractedBin = path.join(tmpDir, 'package', binaryName(platform))
    const destBin = cachedBinaryPath(platform, arch)
    fs.cpSync(extractedBin, destBin)
    verifyBinary(platform, arch, { requireExecutable: canExecuteTarget })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  console.log(`Claude CLI ready at: ${cachedBinaryPath(platform, arch)}`)
}

main().catch((err) => {
  console.error('❌ Failed to prepare Claude CLI:', err.message)
  process.exit(1)
})
