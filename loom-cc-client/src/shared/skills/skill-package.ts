import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SkillItem, SkillPackageTreeItem, SkillUiMeta } from './skill-types'
import { parseSkillMarkdown, slugifySkillName } from './skill-parser'

export interface SkillPackageFile {
  path: string
  content: string | Buffer
  executable?: boolean
}

export interface SkillPackage {
  slug: string
  files: SkillPackageFile[]
  packageTree: SkillPackageTreeItem[]
  sourcePath?: string
}

export interface SkillPackageInstallMeta {
  installedFrom?: string
  installedAt?: string
}

export class SkillPackageError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SkillPackageError'
    this.status = status
  }
}

const MAX_PACKAGE_FILES = 200
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const SKILL_FILENAMES = new Set(['SKILL.md', 'skill.md'])
const LOOM_META_FILENAME = 'loom.skill.json'
const DEFAULT_IGNORES = [
  '.DS_Store',
  '.git',
  '.clawhub',
  '.clawdhub',
  '.next',
  'dist',
  'build',
  'node_modules',
  'coverage',
  '.clawhubignore',
  '.clawdhubignore',
  '.gitignore',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]

export function readStandardSkillPackageFromDirectory(
  sourceDir: string,
  options?: { slug?: string },
): SkillPackage {
  const root = path.resolve(sourceDir)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new SkillPackageError('Skill package directory does not exist', 404)
  }

  const ignoreRules = readIgnoreRules(root)
  const files = readPackageFiles(root, root, ignoreRules)
  const skillFile = findSkillFile(files)
  if (!skillFile) {
    throw new SkillPackageError('Skill package missing SKILL.md', 400)
  }

  const raw = fileContentAsUtf8(skillFile)
  const parsed = parseSkillMarkdown(raw)
  const slug = slugifySkillName(options?.slug || parsed.name || path.basename(root))
  const packageTree = inferPackageTree(files, readPackageUiMeta(files))

  return {
    slug,
    files,
    packageTree,
    sourcePath: root,
  }
}

export function createSkillPackageFromSkillItem(source: SkillItem): SkillPackage {
  const raw = ensureTrailingNewline(source.raw || '')
  const meta = buildSkillPackageUiMeta(source, [])
  const files: SkillPackageFile[] = [
    { path: 'SKILL.md', content: raw },
    { path: LOOM_META_FILENAME, content: `${JSON.stringify(meta, null, 2)}\n` },
  ]

  return {
    slug: source.slug,
    files,
    packageTree: inferPackageTree(files, meta),
  }
}

export function prepareSkillPackageForInstall(
  input: SkillPackage,
  installMeta?: SkillPackageInstallMeta,
): SkillPackage {
  const skillFile = findSkillFile(input.files)
  if (!skillFile) {
    throw new SkillPackageError('Skill package missing SKILL.md', 400)
  }

  const normalizedFiles = new Map<string, SkillPackageFile>()
  for (const file of input.files) {
    const normalized = normalizePackagePath(file.path)
    if (!normalized) {
      throw new SkillPackageError(`Invalid package path: ${file.path}`, 400)
    }

    if (isLoomMetaPath(normalized)) continue

    const canonicalPath = isSkillPath(normalized) ? 'SKILL.md' : normalized
    if (normalizedFiles.has(canonicalPath)) {
      throw new SkillPackageError(`Duplicate package path: ${canonicalPath}`, 400)
    }

    normalizedFiles.set(canonicalPath, {
      path: canonicalPath,
      content: file.content,
      executable: file.executable,
    })
  }

  const canonicalFiles = Array.from(normalizedFiles.values())
  const raw = fileContentAsUtf8(
    canonicalFiles.find(file => file.path === 'SKILL.md') ?? skillFile,
  )
  const parsed = parseSkillMarkdown(raw)
  const slug = slugifySkillName(input.slug || parsed.name || 'new-skill')
  const existingMeta = readPackageUiMeta(input.files)
  const packageTree = inferPackageTree(canonicalFiles, existingMeta)
  const uiMeta = {
    ...buildSkillPackageUiMeta({
      id: installMeta?.installedFrom || `package:${slug}`,
      name: existingMeta?.displayName || parsed.name || slug,
      slug,
      description: parsed.description || '',
      sourceType: 'builtin',
      storagePath: input.sourcePath ?? null,
      isPinned: false,
      createdAt: null,
      raw,
      category: existingMeta?.category,
      stage: existingMeta?.stage,
      tags: existingMeta?.tags,
      inputs: existingMeta?.inputTypes,
      outputs: existingMeta?.outputTypes,
      examples: existingMeta?.examples,
      riskLevel: existingMeta?.riskLevel,
      requires: existingMeta?.requires,
      packageTree,
    }, packageTree),
    ...existingMeta,
    schemaVersion: existingMeta?.schemaVersion || '1.0',
    displayName: existingMeta?.displayName || parsed.name || slug,
    packageTree,
    installedFrom: installMeta?.installedFrom || existingMeta?.installedFrom,
    installedAt: installMeta?.installedAt || new Date().toISOString(),
  }

  canonicalFiles.push({
    path: LOOM_META_FILENAME,
    content: `${JSON.stringify(uiMeta, null, 2)}\n`,
  })

  return {
    slug,
    files: canonicalFiles,
    packageTree,
    sourcePath: input.sourcePath,
  }
}

export function installSkillPackage(params: {
  skillsDir: string
  skillPackage: SkillPackage
  overwrite?: boolean
  installMeta?: SkillPackageInstallMeta
}): { skillDir: string; skillPackage: SkillPackage } {
  const normalizedPackage = prepareSkillPackageForInstall(params.skillPackage, params.installMeta)
  validateSkillPackageOrThrow(normalizedPackage.files)

  const skillsDir = path.resolve(params.skillsDir)
  const skillDir = path.join(skillsDir, normalizedPackage.slug)
  if (!isSafeChild(skillsDir, skillDir)) {
    throw new SkillPackageError('Invalid skill path', 400)
  }

  if (fs.existsSync(skillDir)) {
    const stat = fs.statSync(skillDir)
    if (!stat.isDirectory()) {
      throw new SkillPackageError('A non-directory file already exists at target path', 409)
    }
    if (!params.overwrite) {
      throw new SkillPackageError('Skill already installed', 409)
    }
  }

  writePackageAtomically(skillsDir, skillDir, normalizedPackage.files)
  return { skillDir, skillPackage: normalizedPackage }
}

export function validateSkillPackageOrThrow(files: SkillPackageFile[]): void {
  if (files.length === 0) throw new SkillPackageError('Skill package is empty', 400)
  if (files.length > MAX_PACKAGE_FILES) {
    throw new SkillPackageError('Skill package contains too many files', 400)
  }
  if (!files.some(file => isSkillPath(file.path))) {
    throw new SkillPackageError('Skill package missing SKILL.md', 400)
  }
  if (!files.some(file => isLoomMetaPath(file.path))) {
    throw new SkillPackageError('Skill package missing loom.skill.json', 400)
  }

  let totalBytes = 0
  const seen = new Set<string>()
  for (const file of files) {
    const normalized = normalizePackagePath(file.path)
    if (!normalized) {
      throw new SkillPackageError(`Invalid package path: ${file.path}`, 400)
    }
    if (seen.has(normalized)) {
      throw new SkillPackageError(`Duplicate package path: ${normalized}`, 400)
    }
    seen.add(normalized)

    const bytes = fileContentBytes(file)
    if (bytes > MAX_FILE_BYTES) {
      throw new SkillPackageError(`Package file is too large: ${normalized}`, 400)
    }
    totalBytes += bytes
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new SkillPackageError('Skill package is too large', 400)
    }
  }
}

export function getSkillMarkdownFromPackage(skillPackage: SkillPackage): string {
  const skillFile = findSkillFile(skillPackage.files)
  if (!skillFile) return ''
  return fileContentAsUtf8(skillFile)
}

export function findBuiltinSkillPackageDir(slug: string): string | null {
  const repositoryDir = getBuiltinSkillsRepositoryDir()
  if (!repositoryDir) return null

  const skillDir = path.join(repositoryDir, slugifySkillName(slug))
  if (!isSafeChild(repositoryDir, skillDir)) return null
  return isSkillPackageDir(skillDir) ? skillDir : null
}

export function listBuiltinSkillPackageDirs(): string[] {
  const repositoryDir = getBuiltinSkillsRepositoryDir()
  if (!repositoryDir) return []

  return fs.readdirSync(repositoryDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(repositoryDir, entry.name))
    .filter(skillDir => isSafeChild(repositoryDir, skillDir) && isSkillPackageDir(skillDir))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
}

export function getBuiltinSkillsRepositoryDir(): string | null {
  const configured = process.env.LOOM_BUILTIN_SKILLS_DIR?.trim()
  const repositoryDir = configured
    ? path.resolve(configured)
    : getDefaultBuiltinSkillsRepositoryDir()

  if (!repositoryDir) return null
  if (!fs.existsSync(repositoryDir)) return null
  if (!fs.statSync(repositoryDir).isDirectory()) return null
  return repositoryDir
}

function getDefaultBuiltinSkillsRepositoryDir(): string {
  if (process.env.LOOM_RESOURCES_PATH) {
    return path.join(process.env.LOOM_RESOURCES_PATH, 'skills')
  }
  return path.resolve(process.cwd(), '..', 'skills')
}

function isSkillPackageDir(skillDir: string): boolean {
  return fs.existsSync(path.join(skillDir, 'SKILL.md')) ||
    fs.existsSync(path.join(skillDir, 'skill.md'))
}

function buildSkillPackageUiMeta(
  source: SkillItem,
  packageTree: SkillPackageTreeItem[],
): SkillUiMeta & Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    displayName: source.name || source.slug,
    category: source.category || '',
    stage: source.stage || '',
    tags: source.tags ?? [],
    inputTypes: source.inputs ?? [],
    outputTypes: source.outputs ?? [],
    riskLevel: source.riskLevel || 'low',
    requires: source.requires ?? {
      network: false,
      fileRead: true,
      fileWrite: true,
      shell: false,
      mcp: [],
    },
    examples: source.examples ?? [],
    packageTree: source.packageTree?.length ? source.packageTree : packageTree,
    installedFrom: source.id,
    installedAt: new Date().toISOString(),
  }
}

function readPackageFiles(
  root: string,
  currentDir: string,
  ignoreRules: IgnoreRule[],
): SkillPackageFile[] {
  const results: SkillPackageFile[] = []
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name)
    const relativePath = toPosixPath(path.relative(root, absolutePath))
    if (isIgnored(relativePath, entry.isDirectory(), ignoreRules)) continue

    if (entry.isDirectory()) {
      results.push(...readPackageFiles(root, absolutePath, ignoreRules))
      continue
    }
    if (!entry.isFile()) continue

    results.push({
      path: relativePath,
      content: fs.readFileSync(absolutePath),
      executable: isExecutable(absolutePath),
    })
  }

  return results
}

interface IgnoreRule {
  pattern: string
  negated: boolean
}

function readIgnoreRules(root: string): IgnoreRule[] {
  const rules = DEFAULT_IGNORES.map(pattern => ({ pattern, negated: false }))
  for (const filename of ['.clawhubignore', '.clawdhubignore', '.gitignore']) {
    const ignorePath = path.join(root, filename)
    if (!fs.existsSync(ignorePath)) continue

    const customRules = fs.readFileSync(ignorePath, 'utf-8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => ({
        pattern: line.startsWith('!') ? line.slice(1).trim() : line,
        negated: line.startsWith('!'),
      }))
      .filter(rule => rule.pattern)
    rules.push(...customRules)
  }

  return rules
}

function isIgnored(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false
  for (const rule of rules) {
    if (matchesIgnoreRule(relativePath, isDirectory, rule.pattern)) {
      ignored = !rule.negated
    }
  }
  return ignored
}

function matchesIgnoreRule(relativePath: string, isDirectory: boolean, pattern: string): boolean {
  const normalized = toPosixPath(pattern).replace(/^\//, '')
  if (!normalized) return false

  if (normalized.endsWith('/')) {
    const dirPattern = normalized.slice(0, -1)
    return relativePath === dirPattern || relativePath.startsWith(`${dirPattern}/`)
  }

  if (!normalized.includes('/') && !normalized.includes('*')) {
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`) || relativePath.endsWith(`/${normalized}`)
  }

  const regex = new RegExp(`^${escapeRegExp(normalized).replace(/\\\*/g, '.*')}${isDirectory ? '(?:/.*)?' : ''}$`)
  return regex.test(relativePath)
}

function findSkillFile(files: SkillPackageFile[]): SkillPackageFile | undefined {
  return files.find(file => file.path === 'SKILL.md') ??
    files.find(file => file.path === 'skill.md')
}

function readPackageUiMeta(files: SkillPackageFile[]): (SkillUiMeta & Record<string, unknown>) | undefined {
  const metaFile = files.find(file => isLoomMetaPath(file.path))
  if (!metaFile) return undefined
  try {
    return JSON.parse(fileContentAsUtf8(metaFile)) as SkillUiMeta & Record<string, unknown>
  } catch {
    return undefined
  }
}

function inferPackageTree(
  files: SkillPackageFile[],
  existingMeta?: SkillUiMeta,
): SkillPackageTreeItem[] {
  const existing = new Map<string, SkillPackageTreeItem>()
  for (const item of existingMeta?.packageTree ?? []) {
    existing.set(item.path, item)
  }

  const paths = new Set<string>()
  for (const file of files) {
    const normalized = normalizePackagePath(file.path)
    if (!normalized) continue
    const parts = normalized.split('/')
    for (let i = 1; i < parts.length; i += 1) {
      paths.add(`${parts.slice(0, i).join('/')}/`)
    }
    paths.add(isSkillPath(normalized) ? 'SKILL.md' : normalized)
  }

  return Array.from(paths)
    .sort((a, b) => a.localeCompare(b))
    .map(itemPath => existing.get(itemPath) ?? inferTreeItem(itemPath))
}

function inferTreeItem(itemPath: string): SkillPackageTreeItem {
  if (itemPath.endsWith('/')) {
    return {
      path: itemPath,
      type: 'directory',
      description: 'Skill 包目录。',
      risk: 'none',
      autoRun: false,
      loadedWhen: 'Claude Agent SDK 或 skill 指令按需读取时。',
    }
  }

  const lower = itemPath.toLowerCase()
  if (isSkillPath(itemPath)) {
    return {
      path: 'SKILL.md',
      type: 'instruction',
      description: 'Claude 原生 skill 入口说明。',
      risk: 'none',
      autoRun: false,
      loadedWhen: 'Skill 被触发时。',
    }
  }
  if (lower === LOOM_META_FILENAME) {
    return {
      path: LOOM_META_FILENAME,
      type: 'metadata',
      description: 'Loom UI 元数据，不参与 Claude 原生调度。',
      risk: 'none',
      autoRun: false,
      loadedWhen: 'Loom 展示 skill 列表和详情页时。',
    }
  }
  if (lower.startsWith('references/') || lower.endsWith('.md')) {
    return {
      path: itemPath,
      type: 'reference',
      description: 'Skill 按需读取的参考资料。',
      risk: 'none',
      autoRun: false,
      loadedWhen: '任务需要对应资料时。',
    }
  }
  if (lower.startsWith('scripts/') || /\.(mjs|cjs|js|ts|py|sh)$/.test(lower)) {
    return {
      path: itemPath,
      type: 'script',
      description: 'Skill 可按需调用的脚本。',
      risk: 'shell',
      autoRun: false,
      loadedWhen: '用户任务明确需要执行脚本时。',
    }
  }
  if (lower.startsWith('assets/templates/') || lower.includes('/templates/')) {
    return {
      path: itemPath,
      type: 'template',
      description: 'Skill 使用的模板资源。',
      risk: 'none',
      autoRun: false,
      loadedWhen: '生成对应产物时。',
    }
  }

  return {
    path: itemPath,
    type: 'asset',
    description: 'Skill 资源文件。',
    risk: 'none',
    autoRun: false,
    loadedWhen: '任务需要对应资源时。',
  }
}

function writePackageAtomically(
  skillsDir: string,
  skillDir: string,
  files: SkillPackageFile[],
) {
  const stagingDir = path.join(
    skillsDir,
    `.${path.basename(skillDir)}.install-${Date.now()}-${process.pid}`,
  )
  if (!isSafeChild(skillsDir, stagingDir)) {
    throw new SkillPackageError('Invalid staging path', 400)
  }

  try {
    fs.mkdirSync(stagingDir, { recursive: true })
    for (const file of files) {
      const normalized = normalizePackagePath(file.path)
      if (!normalized) throw new SkillPackageError(`Invalid package path: ${file.path}`, 400)

      const targetPath = path.join(stagingDir, normalized)
      if (!isSafeChild(stagingDir, targetPath)) {
        throw new SkillPackageError(`Invalid package path: ${file.path}`, 400)
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, file.content)
      if (file.executable) {
        fs.chmodSync(targetPath, 0o755)
      }
    }

    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true })
    }
    fs.renameSync(stagingDir, skillDir)
  } catch (err) {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true })
    }
    throw err
  }
}

export function normalizePackagePath(value: string): string | null {
  const raw = value.trim().replace(/\\/g, '/')
  if (!raw || raw.startsWith('/') || raw.includes('\0')) return null
  const normalized = path.posix.normalize(raw)
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.isAbsolute(normalized)
  ) {
    return null
  }
  return normalized
}

export function isSafeChild(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir)
  const child = path.resolve(childPath)
  const rel = path.relative(parent, child)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function isSkillPath(value: string): boolean {
  return SKILL_FILENAMES.has(path.basename(value))
}

function isLoomMetaPath(value: string): boolean {
  return path.basename(value).toLowerCase() === LOOM_META_FILENAME
}

function fileContentAsUtf8(file: SkillPackageFile): string {
  return Buffer.isBuffer(file.content) ? file.content.toString('utf-8') : file.content
}

function fileContentBytes(file: SkillPackageFile): number {
  return Buffer.isBuffer(file.content)
    ? file.content.byteLength
    : Buffer.byteLength(file.content, 'utf-8')
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/')
}

function isExecutable(filePath: string): boolean {
  if (os.platform() === 'win32') return /\.(cmd|bat|ps1|exe)$/i.test(filePath)
  return Boolean(fs.statSync(filePath).mode & 0o111)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
