# Image Provider

Default model: gpt-image-2.

The skill is provider-flexible. Scripts read local configuration and can be changed by the user.

## Config priority

1. Environment variables in the current command.
2. A private local config file such as .student-ppt.local.json.
3. No provider: generate image_prompts.json and use placeholders.

## Environment variables

- STUDENT_PPT_IMAGE_PROVIDER=openai | compatible | none
- STUDENT_PPT_IMAGE_MODEL=gpt-image-2
- GPT_IMAGE_API_BASE=https://api.openai.com  （脚本会自动追加 /v1）
- GPT_IMAGE_API_KEY=...

Do not echo the key.

## Compatible provider

A compatible provider may use another base URL and model name. If the base URL is not the official OpenAI API, warn before sending prompts or reference images.

## Prompt construction

Prompts should include:

- 16:9 slide ratio.
- Slide purpose and visual style.
- Non-sensitive topic and visual elements.
- Instruction to avoid dense text.

Prompts must not include student name, school, class, student ID, teacher name, phone, email, or home address.
