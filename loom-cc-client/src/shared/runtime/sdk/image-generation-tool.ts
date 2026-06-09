import { access, realpath, stat } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { getImageGenerationConfig } from '@/shared/config/image-generation-config'
import { getDb } from '@/shared/db/db'
import { getUploadsDir } from '@/shared/db/paths'
import { generateImage } from '@/shared/image-generation/generate'
import type {
  GenerateImageRequest,
  ImageReferenceInput,
  ResolvedImageReference,
} from '@/shared/image-generation/types'

export const IMAGE_MCP_SERVER_NAME = 'loom_image'
export const IMAGE_GENERATION_TOOL_NAME = 'generate_image'

interface RuntimeImageAttachment {
  name: string
  serverPath: string
  mimeType: string
  tier: string
}

interface CreateImageGenerationMcpServerOptions {
  sessionId: string
  cwd: string
  attachments?: RuntimeImageAttachment[]
}

const IMAGE_GENERATION_TOOL_SCHEMA = {
  prompt: z.string().min(1).describe('The image generation prompt. Sensitive names, phone numbers, emails, and addresses are redacted before the provider call.'),
  mode: z.enum(['auto', 'text_to_image', 'image_to_image']).optional().describe('Generation mode. Use image_to_image when the user wants an attached/reference image transformed or used as visual guidance.'),
  referenceImages: z.array(z.object({
    name: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
  })).optional().describe('Optional local reference images. Use /api/files/serve/<filename>, workspace paths, uploads paths, or names from current image attachments. Remote URLs are not supported.'),
  aspectRatio: z.string().optional().describe('Optional aspect ratio such as 1:1, 16:9, 9:16, 4:3, or 3:4.'),
  size: z.string().optional().describe('Optional provider-specific size string such as 1024x1024 or 1536x864.'),
  outputName: z.string().optional().describe('Optional base filename for the generated image.'),
  count: z.number().int().min(1).max(4).optional().describe('Number of images to generate.'),
}

export function createImageGenerationMcpServer(options: CreateImageGenerationMcpServerOptions) {
  return createSdkMcpServer({
    name: IMAGE_MCP_SERVER_NAME,
    version: '0.1.0',
    instructions: [
      'Use generate_image when the user asks to create, render, redraw, stylize, or transform an image.',
      'For reference-image tasks, pass mode image_to_image and include referenceImages when possible. Current image attachments can be used automatically.',
      'The tool stores generated files locally and returns Markdown image links.',
    ].join('\n'),
    alwaysLoad: true,
    tools: [
      tool(
        IMAGE_GENERATION_TOOL_NAME,
        'Generate images from text or from local reference images using the globally configured Loom image provider.',
        IMAGE_GENERATION_TOOL_SCHEMA,
        async (args) => {
          try {
            const db = getDb()
            const config = getImageGenerationConfig(db)
            if (!config.enabled) {
              return toolError('图像生成未启用。请先在设置中打开“图像生成设置”。')
            }

            const provider = config.configs.find(item => item.id === config.activeProviderId)
            if (!provider) return toolError('未找到当前图像生成服务商配置。')
            if (!provider.apiKey.trim()) return toolError(`当前图像生成服务商 ${provider.name} 未配置 API Key。`)
            if (!provider.model.trim()) return toolError(`当前图像生成服务商 ${provider.name} 未配置模型 ID。`)

            const mode = args.mode || config.defaultMode
            const references = await resolveImageReferences({
              inputs: args.referenceImages || [],
              mode,
              cwd: options.cwd,
              attachments: options.attachments || [],
            })

            const request: GenerateImageRequest = {
              prompt: args.prompt,
              mode,
              references,
              aspectRatio: args.aspectRatio,
              size: args.size,
              outputName: args.outputName,
              count: args.count || 1,
              outputFormat: config.outputFormat,
            }

            const images = await generateImage(provider, request)
            return {
              content: [{
                type: 'text' as const,
                text: formatGeneratedImages(provider.name, provider.model, images),
              }],
            }
          } catch (err) {
            return toolError(err instanceof Error ? err.message : String(err))
          }
        },
        {
          alwaysLoad: true,
          searchHint: 'Generate or edit images from prompts and reference images.',
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: true,
          },
        },
      ),
    ],
  })
}

export function isImageGenerationToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized === IMAGE_GENERATION_TOOL_NAME ||
    normalized === `mcp__${IMAGE_MCP_SERVER_NAME}__${IMAGE_GENERATION_TOOL_NAME}` ||
    (normalized.includes(IMAGE_MCP_SERVER_NAME) && normalized.includes(IMAGE_GENERATION_TOOL_NAME))
}

async function resolveImageReferences(args: {
  inputs: ImageReferenceInput[]
  mode: 'auto' | 'text_to_image' | 'image_to_image'
  cwd: string
  attachments: RuntimeImageAttachment[]
}): Promise<ResolvedImageReference[]> {
  const imageAttachments = args.attachments.filter(isImageAttachment)
  const inputs = args.inputs.filter(input => input.name || input.path || input.url)
  const effectiveInputs = inputs.length > 0
    ? inputs
    : args.mode === 'image_to_image'
      ? imageAttachments.map(attachment => ({ name: attachment.name, path: attachment.serverPath }))
      : []

  const refs: ResolvedImageReference[] = []
  const seen = new Set<string>()
  for (const input of effectiveInputs) {
    const ref = await resolveSingleReference(input, args.cwd, imageAttachments)
    const key = await realpath(ref.path).catch(() => ref.path)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

async function resolveSingleReference(
  input: ImageReferenceInput,
  cwd: string,
  imageAttachments: RuntimeImageAttachment[],
): Promise<ResolvedImageReference> {
  const matched = matchAttachment(input, imageAttachments)
  if (matched) return attachmentToReference(matched)

  const rawPath = input.path?.trim()
  const rawUrl = input.url?.trim()
  const fromServedUrl = resolveServedFile(rawUrl || rawPath || '')
  if (fromServedUrl) return resolveLocalImagePath(fromServedUrl, cwd, input.name)

  if (rawUrl) {
    const fileUrlPath = resolveFileUrl(rawUrl)
    if (fileUrlPath) return resolveLocalImagePath(fileUrlPath, cwd, input.name)
    throw new Error('Remote reference image URLs are not supported. Use an uploaded image or local workspace path.')
  }

  if (rawPath) return resolveLocalImagePath(rawPath, cwd, input.name)
  if (input.name) throw new Error(`Reference image not found: ${input.name}`)
  throw new Error('Reference image must include name, path, or url')
}

function matchAttachment(
  input: ImageReferenceInput,
  imageAttachments: RuntimeImageAttachment[],
): RuntimeImageAttachment | null {
  const candidates = [input.name, input.path, input.url]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => path.basename(value.trim()).toLowerCase())
  if (candidates.length === 0) return null
  return imageAttachments.find(attachment => {
    const names = [
      attachment.name,
      path.basename(attachment.serverPath),
    ].map(value => value.toLowerCase())
    return candidates.some(candidate => names.includes(candidate))
  }) ?? null
}

function attachmentToReference(attachment: RuntimeImageAttachment): ResolvedImageReference {
  return {
    name: attachment.name || path.basename(attachment.serverPath),
    path: attachment.serverPath,
    mimeType: attachment.mimeType,
  }
}

async function resolveLocalImagePath(
  value: string,
  cwd: string,
  name?: string,
): Promise<ResolvedImageReference> {
  const uploadsDir = path.resolve(getUploadsDir())
  const workspaceDir = path.resolve(cwd)
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(workspaceDir, value)

  if (!isInside(resolved, workspaceDir) && !isInside(resolved, uploadsDir)) {
    throw new Error('Reference image path must be inside the current workspace or Loom uploads directory.')
  }

  await access(resolved)
  const info = await stat(resolved)
  if (!info.isFile()) throw new Error(`Reference image is not a file: ${resolved}`)

  const mimeType = mimeFromPath(resolved)
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Reference file is not a supported image: ${resolved}`)
  }

  return {
    name: name?.trim() || path.basename(resolved),
    path: resolved,
    mimeType,
  }
}

function resolveServedFile(value: string): string | null {
  if (!value) return null
  const match = value.match(/\/api\/files\/(?:serve|upload)\/([^/?#]+)/)
  if (!match?.[1]) return null
  const filename = decodeURIComponent(match[1])
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid uploaded reference filename')
  }
  return path.join(getUploadsDir(), filename)
}

function resolveFileUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    return fileURLToPath(url)
  } catch {
    return null
  }
}

function isImageAttachment(attachment: RuntimeImageAttachment): boolean {
  return attachment.tier === 'image' && attachment.mimeType.startsWith('image/')
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function formatGeneratedImages(providerName: string, model: string, images: Array<{ filename: string; url: string; size: number }>): string {
  const lines = [
    `Generated ${images.length} image${images.length === 1 ? '' : 's'} with ${providerName} (${model}).`,
    '',
  ]
  for (const image of images) {
    lines.push(`- ${image.filename} (${Math.round(image.size / 1024)} KB): ${image.url}`)
    lines.push(`![${image.filename}](${image.url})`)
  }
  return lines.join('\n')
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  }
}
