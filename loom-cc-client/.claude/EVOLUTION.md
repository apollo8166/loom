[职责]
    本文件描述 Loom 的 memory/evolution 概念边界。具体实现可以由本地服务、skills、sub-agent 或后台任务承担。

    evolution 的目标不是把每条对话都变成规则，也不是让用户维护一堆候选记忆。

    目标是：

    - 低成本记录事实和观察。
    - 批量识别稳定规律。
    - 让项目规则可以被印证、衰减、废弃。
    - 让后续上下文只注入真正有用的项目理解。

[四层记忆]
    L0 Fact Records
        记录确定发生过的消息、反馈、操作和状态。
        只增不改，不需要 LLM 判断。

    L1 Session Observations
        记录近期有价值信号，例如用户纠正、反馈、规则意图、风险。
        通过 cheap gate 写入，短期有效。

    L2 Semantic Memories / Project Rules
        多次观察印证后形成稳定认知。
        具有 strength、occurrences、stale_score、expires_at 和 evidence ids。

    L3 Project Dossier
        当前项目理解摘要。
        低频重算，用于后续上下文注入。

[三道闸门]
    价值过滤
        判断这条信息下次处理项目时是否还用得上。
        一次性噪声、寒暄、纯过程内容不进入长期记忆。

    置信过滤
        高置信低风险可自动记录或强化。
        中置信或高影响进入待处理区。
        低置信只保留 L0 留痕。

    晋升 / 去重过滤
        L1 不直接变成规则。
        需要重复证据、语义一致、无 negative prior。
        规则预过滤先行，只有模糊 case 调用 skill。

[Token 原则]
    - 普通 after_message 不单独调用 LLM memory extractor。
    - L0/L1 写入通过确定性规则完成。
    - 候选提炼尽量搭车主任务或 skill 的已有 LLM 调用。
    - L1 到 L2 的晋升批量处理。
    - 注入上下文时固定预算：L3 dossier + L2 top-K + 最近少量 L1。
    - evidence 只引用 id，不把完整证据链塞进 prompt。

[进化飞轮]
    观察 L1
        ↓
    晋升 / 强化 L2
        ↓
    更新 L3 dossier
        ↓
    下一轮按需注入
        ↓
    新观察继续印证、修正或推翻

    L2 / project rule 被新证据印证：
        strength 上升，occurrences 增加，last_reinforced_at 更新。

    L2 / project rule 长期未被印证：
        stale_score 上升，注入权重下降，最终归档或废弃。

    用户否决某个方向：
        创建 negative prior，未来同方向候选提高门槛或直接过滤。

[用户体验]
    进化是无感优先，不是打扰优先。

    - 普通记录 → 无感。
    - 自动强化 → 无感。
    - 批量晋升 → 无感或轻提示。
    - 高影响 / 冲突 / 低置信事项 → 进入右侧“需要处理”。
    - 执行会改变项目规则的高风险动作 → 用户确认。

    右侧 Memory 面板展示项目理解，不展示内部账本。

    常驻展示：
        - 自动进化概览
        - L3 Project Dossier
        - L2 Semantic Memories
        - L1 Recent Observations
        - 需要处理
        - 注入预览

    不常驻展示：
        - Topic 文件列表
        - MEMORY.md 原文
        - L0 fact records
        - audit log
        - active/shadow rules 的完整内部清单
