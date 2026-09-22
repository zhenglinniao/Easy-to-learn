import { Excalidraw } from '@excalidraw/excalidraw';
import type {
  AppState,
  ExcalidrawImperativeAPI,
  PointerDownState,
} from '@excalidraw/excalidraw/types';
import {
  getTutorSelection,
  prepareTutorSelection,
  shouldOpenTutorMenu,
} from '@easy-to-learn/canvas-adapter';
import { RadialMenu, type RadialMenuAction } from '@easy-to-learn/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import '@excalidraw/excalidraw/index.css';
import styles from './CanvasPage.module.css';

interface OpenMenu {
  x: number;
  y: number;
  selectionSignature: string;
}

interface PreparedSummary {
  action: RadialMenuAction;
  elementCount: number;
  textLength: number;
  hasImage: boolean;
}

const selectionSignature = (selectedElementIds: AppState['selectedElementIds']): string =>
  Object.keys(selectedElementIds)
    .filter((id) => selectedElementIds[id])
    .sort()
    .join('|');

const didHitSelection = (pointerDownState: PointerDownState): boolean =>
  pointerDownState.hit.element !== null ||
  pointerDownState.hit.hasHitCommonBoundingBoxOfSelectedElements;

export default function CanvasPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<OpenMenu | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [menu, setMenuState] = useState<OpenMenu | null>(null);
  const [loadingAction, setLoadingAction] = useState<RadialMenuAction | null>(null);
  const [prepared, setPrepared] = useState<PreparedSummary | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);

  const setMenu = useCallback((next: OpenMenu | null) => {
    menuRef.current = next;
    setMenuState(next);
  }, []);

  useEffect(() => {
    if (!api) return;
    const unsubscribeDown = api.onPointerDown(() => setMenu(null));
    const unsubscribeUp = api.onPointerUp((activeTool, pointerDownState, event) => {
      requestAnimationFrame(() => {
        const appState = api.getAppState();
        const selection = getTutorSelection(api.getSceneElements(), appState.selectedElementIds);
        if (
          !shouldOpenTutorMenu(selection, {
            activeToolType: activeTool.type,
            pointerType: event.pointerType,
            dragOccurred: pointerDownState.drag.hasOccurred,
            boxSelectionOccurred: pointerDownState.boxSelection.hasOccurred,
            hitSelection: didHitSelection(pointerDownState),
          })
        ) {
          setMenu(null);
          return;
        }

        const stage = stageRef.current?.getBoundingClientRect();
        if (!stage) return;
        const horizontalMargin = 110;
        setMenu({
          x: Math.min(
            Math.max(event.clientX - stage.left, horizontalMargin),
            stage.width - horizontalMargin,
          ),
          y: Math.max(event.clientY - stage.top, 88),
          selectionSignature: selectionSignature(appState.selectedElementIds),
        });
      });
    });
    return () => {
      unsubscribeDown();
      unsubscribeUp();
    };
  }, [api, setMenu]);

  const handleChange = useCallback(
    (
      _elements: Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>[0],
      appState: AppState,
    ) => {
      const currentMenu = menuRef.current;
      if (
        currentMenu &&
        selectionSignature(appState.selectedElementIds) !== currentMenu.selectionSignature
      ) {
        setMenu(null);
      }
    },
    [setMenu],
  );

  const handleAction = async (action: RadialMenuAction) => {
    if (!api || loadingAction) return;
    setLoadingAction(action);
    setPreparationError(null);
    try {
      const appState = api.getAppState();
      const selection = getTutorSelection(api.getSceneElements(), appState.selectedElementIds);
      const input = await prepareTutorSelection(selection, api.getFiles());
      setPrepared({
        action,
        elementCount: input.elementIds.length,
        textLength: input.text?.length ?? 0,
        hasImage: input.image !== undefined,
      });
      setMenu(null);
    } catch {
      setPreparationError('无法准备当前选区，请重新选择后再试。');
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="返回 Easy to learn 首页">
          <span aria-hidden="true">E</span>
          Easy to learn
        </a>
        <div className={styles.context}>
          <strong>学习画布</strong>
          <span>选择题目后使用 AI 操作</span>
        </div>
        <span className={styles.mode}>画布编辑</span>
      </header>

      <section className={styles.workspace} aria-label="AI 学习画布工作区">
        <div ref={stageRef} className={styles.stage}>
          <Excalidraw
            excalidrawAPI={setApi}
            langCode="zh-CN"
            name="Easy to learn"
            onChange={handleChange}
            initialData={{
              appState: {
                viewBackgroundColor: '#fbfaf7',
              },
            }}
          />
          {menu ? (
            <RadialMenu
              x={menu.x}
              y={menu.y}
              loadingAction={loadingAction}
              onAction={(action) => void handleAction(action)}
              onClose={() => setMenu(null)}
            />
          ) : null}
        </div>

        <aside className={styles.guide} aria-label="画布使用提示">
          <span className={styles.guideIcon} aria-hidden="true">
            ✦
          </span>
          <div>
            <strong>让 AI 看懂你的题目</strong>
            <p>使用选择工具框选文字、图形或手写内容，松开鼠标后选择“解题”或“提示”。</p>
          </div>
        </aside>
      </section>

      {prepared || preparationError ? (
        <div className={styles.notice} role="status">
          {prepared
            ? `已准备 ${prepared.elementCount} 个元素的${prepared.action === 'solve' ? '解题' : '提示'}输入${prepared.textLength > 0 ? ` · ${prepared.textLength} 个文字` : ''}${prepared.hasImage ? ' · 1 张选区图片' : ''}`
            : preparationError}
        </div>
      ) : null}
    </main>
  );
}
