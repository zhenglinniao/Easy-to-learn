import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

const CanvasSpikePage = lazy(() => import('../spikes/CanvasSpikePage'));

const completedFoundations = ['工作区已建立', '依赖已锁定', '质量门禁已启用'] as const;

function FoundationPage() {
  return (
    <main className="app-shell">
      <header className="site-header" aria-label="主导航">
        <a className="brand" href="/" aria-label="Easy to learn 首页">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span>Easy to learn</span>
        </a>
        <span className="stage-badge">工程基线</span>
      </header>

      <section className="foundation-card" aria-labelledby="foundation-title">
        <p className="eyebrow">开发节点 01</p>
        <h1 id="foundation-title">让学习过程，留在思考发生的地方。</h1>
        <p className="lead">
          Easy to learn 的基础工程已经就绪。下一节点将验证无限画布、混合选区导出与坐标转换。
        </p>

        <ul className="foundation-list" aria-label="已完成的工程基础">
          {completedFoundations.map((item) => (
            <li key={item}>
              <span className="status-dot" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<p className="route-loading">正在加载验证页面…</p>}>
        <Routes>
          <Route path="/" element={<FoundationPage />} />
          <Route path="/spikes/excalidraw" element={<CanvasSpikePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
