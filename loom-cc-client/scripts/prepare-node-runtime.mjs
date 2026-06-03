/**
 * Downloads Node.js LTS (v22) for the current platform/arch and extracts to build/node-runtime/.
 *
 * Run manually before building:
 *   node scripts/prepare-node-runtime.mjs
 *
 * Output structure:
 *   build/node-runtime/          (macOS/Linux)
 *     bin/
 *       node
 *   build/node-runtime/          (Windows)
 *     node.exe
 *
 * Only uses built-in Node.js modules — no npm packages required.
 */

import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

const DEST_DIR = path.join(process.cwd(), 'build', 'node-runtime')

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

async function main() {
  const rawPlatform = process.platform
  const rawArch = process.arch

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

  console.log(`Platform: ${platform}, Arch: ${arch}`)
  console.log('Resolving latest Node.js v22 LTS version...')

  const version = await getLatestV22Version()
  console.log(`Latest v22 LTS: ${version}`)

  // Clean destination
  if (fs.existsSync(DEST_DIR)) {
    fs.rmSync(DEST_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(DEST_DIR, { recursive: true })

  const isWin = platform === 'win'
  const ext = isWin ? 'zip' : 'tar.gz'
  const archiveName = `node-${version}-${platform}-${arch}.${ext}`
  const downloadUrl = `https://nodejs.org/dist/${version}/${archiveName}`
  const tmpDir = path.join(process.cwd(), 'build', '.tmp-node-download')

  fs.mkdirSync(tmpDir, { recursive: true })
  const archivePath = path.join(tmpDir, archiveName)

  console.log(`Downloading ${downloadUrl}`)
  await downloadFile(downloadUrl, archivePath)

  const extractedDirName = `node-${version}-${platform}-${arch}`

  if (isWin) {
    // Windows: extract .zip using PowerShell
    console.log('Extracting with PowerShell...')
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}' -Force"`,
      { stdio: 'inherit' }
    )
    // Copy node.exe to destination
    const nodeExeSrc = path.join(tmpDir, extractedDirName, 'node.exe')
    const nodeExeDest = path.join(DEST_DIR, 'node.exe')
    fs.cpSync(nodeExeSrc, nodeExeDest)
    console.log(`✅ node.exe placed at ${nodeExeDest}`)
  } else {
    // macOS/Linux: extract .tar.gz using tar command
    console.log('Extracting with tar...')
    execSync(
      `tar -xzf "${archivePath}" -C "${tmpDir}"`,
      { stdio: 'inherit' }
    )
    // Copy bin/node to destination
    const nodeBinSrc = path.join(tmpDir, extractedDirName, 'bin', 'node')
    const nodeBinDestDir = path.join(DEST_DIR, 'bin')
    const nodeBinDest = path.join(nodeBinDestDir, 'node')
    fs.mkdirSync(nodeBinDestDir, { recursive: true })
    fs.cpSync(nodeBinSrc, nodeBinDest)
    fs.chmodSync(nodeBinDest, 0o755)
    console.log(`✅ node binary placed at ${nodeBinDest}`)
  }

  // Clean up temp files
  fs.rmSync(tmpDir, { recursive: true, force: true })

  console.log(`\nNode.js runtime ready at: ${DEST_DIR}`)
  console.log('You can now run: pnpm build:mac:current (or build:win)')
}

main().catch((err) => {
  console.error('❌ Failed to prepare Node.js runtime:', err.message)
  process.exit(1)
})
