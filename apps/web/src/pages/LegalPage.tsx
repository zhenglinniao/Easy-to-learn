import { Link } from 'react-router-dom';

import { SiteHeader } from './SiteHeader';
import styles from './pages.module.css';

export default function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const privacy = kind === 'privacy';
  return (
    <main className={styles.page}>
      <SiteHeader />
      <article className={styles.legalPage}>
        <p className={styles.eyebrow}>{privacy ? '隐私说明' : '使用条款'}</p>
        <h1>{privacy ? '我们怎样处理你的学习数据' : '使用 Easy to learn 前请了解'}</h1>
        <p className={styles.legalUpdated}>更新日期：2026 年 9 月 26 日</p>
        {privacy ? <PrivacyContent /> : <TermsContent />}
        <p>
          <Link to="/">返回首页</Link>
        </p>
      </article>
    </main>
  );
}

function PrivacyContent() {
  return (
    <>
      <h2>我们处理哪些数据</h2>
      <p>
        游客画板保存在当前设备。登录后，账户标识、画板快照、图片和辅导板保存在私有云空间。AI
        请求会处理你主动圈选的文字或图片；运行元数据不保存题目、图片、Base64、JWT 或签名 URL。
      </p>
      <h2>用途与共享</h2>
      <p>
        数据仅用于认证、保存画板、提供 AI 辅导、限流、防滥用和故障排查。服务依赖
        Supabase、Vercel、Upstash Redis 与部署时选定的 AI
        模型供应商；具体供应商可能随服务配置调整。我们不出售个人数据，也不建立包含用户题图的人工审核队列。
      </p>
      <p>
        官网访问统计使用服务端签发的随机标识生成不可逆摘要，只统计访问会话和匿名聚合数量；不保存
        IP、完整 User-Agent、页面查询参数、题目或画布内容。浏览器启用“请勿追踪”时不会发送访问事件。
      </p>
      <h2>保留期限</h2>
      <ul>
        <li>活跃画板和图片保留至你删除画板或账户；已删画板的关联图片在 24 小时内清理。</li>
        <li>账户删除有 7 天冷静期；期满后主数据在 24 小时内删除，灾难恢复备份最长保留 30 天。</li>
        <li>AI 运行元数据保留 90 天，安全与权限审计日志保留 180 天。</li>
        <li>匿名限流标识在最后活动 48 小时后清理，幂等响应最长保留 24 小时。</li>
        <li>访问统计的匿名访客摘要保留 90 天；无法关联个人的每日聚合计数长期保留。</li>
      </ul>
      <h2>你的选择</h2>
      <p>
        你可以导出标准 .excalidraw
        文件、删除画板、申请删除账户，并在冷静期内取消。未成年人应在当地法律要求时取得监护人同意。
      </p>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <h2>服务定位</h2>
      <p>
        Easy to learn 是全年龄学习辅助工具。AI
        输出可能出错，不应作为医疗、法律、财务或其他高风险决定的唯一依据；重要结论请向老师或相关专业人士核实。
      </p>
      <h2>合理使用</h2>
      <p>
        请勿上传无权处理的内容、尝试绕过配额或安全边界、干扰服务，或将服务用于违法及伤害他人的活动。游客每天有
        3 次有效 AI 请求且每 5 分钟最多 1 次；登录用户每天有 10 次有效 AI 请求，无请求间隔限制。
      </p>
      <h2>账户与内容</h2>
      <p>
        你应保护自己的登录凭据，并对提交的内容拥有必要权利。画板删除为硬删除且没有回收站；请在删除前使用导出功能保存副本。
      </p>
      <h2>可用性与变更</h2>
      <p>
        网络、模型或第三方依赖可能导致暂时不可用。我们会优先保护本地草稿，并在影响数据处理或用户权利时更新本说明。
      </p>
    </>
  );
}
