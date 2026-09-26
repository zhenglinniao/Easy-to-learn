# SenseNova 多模态理解与生图接入设计

## 1. 目标与边界

本节点将商汤日日新接入 Easy to learn，用于两类彼此独立的能力：

1. **画布理解与教学规划**：读取用户圈选的文字、手写、图形或图片，识别内容类型，生成符合 Tutor DSL 的分步讲解计划。
2. **教学插画生成**：根据已经通过服务端校验的视觉简报生成原创、可爱、手绘风格的辅助插画。

本节点不允许图片模型直接决定答案、公式、代码、坐标、步骤顺序或交互逻辑。所有可验证内容继续由结构化 Tutor DSL、KaTeX 和受控矢量图渲染。图片只是解释载体之一，生成失败时仍必须能展示完整、正确的文字与矢量讲解。

## 2. 官方能力核对结论

- 日日新融合模态模型支持文字和图片输入；官方兼容模式提供 OpenAI 风格的 `/chat/completions` 接口。
- 官方原生接口允许使用 `image_url`、`image_file_id` 或 `image_base64` 传入图片；具体格式由所选接口决定。
- 文生图是独立能力，不通过普通 Chat Completions 返回图片。平台旧版秒画接口和新 Token Plan/U1 系列的端点、模型名与授权可能不同。
- 模型列表和账户已开通能力必须在联调时实时读取，不能在业务代码里猜测模型 ID。
- 商汤官方 SenseNova-Skills 也将 Text、Vision 和 Image Generation 拆成独立配置，并允许分别设置密钥、模型和 Base URL；本项目沿用这一隔离原则，但不直接把外部 Skill 当作线上运行时依赖。

## 3. 核心架构决策

### 3.1 两条 Provider 链

```text
用户画布选区
    |
    v
SenseNova Vision / Chat ----> TutorPlan JSON ----> Zod 校验与一次纠错
                                              |
                                              +--> Tutor DSL：文字、公式、代码、流程图、结构图
                                              |
                                              +--> VisualBrief：仅描述插画意图
                                                               |
                                                               v
                                              SenseNova Image Provider
                                                               |
                                                               v
                                              图片校验、私有存储、资产引用
```

理解模型和生图模型必须分别配置、分别熔断、分别记录成本。生图故障不得触发整份答案改由另一个文字模型重算，也不得让已验证的教学结果消失。

### 3.2 不让生图模型绘制关键文字

生图提示词默认要求 `no text, no formula, no watermark, no logo`。标题、步骤说明、数学公式、代码、数值、坐标刻度和部件标签由前端叠加。

原因：生图模型即使支持中文，也不能作为精确教学内容的事实来源。尤其是数学、物理、代码与结构标注，一处字符错误就可能改变答案。

### 3.3 每一步都有视觉，但不强制每一步都调用生图

视觉策略由服务端规则决定，模型只能提出建议：

| 内容 | 默认视觉方式 | 说明 |
| --- | --- | --- |
| 数学、几何、函数、统计图 | `hybrid` | Q 版角色和场景可生图；公式、图形、坐标用 Tutor DSL 精确绘制 |
| 编程与流程 | `vector` | 代码块和流程图必须可复制、可校验；使用内置吉祥物增强趣味 |
| 食物、蔬果、物体、服装、设备 | `generated` 或 `hybrid` | 可生成剖面、爆炸图或场景插画，标签由前端叠加 |
| 文章与抽象概念 | `vector` 或 `generated` | 优先关系图；只有具象类比能明显帮助理解时才生图 |
| 安全敏感、身份不明的人脸、医疗诊断 | `vector` | 不进行换脸或高风险视觉生成 |

简单题默认一张主插画；复杂题最多生成两张插画。超过两步时，其余步骤使用现有 `comic-strip`、`part-map`、流程图和原创“小易”姿态，保证每步图文结合而不让一次请求无限增加成本与等待时间。

## 4. 业务流程

### 4.1 请求准备

1. 客户端继续使用现有选区管线，提取文字并导出 PNG/JPEG。
2. 服务端完成身份、画板权限、每日三次和五分钟冷却校验。
3. 大图继续走一次性私有上传票据；任何供应商调用前都由服务端读取，浏览器永远不接触 Provider 密钥。
4. 使用 `requestId` 保证幂等，同一请求不能重复创建生图任务。

### 4.2 内容理解与教学规划

规划模型必须返回新的 Tutor DSL v6 草案，除现有字段外增加内部视觉计划：

```ts
interface VisualBrief {
  stepId: string;
  renderMode: 'vector' | 'generated' | 'hybrid';
  purpose: 'concept' | 'mascot-scene' | 'exploded-view' | 'layers' | 'process';
  subject: string;
  composition: string;
  mustShow: string[];
  mustNotShow: string[];
  overlayLabels: Array<{ anchor: string; text: string }>;
  aspectRatio: '1:1' | '4:3' | '3:4' | '16:9';
}
```

`VisualBrief` 只描述需要表达的概念，不能包含用户邮箱、账户 ID、密钥、完整原题、上传路径或可执行内容。服务端策略引擎会覆盖不合理的 `renderMode`，并把精确文字从图片提示词中剥离为 `overlayLabels`。

### 4.3 规划校验

1. 继续使用 Zod 严格校验 Tutor DSL。
2. 保留一次格式纠错，但纠错消息只发送字段路径和规则，不回传用户原文或图片。
3. 先验证知识结构，再提交生图。未通过校验的规划禁止产生图片费用。
4. 数学题额外验证：每一步必须包含准确 `math` 块和图解块；生图不能代替推导。

### 4.4 生图提示词编译

服务端使用固定模板把 `VisualBrief` 编译成图片提示词，而不是直接把用户原文发送给生图模型：

```text
原创儿童友好的手绘教学插画，暖色纸张质感，清晰粗线条，Q 版小易作为引导角色。
教学目的：{purpose}
主体：{subject}
构图：{composition}
必须出现：{mustShow}
禁止出现：真实品牌、现成角色、Logo、水印、界面按钮、公式、代码、可读文字。
留出标签空间：{overlayAnchors}
```

负面提示词固定包含：写实恐怖、血腥、成人内容、歧视符号、品牌 Logo、水印、乱码文字、多余肢体、遮挡主体、低对比度。

### 4.5 异步生图

图片生成不塞进现有 25 秒文字 Provider 超时预算。处理状态为：

```text
analyzing
  -> plan_validated
  -> image_tasks_submitted
  -> text_ready
  -> generating
  -> validating_assets
  -> ready | partial | failed
```

建议接口：

- `POST /api/ai/tutor`：生成并验证教学计划；提交需要的图片任务；立即返回可展示的 Tutor DSL 和可选 `renderJobs`。
- `GET /api/ai/render-jobs/:id`：查询图片任务。完成时由服务端下载、校验并保存图片，再返回资产状态。
- `POST /api/ai/render-jobs/:id/retry`：仅对可重试错误允许一次重试，不再次扣除当日 AI 次数。

Vercel 响应结束后不能依赖未托管的后台 Promise。轮询与最终入库必须发生在后续函数请求或持久任务系统中；首版使用客户端退避轮询，后续有队列资源时再替换为队列消费者。

轮询节奏建议为 2、3、5、8、12 秒，最长 60 秒。离开页面后停止轮询，重新打开画板可凭任务 ID 恢复。

### 4.6 图片验收与存储

供应商返回的 URL 不能直接写入画板或长期展示。服务端必须：

1. 只允许从配置的商汤域名下载，防止 SSRF。
2. 限制响应体大小、连接超时和重定向次数。
3. 校验文件魔数、MIME、像素尺寸和最大像素数，不能只信 `Content-Type`。
4. 删除 EXIF 等元数据，统一转成 WebP 或 PNG。
5. 计算 SHA-256，写入现有私有 `board-assets` 存储与 manifest。
6. 前端只接收 `assetId` 或短期签名 URL，不接收供应商永久 URL。
7. 登录用户的生成图片随画板保留并随画板/账户删除；游客图片仅保存在 IndexedDB，供应商临时 URL 不进入快照。

新增 Tutor 块建议为：

```ts
interface TutorIllustrationBlock {
  type: 'illustration';
  assetId: string;
  stepId: string;
  alt: string;
  caption?: string;
  presentation: 'card' | 'background' | 'exploded-view';
}
```

`assetId` 必须属于当前画板。模型不得返回 URL、Base64、HTML、SVG 或存储路径。

## 5. Provider 配置设计

### 5.1 理解模型

日日新兼容模式可先复用现有 `openai-compatible` 适配器：

```dotenv
AI_PROVIDERS=sensenova,deepseek
AI_PROVIDER_SENSENOVA_TYPE=openai-compatible
AI_PROVIDER_SENSENOVA_BASE_URL=https://api.sensenova.cn/compatible-mode/v2
AI_PROVIDER_SENSENOVA_API_KEY=仅配置在服务端 Secret
AI_PROVIDER_SENSENOVA_MODEL=从账户模型列表确认
AI_PROVIDER_SENSENOVA_WIRE_API=chat_completions
AI_PROVIDER_SENSENOVA_RESPONSE_FORMAT=prompt
AI_PROVIDER_SENSENOVA_TIMEOUT_MS=15000
```

在真实联调证明该账户支持 JSON Schema 后，才能把 `RESPONSE_FORMAT` 改为 `json_schema`。若兼容模式不接受 Data URL，则新增原生 `sensenova` 适配器，通过官方 `image_base64` 格式发送图片，不把私有图片改成公网 URL。

### 5.2 生图模型

生图配置独立于 `AI_PROVIDERS`：

```dotenv
AI_IMAGE_PROVIDER=sensenova
AI_IMAGE_SENSENOVA_BASE_URL=由账户已开通产品确认
AI_IMAGE_SENSENOVA_API_KEY=仅配置在服务端 Secret
AI_IMAGE_SENSENOVA_MODEL=通过模型列表取得
AI_IMAGE_SENSENOVA_PROTOCOL=token-plan
AI_IMAGE_MAX_PER_REQUEST=2
AI_IMAGE_TIMEOUT_MS=60000
```

`AI_IMAGE_SENSENOVA_PROTOCOL` 首版支持两个适配器：

- `token-plan`：用于当前 U1/U1.5 生图网关。
- `miaohua-async`：用于平台文档中的秒画异步任务接口。

业务层只依赖统一的 `ImageGenerationProvider`，不感知具体端点：

```ts
interface ImageGenerationProvider {
  submit(input: ImageGenerationInput): Promise<{ providerTaskId: string }>;
  poll(providerTaskId: string): Promise<ImageGenerationStatus>;
  cancel?(providerTaskId: string): Promise<void>;
}
```

同一 Key 是否同时具有 Chat、Vision 和 Image 权限必须以模型列表和一次最小联调为准，不能假设。

## 6. 配额、成本与降级

- 一次用户“解题/提示/解释步骤”仍只扣一次产品 AI 次数；内部规划和生图不分别扣产品次数，但生成图片使用独立的张数额度。
- 免费期游客每日 3 次且每 5 分钟 1 次，登录用户每日 10 次且无请求间隔；另外增加 30 天封顶和全站预算熔断。
- 简单题最多 1 张生成图，复杂题最多 2 张；默认 2K 以下展示尺寸，不为画布生成 4K 原图。
- 图片生成失败可自动重试一次，不切换文字 Provider，不重新生成整份答案。
- 生图超时后页面显示“插画仍在生成”或“插画暂时不可用”，文字、公式和矢量图继续可用。
- 达到成本阈值或供应商限流时，策略引擎自动将 `generated` 降级为 `vector`，不能显示空白卡片。
- 记录 provider、model、耗时、状态、图片数和估算成本；日志不记录题目、图片、提示词正文、URL、Base64 或密钥。

完整额度、扣额、返还、全站预算与接口契约见 [AI 使用额度与成本控制设计](08-AI使用额度与成本控制设计.md)。

## 7. 安全与合规

- 用户提供的 Key 只能保存到本地 `.env` 或 Vercel Secret；不得写入浏览器变量、Git、日志或错误响应。
- 对当前已在对话中出现的 Key，必须先撤销并新建，禁止继续用于正式联调。
- 服务端在提交前执行输入安全分类；供应商安全拒绝视为不可重试业务错误。
- 禁止生成色情、血腥、仇恨、自残指导、违法教程、冒充真人、未经同意的换脸和侵犯版权的现成角色。
- 面向全年龄用户，涉及医疗、营养和安全风险的内容必须显示非诊断提示，并保留事实型文字说明。
- 参考图片只提取主题与结构，不要求复刻作者风格、账号、品牌、Logo、水印或具体作品构图。

## 8. 测试与验收

### 8.1 单元与契约测试

- SenseNova Chat 请求：纯文字、Base64 图片、超时、401、429、5xx、非 JSON、错误 JSON。
- Tutor DSL v6：视觉计划、`illustration` 块、资产归属、URL/Base64 注入拒绝。
- 图片任务：提交、轮询、完成、失败、超时、重复 requestId、不支持模型。
- 文件校验：伪造 MIME、超大文件、坏图、过多像素、恶意重定向、非允许域名。
- 降级：图片失败时 Tutor DSL 仍完整，生成模式正确回落到矢量图。

### 8.2 真实黄金集

真实调用必须单独用环境开关运行，默认测试不消耗额度。至少覆盖：

1. 一元一次方程：准确公式 + 每步 Q 版视觉，不把公式画进图片。
2. 几何题：几何图由 DSL 精确绘制，图片只负责情境。
3. Java Class：代码可复制，流程和角色插画不改变代码。
4. 番茄：营养结构图，标签文字由前端叠加。
5. 汉堡/香水瓶：爆炸拆解图与部件标签锚点对应。
6. 用户上传 PNG：多模态识别正确，图片不被意外公开。
7. 不安全输入：正确拒绝且日志脱敏。

验收指标：Tutor DSL 通过率、关键事实正确率、图片成功率、图片平均/95 分位等待时间、每次请求平均图片数、单次估算成本、降级率。没有真实测量数据前不设虚假的通过阈值。

## 9. 实施顺序

1. 撤销已经暴露的 Key，创建新的测试 Key，并确认已开通的 Chat/Vision/Image 模型列表。
2. 先将 SenseNova 作为后备文字 Provider 跑通现有 v5 黄金集，不立即替换生产主模型。
3. 新增独立 Image Provider、任务状态和下载校验，先在开发环境生成单张插画。
4. 升级 Tutor DSL v6 与前端 `illustration` 块，完成失败降级。
5. 跑完整黄金集、成本和延迟观测；通过后再把 SenseNova 调整为生产主 Provider。
6. 保留 DeepSeek 作为可配置后备至少一个发布周期，稳定后再决定是否移除。

## 10. 开发所需资源

- 已撤销旧 Key 后重新生成的服务端测试 Key。
- 控制台中该 Key 可用的 Chat/Vision 模型 ID 列表截图或接口结果。
- 控制台中已开通的生图产品、协议类型、模型 ID、免费额度/计费与并发限制。
- 若 Chat 与生图使用不同网关或不同 Key，需要分别提供并配置到本地 Secret；不要再次粘贴到对话或提交到仓库。
