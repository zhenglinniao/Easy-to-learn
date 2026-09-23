# 节点 03-21：Solve 答案呈现策略

## 已确认决策

2026-09-23 用户确认：Solve 根据题型自动判断答案呈现方式；简单题先给结论，推理题最后给答案。

## 实现

- 保留 Prompt `v1`，新增并默认启用 `v2`，支持安全回滚。
- `v2` Solve 要求模型输出 `answerPresentation.problemType` 和 `answerPresentation.conclusionPosition`。
- `simple` 只允许配合 `first_step`；`reasoning` 只允许配合 `final_step`。
- Prompt `v2` Solve 缺少策略、枚举组合不一致，或 Hint/Explain step 携带该字段时，Tutor DSL 校验失败并进入现有的一次格式纠错。
- 当前不硬编码具体学科或题型分类表，模型结合问题内容判断 `simple/reasoning`；本节点未新增步骤数量、语气、动画、年龄适配或自检规则。

## 测试

- 覆盖 `v1/v2` 注册与未知版本拒绝。
- 覆盖简单题正确组合、推理题错误组合、缺失策略和非 Solve 越界字段。
- 完整质量门禁通过：22 个测试文件、98 个测试用例全部通过，Lint、TypeScript、格式、数据库静态检查、生产构建与高危依赖审计均通过。
- `skill-creator` 官方快速校验通过。
