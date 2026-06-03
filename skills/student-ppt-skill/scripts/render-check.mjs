#!/usr/bin/env node
/*
 * render-check.mjs — 交付前质量 + 隐私体检（零依赖）
 * 解析内联的 var SPEC = {...} 来查内容，并对整份 HTML 做隐私泄露扫描。
 *
 * 硬失败(issues)：未替换占位、隐私泄露（API Key/手机号/邮箱）、0 页。
 * 软提醒(warnings)：缺逐字稿、文字过密、空泛标题、疑似编造（年份/DOI/百分比）。
 *
 * 用法：node scripts/render-check.mjs [student-ppt.html]
 */
import fs from 'node:fs/promises'

const target = process.argv[2] || 'student-ppt.html'
const html = await fs.readFile(target, 'utf-8')
const issues = []
const warnings = []

/* ---- 硬失败：未替换占位 ---- */
for (const token of ['__SLIDE_SPEC_JSON__', '__BASE_CSS__', '__STAGE_CSS__', '__THEME_CSS__', '__RUNTIME_JS__', '__DECK_TITLE__']) {
  if (html.includes(token)) issues.push(`未替换占位：${token}（build-deck.mjs 没跑完整？）`)
}

/* ---- 解析内联 SPEC ---- */
let spec = null
const m = html.match(/var SPEC = ([\s\S]*?);<\/script>/)
if (m) { try { spec = JSON.parse(m[1]) } catch (e) { warnings.push('内联 SPEC 解析失败：' + e.message) } }
const slides = (spec && spec.slides) || []
const slideCount = slides.length
if (slideCount === 0) issues.push('未找到任何幻灯片（SPEC.slides 为空）。')

/* ---- 内容质量（软提醒）---- */
const GENERIC_TITLES = ['背景', '简介', '介绍', '概述', '总结', '内容', '正文', '结尾', 'thanks', '谢谢']
slides.forEach(s => {
  const pg = s.page || '?'
  const title = (s.action_title || s.title || '').trim()
  if (!title) warnings.push(`第${pg}页：缺标题。`)
  else if (GENERIC_TITLES.some(g => title === g || title.toLowerCase() === g)) warnings.push(`第${pg}页：标题"${title}"太空泛，建议改成一句结论。`)
  if (s.layout !== 'cover' && (!s.notes || !String(s.notes).trim())) warnings.push(`第${pg}页：缺逐字稿(notes)。`)
  const bodyText = [].concat(s.content || [], (s.items || []).map(i => i.title + (i.body || '')), s.question || '').join('')
  if ((s.content || []).length > 6) warnings.push(`第${pg}页：要点 ${(s.content || []).length} 条，偏多（建议≤6）。`)
  if (bodyText.replace(/\s/g, '').length > 160) warnings.push(`第${pg}页：正文偏密（${bodyText.replace(/\s/g, '').length} 字），考虑精简或拆页。`)

  /* 编造嗅探 */
  const blob = JSON.stringify([s.content, s.notes, s.quote, s.columns, s.items, s.stats]).replace(/待补/g, '')
  const hits = []
  if (/10\.\d{4,}\/\S+/.test(blob)) hits.push('DOI')
  if (/\d{1,3}(\.\d+)?\s*%/.test(blob)) hits.push('百分比')
  if (/(18|19|20)\d{2}\s*年/.test(blob)) hits.push('具体年份')
  if (hits.length) warnings.push(`第${pg}页：出现${hits.join('/')}，请核实是否来自真实资料（不要编造）。`)
})

/* ---- 硬失败：隐私泄露扫描 ---- */
const privacyPatterns = [
  [/GPT_IMAGE_API_KEY/i, 'API Key 环境变量名'],
  [/sk-[A-Za-z0-9_-]{16,}/, '疑似 API Key'],
  [/1[3-9]\d{9}/, '疑似手机号'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, '疑似邮箱'],
]
for (const [re, label] of privacyPatterns) {
  if (re.test(html)) issues.push(`疑似隐私泄露：${label}（${re}）。`)
}

const result = { target, slideCount, ok: issues.length === 0, issues, warnings }
await fs.writeFile('qa-check.json', JSON.stringify(result, null, 2) + '\n')

console.log(`检查：${target}  共 ${slideCount} 页`)
if (issues.length) { console.log('\n✗ 硬失败：'); issues.forEach(i => console.log('  - ' + i)) }
if (warnings.length) { console.log('\n⚠ 提醒：'); warnings.forEach(w => console.log('  - ' + w)) }
if (result.ok && !warnings.length) console.log('\n✓ 全部通过，无提醒。')
else if (result.ok) console.log(`\n✓ 无硬失败（${warnings.length} 条提醒待人工确认）。`)
console.log('\n已写入 qa-check.json')
if (!result.ok) process.exitCode = 1
