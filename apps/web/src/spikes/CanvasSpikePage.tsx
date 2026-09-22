import { convertToExcalidrawElements, Excalidraw } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import {
  clientPointToScene,
  exportTutorSelectionToPng,
  extractTutorText,
  getTutorSelection,
  hasVisualTutorInput,
  scenePointToClient,
} from '@easy-to-learn/canvas-adapter';
import { useEffect, useRef, useState } from 'react';

import '@excalidraw/excalidraw/index.css';
import './canvas-spike.css';

const initialElements = convertToExcalidrawElements([
  {
    id: 'spike-frame',
    type: 'rectangle',
    x: 80,
    y: 80,
    width: 340,
    height: 160,
    strokeColor: '#5f3dc4',
    backgroundColor: '#e5dbff',
    fillStyle: 'solid',
    roundness: { type: 3 },
  },
  {
    id: 'spike-question',
    type: 'text',
    x: 130,
    y: 125,
    text: '2x + 3 = 11',
    fontSize: 32,
    strokeColor: '#27231d',
  },
  {
    id: 'spike-arrow',
    type: 'arrow',
    x: 440,
    y: 160,
    points: [
      [0, 0],
      [150, 0],
    ],
    strokeColor: '#ee6c4d',
  },
]);

const checkLabels = {
  api: 'Imperative API 已获取',
  elements: '元素转换与读取',
  selection: '文字与视觉选区过滤',
  coordinates: 'scene/client 坐标往返',
  png: '白底 PNG 导出',
  mermaid: '安全 override 后 Mermaid 加载',
} as const;

type CheckName = keyof typeof checkLabels;
type CheckStatus = 'pending' | 'passed' | 'failed';

const initialChecks = Object.fromEntries(
  Object.keys(checkLabels).map((key) => [key, 'pending']),
) as Record<CheckName, CheckStatus>;

const asSelectedIds = (ids: readonly string[]): AppState['selectedElementIds'] =>
  Object.fromEntries(ids.map((id) => [id, true])) as AppState['selectedElementIds'];

export default function CanvasSpikePage() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [checks, setChecks] = useState(initialChecks);
  const [failure, setFailure] = useState<string | null>(null);
  const [pngBytes, setPngBytes] = useState<number | null>(null);
  const hasRun = useRef(false);

  useEffect(() => {
    if (!api || !sceneReady || hasRun.current) {
      return;
    }

    hasRun.current = true;

    const mark = (name: CheckName, status: CheckStatus) => {
      setChecks((current) => ({ ...current, [name]: status }));
    };

    const run = async () => {
      try {
        mark('api', 'passed');

        const elements = api.getSceneElements();
        if (elements.length !== initialElements.length) {
          throw new Error(`预期 ${initialElements.length} 个元素，实际为 ${elements.length} 个`);
        }
        mark('elements', 'passed');

        const selection = getTutorSelection(elements, asSelectedIds(elements.map(({ id }) => id)));
        if (extractTutorText(selection) !== '2x + 3 = 11' || !hasVisualTutorInput(selection)) {
          throw new Error('选区文字或视觉元素识别失败');
        }
        mark('selection', 'passed');

        const appState = api.getAppState();
        const transform = {
          zoom: appState.zoom,
          offsetLeft: appState.offsetLeft,
          offsetTop: appState.offsetTop,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
        };
        const clientProbe = {
          clientX: appState.offsetLeft + 180,
          clientY: appState.offsetTop + 120,
        };
        const sceneProbe = clientPointToScene(clientProbe, transform);
        const clientRoundTrip = scenePointToClient(
          { sceneX: sceneProbe.x, sceneY: sceneProbe.y },
          transform,
        );
        if (
          Math.abs(clientRoundTrip.x - clientProbe.clientX) > 0.01 ||
          Math.abs(clientRoundTrip.y - clientProbe.clientY) > 0.01
        ) {
          throw new Error('坐标往返误差超过 0.01px');
        }
        mark('coordinates', 'passed');

        const png = await exportTutorSelectionToPng(selection, api.getFiles());
        if (png.type !== 'image/png' || png.size === 0) {
          throw new Error('PNG 导出结果无效');
        }
        setPngBytes(png.size);
        mark('png', 'passed');

        const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
        const mermaid = await parseMermaidToExcalidraw('flowchart LR\n  A[题目] --> B[解答]');
        if (mermaid.elements.length === 0) {
          throw new Error('Mermaid 未生成元素');
        }
        mark('mermaid', 'passed');
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知验证错误';
        setFailure(message);
        setChecks((current) => {
          const next = { ...current };
          const pending = (Object.keys(next) as CheckName[]).find(
            (name) => next[name] === 'pending',
          );
          if (pending) {
            next[pending] = 'failed';
          }
          return next;
        });
      }
    };

    void run();
  }, [api, sceneReady]);

  const passedCount = Object.values(checks).filter((status) => status === 'passed').length;

  return (
    <main className="spike-page">
      <header className="spike-header">
        <div>
          <p className="eyebrow">技术尖峰 02</p>
          <h1>Excalidraw 兼容性验证</h1>
          <p>该页面只用于验证 SDK 公共边界，不属于最终产品路由。</p>
        </div>
        <a href="/">返回工程基线</a>
      </header>

      <section className="spike-layout">
        <div className="canvas-stage" aria-label="Excalidraw 验证画布">
          <Excalidraw
            excalidrawAPI={setApi}
            onChange={(elements) => {
              if (elements.length === initialElements.length) {
                setSceneReady(true);
              }
            }}
            initialData={{
              elements: initialElements,
              appState: {
                viewBackgroundColor: '#fbfaf7',
                selectedElementIds: asSelectedIds(initialElements.map(({ id }) => id)),
              },
            }}
          />
        </div>

        <aside className="spike-results" aria-labelledby="spike-results-title">
          <div className="result-summary">
            <span className="result-count" aria-hidden="true">
              {passedCount}/{Object.keys(checks).length}
            </span>
            <div>
              <h2 id="spike-results-title">运行时检查</h2>
              <p>{failure ? '验证遇到阻塞' : '浏览器自动执行'}</p>
            </div>
          </div>

          <ul>
            {(Object.keys(checkLabels) as CheckName[]).map((name) => (
              <li key={name} data-status={checks[name]}>
                <span aria-hidden="true" />
                <div>
                  <strong>{checkLabels[name]}</strong>
                  <small>
                    {checks[name] === 'passed'
                      ? name === 'png' && pngBytes
                        ? `${pngBytes.toLocaleString('zh-CN')} bytes`
                        : '通过'
                      : checks[name] === 'failed'
                        ? '失败'
                        : '等待'}
                  </small>
                </div>
              </li>
            ))}
          </ul>

          {failure ? (
            <p className="spike-error" role="alert">
              {failure}
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
