#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const inputPath = args.input || 'image_prompts.json'
const outDir = args.out || 'generated-images'

const prompts = JSON.parse(await fs.readFile(inputPath, 'utf-8'))
const requests = Array.isArray(prompts) ? prompts : prompts.images || []
await fs.mkdir(outDir, { recursive: true })

const config = await loadConfig()
const provider = config.provider || 'openai'
const model = config.model || 'gpt-image-2'
const baseUrl = normalizeBaseUrl(config.baseUrl || 'https://api.openai.com/v1')
const apiKey = config.apiKey

if (provider === 'none' || !apiKey) {
  await writePlaceholderManifest(requests, outDir, provider, model)
  console.log('No image provider configured. Wrote placeholder manifest only.')
  process.exit(0)
}

if (!baseUrl.startsWith('https://api.openai.com/')) {
  console.warn('Warning: non-official image base URL configured. Prompts may be sent to that provider.')
}

const manifest = []
for (const request of requests) {
  const page = request.page || manifest.length + 1
  const safePrompt = sanitizePrompt(String(request.prompt || request.visual || 'student presentation slide'))
  const filename = request.filename || `slide-${String(page).padStart(2, '0')}.png`
  const outputPath = path.join(outDir, filename)
  const image = await generateImage({ baseUrl, apiKey, model, prompt: safePrompt })
  await fs.writeFile(outputPath, Buffer.from(image, 'base64'))
  manifest.push({
    page,
    provider,
    model,
    file: outputPath,
    promptSummary: safePrompt.slice(0, 240),
    privacyLevel: request.privacy_level || 'none',
  })
}

await fs.writeFile(path.join(outDir, 'image_manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`Generated ${manifest.length} image(s) into ${outDir}`)

async function generateImage({ baseUrl, apiKey, model, prompt }) {
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size: '1536x864',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Image generation failed: ${res.status} ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  const first = data.data?.[0]
  if (first?.b64_json) return first.b64_json
  if (first?.url) {
    const imageRes = await fetch(first.url)
    if (!imageRes.ok) throw new Error(`Failed to download generated image: ${imageRes.status}`)
    return Buffer.from(await imageRes.arrayBuffer()).toString('base64')
  }
  throw new Error('Image response did not include b64_json or url')
}

async function writePlaceholderManifest(requests, outDir, provider, model) {
  const manifest = requests.map((request, index) => ({
    page: request.page || index + 1,
    provider,
    model,
    file: null,
    promptSummary: sanitizePrompt(String(request.prompt || request.visual || '')).slice(0, 240),
    privacyLevel: request.privacy_level || 'none',
    status: 'placeholder',
  }))
  await fs.writeFile(path.join(outDir, 'image_manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
}

async function loadConfig() {
  const fileConfig = await readJsonIfExists('.student-ppt.local.json')
  return {
    provider: process.env.STUDENT_PPT_IMAGE_PROVIDER || fileConfig.provider,
    model: process.env.STUDENT_PPT_IMAGE_MODEL || fileConfig.model,
    baseUrl: process.env.GPT_IMAGE_API_BASE || fileConfig.baseUrl,
    apiKey: process.env.GPT_IMAGE_API_KEY || fileConfig.apiKey,
  }
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    return {}
  }
}

function normalizeBaseUrl(value) {
  const stripped = String(value).replace(/\/+$/, '')
  return stripped.endsWith('/v1') ? stripped : stripped + '/v1'
}

function sanitizePrompt(value) {
  return value
    .replace(/(姓名|学生姓名|学校|班级|年级|学号|手机号|电话|邮箱|家庭住址)[:：]\s*[^，。\n,;；]+/g, '$1: [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/1[3-9]\d{9}/g, '[redacted-phone]')
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
