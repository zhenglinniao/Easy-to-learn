import { Link } from 'react-router-dom';
import { ProductMetrics } from '../features/analytics/ProductMetrics';
import { ApplicationScenes } from './ApplicationScenes';
import { LearningCompanion } from './LearningCompanion';
import { SiteHeader } from './SiteHeader';
import styles from './pages.module.css';

const features = [
  ['径向 AI 菜单', '圈选题目，就地选择解题或提示，不必在聊天窗口与画布之间来回切换。'],
  ['分步辅导板', '答案锚定在原题旁边，可以拖动、逐步阅读，也可以继续追问某一步。'],
  ['画出来，或直接粘贴', '支持文字、手写、几何图形与课本截图，让思考保持原来的样子。'],
  ['登录后自动保存', '画板、图片和辅导步骤一起恢复，下一次从上次思考的位置继续。'],
] as const;
const steps = [
  '画出或粘贴题目',
  '圈选并选择 AI 操作',
  '在原题旁分步学习',
  '登录保存，下次继续',
] as const;

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <SiteHeader />
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>AI 学习画布</p>
          <h1>
            思考不必离开
            <br />
            正在发生的地方。
          </h1>
          <p className={styles.heroLead}>
            Easy to learn 把中文 AI
            导师放进无限画布。画题、圈选、获得提示或分步解答，所有内容都留在同一片思考空间里。
          </p>
          <div className={styles.ctas}>
            <Link className={styles.primaryButton} to="/canvas">
              游客直接使用
            </Link>
            <Link className={styles.secondaryButton} to="/login?redirect=/boards">
              登录并云端保存
            </Link>
          </div>
          <small>游客也可使用，每天 3 次 AI 请求 · 每 5 分钟 1 次</small>
        </div>
        <div className={styles.heroCanvas} aria-label="产品界面示意">
          <div className={styles.problem}>2x + 3 = 11</div>
          <svg className={styles.learningPath} viewBox="0 0 400 260" aria-hidden="true">
            <path d="M112 72c72 6 70 82 137 85 42 2 63 29 84 65" />
          </svg>
          <LearningCompanion />
          <div className={styles.tutorPreview}>
            <span>AI TUTOR · 步骤 1</span>
            <strong>先把常数项移到右边</strong>
            <p>等式两边同时减去 3，得到 2x = 8。</p>
            <div className={styles.tutorProgress} aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        </div>
      </section>
      <ProductMetrics />
      <section className={styles.section} aria-labelledby="features-title">
        <p className={styles.eyebrow}>为什么好用</p>
        <h2 id="features-title">少一次切换，多一点专注。</h2>
        <div className={styles.featureGrid}>
          {features.map(([title, text], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <ApplicationScenes />
      <section className={styles.section} aria-labelledby="how-title">
        <p className={styles.eyebrow}>使用方式</p>
        <h2 id="how-title">从题目到理解，只需四步。</h2>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step}>
              <b>{index + 1}</b>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <strong>Easy to learn</strong>
          <span>让答案靠近问题，让学习留在画布。</span>
        </div>
        <div className={styles.creator}>
          <span className={styles.creatorMark} aria-hidden="true">
            K
          </span>
          <div>
            <small>设计与开发</small>
            <strong>KID · zhenglinniao</strong>
          </div>
        </div>
        <nav aria-label="创作者与法律信息">
          <a href="https://github.com/zhenglinniao" target="_blank" rel="noreferrer">
            GitHub <span aria-hidden="true">↗</span>
          </a>
          <a href="https://web.zlnblog.asia/" target="_blank" rel="noreferrer">
            个人博客 <span aria-hidden="true">↗</span>
          </a>
          <Link to="/privacy">隐私说明</Link>
          <Link to="/terms">使用条款</Link>
        </nav>
      </footer>
    </main>
  );
}
