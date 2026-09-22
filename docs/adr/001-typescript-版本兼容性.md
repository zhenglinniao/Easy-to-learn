# ADR-001：TypeScript 使用 6.0.3

- 状态：已接受
- 日期：2026-09-22
- 影响范围：工程工具链，不影响产品需求、协议或运行时行为

## 背景

阶段 2 设计稿初始选择 TypeScript 7.0.2。阶段 3 安装前核查发现，当前 `typescript-eslint@8.70.1` 的 peer dependency 要求 TypeScript `>=4.8.4 <6.1.0`。强行安装 TypeScript 7 会失去受支持的静态检查组合，并可能产生无法复现的解析错误。

## 决策

使用 `typescript@6.0.3`，保留 `typescript-eslint@8.70.1` 和 ESLint 10。所有版本通过根 `package.json` 与 `pnpm-lock.yaml` 固定。

## 后果

- 获得供应商声明支持的 lint/typecheck 组合。
- 暂不使用 TypeScript 7 独有能力。
- `typescript-eslint` 正式支持 TypeScript 7 后，可以通过新的 ADR 和完整质量检查升级。

## 被拒绝的方案

- 忽略 peer dependency：会让 CI 结果失去可靠性。
- 移除 TypeScript ESLint：会削弱 TypeScript 代码质量门禁。
- 暂停整个工程等待上游：当前没有必要。
