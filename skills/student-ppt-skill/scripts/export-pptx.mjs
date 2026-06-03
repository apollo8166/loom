#!/usr/bin/env node
/*
 * VENDORED from the huashu-design (花叔Design) skill (renamed export_deck_pptx.mjs → export-pptx.mjs).
 * student-ppt-skill 导出轨入口：把 build-pptx-html.mjs 产出的 pptx-slides/*.html 导出为可编辑 PPTX。
 */
/**
 * export-pptx.mjs — 把多文件 slide deck 导出为可编辑 PPTX
 *
 * 用法：
 *   node scripts/export-pptx.mjs --slides <dir> --out <file.pptx>
 *
 * ⚠️ HTML 必须符合 4 条硬约束（见 references/editable-pptx.md）。
 * 视觉自由度优先的场景请改用"浏览器打印 student-ppt.html 为 PDF"。
 *
 * 依赖：npm install playwright pptxgenjs sharp
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
// 注意：pptxgenjs 用动态 import（在 main 里），缺依赖时给友好提示而不是丑陋的 ERR_MODULE_NOT_FOUND 栈。

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '');
    args[k] = a[i + 1];
  }
  if (!args.slides || !args.out) {
    console.error('用法: node scripts/export-pptx.mjs --slides <dir> --out <file.pptx>');
    console.error('⚠️ HTML 必须符合 4 条硬约束（见 references/editable-pptx.md）。');
    process.exit(1);
  }
  return args;
}

async function main() {
  const { slides, out } = parseArgs();
  const slidesDir = path.resolve(slides);
  const outFile = path.resolve(out);

  const files = (await fs.readdir(slidesDir)).filter(f => f.endsWith('.html')).sort();
  if (!files.length) { console.error(`No .html files found in ${slidesDir}`); process.exit(1); }

  console.log(`Converting ${files.length} slides via html2pptx...`);

  let pptxgen, html2pptx;
  try {
    pptxgen = (await import('pptxgenjs')).default;
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    html2pptx = require(path.join(__dirname, 'html2pptx.js'));
  } catch (e) {
    const skillRoot = path.dirname(__dirname);
    console.error(`\n✗ 缺少"可编辑 PPTX"导出依赖（${(e.message || '').split('\n')[0]}）。`);
    console.error(`  这是可选路径——HTML 展示稿已经能用。要导出 .pptx，先在 skill 目录安装依赖：`);
    console.error(`      cd "${skillRoot}" && npm install`);
    console.error(`  已生成的 ${slides}/*.html 仍在，装好依赖后重跑本命令即可，不必重做。`);
    process.exit(2);
  }

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';

  const errors = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const fullPath = path.join(slidesDir, f);
    try {
      await html2pptx(fullPath, pres);
      console.log(`  [${i + 1}/${files.length}] ${f} ✓`);
    } catch (e) {
      console.error(`  [${i + 1}/${files.length}] ${f} ✗  ${e.message}`);
      errors.push({ file: f, error: e.message });
    }
  }

  if (errors.length) {
    console.error(`\n⚠️ ${errors.length} 张 slide 转换失败。详见 references/editable-pptx.md 的「常见错误速查」。`);
    if (errors.length === files.length) { console.error('✗ 全部失败，不生成 PPTX。'); process.exit(1); }
  }

  await pres.writeFile({ fileName: outFile });
  console.log(`\n✓ Wrote ${outFile}  (${files.length - errors.length}/${files.length} slides, 可编辑 PPTX)`);
}

main().catch(e => { console.error(e); process.exit(1); });
