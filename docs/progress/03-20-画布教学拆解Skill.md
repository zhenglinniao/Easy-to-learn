# 节点 03-20：画布教学拆解 Skill

## 目标

把画布问题拆解从散落的服务端字符串升级为项目级能力包，同时保持已确认的 Solve、Hint、Explain step 行为不变。后续任何新增教学 Prompt 约束必须先由用户确认。

## 实现

- 新增 `skills/canvas-tutor-planner/SKILL.md`，明确画布教学规划的适用范围、工作流和安全边界。
- 新增运行契约参考，记录输入边界、三种模式现有语义、Tutor DSL、校验和失败行为。
- 新增版本化 `prompt-registry.json`，并作为 Gemini 与 OpenAI-compatible 适配器的生产 Prompt 唯一来源。
- `AI_PROMPT_VERSION` 现在只能选择注册表中实际存在的版本；未知版本不会启动模型调用，健康检查显示 AI 降级。
- Prompt 版本、实际内容与 AI 元数据保持一致，可安全回滚；Provider 只负责传输，不复制教学规则。
- 增加注册表接线、模式映射、Explain step 上下文和未知版本拒绝测试。
- 为内存幂等状态存储增加可注入时钟，修复固定测试时间跨过真实 24 小时后缓存断言失效的问题。

## 当前保留的 Prompt 语义

- Solve：分步骤解答、解释推理、不跳过关键步骤。
- Hint：三级递进提示，不泄露最终数值答案或完整证明。
- Explain step：只解释指定步骤，并保持父辅导板上下文一致。
- 全部模式只输出受限 Tutor DSL，禁止任意 HTML、SVG、脚本、URL、外部资源和工具调用。

本节点没有新增步骤数量、先结论还是后结论、年龄适配、语气、动画、视觉使用或自检问题等教学策略。

## 验证

- 使用 `skill-creator` 官方 `quick_validate.py` 验证 Skill 结构与元数据。
- `pnpm check`：通过。
- Vitest：22 个测试文件、97 个测试用例通过。
- 数据库静态契约：6 张表、43 项断言通过。
- 生产构建、格式检查和依赖安全审计通过。
