export function sanitizeImagePrompt(value: string): string {
  return value
    .replace(/(姓名|学生姓名|学校|班级|年级|学号|手机号|电话|邮箱|家庭住址)[:：]\s*[^，。\n,;；]+/g, '$1: [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/1[3-9]\d{9}/g, '[redacted-phone]')
    .trim()
}

export function promptSummary(value: string): string {
  const clean = sanitizeImagePrompt(value).replace(/\s+/g, ' ')
  return clean.length > 240 ? clean.slice(0, 237) + '...' : clean
}
