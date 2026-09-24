最近我完成了一个叫 **Easy to learn** 的项目。

它不是另一个“输入问题、等待答案”的聊天机器人，而是一块可以直接写字、画图、粘贴题目，并让 AI 在原题旁边提供提示和分步讲解的学习画布。

> 让答案靠近问题，让学习留在画布。

![Easy to learn 的 AI 辅导界面与吉祥物小易](https://raw.githubusercontent.com/zhenglinniao/Easy-to-learn/main/docs/assets/blog/home-hero-product.png)

*在原题附近出现分步辅导，减少画布和聊天窗口之间的来回切换。*

## 为什么想做这个项目？

使用通用 AI 学习时，我经常遇到一个问题：题目在课本、截图或草稿里，提问却发生在另一个聊天窗口。

复制题目、补充上下文、切换页面、再把答案搬回笔记——每一步都在打断原本连续的思考过程。尤其面对几何图、物理受力图、手写草稿或流程图时，纯文字对话很难保留问题原来的空间关系。

Easy to learn 的核心想法很简单：**学习者不必离开正在思考的地方。**

用户可以把文字、图形、手写内容和图片放进无限画布，圈选真正需要帮助的部分，再选择“解题”“提示”或“解释步骤”。AI 的反馈会作为辅导板出现在原内容附近，而不是把用户带到另一个页面。

## 它是怎么使用的？

下面是真实运行中的学习画布。我在画布中输入了一个简单方程，文字被选中后，可以继续触发对应的 AI 学习操作。

![Easy to learn 实际运行的无限画布](https://raw.githubusercontent.com/zhenglinniao/Easy-to-learn/main/docs/assets/blog/canvas-workspace.png)

*真实画板支持文字、自由书写、基础图形、箭头和图片等内容。游客数据默认保存在本机。*

完整流程只有四步：

1. 在画布中写下问题，或者粘贴课本、练习册截图。
2. 用选择工具圈选文字、手写、图形或图片。
3. 选择“解题”“提示”或“解释步骤”。
4. 在原题旁逐步阅读；登录后还可以保存画板并继续学习。

这里的目标不是让 AI 尽快替用户完成题目，而是让它根据当前场景提供合适层级的帮助：卡住时先给方向，需要核对时展示步骤，某一步没看懂时再单独解释。

## 不只适用于数学题

画布天然适合表达带有空间关系的信息，所以 Easy to learn 并没有把使用场景限制在公式计算上。

![Easy to learn 的三类主要应用场景](https://raw.githubusercontent.com/zhenglinniao/Easy-to-learn/main/docs/assets/blog/use-cases.png)

*题图提示、贴图推理和跨设备复习，是目前重点设计的三类使用场景。*

### 1. 作业卡住时：先要一条提示

把练习册截图贴进画布，只圈住卡住的部分。选择 `Hint` 后先获得解题方向，仍然没有思路时，再展开完整步骤。

这种方式适合数学计算、应用题，以及带有插图的理化题目。

### 2. 课堂与自学：让推理贴着图走

几何图、函数草图、受力图和流程图可以直接画在画布上。辅导板锚定在原图附近，移动和缩放画布时，问题与解释依然保持上下文关系。

### 3. 复习与持续学习：从上次的位置继续

登录用户可以保存多个画板。题图、画布内容和辅导步骤会一起恢复，适合错题整理、长期课题以及跨设备复习。

## 我重点实现了哪些功能？

- **无限学习画布**：基于 Excalidraw，支持文字、手写、图形、箭头与图片混合编辑。
- **就地 AI 辅导**：选区完成后直接触发解题、提示或步骤解释，不离开当前上下文。
- **受控结果渲染**：AI 输出使用受约束的 Tutor DSL、KaTeX 和受限图表渲染，不直接注入模型生成的 HTML。
- **本地优先存储**：游客无需注册即可使用，画板和图片保存在浏览器 IndexedDB。
- **云端画板**：登录后支持创建、重命名、打开和删除多个私有画板。
- **离线与冲突保护**：本地事务完成后再同步；多标签页冲突时保留本地副本，不静默覆盖云端版本。
- **完整备份**：支持标准 `.excalidraw` 文件和包含辅导信息的 `.easy-to-learn.json` 备份。
- **多模型接入**：支持 Gemini 与 OpenAI-compatible Provider 链，可以连接 OpenAI、DeepSeek、通义千问、Moonshot、OpenRouter、Groq 或本地模型服务。
- **限流与配额**：游客和登录用户每天各有 3 次有效 AI 请求，同一身份每 5 分钟最多请求一次。
- **无障碍与动效降级**：支持键盘焦点、亮色/深色主题、窄屏布局与 `prefers-reduced-motion`。

## 技术实现

项目采用 TypeScript Monorepo，前后端共享领域协议：

```text
React 19 + Vite 8
        │
        ├── Excalidraw 学习画布
        ├── IndexedDB 本地持久化
        └── Vercel Functions
                 │
                 ├── Supabase Auth / Postgres / Storage
                 ├── Upstash Redis 配额与幂等缓存
                 └── Gemini / OpenAI-compatible Provider
```

前端主要使用 React、TypeScript、Vite、Excalidraw、Zod 和 KaTeX；服务端运行在 Vercel Functions，数据层使用 Supabase，配额与幂等缓存使用 Upstash Redis。

AI 接入层没有绑定单一模型。多个 Provider 可以按照配置顺序尝试，遇到超时、网络错误或供应商故障时自动回退。这样即使未来更换模型，也不需要重写画布和业务层。

## 数据与安全设计

这是一个面向全年龄用户的学习产品，所以我没有把安全和隐私留到最后再补：

- 浏览器只接收公开配置，Service Role 和模型密钥仅存在于服务端。
- Supabase 使用 RLS 和 Storage Policy 隔离不同用户的数据。
- AI 临时图片会在任务完成后清理，模型输出不会被当作可信 HTML 渲染。
- 账户删除包含 7 天冷静期，期满后进入删除流程。
- AI 运行元数据保留 90 天，安全审计日志保留 180 天。
- 页面配置了 CSP、HSTS、`nosniff`、Referrer Policy 与 Permissions Policy。

## 测试与当前进度

当前项目已经完成本地 MVP、单元测试、数据库契约和 Vercel 演示部署：

- 26 个测试文件通过，1 个真实供应商测试文件按环境开关跳过。
- 119 个测试用例通过，5 个真实供应商用例跳过。
- 数据库静态契约覆盖 6 张表和 43 项 pgTAP 断言。
- 首页、学习画布和健康检查接口已在线验证。

需要特别说明的是：当前公开地址是**功能演示环境**。官网和游客本地画板可以直接体验，但线上尚未配置 Supabase、Redis 与 AI Provider 密钥，因此云登录、云同步和真实 AI 请求暂时处于安全降级状态。

另外，项目设计的数据保留任务要求每小时执行一次，而当前 Vercel Hobby 计划只支持每日 Cron。正式上线时需要升级计划，或者接入能够安全携带 `CRON_SECRET` 的外部小时级调度器。

## 在线体验与源码

- 在线演示：[https://easy-to-learn-steel.vercel.app](https://easy-to-learn-steel.vercel.app)
- GitHub：[https://github.com/zhenglinniao/Easy-to-learn](https://github.com/zhenglinniao/Easy-to-learn)

Easy to learn 仍然在继续迭代。接下来我会重点完成真实云服务环境的端到端验收、多模型黄金题集测试，以及更自然的画布内辅导交互。

如果你也在思考 AI 应该怎样参与学习，我很想听听你的意见：你更希望 AI 直接给出答案，还是先在恰当的时候给你一条提示？
