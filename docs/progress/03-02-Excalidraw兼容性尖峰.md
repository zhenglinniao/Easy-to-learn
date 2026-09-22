# 阶段 3 / 节点 2：Excalidraw 兼容性尖峰

- 状态：已完成（GO）
- 日期：2026-09-22
- 范围：Excalidraw 0.18.1 公共 API、画布适配边界及传递依赖 override 运行时验证

## 完成内容

- 在 `canvas-adapter` 建立画布边界：支持的 AI 输入元素过滤、选区文字提取、视觉输入判断、scene/client 坐标转换和白底 PNG 导出。
- 增加独立懒加载尖峰路由 `/spikes/excalidraw`，不改变产品功能和业务路由。
- 使用 Excalidraw 公共 API 完成初始元素装载、场景读取、应用状态读取和二进制文件读取。
- 用真实混合选区验证文字与图形的过滤和导出，生成的 PNG 为 10,825 bytes。
- 动态加载 `@excalidraw/mermaid-to-excalidraw@2.2.2`，验证安全 override 后仍能正常生成元素。
- 为选区过滤和非 100% 缩放下的坐标往返增加单元测试。

## 兼容性结论

| 检查 | 结果 |
|---|---|
| Excalidraw 挂载与 Imperative API | 通过 |
| `convertToExcalidrawElements` 与场景元素读取 | 通过，3 个元素 |
| 文字、矩形、箭头混合选区 | 通过 |
| scene/client 坐标往返 | 通过，误差不超过 0.01 px |
| 白底 PNG 导出 | 通过，10,825 bytes |
| Mermaid 模块在安全 override 下加载与解析 | 通过 |
| Edge 浏览器控制台 | 0 error / 0 warning |
| `pnpm audit --audit-level high` | 通过，0 known vulnerability |

结论为 **GO**：可以继续基于 `@excalidraw/excalidraw@0.18.1` 和当前精确依赖 override 开发。若后续升级 Excalidraw 或取消 override，必须重新执行本尖峰。

## 工程决策

- 产品画布继续按路由懒加载，避免 Excalidraw 进入首页初始包。
- Mermaid 只用于兼容性验证，当前需求不包含 Mermaid 功能，不将其接入产品交互。
- jsdom 不具备完整 Canvas 能力；单元测试验证适配器纯逻辑，真实渲染和 PNG 导出由浏览器尖峰验证。
- 尖峰页面保留到画布主流程完成，便于升级回归；它不作为用户入口，也不代表新增产品需求。

## 构建观察

- 首页入口保持独立，入口 JavaScript 约 260.76 KiB（gzip 83.18 KiB）。
- Excalidraw 和 Mermaid 生成独立懒加载 chunk；尖峰 chunk 超过 Vite 500 KiB 提示阈值，这是技术验证页面的已知结果。
- 正式画布实现不得静态引入 Mermaid，并应继续检查产品路由的实际加载边界。

## 已知环境差异

当前 Codex 内置 Node 为 24.19.0，仓库目标为 24.21.0。所有检查已在 24.19.0 上通过，CI 和正式环境仍须使用 `.node-version` 指定的 24.21.0 复验。

## 下一节点

节点 3 按设计文档实现领域模型和 Zod 协议，包括统一错误结构、AI 请求/响应、配额状态、画板持久化和账户删除状态；不在本节点提前实现业务接口。
