#!/usr/bin/env node
/*
 * build-pptx-html.mjs — 导出轨：slide-spec.json → pptx-slides/NN.html
 * 每张是独立的 960×540pt(=1280×720px) HTML，严守 4 条硬约束（见 references/editable-pptx.md），
 * 再交给 export-pptx.mjs + html2pptx.js 翻译成真·可编辑 PPTX。
 *
 * 用法：
 *   node scripts/build-pptx-html.mjs --spec slide-spec.json --theme reading-warm --out pptx-slides
 * 之后：
 *   node scripts/export-pptx.mjs --slides pptx-slides --out deck.pptx   (需 npm i playwright pptxgenjs sharp)
 */
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const args = parseArgs(process.argv.slice(2))
const specPath = args.spec || 'slide-spec.json'
const outDir = args.out || 'pptx-slides'
const assetsDir = path.join(SKILL_ROOT, 'assets')

const W = 1280, H = 720, M = 72
const KICKER_Y = 52, TITLE_Y = 86, BODY_TOP = 196, FOOT_Y = 678
const BODY_W = W - 2 * M

async function main() {
  const spec = JSON.parse(await fs.readFile(specPath, 'utf-8'))
  const palettes = JSON.parse(await fs.readFile(path.join(assetsDir, 'themes', 'palettes.json'), 'utf-8'))
  const themeName = args.theme || spec.theme || 'reading-warm'
  const P = palettes[themeName] || palettes['reading-warm']
  let baseCss = await fs.readFile(path.join(assetsDir, 'templates', '_pptx-safe', 'pptx-base.css'), 'utf-8')
  baseCss = baseCss.replaceAll('__PAPER__', P.paper)

  await fs.mkdir(outDir, { recursive: true })
  const meta = spec.meta || {}
  const deckType = spec.type || '学生展示'
  const slides = spec.slides || []
  let n = 0
  for (const s of slides) {
    n += 1
    const html = renderSlide(s, { P, meta, deckType, baseCss })
    const name = String(s.page || n).padStart(2, '0') + '.html'
    await fs.writeFile(path.join(outDir, name), html, 'utf-8')
  }
  console.log(`Wrote ${slides.length} slide(s) to ${outDir}/  (theme: ${themeName})`)
  console.log(`Next: node scripts/export-pptx.mjs --slides ${outDir} --out deck.pptx  (需 npm i playwright pptxgenjs sharp)`)
}

function renderSlide(s, ctx) {
  const { P, baseCss } = ctx
  const layout = s.layout || (s.page === 1 ? 'cover' : (s.quote ? 'quote' : 'claim-bullets'))
  const body = (LAYOUTS[layout] || LAYOUTS['claim-bullets'])(s, ctx)
  const head = layout === 'cover' ? '' : chromeHead(s, ctx)
  const foot = layout === 'cover' ? '' : footer(s, ctx)
  return ['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>', baseCss, '</style></head><body>', head, body, foot, '</body></html>'].join('\n')
}

function chromeHead(s, ctx) {
  const { P, deckType } = ctx
  return p(clean(s.kicker) || deckType, abs(M, KICKER_Y, BODY_W, 26) + font(18, P.accent2, 700)) +
    h(2, s.action_title || s.title || '待补充标题', abs(M, TITLE_Y, BODY_W, 96) + font(40, P.ink, 800) + 'line-height:1.12;')
}

function footer(s, ctx) {
  const { meta, P } = ctx
  const left = metaJoin([meta.studentName || meta.teamName, meta.grade, meta.className])
  const mid = metaJoin([meta.course, meta.teacherName, meta.date])
  const page = String(s.page || '').padStart(2, '0')
  return p(left, abs(M, FOOT_Y, 520, 22) + font(14, P.text3, 400)) +
    p(mid, abs(M + 540, FOOT_Y, 460, 22) + font(14, P.text3, 400) + 'text-align:center;') +
    p(page, abs(W - M - 80, FOOT_Y, 80, 22) + font(14, P.text2, 700) + 'text-align:right;')
}

const LAYOUTS = {
  cover(s, ctx) {
    const { P, meta, deckType } = ctx
    const lines = (s.content || []).slice(0, 2)
    let y = 250
    let out = p(clean(s.kicker) || deckType, abs(M, 180, BODY_W, 28) + font(20, P.accent2, 700))
    out += h(1, s.action_title || s.title || meta.workTitle || deckType, abs(M, y, BODY_W, 200) + font(60, P.ink, 800) + 'line-height:1.12;')
    y = 250 + 150
    for (const line of lines) { out += p(line, abs(M, y, BODY_W, 40) + font(28, P.text2, 400)); y += 50 }
    out += divBar(M, 560, 380, 8, P.accent)
    const m1 = metaJoin([meta.studentName || meta.teamName, meta.school, meta.grade, meta.className])
    const m2 = metaJoin([meta.course, meta.teacherName, meta.date])
    if (m1) out += p(m1, abs(M, 590, BODY_W, 30) + font(24, P.text2, 400))
    if (m2) out += p(m2, abs(M, 626, BODY_W, 30) + font(24, P.text3, 400))
    return out
  },
  'claim-bullets'(s, ctx) {
    const { P } = ctx
    const hasVisual = s.image && fssync.existsSync(path.resolve(s.image))
    const leftW = 700
    let out = ul(s.content || [], abs(M, BODY_TOP, leftW, 460) + font(26, P.ink, 400) + 'padding-left:30px;')
    const cx = M + leftW + 48, cw = BODY_W - leftW - 48
    if (hasVisual) out += img(s.image, abs(cx, BODY_TOP, cw, 420) + 'object-fit:cover;border-radius:14px;')
    else out += card(cx, BODY_TOP, cw, 420, P, p(clean(s.visual) || '视觉位：结构图 / 引用卡 / 配图', font(22, P.text2, 400) + 'line-height:1.5;'))
    return out
  },
  'two-column'(s, ctx) {
    const { P } = ctx
    const c = s.columns || {}
    const cw = (BODY_W - 48) / 2
    return colCard(M, c.left, cw, P) + colCard(M + cw + 48, c.right, cw, P)
  },
  timeline(s, ctx) {
    const { P } = ctx
    const items = (s.items || (s.content || []).map(t => ({ title: t }))).slice(0, 5)
    const rowH = Math.min(96, Math.floor(460 / items.length))
    let out = '', y = BODY_TOP
    items.forEach((it, i) => {
      out += divCircle(M, y, 56, P.accent, p(String(it.num || i + 1), 'width:56px;height:56px;text-align:center;line-height:56px;' + font(26, P.onAccent, 700)))
      const tx = M + 80
      if (it.title) out += h(3, it.title, abs(tx, y, BODY_W - 80, 34) + font(27, P.ink, 700))
      if (it.body) out += p(it.body, abs(tx, y + 36, BODY_W - 80, 40) + font(22, P.text2, 400) + 'line-height:1.4;')
      y += rowH
    })
    return out
  },
  comparison(s, ctx) {
    const { P } = ctx
    const c = s.compare || {}
    const cw = (BODY_W - 40) / 2
    return cmpCard(M, c.left, c.leftKind, cw, P) + cmpCard(M + cw + 40, c.right, c.rightKind, cw, P)
  },
  'pros-cons'(s, ctx) {
    const c = s.compare || { left: { title: '优点 / 支持', items: s.pros || [] }, right: { title: '不足 / 风险', items: s.cons || [] } }
    return LAYOUTS.comparison({ compare: { left: c.left, right: c.right, leftKind: 'good', rightKind: 'bad' } }, ctx)
  },
  'structure-map'(s, ctx) {
    const { P } = ctx
    const nodes = (s.flow || s.content || []).slice(0, 5)
    let out = '', x = M, y = BODY_TOP + 60
    nodes.forEach((node, i) => {
      if (i) { out += p('→', abs(x, y + 14, 40, 40) + font(30, P.accent, 800)); x += 46 }
      const w = Math.max(160, Math.min(260, 120 + String(node).length * 18))
      out += card(x, y, w, 90, P, p(String(node), font(24, P.ink, 600) + 'line-height:1.3;'), P.surface2)
      x += w
    })
    return out
  },
  quote(s, ctx) {
    const { P } = ctx
    const q = s.quote || { text: (s.content || [])[0] || '', source: (s.citations || [])[0] || '', reading: (s.content || [])[1] || '' }
    let out = p('"' + (q.text || '') + '"', abs(M, BODY_TOP + 10, BODY_W, 200) + font(42, P.ink, 600) + 'line-height:1.35;')
    let y = BODY_TOP + 230
    if (q.source) { out += p('— ' + q.source, abs(M, y, BODY_W, 34) + font(24, P.text3, 400)); y += 50 }
    if (q.reading) out += divLeftBar(M, y, BODY_W, 100, P.accent, p(q.reading, font(24, P.text2, 400) + 'line-height:1.5;'), P.surface)
    return out
  },
  'stat-highlight'(s, ctx) {
    const { P } = ctx
    const stats = (s.stats || []).slice(0, 4)
    const n = stats.length || 1
    const colW = BODY_W / n
    let out = ''
    stats.forEach((st, i) => {
      const x = M + i * colW
      out += h(1, String(st.num), abs(x, BODY_TOP + 40, colW, 130) + font(86, P.accent, 800) + 'text-align:center;')
      out += p(String(st.label), abs(x, BODY_TOP + 180, colW, 60) + font(24, P.text2, 400) + 'text-align:center;line-height:1.35;')
    })
    if (s.content && s.content.length) out += ul(s.content, abs(M, BODY_TOP + 280, BODY_W, 160) + font(24, P.text2, 400) + 'padding-left:30px;')
    return out
  },
  'key-people'(s, ctx) {
    const { P } = ctx
    const people = (s.people || []).slice(0, 3)
    const n = people.length || 1, gap = 32, cw = (BODY_W - gap * (n - 1)) / n
    let out = ''
    people.forEach((person, i) => {
      const x = M + i * (cw + gap)
      let inner = p(String(person.name || ''), font(28, P.ink, 800))
      if (person.role) inner += p(String(person.role), font(22, P.accent, 700) + 'margin-top:6px;')
      if (person.body) inner += p(String(person.body), font(22, P.text2, 400) + 'margin-top:8px;line-height:1.45;')
      out += card(x, BODY_TOP, cw, 420, P, inner)
    })
    return out
  },
  reflection(s, ctx) {
    const { P } = ctx
    const nodes = (s.triad || (s.content || []).slice(0, 3).map(t => ({ title: t }))).slice(0, 3)
    const n = nodes.length || 1, gap = 28, cw = (BODY_W - gap * (n - 1)) / n
    let out = ''
    nodes.forEach((nd, i) => {
      const x = M + i * (cw + gap)
      let inner = h(3, String(nd.title || ''), font(26, P.ink, 800))
      if (nd.body) inner += p(String(nd.body), font(22, P.text2, 400) + 'margin-top:8px;line-height:1.45;')
      out += cardTopBar(x, BODY_TOP, cw, 380, P, inner)
    })
    return out
  },
  agenda(s, ctx) {
    const { P } = ctx
    const items = (s.items || s.content || []).slice(0, 7)
    let out = '', y = BODY_TOP + 10
    const step = Math.min(58, Math.floor(440 / items.length))
    items.forEach((it, i) => {
      const t = typeof it === 'string' ? it : (it.title || '')
      out += p(String(i + 1).padStart(2, '0'), abs(M, y, 70, 40) + font(28, P.accent, 700) + 'font-family:monospace;')
      out += p(t, abs(M + 86, y, BODY_W - 86, 40) + font(30, P.ink, 400))
      y += step
    })
    return out
  },
  summary(s, ctx) {
    const { P } = ctx
    const q = clean(s.question)
    let out = ul(s.content || [], abs(M, BODY_TOP, BODY_W, q ? 280 : 460) + font(26, P.ink, 400) + 'padding-left:30px;')
    if (q) out += divBox(M, BODY_TOP + 300, BODY_W, 150, P.accent, 0,
      p('讨论 / Q&A', font(20, P.onAccent, 800)) + p(q, font(26, P.onAccent, 400) + 'margin-top:10px;line-height:1.4;'))
    return out
  }
}
LAYOUTS['toc'] = LAYOUTS.agenda

function abs(x, y, w, h) { return `position:absolute;left:${r(x)}px;top:${r(y)}px;width:${r(w)}px;${h != null ? `height:${r(h)}px;` : ''}` }
function font(size, color, weight) { return `font-size:${size}px;color:${color};${weight ? `font-weight:${weight};` : ''}` }
function r(v) { return Math.round(v) }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function clean(v) { const s = String(v == null ? '' : v).trim(); return /^待补(充)?$/.test(s) ? '' : s }
function metaJoin(arr) { return arr.map(clean).filter(Boolean).map(esc).join('  ·  ') }
function p(text, style) { return `<p style="${style}">${esc(text)}</p>` }
function h(level, text, style) { return `<h${level} style="${style}">${esc(text)}</h${level}>` }
function ul(items, style) { if (!items || !items.length) return ''; return `<ul style="${style}">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` }
function img(src, style) { return `<img src="${esc(path.resolve(src))}" style="${style}" />` }
function card(x, y, w, hgt, P, inner, bg) { return `<div style="${abs(x, y, w, hgt)}background:${bg || P.surface};border:1px solid ${P.border};border-radius:14px;padding:26px 28px;">${inner}</div>` }
function cardTopBar(x, y, w, hgt, P, inner) { return `<div style="${abs(x, y, w, hgt)}background:${P.surface};border-top:8px solid ${P.accent};border-radius:12px;padding:26px 28px;">${inner}</div>` }
function divBox(x, y, w, hgt, bg, rad, inner) { return `<div style="${abs(x, y, w, hgt)}background:${bg};border-radius:${rad || 12}px;padding:24px 28px;">${inner}</div>` }
function divBar(x, y, w, hgt, color) { return `<div style="${abs(x, y, w, hgt)}background:${color};"></div>` }
function divCircle(x, y, d, color, inner) { return `<div style="${abs(x, y, d, d)}background:${color};border-radius:50%;">${inner}</div>` }
function divLeftBar(x, y, w, hgt, color, inner, bg) { return `<div style="${abs(x, y, w, hgt)}background:${bg};border-left:6px solid ${color};border-radius:8px;padding:22px 26px;">${inner}</div>` }
function colCard(x, col, w, P) {
  if (!col) return ''
  let inner = ''
  if (col.label) inner += p(col.label, font(20, P.accent, 800) + 'letter-spacing:.03em;')
  if (col.title) inner += h(2, col.title, font(28, P.ink, 800) + 'margin-top:6px;')
  if (col.items) inner += ul(col.items, font(24, P.text2, 400) + 'padding-left:28px;margin-top:14px;')
  else if (col.body) inner += p(col.body, font(25, P.text2, 400) + 'margin-top:12px;line-height:1.5;')
  return card(x, BODY_TOP, w, 420, P, inner)
}
function cmpCard(x, col, kind, w, P) {
  if (!col) return ''
  const bar = kind === 'good' ? P.good : kind === 'bad' ? P.bad : P.accent
  let inner = h(3, col.title || '', font(28, P.ink, 700))
  inner += ul(col.items || [], font(24, P.text2, 400) + 'padding-left:28px;margin-top:14px;')
  return `<div style="${abs(x, BODY_TOP, w, 440)}background:${P.surface};border-top:8px solid ${bar};border-radius:12px;padding:26px 30px;">${inner}</div>`
}
function parseArgs(values) {
  const out = {}
  for (let i = 0; i < values.length; i += 1) {
    if (!values[i].startsWith('--')) continue
    out[values[i].slice(2)] = values[i + 1]; i += 1
  }
  return out
}

main().catch(err => { console.error(err.message); process.exit(1) })
