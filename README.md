# Easy to learn

Easy to learn 是一个中文 AI 学习画布：用户可以在 Excalidraw 无限画布中书写、涂鸦、绘图或粘贴图片，圈选习题、文章、食物、物体、流程图等内容后，就地获取手绘感的分步解答、内容拆解、递进提示或步骤解释。

当前仓库已完成可运行的本地 MVP 代码、单元测试和 Vercel 部署配置。由于仓库尚未配置真实 Supabase、Upstash Redis、AI 模型供应商、OAuth、Sentry、Vercel 项目和域名，云登录、云同步与真实 AI 请求不能视为已经上线或完成供应商 E2E 验证。

## 功能

- 游客无需登录即可使用画布，草稿与图片保存在当前浏览器 IndexedDB。
- 登录用户可创建、重命名、打开和删除多个私有画板。
- 文字、手写、图形和图片混合选区可调用 Solve、Hint 与 Explain step。
- AI 输出使用受控 Tutor DSL、KaTeX 与受限图表渲染，不注入模型 HTML。
- AI 会优先遵循明确问题；没有问题时按画布内容推断一个主要学习目标，例如文章结构、菜谱变化、营养构成、种植过程或物体机制，并在结果中标记推断来源和置信度。
- 讲解采用准确、轻松而不过度卖萌的手绘叙事方向；严肃、高风险或识别不确定的内容会主动降低幽默并明确边界。
- AI Provider 可按顺序配置 Gemini 或 OpenAI-compatible 模型，并在超时、网络错误或供应商故障时自动回退。
- 画布教学规则集中在项目级 `canvas-tutor-planner` Skill，并由同一版本化注册表生成线上 Prompt。
- Solve 会根据题型选择答案位置：简单题先给结论再解释，推理题完成必要推理后在最后一步给结论。
- 辅导板支持“有帮助”或预定义问题分类反馈，不采集自由文本与原题内容。
- 本地事务完成后再同步云端；资产先上传，快照使用 revision 乐观锁。
- 多标签页竞争单写入者，冲突时保留本地副本，不静默覆盖云端。
- 支持标准 `.excalidraw` 与包含辅导板和图片的 `.easy-to-learn.json` 完整备份。
- 支持 light/dark、窄屏布局、键盘焦点和 reduced motion。
- 可选启用 Sentry 浏览器异常采集；服务端 API 输出不含题目和身份信息的结构化错误日志。
- 游客与登录用户每天各 3 次有效 AI 请求，同一身份每 5 分钟最多 1 次。
- 官网使用原创吉祥物“小易”演示题目到分步辅导的过程，并完整支持 reduced motion。
- 官网以动态图文微界面展示题图提示、图形推理和跨设备复习三类实际使用场景。

## 技术栈

- Node.js 24.21.0、pnpm 11.25.0
- React 19、TypeScript 6、Vite 8、React Router 7
- Excalidraw 0.18、Zod 4、KaTeX 0.18、IndexedDB (`idb`)
- Supabase Auth / Postgres / Storage
- Vercel Functions、Upstash Redis、Gemini / OpenAI-compatible AI Provider
- Vitest、Testing Library、fake-indexeddb、pgTAP

所有依赖使用精确版本并写入 lockfile。请使用仓库冻结版本，不要用 `latest` 替换。

## 目录

```text
apps/web/                  React/Vite 前端
api/                       Vercel Node Functions
packages/domain/           领域模型与 Zod 协议
packages/canvas-adapter/   Excalidraw 选区、坐标和导出适配
packages/persistence/      IndexedDB、outbox、同步和导出
packages/ui/               径向菜单、辅导板与安全 DSL 渲染
skills/canvas-tutor-planner/ 画布问题拆解 Skill、运行契约与 Prompt 注册表
supabase/migrations/       数据库、RLS、RPC、Storage policy
supabase/tests/            pgTAP 权限与契约测试
docs/                      需求、方案、进度和测试报告
```

## 环境依赖

必需：

- Node.js `24.21.0`（仓库包含 `.nvmrc` 和 `.node-version`）
- pnpm `11.25.0`

需要运行本地 Supabase 或数据库测试时，还需：

- Docker Desktop
- Supabase CLI（已作为项目开发依赖安装，可通过 pnpm 脚本调用）

## 安装

```powershell
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
```

`.env.local` 只保存在本机，禁止提交任何真实密钥。

## 环境变量

浏览器仅允许以下公开变量：

| 变量                     | 用途                                        |
| ------------------------ | ------------------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase 项目 URL                           |
| `VITE_SUPABASE_ANON_KEY` | 浏览器 anon key，不是 service role          |
| `VITE_APP_ENV`           | `local`、`preview` 或 `production`          |
| `VITE_SENTRY_DSN`        | 可选的公开 Sentry DSN；未配置时监控保持禁用 |

服务端变量：

| 变量                                                  | 用途                                             |
| ----------------------------------------------------- | ------------------------------------------------ |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY`                  | JWT 校验与用户级访问                             |
| `SUPABASE_SERVICE_ROLE_KEY`                           | 临时 AI 图片、账户删除和保留任务；禁止传到浏览器 |
| `AI_PROVIDERS`                                        | Provider 标识的有序列表，如 `primary,backup`     |
| `AI_PROMPT_VERSION`                                   | 已在 Tutor Skill 注册的提示词版本，默认 `v3`     |
| `AI_PROVIDER_<ID>_TYPE`                               | `gemini` 或 `openai-compatible`                  |
| `AI_PROVIDER_<ID>_MODEL`                              | 该 Provider 使用的模型名                         |
| `AI_PROVIDER_<ID>_API_KEY`                            | 该 Provider 的服务端密钥；本地服务可以留空       |
| `AI_PROVIDER_<ID>_BASE_URL`                           | OpenAI-compatible API 的 `/v1` 基础地址          |
| `AI_PROVIDER_<ID>_RESPONSE_FORMAT`                    | `json_schema`、`json_object` 或 `prompt`         |
| `AI_PROVIDER_<ID>_WIRE_API`                           | `chat_completions`（默认）或 `responses`         |
| `AI_PROVIDER_<ID>_REASONING_EFFORT`                   | 可选：`none`、`low`、`high` 或 `max`             |
| `AI_PROVIDER_<ID>_TIMEOUT_MS`                         | 单个 Provider 超时，范围 1000–25000 毫秒         |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 配额、限流、票据和幂等缓存                       |
| `ANON_SESSION_KEYS`                                   | `v2:至少32字符密钥,v1:旧密钥`，第一项用于签发    |
| `ACTOR_HASH_SECRET`                                   | actor 不可逆摘要和上传路径隔离                   |
| `AI_CACHE_ENCRYPTION_KEY`                             | 32 字节随机值的 Base64，保护 24 小时幂等响应     |
| `CRON_SECRET`                                         | Vercel Cron 调用保留任务的 Bearer 密钥           |
| `APP_ORIGINS`                                         | 逗号分隔的完整允许 origin                        |

Provider 按 `AI_PROVIDERS` 的声明顺序尝试。仅当当前 Provider 超时、网络失败或返回供应商错误时才切换；模型成功返回但 DSL 非法时，仍由现有的一次纠错流程处理。`GEMINI_API_KEY`、`AI_MODEL` 和 `AI_TIMEOUT_MS` 仅用于兼容旧部署；声明 `AI_PROVIDERS` 后不再读取它们。

生产 Prompt 的唯一来源是 `skills/canvas-tutor-planner/references/prompt-registry.json`。`AI_PROMPT_VERSION` 必须指向其中真实存在的版本；未知版本会让健康检查返回 AI `degraded`，Tutor API 返回依赖未配置，避免审计元数据与实际 Prompt 内容不一致。

Provider 链最多配置 3 个节点，累计超时预算不得超过 25 秒；未单独设置超时时，预算会在节点间平均分配。Tutor Function 时限为 60 秒，用于容纳一次正常调用和至多一次既有格式纠错，不应依靠平台时限代替 Provider 超时。

OpenAI、DeepSeek、通义千问、Moonshot、OpenRouter、Groq 与本地服务共用 `openai-compatible` 适配器。不同供应商对结构化输出的支持不同：优先使用 `json_schema`，不支持时改为 `json_object`，仍不支持时使用 `prompt`。DeepSeek 的 `deepseek-flash` 应配置 `WIRE_API=responses`、`RESPONSE_FORMAT=json_schema`、`REASONING_EFFORT=none`，以获得图文输入、严格结构和适合交互场景的延迟。所选模型必须支持图片输入，才能处理题图。

建议用密码管理器生成独立随机密钥；不要复用 Supabase、Redis 或 AI Provider 凭据。

## 启动

只预览前端（登录和 AI API 不可用）：

```powershell
pnpm dev
```

浏览器打开 `http://127.0.0.1:5173/`。

运行本地 Supabase：

```powershell
pnpm db:start
pnpm db:verify
```

`db:start` 输出的本地 URL 与 anon/service-role key 需要填入 `.env.local`。运行包含 Vercel Functions 的完整本地栈可使用：

```powershell
pnpm dlx vercel@latest dev
```

完整栈的实际端口以 Vercel CLI 输出为准，并将该 origin 写入 `APP_ORIGINS`。

## 调用示例

健康检查：

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

建立游客会话：

```powershell
Invoke-WebRequest http://localhost:3000/api/anonymous/session `
  -Method Post `
  -Headers @{ Origin = "http://localhost:3000" } `
  -SessionVariable EasySession
```

使用游客 cookie 请求文字解题：

```powershell
$Body = @{
  requestId = [guid]::NewGuid().ToString()
  schemaVersion = 1
  boardId = "local_demo"
  mode = "solve"
  text = "2x + 3 = 11"
  locale = "zh-CN"
  source = @{
    elementIds = @("element-1")
    selectionBounds = @{ x = 0; y = 0; width = 120; height = 40 }
    contentHash = "demo-hash"
  }
} | ConvertTo-Json -Depth 6

Invoke-RestMethod http://localhost:3000/api/ai/tutor `
  -Method Post `
  -Headers @{ Origin = "http://localhost:3000" } `
  -ContentType "application/json" `
  -WebSession $EasySession `
  -Body $Body
```

真实调用会消耗一次有效配额；相同 `requestId` 的幂等重试不会重复扣减。

## 质量检查

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm db:static
pnpm db:verify       # 需要 Docker 与本地 Supabase
pnpm build
pnpm audit:dependencies
pnpm check
```

当前本地结果：15 个测试文件、65 个测试用例通过；数据库静态契约覆盖 6 张表和 40 项 pgTAP 断言。详细范围见 [单元测试报告](docs/04-单元测试报告.md)。

## Vercel 部署

1. 创建独立的 Preview 与 Production Supabase/Redis 资源，不允许 Preview 连接生产数据。
2. 在 Supabase 应用迁移并执行 RLS/Storage 测试。
3. 在 Vercel 分环境录入 `.env.example` 中的变量，确认 service role 没有 `VITE_` 前缀。
4. 配置 Supabase Site URL、OAuth callback 和允许 origin；启用所需 Google/GitHub provider。
5. 从 Preview 部署开始，验证 `/api/health`、登录、画板 CRUD、图片恢复、AI 配额和账户删除冷静期。
6. 检查 CSP、HSTS、Referrer-Policy、Permissions-Policy、`nosniff` 和静态资源缓存头。
7. 完成数据库备份恢复、应用回滚、migration 回滚兼容和账户删除演练后，再逐步放量。

仓库的 `vercel.json` 提供 SPA deep link、函数时限、小时级保留任务、安全响应头和静态资源缓存。该配置依据 Vercel 官方 Vite SPA 与项目配置格式编写；生产发布仍需在实际 Preview 域名验证。

## 数据保留摘要

- 活跃画板与图片：保留至用户删除画板或账户。
- 已删除画板关联图片：24 小时内清理。
- 账户删除：7 天冷静期；期满后主数据 24 小时内删除。
- 已删除账户的灾难恢复备份：最长 30 天。
- AI 运行元数据：90 天；安全与权限审计日志：180 天。
- 匿名限流标识：最后活动后 48 小时；幂等响应：最长 24 小时。

详细说明见应用内 `/privacy` 与 [需求决策记录](docs/01-需求评审与决策记录.md)。

## 常见问题

### 页面能打开，但登录按钮不可用

未设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。这是预期的安全降级，界面会保留预览但不会伪造登录。

### 画布能用，但 AI 请求返回服务未配置

前端 Vite 服务不包含 `/api` Functions，或 AI Provider/Redis/Supabase 服务端变量不完整。使用 Vercel CLI 启动完整栈，并检查 `/api/health` 的 `degraded` 项。

### 为什么本地 Node 会出现 engine 警告

仓库固定 Node `24.21.0`。其他 24.x 版本可能暂时能运行，但正式检查和部署应切换到冻结版本，避免原生 API 或构建行为差异。

### 离线编辑会丢失吗

画布先写 IndexedDB，再尝试云同步。离线时 outbox 保留，恢复网络后重试；本地写失败会阻断云覆盖并提示先导出副本。

### revision 冲突如何处理

应用不会强制覆盖云端，会保存本地冲突副本。MVP 的恢复路径是打开云端版本、把本地版本另存为新画板，或下载本地完整备份。

### 如何清理本地 Supabase

```powershell
pnpm db:stop
```

不要手工删除仓库或 Docker 数据目录来代替正常停止流程。

## 文档

- [需求评审与决策记录](docs/01-需求评审与决策记录.md)
- [系统方案设计](docs/02-方案设计.md)
- [单元测试报告](docs/04-单元测试报告.md)
- [最新开发节点记录](docs/progress/03-23-生产AI与辅导板验收.md)

## 当前发布边界

本地代码完成不等于生产发布完成。DeepSeek `deepseek-flash` 的文字、PNG 图文、结构化输出和一次纠错已经过真实 API 验收；仍需外部资源的事项包括：OAuth、云端 RLS/Storage E2E、其他启用 Provider 的黄金题集与 Provider 间回退演练、Redis 配额、Sentry 告警、Vercel Preview 安全头、域名、备份恢复和灰度观察。所有这些必须用对应环境的证据单独验收。
