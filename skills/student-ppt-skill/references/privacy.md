# Privacy Rules

Use this reference whenever student identity, school material, API keys, provider base URLs, or reference images appear.

## API keys

- Never ask the user to paste an API key into chat.
- Read keys only from local environment variables or private local config files.
- Never write keys into HTML, PPTX notes, logs, image_manifest.json, prompt summaries, or error messages.

## Student identity

Student name, school, class, grade, teacher, student ID, phone, email, family address, screenshots, and photos are sensitive.

- Keep required identity information in local layout fields.
- Do not send identity fields to image providers.
- Before image generation, strip identity fields from prompts.
- If a cover must display student identity, render it locally after image generation.

## Provider warning

If baseUrl is not the official OpenAI API endpoint, warn that prompts and optional reference images will be sent to that configured provider.

## Reference images

Before sending school logos, student photos, homework screenshots, or uploaded reference images to a provider, ask for explicit confirmation.

## Manifest

image_manifest.json may contain provider name, model, output file path, prompt summary, and privacy_level. It must not contain keys, full base URLs with secrets, student identity, or private source text.

**导出轨隐私规则**：见 `references/editable-pptx.md`——封面姓名字段可显示在封面/页脚，不能塞进发给图片服务商的 prompt；API Key 不写入 PPTX 备注或日志。
