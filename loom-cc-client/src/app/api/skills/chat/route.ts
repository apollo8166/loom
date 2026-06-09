import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { resolveProvider } from '@/shared/runtime/provider'
import { getSkillBuilderSystemPrompt } from '@/shared/skills/builtin-skills'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CREATE_SKILL_APPENDIX = `

---

## 输出格式（系统要求，必须遵守）

低门槛发现模式：
- 当用户说“不知道建什么”“我没想好”“有什么 Skill 可以做”“你帮我想想”“我只是想自动化一些事”时，不要要求用户先定义 Skill。
- 直接用这句话引导：“没关系，你不需要有清晰的需求。你只需要告诉我：你今天或者本周，哪一件事情让你觉得最枯燥、最想推给别人干？哪怕只有一句话，我也能帮你判断它能不能变成一个 Skill。”
- 拿到用户的一句话后，快速判断它是否重复发生、是否有明确输入输出、是否有稳定判断标准、是否适合沉淀成 Skill。
- 如果不适合，直接说明“不建议做成 Skill，可以先作为一次性任务处理”，不要强行包装。

当你通过对话已收集到足够信息（目标、触发场景、输入、输出、质量标准和边界），准备生成 Skill 时：

1. 先展示领域标准卡和文件预览，让用户确认。
2. 用户确认领域标准卡后，立即生成 SKILL.md 和 loom.skill.json 的预览代码块，不要再次复述确认。
3. 用户确认预览内容后，立即在回复**末尾**单独一行输出以下 JSON 标记（JSON 必须合法，所有字段在一行内）：

<!-- CREATE_SKILL {"name":"<kebab-case>","displayName":"<中文名>","description":"<触发描述>","category":"<分类>","stage":"<阶段>","tags":["<标签>"],"inputs":["<输入项>"],"outputs":["<输出项>"],"examples":["<示例说法>"],"riskLevel":"low"} -->

字段说明：
- name: 英文 kebab-case，如 xiaohongshu-note-writer
- description: 明确包含触发条件的一句话
- riskLevel: "low" | "medium" | "high"
- 数组最多 5 个元素

确认推进规则：
- 用户回复“确认”“可以”“没问题”“就这样”“继续”“创建”等明确认可时，视为进入下一步。
- 不要在用户确认后再次询问“现在可以了吗”“是否继续”“请再次确认”。
- 只有发现安全风险、权限变化、路径缺失或结构无法创建时，才允许再次询问。

SKILL.md 结构规则：
- “用户交互”可以是 SKILL.md 的运行时规则章节，用来说明何时追问、何时直接执行。
- “用户交互”必须作为独立的 “## 用户交互” 标题出现，不能被写进 “## 输出” 的示例模板里。
- 如果 SKILL.md 内需要展示输出模板，优先使用 ~~~markdown 代码块。
- 预览完整 SKILL.md 时，外层代码块使用 ~~~markdown，不要使用 \`\`\`markdown。
- 所有代码块必须成对闭合；预览前检查后续章节没有被代码块吞掉。

只有信息充分、预览完成、用户确认后，才输出这个标记。`

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: NextRequest) {
  let messages: ChatMessage[]
  try {
    const body = await req.json()
    messages = body.messages ?? []
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response('{"error":"messages required"}', {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch {
    return new Response('{"error":"Invalid JSON"}', {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let apiKey: string
  let baseUrl: string | undefined
  let modelId: string
  try {
    const provider = resolveProvider('claude-haiku-4-5')
    apiKey = provider.apiKey
    baseUrl = provider.baseUrl
    modelId = provider.resolvedModelId || 'claude-haiku-4-5'
    if (!apiKey && !provider.isCliAuth) {
      return new Response('{"error":"未配置 API Key，请在设置中配置 Anthropic API Key"}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : '未找到 API 凭证' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const skillBuilderPrompt = getSkillBuilderSystemPrompt()
  if (!skillBuilderPrompt) {
    return new Response('{"error":"未找到 skill-builder，请检查预置 skills 仓库目录"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const system = skillBuilderPrompt + CREATE_SKILL_APPENDIX

  try {
    const client = new Anthropic({
      apiKey: apiKey || undefined,
      baseURL: baseUrl,
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = client.messages.stream({
            model: modelId,
            max_tokens: 2048,
            system,
            messages: messages as Anthropic.MessageParam[],
          })
          for await (const chunk of stream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`),
              )
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : 'Stream error'
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`))
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'API Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
