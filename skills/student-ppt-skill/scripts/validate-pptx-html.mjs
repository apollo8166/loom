#!/usr/bin/env node
/*
 * validate-pptx-html.mjs — 导出轨 4 条硬约束体检（纯静态，无需 Playwright）
 * 用法：node scripts/validate-pptx-html.mjs <dir 或 file.html>
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const target = process.argv[2] || 'pptx-slides'

async function main() {
  const stat = await fs.stat(target).catch(() => null)
  if (!stat) { console.error(`找不到：${target}`); process.exit(1) }
  const files = stat.isDirectory()
    ? (await fs.readdir(target)).filter(f => f.endsWith('.html')).sort().map(f => path.join(target, f))
    : [target]
  if (!files.length) { console.error(`${target} 下没有 .html`); process.exit(1) }

  const report = []
  let totalIssues = 0
  for (const file of files) {
    const html = await fs.readFile(file, 'utf-8')
    const issues = lint(html)
    totalIssues += issues.length
    report.push({ file: path.basename(file), ok: issues.length === 0, issues })
  }

  for (const r of report) {
    if (r.ok) console.log(`✓ ${r.file}`)
    else { console.log(`✗ ${r.file}`); r.issues.forEach(i => console.log(`    - ${i}`)) }
  }
  const ok = totalIssues === 0
  console.log(`\n${ok ? '✓ 全部合规' : `✗ 共 ${totalIssues} 处违反 4 条硬约束`}（${report.length} 张）`)
  await fs.writeFile('pptx-validate.json', JSON.stringify({ target, ok, report }, null, 2) + '\n')
  if (!ok) process.exitCode = 1
}

function lint(html) {
  const issues = []
  if (/(linear|radial|conic)-gradient\s*\(/.test(html)) issues.push('用了 CSS 渐变（规则2）。改纯色，或用 flex 子元素分段。')
  if (/background-image\s*:/.test(html) || /background\s*:\s*url\(/.test(html)) issues.push('用了 background-image（规则4）。图片请用 <img> 标签。')
  const textTagRe = /<(p|h[1-6]|li|ul|ol)\b([^>]*)>/gi
  let m
  while ((m = textTagRe.exec(html))) {
    const attrs = m[2] || ''
    const styleM = /style\s*=\s*"([^"]*)"/i.exec(attrs)
    if (!styleM) continue
    const style = styleM[1]
    if (/background(-color)?\s*:/.test(style) && !/background(-color)?\s*:\s*(transparent|none)/.test(style)) issues.push(`<${m[1]}> 带了 background（规则3）。把背景挪到外层 <div>。`)
    if (/box-shadow\s*:/.test(style) && !/box-shadow\s*:\s*none/.test(style)) issues.push(`<${m[1]}> 带了 box-shadow（规则3）。`)
  }
  const divOpenRe = /<div\b[^>]*>/gi
  while ((m = divOpenRe.exec(html))) {
    const after = html.slice(m.index + m[0].length)
    const nextTagIdx = after.search(/<[a-z!/]/i)
    const leading = (nextTagIdx === -1 ? after : after.slice(0, nextTagIdx))
    if (leading.replace(/\s+/g, '') !== '') issues.push(`<div> 里有裸文字 "${leading.trim().slice(0, 30)}…"（规则1）。用 <p>/<h*> 包裹。`)
  }
  return issues
}

main().catch(err => { console.error(err.message); process.exit(1) })
