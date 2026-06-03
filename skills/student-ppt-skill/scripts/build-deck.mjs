#!/usr/bin/env node
/*
 * build-deck.mjs — 展示轨：把 slide-spec.json 组装成单文件、可双击打开的 HTML 展示稿。
 * 把 base.css + deck-stage.css + 主题 + runtime.js + spec 全部内联进 shell.html，
 * 产出零依赖、可离线、可原生打印 PDF 的 student-ppt.html。
 *
 * 用法：
 *   node scripts/build-deck.mjs --spec slide-spec.json --theme reading-warm --out student-ppt.html
 * 参数：
 *   --spec    slide-spec.json 路径（默认 slide-spec.json）
 *   --theme   主题名 reading-warm|academic-clean|campus-fresh|kid-friendly|competition-bold（默认 reading-warm）
 *             也可传入一个 .css 文件路径
 *   --out     输出 HTML（默认 student-ppt.html）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const args = parseArgs(process.argv.slice(2))

const specPath = args.spec || 'slide-spec.json'
const outPath = args.out || 'student-ppt.html'
const assetsDir = path.join(SKILL_ROOT, 'assets')
const shellPath = path.join(assetsDir, 'deck', 'shell.html')
const themeArg = args.theme || 'reading-warm'

const KNOWN_THEMES = ['reading-warm', 'academic-clean', 'campus-fresh', 'kid-friendly', 'competition-bold']

async function main() {
  const spec = JSON.parse(await fs.readFile(specPath, 'utf-8'))

  const themePath = themeArg.endsWith('.css')
    ? path.resolve(themeArg)
    : path.join(assetsDir, 'themes', `${themeArg}.css`)
  if (!themeArg.endsWith('.css') && !KNOWN_THEMES.includes(themeArg)) {
    console.error(`未知主题 "${themeArg}"。可用：${KNOWN_THEMES.join(', ')}（或传入 .css 文件路径）`)
    process.exit(1)
  }

  const [shell, baseCss, stageCss, themeCss, runtimeRaw] = await Promise.all([
    fs.readFile(shellPath, 'utf-8'),
    fs.readFile(path.join(assetsDir, 'base.css'), 'utf-8'),
    fs.readFile(path.join(assetsDir, 'deck-stage.css'), 'utf-8'),
    fs.readFile(themePath, 'utf-8'),
    fs.readFile(path.join(assetsDir, 'runtime.js'), 'utf-8'),
  ])

  // runtime.js 内部含字面量 </script>，内联时必须转义防止提前闭合
  const runtimeJs = runtimeRaw.replace(/<\/script>/g, '<\\/script>')

  const title = (spec.meta && spec.meta.workTitle) || spec.type || '学生展示稿'

  const html = shell
    .replace('/* __BASE_CSS__ */', () => baseCss)
    .replace('/* __STAGE_CSS__ */', () => stageCss)
    .replace('/* __THEME_CSS__ */', () => themeCss)
    .replace('/* __RUNTIME_JS__ */', () => runtimeJs)
    .replace('__SLIDE_SPEC_JSON__', () => escapeScriptJson(spec))
    .replace('__DECK_TITLE__', () => escapeHtml(title))

  const outDir = path.dirname(outPath)
  if (outDir && outDir !== '.') await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(outPath, html, 'utf-8')
  console.log(`Wrote ${outPath}  (theme: ${themeArg}, slides: ${(spec.slides || []).length})`)
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]))
}
function parseArgs(values) {
  const out = {}
  for (let i = 0; i < values.length; i += 1) {
    const item = values[i]
    if (!item.startsWith('--')) continue
    out[item.slice(2)] = values[i + 1]
    i += 1
  }
  return out
}

main().catch(err => { console.error(err.message); process.exit(1) })
