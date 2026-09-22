# 阶段 3 / 节点 4：Supabase 数据层

- 状态：实现完成；本机数据库运行验证待环境补齐
- 日期：2026-09-22
- 范围：Postgres migration、RLS、画板 RPC、私有 Storage、清理队列、保留期和 pgTAP 权限测试

## 完成内容

- 增加可提交的 Supabase 本地配置，并精确锁定项目级 Supabase CLI `2.117.0`。
- 建立 `boards`、`board_assets`、`account_deletion_requests`、`ai_feedback`、`security_audit_events` 和 `asset_cleanup_jobs` 六张表。
- 实现标题、revision、schema version、图片 MIME/尺寸/32 MP、单资产 10 MiB、单画板 100 MiB 和单用户 1 GiB 等数据库约束。
- 所有业务表启用并强制 RLS；普通登录用户只能读取自己的画板、资产和 pending 删除请求。
- 实现 `create_board`、`rename_board`、`save_board` 和 `delete_board` 原子 RPC。
- `save_board` 使用行锁和 expected revision，校验 V2 外层结构、Excalidraw 元素类型、资产清单、私有路径及容量，然后原子递增 revision。
- `delete_board` 在删除数据库记录前写入可重试资产清理任务；Storage 删除失败不会恢复已确认删除的画板。
- `save_board` 对新 manifest 不再引用的旧资产写入 24 小时延迟清理任务，避免覆盖保存遗留孤儿对象。
- 建立私有 `board-assets` 和 `ai-temp` bucket；登录用户只能操作路径属于自己画板的普通资产，`ai-temp` 不开放普通用户策略。
- 补齐原始需求中的无内容安全审计表，登录用户不能读取；保留期为 180 天。
- 实现受控保留期清理函数：AI 反馈 90 天、安全审计 180 天、已完成资产清理任务 30 天；仅 `service_role` 可执行。
- 增加 40 项 pgTAP 断言，覆盖表、函数、强制 RLS、跨用户 CRUD/RPC、Storage 越权、敏感表访问和删除清理队列。

## 安全边界

- 所有 `SECURITY DEFINER` 函数固定 `search_path = ''` 并使用完全限定对象名。
- RPC 撤销 `public` 和 `anon` 的默认执行权，只向明确角色授权。
- 登录用户不拥有画板、资产和账户删除表的直接写权限，避免绕过 revision、配额和服务端状态机。
- `security_audit_events` 不提供任意 metadata 字段，只允许 actor hash、事件、结果、目标 hash、request ID 和错误码，避免误存题目、图片、令牌或供应商正文。
- 资产路径固定为 `<ownerId>/<boardId>/<contentHash>`，Storage policy 和保存 RPC 分别校验所有权。

## 验证结果

| 检查 | 结果 |
|---|---|
| 数据库契约静态检查 | 通过：6 张表、40 项 pgTAP 断言，plan 数量一致 |
| 全仓库 `pnpm check` | 通过：peer、lint、类型检查、15 个 Vitest、数据库静态检查、构建、格式 |
| `pnpm audit --audit-level high` | 通过，0 known vulnerability |
| pgTAP 数据库执行 | 未执行；Supabase CLI 未能加载本机 Windows 平台二进制 |
| Postgres/Storage 真实策略执行 | 未执行；本机没有 Docker 兼容运行时或独立 Postgres |

`pnpm db:test` 在连接数据库前失败，错误为 `No matching Supabase CLI binary package found for win32-x64`。安装过程中对应约 137 MB 的可选平台包下载失败；仓库中的 CLI 版本、migration、配置和测试文件均已锁定，但不能把静态检查记作数据库运行测试通过。

环境补齐后的标准验证顺序：

```text
pnpm install
pnpm db:start
pnpm db:verify
```

其中 `db:verify` 会重放 migration、运行 Postgres lint，并执行全部 pgTAP 测试。生产发布前仍必须按阶段 1 要求进行非实现者安全复核。

## 下一节点

节点 5 按设计文档实现 IndexedDB、本地事务、outbox、资产前置、同步状态机和 revision conflict copy；该节点不依赖远程 Supabase 项目。
