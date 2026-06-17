import { app, BrowserWindow, shell, ipcMain, dialog, clipboard, Notification, globalShortcut, desktopCapturer, nativeImage, screen } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, statSync, watch, mkdirSync, cpSync, readFileSync, unlinkSync, type FSWatcher } from 'node:fs'
import { inspect } from 'node:util'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let serverUrl: string | null = null
let captureShortcut = process.platform === 'darwin' ? 'Command+Shift+X' : 'Control+Shift+X'
let captureOverlayWindow: BrowserWindow | null = null
let pendingCaptureDataUrl: string | null = null
let pendingCaptureDisplay: Electron.Display | null = null

/**
 * Loom CC data directory.
 * Dev  (isDev=true):  loom-cc-dev  — isolated from production data
 * Prod (packaged):    loom-cc
 *
 *   macOS:   ~/Library/Application Support/loom-cc[-dev]/
 *   Windows: ~/AppData/Roaming/loom-cc[-dev]/
 *   Linux:   ~/.loom-cc[-dev]/
 */
function getDataDir(): string {
  const name = isDev ? 'loom-cc-dev' : 'loom-cc'
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', name)
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', name)
  }
  return path.join(os.homedir(), `.${name}`)
}

let mainLogPath: string | null = null

function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || arg.message
  if (typeof arg === 'string') return arg
  return inspect(arg, { colors: false, depth: 6, breakLength: Infinity })
}

function appendMainLog(level: 'log' | 'warn' | 'error', args: unknown[]): void {
  if (!mainLogPath) return
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${args.map(formatLogArg).join(' ')}\n`
  try {
    appendFileSync(mainLogPath, line, 'utf8')
  } catch {
    // Logging must never break application startup.
  }
}

function installMainProcessFileLogging(): void {
  try {
    const logsDir = path.join(getDataDir(), 'logs')
    mkdirSync(logsDir, { recursive: true })
    mainLogPath = path.join(logsDir, 'main.log')
    appendMainLog('log', [
      '--- Loom CC main process starting ---',
      `pid=${process.pid}`,
      `packaged=${app.isPackaged}`,
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      `electron=${process.versions.electron}`,
      `node=${process.version}`,
    ])
  } catch {
    return
  }

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  console.log = (...args: unknown[]) => {
    appendMainLog('log', args)
    original.log(...args)
  }
  console.warn = (...args: unknown[]) => {
    appendMainLog('warn', args)
    original.warn(...args)
  }
  console.error = (...args: unknown[]) => {
    appendMainLog('error', args)
    original.error(...args)
  }

  process.on('uncaughtExceptionMonitor', (err) => {
    console.error('[main] uncaughtException:', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[main] unhandledRejection:', reason)
    setImmediate(() => {
      throw reason instanceof Error ? reason : new Error(String(reason))
    })
  })
}

installMainProcessFileLogging()

/**
 * Default workspaces root directory.
 * Individual projects have their own workspace_path stored in DB.
 * This is used as the default when creating a new project.
 */
function getWorkspacesDir(): string {
  return path.join(getDataDir(), 'workspaces')
}

/**
 * Ensure app data directories exist on first launch.
 * Copies the bundled dot-claude-template to a global .claude/ if not present.
 */
function ensureAppDataDir(): void {
  const dataDir = getDataDir()
  const workspacesDir = getWorkspacesDir()

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }
  if (!existsSync(workspacesDir)) {
    mkdirSync(workspacesDir, { recursive: true })
  }

  // Copy global .claude template to dataDir if not present
  const globalClaudeDir = path.join(dataDir, '.claude')
  if (!existsSync(globalClaudeDir)) {
    const appPath = app.getAppPath()
    const resourcesDir = path.dirname(appPath)
    const templateDir = path.join(resourcesDir, 'dot-claude-template')
    if (existsSync(templateDir)) {
      cpSync(templateDir, globalClaudeDir, { recursive: true })
      console.log('[workspace] Initialized global .claude from template')
    } else {
      mkdirSync(globalClaudeDir, { recursive: true })
      console.log('[workspace] Created empty global .claude directory')
    }
  }
}

/**
 * Check if Git is available on the system.
 */
async function checkGitAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    const { exec } = require('child_process')
    exec('git --version', (err: Error | null) => resolve(!err))
  })
}

function findNodeBinary(): string {
  if (!isDev) {
    const isWin = process.platform === 'win32'
    const appPath = app.getAppPath()
    const resourcesDir = path.dirname(appPath)
    const bundled = isWin
      ? path.join(resourcesDir, 'node-runtime', 'node.exe')
      : path.join(resourcesDir, 'node-runtime', 'bin', 'node')

    if (existsSync(bundled)) {
      try {
        const { execSync } = require('child_process')
        execSync(`"${bundled}" --version`, { stdio: 'ignore', timeout: 5000 })
        console.log('[server] Using bundled Node.js:', bundled)
        return bundled
      } catch (err) {
        console.error('[server] Bundled Node.js not executable:', err)
      }
    }
    throw new Error(`Bundled Node.js runtime not found or not executable: ${bundled}`)
  }
  return 'node'
}

let serverProcess: ChildProcess | null = null
let currentWatchers = new Map<string, FSWatcher>()
let currentWatcherPath: string | null = null
let watcherDebounceTimer: ReturnType<typeof setTimeout> | null = null
let watcherRescanTimer: ReturnType<typeof setTimeout> | null = null

const WATCH_IGNORED = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  '__pycache__', '.DS_Store', '.turbo', '.cache', 'coverage',
  '.nyc_output', 'tmp', '.tmp',
])
const MAX_WATCH_DEPTH = 6
const MAX_WATCH_DIRECTORIES = 1200

function stopCurrentWatcher(): void {
  if (watcherDebounceTimer) {
    clearTimeout(watcherDebounceTimer)
    watcherDebounceTimer = null
  }
  if (watcherRescanTimer) {
    clearTimeout(watcherRescanTimer)
    watcherRescanTimer = null
  }
  for (const watcher of currentWatchers.values()) {
    watcher.close()
  }
  currentWatchers = new Map()
  currentWatcherPath = null
}

function shouldIgnoreWatchParts(parts: string[]): boolean {
  return parts.some(part => WATCH_IGNORED.has(part))
}

function collectWatchDirectories(rootPath: string): Set<string> {
  const root = path.resolve(rootPath)
  const dirs = new Set<string>()
  const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: root, depth: 1 }]

  while (queue.length > 0 && dirs.size < MAX_WATCH_DIRECTORIES) {
    const item = queue.shift()
    if (!item) continue
    if (dirs.has(item.dirPath)) continue
    dirs.add(item.dirPath)
    if (item.depth >= MAX_WATCH_DEPTH) continue

    let entries
    try {
      entries = readdirSync(item.dirPath, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || WATCH_IGNORED.has(entry.name)) continue
      queue.push({ dirPath: path.join(item.dirPath, entry.name), depth: item.depth + 1 })
    }
  }

  return dirs
}

function scheduleFsChanged(): void {
  if (watcherDebounceTimer) clearTimeout(watcherDebounceTimer)
  watcherDebounceTimer = setTimeout(() => {
    watcherDebounceTimer = null
    mainWindow?.webContents.send('fs:changed', { dirPath: currentWatcherPath })
  }, 350)
}

function syncCurrentWatchers(): void {
  if (!currentWatcherPath) return
  const desiredDirs = collectWatchDirectories(currentWatcherPath)

  for (const [dirPath, watcher] of currentWatchers) {
    if (!desiredDirs.has(dirPath)) {
      watcher.close()
      currentWatchers.delete(dirPath)
    }
  }

  for (const dirPath of desiredDirs) {
    if (currentWatchers.has(dirPath)) continue
    try {
      const watcher = watch(dirPath, (_eventType, filename) => {
        if (!currentWatcherPath) return
        const rawName = filename?.toString()
        const changedPath = rawName
          ? path.resolve(dirPath, rawName)
          : dirPath
        const relativePath = path.relative(currentWatcherPath, changedPath)
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return
        const parts = relativePath.split(path.sep).filter(Boolean)
        if (shouldIgnoreWatchParts(parts)) return
        scheduleFsChanged()
        scheduleWatcherRescan()
      })
      watcher.on('error', () => {
        currentWatchers.delete(dirPath)
        scheduleWatcherRescan()
      })
      currentWatchers.set(dirPath, watcher)
    } catch {
      // Directory may have been removed between scanning and watcher creation.
    }
  }
}

function scheduleWatcherRescan(): void {
  if (watcherRescanTimer) clearTimeout(watcherRescanTimer)
  watcherRescanTimer = setTimeout(() => {
    watcherRescanTimer = null
    syncCurrentWatchers()
  }, 100)
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        reject(new Error('Failed to get free port'))
      }
    })
    srv.on('error', reject)
  })
}

function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Server not ready after ${timeoutMs}ms`))
      }
      fetch(url, { method: 'HEAD' })
        .then((res) => {
          if (res.ok) resolve()
          else setTimeout(check, 300)
        })
        .catch(() => setTimeout(check, 300))
    }
    check()
  })
}

function findStandaloneAppRoot(standaloneDir: string): string {
  const directServer = path.join(standaloneDir, 'server.js')
  if (existsSync(directServer)) return standaloneDir

  const queue = [standaloneDir]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (!dir) continue
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { continue }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next') continue
      const fullPath = path.join(dir, entry)
      if (existsSync(path.join(fullPath, 'server.js'))) return fullPath
      try {
        if (statSync(fullPath).isDirectory()) queue.push(fullPath)
      } catch { /* ignore */ }
    }
  }
  throw new Error(`Could not find standalone server.js under ${standaloneDir}`)
}

async function startServer(): Promise<number> {
  const port = await getFreePort()
  const appPath = app.getAppPath()
  const resourcesDir = path.dirname(appPath)
  const standaloneDir = path.join(resourcesDir, 'standalone')
  const builtinSkillsDir = path.join(resourcesDir, 'skills')
  const cwd = findStandaloneAppRoot(standaloneDir)
  const serverScript = path.join(cwd, 'server.js')
  const nodeBin = findNodeBinary()

  console.log('[server] Launching embedded service:', {
    appPath,
    resourcesDir,
    standaloneDir,
    cwd,
    serverScript,
    nodeBin,
    port,
    dataDir: getDataDir(),
    workspacesDir: getWorkspacesDir(),
  })

  const home = os.homedir()
  const isWin = process.platform === 'win32'
  const pathSep = isWin ? ';' : ':'
  const extraPaths = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.fnm', 'aliases', 'default', 'bin'),
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(home, '.volta', 'bin'),
    ...(isWin ? [
      path.join(home, 'AppData', 'Roaming', 'npm'),
      path.join(home, 'AppData', 'Local', 'Programs', 'nodejs'),
    ] : [
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]),
  ].filter(p => existsSync(p))
  const extendedPath = [...extraPaths, process.env.PATH || ''].join(pathSep)

  serverProcess = spawn(nodeBin, [serverScript], {
    env: {
      ...process.env,
      PATH: extendedPath,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      LOOM_DATA_DIR: getDataDir(),
      LOOM_WORKSPACE_DIR: getWorkspacesDir(),
      LOOM_RESOURCES_PATH: resourcesDir,
      LOOM_BUILTIN_SKILLS_DIR: builtinSkillsDir,
      HOME: os.homedir(),
    },
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.on('error', (err) => {
    console.error('[server] failed to start:', err)
    dialog.showErrorBox(
      'Loom CC 启动失败',
      `无法启动内置服务：${err.message}\n\n请确认安装包包含 node-runtime，或重新下载最新安装包。`,
    )
  })

  serverProcess.stdout?.on('data', (data: Buffer) => {
    try { console.log(`[server] ${data.toString().trim()}`) } catch { /* EPIPE safe */ }
  })
  serverProcess.stderr?.on('data', (data: Buffer) => {
    try { console.error(`[server] ${data.toString().trim()}`) } catch { /* EPIPE safe */ }
  })
  serverProcess.stdout?.on('error', () => {})
  serverProcess.stderr?.on('error', () => {})
  serverProcess.on('exit', (code) => {
    try { console.log(`[server] exited with code ${code}`) } catch { /* safe */ }
    serverProcess = null
  })

  await waitForServer(`http://127.0.0.1:${port}`)
  return port
}

function createWindow(url: string) {
  const appIconPath = getAppIconPath()
  const appIcon = appIconPath ? nativeImage.createFromPath(appIconPath) : undefined

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 8 },
    backgroundColor: '#1a1510',
    show: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.loadURL(url)

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    if (linkUrl.startsWith('http')) shell.openExternal(linkUrl)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function getAppIconPath(): string | null {
  const iconPath = isDev
    ? path.join(process.cwd(), 'build', 'icon.png')
    : path.join(path.dirname(app.getAppPath()), 'icon.png')
  return existsSync(iconPath) ? iconPath : null
}

function applyAppIcon(): void {
  const iconPath = getAppIconPath()
  if (!iconPath) return
  const icon = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin' && !icon.isEmpty()) {
    app.dock?.setIcon(icon)
  }
}

function registerCaptureShortcut(accelerator = captureShortcut): { ok: boolean; accelerator: string } {
  captureShortcut = accelerator || captureShortcut
  globalShortcut.unregister('Command+Shift+X')
  globalShortcut.unregister('Control+Shift+X')
  globalShortcut.unregister(captureShortcut)
  const ok = globalShortcut.register(captureShortcut, () => {
    mainWindow?.webContents.send('capture:area')
  })
  return { ok, accelerator: captureShortcut }
}

function getCaptureOverlayHtml(backgroundDataUrl: string): string {
  return encodeURIComponent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; user-select: none; cursor: crosshair; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    body { background: url("${backgroundDataUrl}") center / 100% 100% no-repeat; }
    #shade { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.28); pointer-events: none; }
    #box { position: absolute; border: 1px solid #D97706; background: transparent; box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.42); display: none; }
    #tip { position: absolute; display: none; height: 24px; padding: 0 8px; border-radius: 6px; background: rgba(15,23,42,0.86); color: white; font-size: 12px; align-items: center; gap: 8px; }
    #bar { position: absolute; display: none; gap: 8px; }
    button { height: 32px; padding: 0 12px; border-radius: 7px; font-size: 12px; font-weight: 700; cursor: pointer; }
    #cancel { border: 1px solid rgba(255,255,255,0.18); background: rgba(15,23,42,0.86); color: white; }
    #ok { border: none; background: #D97706; color: #111827; }
  </style>
</head>
<body>
  <div id="shade"></div>
  <div id="box"></div>
  <div id="tip"></div>
  <div id="bar"><button id="cancel">取消</button><button id="ok">附加到 Chat</button></div>
  <script>
    const { ipcRenderer } = require('electron')
    const shade = document.getElementById('shade')
    const box = document.getElementById('box')
    const tip = document.getElementById('tip')
    const bar = document.getElementById('bar')
    const cancel = document.getElementById('cancel')
    const ok = document.getElementById('ok')
    let start = null
    let rect = null
    let dragging = false
    function norm(a, b) {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
      return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    }
    function render() {
      if (!rect) return
      shade.style.display = 'none'
      box.style.display = 'block'
      box.style.left = rect.x + 'px'
      box.style.top = rect.y + 'px'
      box.style.width = rect.width + 'px'
      box.style.height = rect.height + 'px'
      tip.style.display = 'flex'
      tip.style.left = rect.x + 'px'
      tip.style.top = Math.max(8, rect.y - 30) + 'px'
      tip.innerHTML = '<span>' + Math.round(rect.width) + ' x ' + Math.round(rect.height) + '</span><span style="color:rgba(255,255,255,.55)">Enter 确认 · Esc 取消</span>'
      if (!dragging && rect.width >= 8 && rect.height >= 8) {
        bar.style.display = 'flex'
        bar.style.left = Math.min(rect.x + rect.width - 168, window.innerWidth - 180) + 'px'
        bar.style.top = Math.min(rect.y + rect.height + 8, window.innerHeight - 44) + 'px'
      } else {
        bar.style.display = 'none'
      }
    }
    window.addEventListener('mousedown', e => {
      if (e.target === cancel || e.target === ok) return
      start = { x: e.clientX, y: e.clientY }
      rect = { x: e.clientX, y: e.clientY, width: 0, height: 0 }
      dragging = true
      render()
    })
    window.addEventListener('mousemove', e => {
      if (!dragging || !start) return
      rect = norm(start, { x: e.clientX, y: e.clientY })
      render()
    })
    window.addEventListener('mouseup', e => {
      if (!start) return
      rect = norm(start, { x: e.clientX, y: e.clientY })
      dragging = false
      render()
    })
    function confirm() {
      if (!rect || rect.width < 8 || rect.height < 8) return
      ipcRenderer.send('capture-overlay:confirm', rect)
    }
    ok.addEventListener('click', confirm)
    cancel.addEventListener('click', () => ipcRenderer.send('capture-overlay:cancel'))
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') ipcRenderer.send('capture-overlay:cancel')
      if (e.key === 'Enter') confirm()
    })
  </script>
</body>
</html>`)
}

async function captureDisplayDataUrl(display: Electron.Display): Promise<{ dataUrl: string; display: Electron.Display }> {
  const scale = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.bounds.width * scale),
      height: Math.round(display.bounds.height * scale),
    },
  })
  const source = sources.find(s => s.display_id === String(display.id)) || sources[0]
  if (!source) throw new Error('No screen source available')
  if (source.thumbnail.isEmpty()) {
    throw new Error('Screen capture is empty. Please allow Screen Recording permission for Loom CC.')
  }
  return { dataUrl: source.thumbnail.toDataURL(), display }
}

async function openDesktopCaptureOverlay(): Promise<void> {
  if (process.platform === 'darwin') {
    const dataUrl = await captureAreaWithMacScreencapture()
    mainWindow?.webContents.send('capture:result', dataUrl)
    return
  }

  if (captureOverlayWindow) {
    captureOverlayWindow.focus()
    return
  }
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor) || screen.getPrimaryDisplay()
  const capture = await captureDisplayDataUrl(display)
  pendingCaptureDataUrl = capture.dataUrl
  pendingCaptureDisplay = capture.display
  const bounds = capture.display.bounds
  captureOverlayWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'Loom Capture Area',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })
  captureOverlayWindow.setAlwaysOnTop(true, 'screen-saver')
  captureOverlayWindow.loadURL(`data:text/html;charset=utf-8,${getCaptureOverlayHtml(capture.dataUrl)}`)
  captureOverlayWindow.on('closed', () => {
    captureOverlayWindow = null
  })
}

async function captureAreaWithMacScreencapture(): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `loom-capture-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/sbin/screencapture', ['-i', '-s', '-x', tmpPath], {
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0 && existsSync(tmpPath)) resolve()
      else reject(new Error('截图已取消或没有生成图片'))
    })
  })

  try {
    const data = readFileSync(tmpPath)
    if (data.length === 0) throw new Error('截图文件为空')
    return nativeImage.createFromBuffer(data).toDataURL()
  } finally {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

async function captureDesktopArea(rect: { x: number; y: number; width: number; height: number }): Promise<string> {
  const display = pendingCaptureDisplay || screen.getPrimaryDisplay()
  const sourceImage = pendingCaptureDataUrl
    ? nativeImage.createFromDataURL(pendingCaptureDataUrl)
    : nativeImage.createEmpty()
  if (sourceImage.isEmpty()) throw new Error('No screen source available')
  const sourceSize = sourceImage.getSize()
  const scaleX = sourceSize.width / Math.max(1, display.bounds.width)
  const scaleY = sourceSize.height / Math.max(1, display.bounds.height)
  const cropped = sourceImage.crop({
    x: Math.max(0, Math.round(rect.x * scaleX)),
    y: Math.max(0, Math.round(rect.y * scaleY)),
    width: Math.min(sourceSize.width, Math.max(1, Math.round(rect.width * scaleX))),
    height: Math.min(sourceSize.height, Math.max(1, Math.round(rect.height * scaleY))),
  })
  return nativeImage.createFromBuffer(cropped.toPNG()).toDataURL()
}

app.whenReady().then(async () => {
  applyAppIcon()

  // ── App data init ──────────────────────────────────────────────────────
  ensureAppDataDir()

  // ── Git availability check ─────────────────────────────────────────────
  const gitAvailable = await checkGitAvailable()
  if (!gitAvailable) {
    console.warn('[startup] Git not found — worktree features will be limited')
  }

  // ── IPC: directory picker ──────────────────────────────────────────────
  ipcMain.handle('dialog:openDirectory', async () => {
    const parent = BrowserWindow.getFocusedWindow() || mainWindow
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Workspace Folder',
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    return result.filePaths[0] || null
  })

  ipcMain.handle('dialog:openFile', async (_event, options: Electron.OpenDialogOptions = {}) => {
    const parent = BrowserWindow.getFocusedWindow() || mainWindow
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openFile'], ...options })
      : await dialog.showOpenDialog({ properties: ['openFile'], ...options })
    return result.filePaths[0] || null
  })

  // ── IPC: filesystem watcher ────────────────────────────────────────────
  ipcMain.handle('fs:watch', (_event, dirPath: string) => {
    if (!dirPath) return { ok: false, error: 'Missing directory path' }
    if (!existsSync(dirPath)) return { ok: false, error: 'Directory does not exist' }
    try {
      stopCurrentWatcher()
      currentWatcherPath = path.resolve(dirPath)
      syncCurrentWatchers()
      return { ok: true }
    } catch (err) {
      console.error('Failed to watch directory:', err)
      stopCurrentWatcher()
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('fs:unwatch', () => {
    stopCurrentWatcher()
    return { ok: true }
  })

  // ── IPC: clipboard ─────────────────────────────────────────────────────
  ipcMain.handle('clipboard:readFiles', () => {
    try {
      if (process.platform === 'darwin') {
        const raw = clipboard.read('NSFilenamesPboardType')
        if (raw) {
          const matches = raw.match(/<string>([^<]+)<\/string>/g)
          if (matches) {
            return matches
              .map(m => m.replace(/<\/?string>/g, ''))
              .filter(p => {
                if (
                  p.startsWith('/tmp/') || p.startsWith('/private/tmp/') ||
                  p.startsWith('/private/var/') || p.startsWith('/var/folders/') ||
                  p.includes('/.Trash/') || p.includes('/com.apple.') ||
                  p.includes('/.TemporaryItems/')
                ) return false
                return existsSync(p)
              })
          }
        }
      }
      return []
    } catch { return [] }
  })

  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text)
  })

  // ── IPC: shell ─────────────────────────────────────────────────────────
  ipcMain.handle('shell:showInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:openPath', (_event, targetPath: string) => {
    return shell.openPath(targetPath)
  })

  // ── IPC: app paths ─────────────────────────────────────────────────────
  ipcMain.handle('app:getDataPath', () => getDataDir())
  ipcMain.handle('app:getWorkspacesPath', () => getWorkspacesDir())
  ipcMain.handle('app:getGitAvailable', () => gitAvailable)

  // ── IPC: native notification ───────────────────────────────────────────
  ipcMain.handle('notification:show', (_event, opts: { title: string; body: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title: opts.title, body: opts.body }).show()
    }
  })

  // ── IPC: capture shortcuts ────────────────────────────────────────────
  ipcMain.handle('capture:registerShortcut', (_event, accelerator: string) => {
    return registerCaptureShortcut(accelerator)
  })

  ipcMain.handle('capture:getShortcut', () => captureShortcut)

  ipcMain.handle('capture:startArea', async () => {
    try {
      await openDesktopCaptureOverlay()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(msg)
    }
  })

  ipcMain.handle('capture:windowArea', async (_event, rect: { x: number; y: number; width: number; height: number }) => {
    if (!mainWindow) throw new Error('Main window unavailable')
    const image = await mainWindow.webContents.capturePage({
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    })
    return image.toDataURL()
  })

  ipcMain.on('capture-overlay:cancel', () => {
    captureOverlayWindow?.close()
    captureOverlayWindow = null
    pendingCaptureDataUrl = null
    pendingCaptureDisplay = null
  })

  ipcMain.on('capture-overlay:confirm', async (_event, rect: { x: number; y: number; width: number; height: number }) => {
    try {
      captureOverlayWindow?.hide()
      const dataUrl = await captureDesktopArea(rect)
      mainWindow?.webContents.send('capture:result', dataUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      mainWindow?.webContents.send('capture:error', msg)
    } finally {
      captureOverlayWindow?.close()
      captureOverlayWindow = null
      pendingCaptureDataUrl = null
      pendingCaptureDisplay = null
    }
  })

  // ── Start app ──────────────────────────────────────────────────────────
  try {
    if (isDev) {
      serverUrl = 'http://localhost:3000'
    } else {
      const port = await startServer()
      serverUrl = `http://127.0.0.1:${port}`
    }
    createWindow(serverUrl)
    registerCaptureShortcut(captureShortcut)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[server] Failed to start:', msg)
    dialog.showErrorBox(
      'Loom CC 启动失败',
      `内置服务无法启动。\n\n${msg}\n\n请重新下载最新安装包；如果你是从源码打包，请先运行对应的 macOS 打包命令以写入 node-runtime。`
    )
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null && serverUrl) {
    createWindow(serverUrl)
  }
})

app.on('before-quit', () => {
  stopCurrentWatcher()
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
})
