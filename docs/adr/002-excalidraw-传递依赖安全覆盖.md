# ADR-002：覆盖 Excalidraw 的高危传递依赖

- 状态：已接受，节点 2 的 Excalidraw 专项兼容性验证已通过
- 日期：2026-09-22
- 影响范围：依赖解析，不改变产品需求和公开协议

## 背景

`pnpm audit --audit-level high` 检出 `@excalidraw/excalidraw@0.18.1` 依赖链中的已知高危版本：

- `nanoid@3.3.3`；
- `nanoid@4.0.2`；
- `lodash-es@4.17.21`。

当前 Excalidraw 和 `@excalidraw/mermaid-to-excalidraw@2.2.2` 尚未发布消除这些公告的新版本。生产基线不能在没有记录和验证的情况下接受高危依赖。

## 决策

通过 pnpm 精确 override 使用已修复版本：

- `nanoid@3.3.3 -> 3.3.19`；
- `nanoid@4.0.2 -> 5.1.16`；
- `lodash-es@4.17.21 -> 4.18.1`。

不使用宽泛的全局 override，避免影响不相关依赖。节点 2 必须验证 Excalidraw mount、元素创建、选区、PNG 导出和 Mermaid 相关模块加载；如发现不兼容，必须停止并重新评估，不能移除审计门禁后继续。

## 后果

- 安装审计不再包含这些已知高危版本。
- `nanoid` 4 到 5 是主版本覆盖，存在运行时兼容风险，因此不能只依赖类型检查。
- lockfile 和构建产物必须进入提交，保证 CI 与本地解析一致。

## 验证结论

2026-09-22 在 Edge 真实浏览器中完成运行时验证：Excalidraw 挂载、公共 API、元素读取、混合选区过滤、白底 PNG 导出均通过；`@excalidraw/mermaid-to-excalidraw@2.2.2` 在上述精确 override 下可以正常解析流程图。依赖审计结果为 0 个已知漏洞，因此保留本决策。
