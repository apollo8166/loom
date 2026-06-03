#!/usr/bin/env bash
# Hook: PreToolUse (Bash) if git commit*
# commit 前自动编译检查，不通过则阻止 commit
# 通用：自动查找包含 tsconfig.json 的项目代码目录

TSCONFIG=$(find "$CLAUDE_PROJECT_DIR" -maxdepth 3 -name "tsconfig.json" -not -path "*/node_modules/*" -not -path "*/.next/*" 2>/dev/null | head -1)

if [ -z "$TSCONFIG" ]; then
  exit 0
fi

PROJECT_CODE=$(dirname "$TSCONFIG")
cd "$PROJECT_CODE"

TSC_OUTPUT=$(cd "$PROJECT_CODE" && node_modules/typescript/bin/tsc --noEmit 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  echo "编译检查未通过，commit 被阻止。请修复以下错误：" >&2
  echo "$TSC_OUTPUT" >&2
  exit 2
fi

exit 0
