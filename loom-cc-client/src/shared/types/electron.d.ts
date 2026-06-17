export {}

declare global {
  interface Window {
    electronAPI?: {
      platform: string
      loomDataPath: string

      // Directory/file pickers
      openDirectoryDialog: () => Promise<string | null>
      openFileDialog: (options?: Electron.OpenDialogOptions) => Promise<string | null>

      // Filesystem watcher
      watchDirectory: (dirPath: string) => Promise<{ ok: boolean; error?: string }>
      unwatchDirectory: () => Promise<{ ok: boolean; error?: string }>
      onFsChanged: (callback: (payload?: { dirPath?: string | null }) => void) => () => void

      // Clipboard
      readClipboardFiles: () => Promise<string[]>
      copyToClipboard: (text: string) => Promise<void>

      // Shell
      showInFolder: (filePath: string) => Promise<void>
      openPath: (targetPath: string) => Promise<string>

      // App paths
      getDataPath: () => Promise<string>
      getWorkspacesPath: () => Promise<string>
      getGitAvailable: () => Promise<boolean>

      // Native notification
      showNotification: (opts: { title: string; body: string }) => Promise<void>

      // Screenshot capture
      registerCaptureShortcut: (accelerator: string) => Promise<{ ok: boolean; accelerator: string }>
      getCaptureShortcut: () => Promise<string>
      startCaptureArea: () => Promise<void>
      captureWindowArea: (rect: { x: number; y: number; width: number; height: number }) => Promise<string>
      onCaptureArea: (callback: () => void) => () => void
      onCaptureResult: (callback: (dataUrl: string) => void) => () => void
      onCaptureError: (callback: (message: string) => void) => () => void
    }
  }
}
