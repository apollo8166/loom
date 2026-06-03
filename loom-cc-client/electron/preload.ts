import { contextBridge, ipcRenderer } from 'electron'
import os from 'node:os'
import path from 'node:path'

function getLoomDataDir(): string {
  const name = 'loom-cc'
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', name)
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', name)
  }
  return path.join(os.homedir(), `.${name}`)
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  loomDataPath: getLoomDataDir(),

  // Directory/file pickers
  openDirectoryDialog: () =>
    ipcRenderer.invoke('dialog:openDirectory') as Promise<string | null>,
  openFileDialog: (options?: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:openFile', options) as Promise<string | null>,

  // Filesystem watcher
  watchDirectory: (dirPath: string) => ipcRenderer.invoke('fs:watch', dirPath),
  onFsChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('fs:changed', handler)
    return () => ipcRenderer.removeListener('fs:changed', handler)
  },

  // Clipboard
  readClipboardFiles: () =>
    ipcRenderer.invoke('clipboard:readFiles') as Promise<string[]>,
  copyToClipboard: (text: string) =>
    ipcRenderer.invoke('clipboard:writeText', text),

  // Shell
  showInFolder: (filePath: string) =>
    ipcRenderer.invoke('shell:showInFolder', filePath),
  openPath: (targetPath: string) =>
    ipcRenderer.invoke('shell:openPath', targetPath) as Promise<string>,

  // App paths
  getDataPath: () =>
    ipcRenderer.invoke('app:getDataPath') as Promise<string>,
  getWorkspacesPath: () =>
    ipcRenderer.invoke('app:getWorkspacesPath') as Promise<string>,
  getGitAvailable: () =>
    ipcRenderer.invoke('app:getGitAvailable') as Promise<boolean>,

  // Native notification
  showNotification: (opts: { title: string; body: string }) =>
    ipcRenderer.invoke('notification:show', opts),

  // Screenshot capture
  registerCaptureShortcut: (accelerator: string) =>
    ipcRenderer.invoke('capture:registerShortcut', accelerator) as Promise<{ ok: boolean; accelerator: string }>,
  getCaptureShortcut: () =>
    ipcRenderer.invoke('capture:getShortcut') as Promise<string>,
  startCaptureArea: () =>
    ipcRenderer.invoke('capture:startArea') as Promise<void>,
  captureWindowArea: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('capture:windowArea', rect) as Promise<string>,
  onCaptureArea: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('capture:area', handler)
    return () => ipcRenderer.removeListener('capture:area', handler)
  },
  onCaptureResult: (callback: (dataUrl: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, dataUrl: string) => callback(dataUrl)
    ipcRenderer.on('capture:result', handler)
    return () => ipcRenderer.removeListener('capture:result', handler)
  },
  onCaptureError: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('capture:error', handler)
    return () => ipcRenderer.removeListener('capture:error', handler)
  },
})
