import { convertToExcalidrawElements, Excalidraw } from '@excalidraw/excalidraw';
import type {
  AppState,
  ExcalidrawImperativeAPI,
  PointerDownState,
} from '@excalidraw/excalidraw/types';
import {
  getTutorSelection,
  inspectTutorSource,
  prepareTutorSelection,
  resolveTutorSource,
  scenePointToClient,
  shouldOpenTutorMenu,
} from '@easy-to-learn/canvas-adapter';
import {
  tutorRequestSchema,
  type AiFeedbackCategory,
  type IllustrationResponse,
  type PersistedTutorBoardV2,
  type QuotaStatus,
  type TutorRequest,
} from '@easy-to-learn/domain';
import {
  BoardSyncEngine,
  BroadcastSyncCoordinator,
  createCompleteExport,
  createExcalidrawExport,
  LocalBoardRepository,
  openLocalDatabase,
  type StoredBoard,
  type SyncState,
} from '@easy-to-learn/persistence';
import { RadialMenu, TutorBoard, type RadialMenuAction } from '@easy-to-learn/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { getOptionalSupabaseClient, useAuth } from '../auth';
import { TutorApiClient } from '../ai-tutor';
import { GuestBoardMigrationService, RemoteBoardRepository, SupabaseBoardGateway } from '../boards';
import { downloadJson } from '../account';
import { ThemeToggle, useTheme } from '../theme';

import '@excalidraw/excalidraw/index.css';
import styles from './CanvasPage.module.css';
import { ConflictResolutionDialog } from './ConflictResolutionDialog';
import { HANDWRITING_FONT_FAMILY, migrateElementsToHandwriting } from './handwriting';

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

type FeedbackState = 'idle' | 'sending' | 'sent' | 'error';
const AI_FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

const canSubmitFeedback = (board: PersistedTutorBoardV2): boolean =>
  Boolean(board.requestId) && Date.now() <= Date.parse(board.createdAt) + AI_FEEDBACK_WINDOW_MS;

const quotaBlockReason = (quota: QuotaStatus | null, now: number): string | null => {
  if (!quota) return null;
  if (quota.action.dailyRemaining === 0)
    return `今天的 ${quota.action.dailyLimit} 次 AI 额度已用完，明天再来吧。`;
  if (quota.action.periodRemaining === 0) return '近 30 天 AI 额度已用完，请在额度恢复后再试。';
  const nextAllowed = quota.action.nextAllowedAt
    ? Date.parse(quota.action.nextAllowedAt)
    : Number.NaN;
  if (Number.isFinite(nextAllowed) && nextAllowed > now) {
    const seconds = Math.max(1, Math.ceil((nextAllowed - now) / 1_000));
    return `AI 正在休息，请等待 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}。`;
  }
  return null;
};

const selectionSignature = (selectedElementIds: AppState['selectedElementIds']): string =>
  Object.keys(selectedElementIds)
    .filter((id) => selectedElementIds[id])
    .sort()
    .join('|');

const didHitSelection = (pointerDownState: PointerDownState): boolean =>
  pointerDownState.hit.element !== null ||
  pointerDownState.hit.hasHitCommonBoundingBoxOfSelectedElements;

const syncLabel = (state: SyncState, isUser: boolean): string => {
  if (!isUser) return '游客 · 仅本机';
  if (state === 'synced' || state === 'clean') return '已保存到云端';
  if (state === 'local-saving') return '正在本地保存';
  if (state === 'syncing-assets' || state === 'syncing-snapshot') return '正在同步';
  if (state === 'conflict') return '版本冲突 · 已保留副本';
  if (state === 'offline' || state === 'retrying') return '离线 · 等待同步';
  if (state === 'failed-local') return '本地保存失败';
  return '已保存本机 · 待同步';
};

type CanvasElements = Parameters<
  NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>
>[0];
type CanvasFiles = Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>[2];

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

type GeneratedIllustrationAsset = Extract<
  IllustrationResponse['data'],
  { status: 'generated' }
>['asset'];

const addGeneratedIllustration = async (
  api: ExcalidrawImperativeAPI,
  asset: GeneratedIllustrationAsset,
  selectionBounds: { x: number; y: number; width: number; height: number },
  signal?: AbortSignal,
): Promise<void> => {
  const response = await fetch(asset.downloadUrl, signal ? { signal } : undefined);
  if (!response.ok) throw new Error('生成插画暂时无法下载，文字与矢量图解已保留。');
  const blob = await response.blob();
  if (blob.type !== asset.mimeType || blob.size === 0 || blob.size > 10 * 1024 * 1024) {
    throw new Error('生成插画文件校验失败，文字与矢量图解已保留。');
  }
  api.addFiles([
    {
      id: asset.fileId,
      dataURL: await blobToDataUrl(blob),
      mimeType: asset.mimeType,
      created: Date.now(),
      lastRetrieved: Date.now(),
    },
  ] as never);
  const width = Math.min(480, Math.max(280, asset.width));
  const height = Math.round((width * asset.height) / asset.width);
  const [image] = convertToExcalidrawElements([
    {
      id: crypto.randomUUID(),
      type: 'image',
      x: selectionBounds.x,
      y: selectionBounds.y + selectionBounds.height + 48,
      width,
      height,
      fileId: asset.fileId as never,
      status: 'saved',
      scale: [1, 1],
    },
  ] as never);
  if (!image) throw new Error('生成插画暂时无法放入画布，文字与矢量图解已保留。');
  api.updateScene({ elements: [...api.getSceneElements(), image] as never });
};

const sha256 = async (blob: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const PERSISTED_ELEMENT_TYPES = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'text',
  'image',
  'line',
  'arrow',
  'freedraw',
  'frame',
  'magicframe',
  'iframe',
  'embeddable',
]);

const persistBoard = async (
  repository: LocalBoardRepository,
  boardId: string,
  elements: CanvasElements,
  appState: AppState,
  files: CanvasFiles,
  tutorBoards: PersistedTutorBoardV2[],
  ownerId: string,
) => {
  const manifests = [];
  const existingAssets = new Map(
    (await repository.getAssets(boardId)).map((asset) => [asset.fileId, asset]),
  );
  for (const file of Object.values(files)) {
    const blob = await fetch(file.dataURL).then((response) => response.blob());
    const contentHash = await sha256(blob);
    const bitmap = await createImageBitmap(blob);
    const manifest = {
      fileId: file.id,
      objectPath: `${ownerId}/${boardId}/${contentHash}`,
      contentHash,
      mimeType: file.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
      byteSize: blob.size,
      width: bitmap.width,
      height: bitmap.height,
    };
    bitmap.close();
    const existing = existingAssets.get(file.id);
    if (
      !existing ||
      existing.contentHash !== contentHash ||
      existing.objectPath !== manifest.objectPath
    ) {
      await repository.putAsset(manifest, blob);
    }
    manifests.push(manifest);
  }
  await repository.saveDurableChange({
    schemaVersion: 2,
    boardId,
    revision: 0,
    excalidraw: {
      elements: elements.filter((element) => PERSISTED_ELEMENT_TYPES.has(element.type)) as never,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        gridSize: appState.gridSize,
        gridStep: appState.gridStep,
        gridModeEnabled: appState.gridModeEnabled,
        objectsSnapModeEnabled: appState.objectsSnapModeEnabled,
      },
    },
    assets: manifests,
    tutorBoards,
    updatedAt: new Date().toISOString(),
  });
};

export default function CanvasPage() {
  const { user, session, signOut } = useAuth();
  const theme = useTheme();
  const { boardId: routeBoardId } = useParams();
  const navigate = useNavigate();
  const [generatedBoardId] = useState(() => `local_${crypto.randomUUID()}`);
  const boardId = routeBoardId ?? generatedBoardId;
  const stageRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<OpenMenu | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [menu, setMenuState] = useState<OpenMenu | null>(null);
  const [loadingAction, setLoadingAction] = useState<RadialMenuAction | null>(null);
  const [prepared, setPrepared] = useState<PreparedSummary | null>(null);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [tutorBoards, setTutorBoards] = useState<PersistedTutorBoardV2[]>([]);
  const [feedbackStates, setFeedbackStates] = useState<Record<string, FeedbackState>>({});
  const [viewportState, setViewportState] = useState<AppState | null>(null);
  const [stageOrigin, setStageOrigin] = useState({ x: 0, y: 0 });
  const [syncState, setSyncState] = useState<SyncState>('clean');
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);
  const [showLocalData, setShowLocalData] = useState(false);
  const [localBoards, setLocalBoards] = useState<StoredBoard[]>([]);
  const [pendingLocalDelete, setPendingLocalDelete] = useState<string | null>(null);
  const [confirmClearLocal, setConfirmClearLocal] = useState(false);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [quotaUnavailable, setQuotaUnavailable] = useState(false);
  const [quotaClock, setQuotaClock] = useState(() => Date.now());
  const requestInputs = useRef(
    new Map<
      string,
      Omit<
        TutorRequest,
        'requestId' | 'mode' | 'parentTutorBoardId' | 'targetStepId' | 'parentContext'
      >
    >(),
  );
  const requestAbort = useRef<AbortController | null>(null);
  const repositoryRef = useRef<LocalBoardRepository | null>(null);
  const syncEngineRef = useRef<BoardSyncEngine | null>(null);
  const syncCoordinatorRef = useRef<BroadcastSyncCoordinator | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedBoard = useRef<string | null>(null);

  const refreshQuota = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await new TutorApiClient(
          async () => session?.access_token ?? null,
        ).quotaStatus(signal);
        setQuota(next);
        setQuotaUnavailable(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setQuotaUnavailable(true);
      }
    },
    [session?.access_token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void refreshQuota(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [refreshQuota]);

  useEffect(() => {
    const nextAllowedAt = quota?.action.nextAllowedAt;
    if (!nextAllowedAt) return;
    const target = Date.parse(nextAllowedAt);
    if (target <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setQuotaClock(now);
      if (now >= target) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [quota?.action.nextAllowedAt]);

  useEffect(() => {
    if (routeBoardId) {
      if (!routeBoardId.startsWith('local_') && !user) {
        navigate(`/login?redirect=${encodeURIComponent(`/canvas/${routeBoardId}`)}`, {
          replace: true,
        });
      }
      return;
    }
    if (user) navigate('/boards', { replace: true });
    else navigate(`/canvas/${generatedBoardId}`, { replace: true });
  }, [generatedBoardId, navigate, routeBoardId, user]);

  useEffect(() => {
    if (!api || hydratedBoard.current === boardId) return;
    let active = true;
    let closeDatabase: (() => void) | undefined;
    void openLocalDatabase()
      .then(async (database) => {
        closeDatabase = () => database.close();
        if (!active) {
          database.close();
          return;
        }
        const repository = new LocalBoardRepository(database);
        repositoryRef.current = repository;
        await repository.cleanupExpiredGuestMigrations();
        let stored = await repository.getBoard(boardId);
        const client = getOptionalSupabaseClient();
        const isCloudBoard = Boolean(user && client && !boardId.startsWith('local_'));
        if (isCloudBoard && user && client) {
          syncEngineRef.current = new BoardSyncEngine(
            repository,
            new SupabaseBoardGateway(client, crypto.randomUUID()),
          );
          syncCoordinatorRef.current = new BroadcastSyncCoordinator();
          if (!stored?.dirty) {
            try {
              const remoteRepository = new RemoteBoardRepository(client);
              const snapshot = await remoteRepository.read(boardId);
              for (const manifest of snapshot.assets) {
                const blob = await remoteRepository.downloadAsset(manifest.objectPath);
                await repository.putAsset(manifest, blob);
                await repository.markAssetState(boardId, manifest.fileId, 'uploaded');
              }
              stored = await repository.storeRemoteSnapshot(snapshot);
            } catch (error) {
              if (!stored) throw error;
              setSyncState('offline');
            }
          }
        }
        if (stored && active) {
          const handwriting = migrateElementsToHandwriting(
            stored.snapshot.excalidraw.elements as unknown as CanvasElements,
          );
          api.updateScene({
            elements: handwriting.elements as never,
            appState: {
              ...stored.snapshot.excalidraw.appState,
              currentItemFontFamily: HANDWRITING_FONT_FAMILY,
            } as never,
          });
          if (handwriting.changed) {
            await repository.saveDurableChange({
              ...stored.snapshot,
              excalidraw: {
                ...stored.snapshot.excalidraw,
                elements: handwriting.elements as never,
              },
              updatedAt: new Date().toISOString(),
            });
          }
          setTutorBoards(stored.snapshot.tutorBoards);
          setSyncState(stored.dirty || handwriting.changed ? 'dirty' : 'synced');
          const assets = await repository.getAssets(boardId);
          const files = await Promise.all(
            assets.map(async (asset) => ({
              id: asset.fileId,
              dataURL: await blobToDataUrl(asset.blob),
              mimeType: asset.mimeType,
              created: Date.now(),
              lastRetrieved: Date.now(),
            })),
          );
          api.addFiles(files as never);
          if ((await repository.getConflictCopies(boardId)).length > 0) {
            setSyncState('conflict');
          }
        }
        hydratedBoard.current = boardId;
        if (stored && user && client && boardId.startsWith('local_')) {
          setMigrationMessage('正在把游客草稿保存为新的云端画板…');
          try {
            const targetBoardId = await new GuestBoardMigrationService(
              repository,
              new RemoteBoardRepository(client),
              new BoardSyncEngine(
                repository,
                new SupabaseBoardGateway(client, crypto.randomUUID()),
              ),
            ).migrate(boardId, user.id);
            if (active) navigate(`/canvas/${targetBoardId}`, { replace: true });
          } catch (error) {
            if (active) {
              setMigrationMessage(
                error instanceof Error
                  ? error.message
                  : '游客草稿暂时无法同步，原稿仍安全保留在本机。',
              );
            }
          }
        }
      })
      .catch(() => setPreparationError('本地画板无法恢复，请先导出重要数据后再重试。'));
    return () => {
      active = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
      if (sourceTimer.current) clearTimeout(sourceTimer.current);
      syncCoordinatorRef.current?.close();
      syncCoordinatorRef.current = null;
      syncEngineRef.current = null;
      repositoryRef.current = null;
      closeDatabase?.();
    };
  }, [api, boardId, navigate, user]);

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

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const bounds = stage.getBoundingClientRect();
      setStageOrigin({ x: bounds.left, y: bounds.top });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (syncState !== 'dirty' || !syncEngineRef.current || !syncCoordinatorRef.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      void (async () => {
        const lease = await syncCoordinatorRef.current?.acquire(boardId);
        if (!lease) return;
        try {
          setSyncState('syncing-snapshot');
          const result = await syncEngineRef.current?.syncBoard(boardId);
          if (result) setSyncState(result.state);
          if (result?.retryAt) {
            syncTimer.current = setTimeout(
              () => setSyncState('dirty'),
              Math.max(0, result.retryAt - Date.now()),
            );
          }
          if ((await repositoryRef.current?.getOutbox(boardId))?.length) {
            if (!result?.retryAt) setSyncState('dirty');
          }
        } finally {
          lease.release();
        }
      })().catch(() => setSyncState('retrying'));
    }, 3_000);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [boardId, syncState]);

  const handleChange = (
    elements: Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>[0],
    appState: AppState,
    files: Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>[2],
  ) => {
    const handwriting = migrateElementsToHandwriting(elements);
    const normalizedElements = handwriting.elements as CanvasElements;

    // 画布输入和 AI 写回内容统一使用手绘字体。即使用户此前选过其他字体，
    // 或第三方代码插入了普通字体文本，也会在同一轮变更中被规范化。
    if (
      api &&
      (handwriting.changed || appState.currentItemFontFamily !== HANDWRITING_FONT_FAMILY)
    ) {
      api.updateScene({
        ...(handwriting.changed ? { elements: normalizedElements as never } : {}),
        appState: { currentItemFontFamily: HANDWRITING_FONT_FAMILY } as never,
      });
    }

    setViewportState(appState);
    const currentMenu = menuRef.current;
    if (
      currentMenu &&
      selectionSignature(appState.selectedElementIds) !== currentMenu.selectionSignature
    ) {
      setMenu(null);
    }
    if (hydratedBoard.current !== boardId || !repositoryRef.current) return;
    if (sourceTimer.current) clearTimeout(sourceTimer.current);
    if (tutorBoards.length > 0) {
      sourceTimer.current = setTimeout(() => {
        void Promise.all(
          tutorBoards.map(async (board) =>
            resolveTutorSource(
              board,
              await inspectTutorSource(normalizedElements, board.source.elementIds),
            ),
          ),
        ).then((next) => {
          if (JSON.stringify(next) !== JSON.stringify(tutorBoards)) {
            setTutorBoards(next);
            void persistBoard(
              repositoryRef.current!,
              boardId,
              normalizedElements,
              appState,
              files,
              next,
              user?.id ?? 'local',
            )
              .then(() => setSyncState('dirty'))
              .catch(() => setPreparationError('辅导板锚点保存失败，请稍后重试。'));
          }
        });
      }, 250);
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSyncState('local-saving');
      void persistBoard(
        repositoryRef.current!,
        boardId,
        normalizedElements,
        appState,
        files,
        tutorBoards,
        user?.id ?? 'local',
      )
        .then(() => {
          setSyncState('dirty');
        })
        .catch(() => {
          setSyncState('failed-local');
          setPreparationError('本地自动保存失败，请导出副本后再继续。');
        });
    }, 250);
  };

  const commitTutorBoards = (next: PersistedTutorBoardV2[]) => {
    setTutorBoards(next);
    if (!api || !repositoryRef.current || hydratedBoard.current !== boardId) return;
    void persistBoard(
      repositoryRef.current,
      boardId,
      api.getSceneElementsIncludingDeleted(),
      api.getAppState(),
      api.getFiles(),
      next,
      user?.id ?? 'local',
    )
      .then(() => {
        setSyncState('dirty');
      })
      .catch(() => setPreparationError('辅导板本地保存失败，请导出副本后再继续。'));
  };

  const exportBoard = async (format: 'excalidraw' | 'complete') => {
    if (!api || !repositoryRef.current) return;
    setPreparationError(null);
    try {
      await persistBoard(
        repositoryRef.current,
        boardId,
        api.getSceneElementsIncludingDeleted(),
        api.getAppState(),
        api.getFiles(),
        tutorBoards,
        user?.id ?? 'local',
      );
      const [stored, assets] = await Promise.all([
        repositoryRef.current.getBoard(boardId),
        repositoryRef.current.getAssets(boardId),
      ]);
      if (!stored) throw new Error('画板尚未完成本地保存');
      if (format === 'complete') {
        downloadJson(
          `easy-to-learn-${boardId}.easy-to-learn.json`,
          await createCompleteExport(stored.snapshot, assets),
        );
      } else {
        downloadJson(
          `easy-to-learn-${boardId}.excalidraw`,
          await createExcalidrawExport(stored.snapshot, assets),
        );
      }
    } catch (error) {
      setPreparationError(error instanceof Error ? error.message : '画板导出失败，请稍后重试。');
    }
  };

  const openLocalData = async () => {
    if (!repositoryRef.current) return;
    setLocalBoards(await repositoryRef.current.listLocalBoards());
    setShowLocalData(true);
  };

  const exportRawLocalData = async () => {
    if (!repositoryRef.current) return;
    downloadJson('easy-to-learn-local-backup.json', await repositoryRef.current.exportRawData());
  };

  const deleteLocalBoard = async (targetBoardId: string) => {
    if (!repositoryRef.current) return;
    await repositoryRef.current.deleteLocalBoard(targetBoardId);
    setPendingLocalDelete(null);
    if (targetBoardId === boardId) {
      setShowLocalData(false);
      navigate('/canvas', { replace: true });
      return;
    }
    setLocalBoards(await repositoryRef.current.listLocalBoards());
  };

  const clearLocalData = async () => {
    if (!repositoryRef.current) return;
    await repositoryRef.current.clearAllLocalData();
    setConfirmClearLocal(false);
    setShowLocalData(false);
    navigate('/canvas', { replace: true });
  };

  const downloadConflictCopy = async () => {
    if (!repositoryRef.current) return;
    setConflictError(null);
    try {
      const copies = await repositoryRef.current.getConflictCopies(boardId);
      const latest = copies.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (!latest) throw new Error('找不到本地冲突副本。');
      const assets = await repositoryRef.current.getAssets(boardId);
      downloadJson(
        `easy-to-learn-conflict-${boardId}.easy-to-learn.json`,
        await createCompleteExport(latest.snapshot, assets),
      );
    } catch (error) {
      setConflictError(error instanceof Error ? error.message : '无法下载本地冲突副本。');
    }
  };

  const openRemoteVersion = async () => {
    const client = getOptionalSupabaseClient();
    if (!client || !repositoryRef.current || !api) return;
    setConflictBusy(true);
    setConflictError(null);
    try {
      const remote = new RemoteBoardRepository(client);
      const snapshot = await remote.read(boardId);
      const downloads = await Promise.all(
        snapshot.assets.map(async (manifest) => ({
          manifest,
          blob: await remote.downloadAsset(manifest.objectPath),
        })),
      );
      await repositoryRef.current.resolveConflictWithRemote(snapshot, downloads);
      const assets = await repositoryRef.current.getAssets(boardId);
      hydratedBoard.current = null;
      const handwriting = migrateElementsToHandwriting(
        snapshot.excalidraw.elements as unknown as CanvasElements,
      );
      api.updateScene({
        elements: handwriting.elements as never,
        appState: {
          ...snapshot.excalidraw.appState,
          currentItemFontFamily: HANDWRITING_FONT_FAMILY,
        } as never,
      });
      if (handwriting.changed) {
        await repositoryRef.current.saveDurableChange({
          ...snapshot,
          excalidraw: {
            ...snapshot.excalidraw,
            elements: handwriting.elements as never,
          },
          updatedAt: new Date().toISOString(),
        });
      }
      api.addFiles(
        (await Promise.all(
          assets.map(async (asset) => ({
            id: asset.fileId,
            dataURL: await blobToDataUrl(asset.blob),
            mimeType: asset.mimeType,
            created: Date.now(),
            lastRetrieved: Date.now(),
          })),
        )) as never,
      );
      setTutorBoards(snapshot.tutorBoards);
      hydratedBoard.current = boardId;
      setSyncState(handwriting.changed ? 'dirty' : 'synced');
    } catch (error) {
      setConflictError(error instanceof Error ? error.message : '暂时无法打开云端版本。');
    } finally {
      setConflictBusy(false);
    }
  };

  const saveConflictAsNewBoard = async () => {
    const client = getOptionalSupabaseClient();
    if (!client || !repositoryRef.current || !user) return;
    setConflictBusy(true);
    setConflictError(null);
    try {
      const remote = new RemoteBoardRepository(client);
      let targetBoardId = await repositoryRef.current.getPreparedConflictTarget(boardId);
      if (!targetBoardId) {
        const created = await remote.create('冲突副本');
        targetBoardId = created.boardId;
        await repositoryRef.current.prepareConflictCopyAsNewBoard(boardId, targetBoardId, user.id);
      }
      const result = await new BoardSyncEngine(
        repositoryRef.current,
        new SupabaseBoardGateway(client, crypto.randomUUID()),
      ).syncBoard(targetBoardId);
      if (result.state !== 'synced' && result.state !== 'clean') {
        throw new Error('新画板暂时无法同步，本地副本仍然保留。');
      }
      await repositoryRef.current.clearCloudBoardCacheAfterConflict(boardId);
      navigate(`/canvas/${targetBoardId}`, { replace: true });
    } catch (error) {
      setConflictError(error instanceof Error ? error.message : '无法另存为新画板。');
      setConflictBusy(false);
    }
  };

  const handleAction = async (action: RadialMenuAction) => {
    if (!api || loadingAction) return;
    const quotaError = quotaBlockReason(quota, Date.now());
    if (quotaError) {
      setPreparationError(quotaError);
      return;
    }
    setLoadingAction(action);
    setPreparationError(null);
    try {
      const appState = api.getAppState();
      const selection = getTutorSelection(api.getSceneElements(), appState.selectedElementIds);
      const input = await prepareTutorSelection(selection, api.getFiles());
      const requestId = crypto.randomUUID();
      requestAbort.current?.abort();
      requestAbort.current = new AbortController();
      const client = new TutorApiClient(async () => session?.access_token ?? null);
      const uploadedImage =
        input.image && !input.image.base64
          ? await client.uploadImage(requestId, input.image.blob, requestAbort.current?.signal)
          : null;
      setPrepared({
        action,
        elementCount: input.elementIds.length,
        textLength: input.text?.length ?? 0,
        hasImage: input.image !== undefined,
      });
      const base = {
        schemaVersion: 1 as const,
        boardId,
        locale: 'zh-CN' as const,
        ...(input.text ? { text: input.text } : {}),
        ...(input.image?.base64
          ? { image: { mimeType: input.image.mimeType, base64: input.image.base64 } }
          : uploadedImage
            ? { image: uploadedImage }
            : {}),
        source: {
          elementIds: input.elementIds,
          selectionBounds: input.selectionBounds,
          contentHash: input.contentHash,
        },
      };
      const request = tutorRequestSchema.parse({
        ...base,
        requestId,
        mode: action,
      });
      const response = await client.execute(request, requestAbort.current.signal);
      setQuota(response.quota);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const next: PersistedTutorBoardV2 = {
        id,
        requestId,
        title: response.result.title,
        result: response.result,
        stepIndex: 0,
        sceneAnchor: {
          sceneX: input.selectionBounds.x + input.selectionBounds.width + 28,
          sceneY: input.selectionBounds.y,
        },
        anchorMode: 'follow-source',
        source: {
          elementIds: input.elementIds,
          bounds: input.selectionBounds,
          contentHash: input.contentHash,
          relativeOffset: { x: 28, y: 0 },
          status: 'active',
        },
        createdAt: now,
        updatedAt: now,
      };
      requestInputs.current.set(id, base);
      commitTutorBoards([...tutorBoards, next]);
      setPrepared({
        action,
        elementCount: input.elementIds.length,
        textLength: input.text?.length ?? 0,
        hasImage: input.image !== undefined,
      });
      setMenu(null);
      if (action === 'solve') {
        try {
          const illustration = await client.generateIllustration(
            { requestId, boardId },
            requestAbort.current.signal,
          );
          setQuota(illustration.quota);
          if (illustration.status === 'generated') {
            await addGeneratedIllustration(
              api,
              illustration.asset,
              input.selectionBounds,
              requestAbort.current.signal,
            );
          }
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setPreparationError(
              error instanceof Error ? error.message : '插画生成暂时不可用，文字与矢量图解已保留。',
            );
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setPreparationError(
        error instanceof Error ? error.message : '无法处理当前选区，请重新选择后再试。',
      );
      void refreshQuota();
    } finally {
      setLoadingAction(null);
    }
  };

  const explainStep = async (parentId: string, targetStepId: string) => {
    const quotaError = quotaBlockReason(quota, Date.now());
    if (quotaError) {
      setPreparationError(quotaError);
      return;
    }
    let base = requestInputs.current.get(parentId);
    const parent = tutorBoards.find(({ id }) => id === parentId);
    if (!parent) {
      setPreparationError('原题上下文已失效，请重新选择题目。');
      return;
    }
    const targetStep = parent.result.steps.find(({ id }) => id === targetStepId);
    if (!targetStep) {
      setPreparationError('目标步骤已失效，请重新打开辅导板。');
      return;
    }
    setLoadingAction('solve');
    try {
      const requestId = crypto.randomUUID();
      if (!base && api) {
        const sourceIds = Object.fromEntries(
          parent.source.elementIds.map((id) => [id, true as const]),
        ) as AppState['selectedElementIds'];
        const selection = getTutorSelection(api.getSceneElements(), sourceIds);
        const input = await prepareTutorSelection(selection, api.getFiles());
        const client = new TutorApiClient(async () => session?.access_token ?? null);
        const uploadedImage =
          input.image && !input.image.base64
            ? await client.uploadImage(requestId, input.image.blob)
            : null;
        base = {
          schemaVersion: 1,
          boardId,
          locale: 'zh-CN',
          ...(input.text ? { text: input.text } : {}),
          ...(input.image?.base64
            ? { image: { mimeType: input.image.mimeType, base64: input.image.base64 } }
            : uploadedImage
              ? { image: uploadedImage }
              : {}),
          source: {
            elementIds: input.elementIds,
            selectionBounds: input.selectionBounds,
            contentHash: input.contentHash,
          },
        };
        requestInputs.current.set(parentId, base);
      }
      if (!base) throw new Error('原题上下文已失效，请重新选择题目。');
      const request = tutorRequestSchema.parse({
        ...base,
        requestId,
        mode: 'explain_step',
        parentTutorBoardId: parentId,
        targetStepId,
        parentContext: { title: parent.result.title, step: targetStep },
      });
      const result = await new TutorApiClient(async () => session?.access_token ?? null).execute(
        request,
      );
      setQuota(result.quota);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const child: PersistedTutorBoardV2 = {
        ...parent,
        id,
        requestId,
        title: result.result.title,
        result: result.result,
        stepIndex: 0,
        sceneAnchor: {
          sceneX: parent.sceneAnchor.sceneX + 34,
          sceneY: parent.sceneAnchor.sceneY + 34,
        },
        parentTutorBoardId: parentId,
        targetStepId,
        createdAt: now,
        updatedAt: now,
      };
      requestInputs.current.set(id, base);
      commitTutorBoards([...tutorBoards, child]);
    } catch (error) {
      setPreparationError(error instanceof Error ? error.message : '无法解释当前步骤。');
      void refreshQuota();
    } finally {
      setLoadingAction(null);
    }
  };

  const submitFeedback = async (
    board: PersistedTutorBoardV2,
    rating: -1 | 1,
    category?: AiFeedbackCategory,
  ) => {
    if (!board.requestId || feedbackStates[board.id] === 'sending') return;
    setFeedbackStates((current) => ({ ...current, [board.id]: 'sending' }));
    try {
      await new TutorApiClient(async () => session?.access_token ?? null).submitFeedback({
        requestId: board.requestId,
        rating,
        ...(category ? { category } : {}),
      });
      setFeedbackStates((current) => ({ ...current, [board.id]: 'sent' }));
    } catch {
      setFeedbackStates((current) => ({ ...current, [board.id]: 'error' }));
    }
  };

  const cooldownSeconds = quota?.action.nextAllowedAt
    ? Math.max(0, Math.ceil((Date.parse(quota.action.nextAllowedAt) - quotaClock) / 1_000))
    : 0;
  const compactQuota = quota
    ? `AI ${quota.action.dailyRemaining}/${quota.action.dailyLimit}`
    : quotaUnavailable
      ? '额度暂不可用'
      : '读取额度';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="返回 Easy to learn 首页">
          <span aria-hidden="true">E</span>
          Easy to learn
        </a>
        <div className={styles.context}>
          <strong>学习画布</strong>
          <div
            className={styles.quotaSummary}
            data-mode={quota?.mode ?? 'loading'}
            aria-live="polite"
            aria-label={
              quota
                ? `今日 AI 剩余 ${quota.action.dailyRemaining} 次，近 30 天剩余 ${quota.action.periodRemaining} 次，今日插画剩余 ${quota.image.dailyRemaining} 张`
                : compactQuota
            }
          >
            {quota ? (
              <>
                <span>
                  今日 AI{' '}
                  <b>
                    {quota.action.dailyRemaining}/{quota.action.dailyLimit}
                  </b>
                </span>
                <span>
                  30 天{' '}
                  <b>
                    {quota.action.periodRemaining}/{quota.action.periodLimit}
                  </b>
                </span>
                <span>
                  插画{' '}
                  <b>
                    {quota.image.dailyRemaining}/{quota.image.dailyLimit}
                  </b>
                </span>
                {cooldownSeconds > 0 ? (
                  <span className={styles.cooldown}>
                    等待 {Math.floor(cooldownSeconds / 60)}:
                    {String(cooldownSeconds % 60).padStart(2, '0')}
                  </span>
                ) : null}
              </>
            ) : (
              <span>{compactQuota}</span>
            )}
          </div>
        </div>
        <div className={styles.userBar}>
          <ThemeToggle />
          <span className={styles.mobileQuota} aria-label={compactQuota}>
            {compactQuota}
          </span>
          <span className={styles.saveState}>{syncLabel(syncState, Boolean(user))}</span>
          <button type="button" onClick={() => void exportBoard('excalidraw')}>
            导出
          </button>
          <button type="button" onClick={() => void exportBoard('complete')}>
            备份
          </button>
          {!user ? (
            <button type="button" onClick={() => void openLocalData()}>
              本地数据
            </button>
          ) : null}
          {user ? (
            <>
              <Link to="/boards">{user.user_metadata?.name ?? user.email ?? '账户'}</Link>
              <button type="button" onClick={() => void signOut()}>
                退出
              </button>
            </>
          ) : (
            <Link to={`/login?redirect=${encodeURIComponent(`/canvas/${boardId}`)}`}>登录保存</Link>
          )}
        </div>
      </header>

      <section className={styles.workspace} aria-label="AI 学习画布工作区">
        <div ref={stageRef} className={styles.stage}>
          <Excalidraw
            excalidrawAPI={setApi}
            langCode="zh-CN"
            name="Easy to learn"
            theme={theme}
            onChange={handleChange}
            initialData={{
              appState: {
                // Excalifont 负责拉丁字符，中文会自动回退到配套的 Xiaolai 手写字形。
                currentItemFontFamily: HANDWRITING_FONT_FAMILY,
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
          {tutorBoards.map((board) => {
            const clientPoint = viewportState
              ? scenePointToClient(board.sceneAnchor, viewportState)
              : { x: board.sceneAnchor.sceneX, y: board.sceneAnchor.sceneY };
            return (
              <TutorBoard
                key={board.id}
                board={board}
                screenPosition={{
                  x: clientPoint.x - stageOrigin.x,
                  y: clientPoint.y - stageOrigin.y,
                }}
                sceneUnitsPerClientPixel={1 / (viewportState?.zoom.value ?? 1)}
                onChange={(next) =>
                  commitTutorBoards(tutorBoards.map((item) => (item.id === next.id ? next : item)))
                }
                onClose={(id) => commitTutorBoards(tutorBoards.filter((item) => item.id !== id))}
                onExplainStep={(id, stepId) => void explainStep(id, stepId)}
                feedbackState={feedbackStates[board.id] ?? 'idle'}
                {...(canSubmitFeedback(board)
                  ? {
                      onFeedback: (rating: -1 | 1, category?: AiFeedbackCategory) =>
                        void submitFeedback(board, rating, category),
                    }
                  : {})}
              />
            );
          })}
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

      {prepared || preparationError || migrationMessage ? (
        <div className={styles.notice} role="status">
          {migrationMessage ??
            preparationError ??
            (prepared
              ? `已准备 ${prepared.elementCount} 个元素的${prepared.action === 'solve' ? '解题' : '提示'}输入${prepared.textLength > 0 ? ` · ${prepared.textLength} 个文字` : ''}${prepared.hasImage ? ' · 1 张选区图片' : ''}`
              : '')}
        </div>
      ) : null}

      {syncState === 'conflict' && user ? (
        <ConflictResolutionDialog
          busy={conflictBusy}
          error={conflictError}
          onOpenRemote={() => void openRemoteVersion()}
          onSaveAsNew={() => void saveConflictAsNewBoard()}
          onDownload={() => void downloadConflictCopy()}
        />
      ) : null}

      {showLocalData ? (
        <div className={styles.dialogBackdrop} role="presentation">
          <section
            className={styles.dataDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-data-title"
          >
            <div className={styles.dialogHeading}>
              <div>
                <p>仅保存在这台设备</p>
                <h2 id="local-data-title">本地画板</h2>
              </div>
              <button type="button" onClick={() => setShowLocalData(false)} aria-label="关闭">
                关闭
              </button>
            </div>
            <div className={styles.localBoardList}>
              {localBoards.map((localBoard) => (
                <div key={localBoard.boardId}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowLocalData(false);
                      navigate(`/canvas/${localBoard.boardId}`);
                    }}
                  >
                    <strong>{localBoard.boardId === boardId ? '当前画板' : '游客画板'}</strong>
                    <span>{new Date(localBoard.updatedAt).toLocaleString('zh-CN')}</span>
                  </button>
                  <button
                    className={styles.dangerText}
                    type="button"
                    onClick={() => {
                      setShowLocalData(false);
                      setPendingLocalDelete(localBoard.boardId);
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.dataActions}>
              <button type="button" onClick={() => void exportRawLocalData()}>
                下载完整本地备份
              </button>
              <button
                className={styles.dangerText}
                type="button"
                onClick={() => {
                  setShowLocalData(false);
                  setConfirmClearLocal(true);
                }}
              >
                清空本地数据
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingLocalDelete || confirmClearLocal ? (
        <div className={styles.dialogBackdrop} role="presentation">
          <section
            className={styles.confirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="local-delete-title"
          >
            <h2 id="local-delete-title">
              {confirmClearLocal ? '清空所有本地数据？' : '删除这块本地画板？'}
            </h2>
            <p>
              {confirmClearLocal
                ? '所有游客画板、图片和恢复副本都会从这台设备移除。建议先下载完整备份。'
                : '画板及其本地图片会立即移除，此操作无法撤销。'}
            </p>
            <div>
              <button
                type="button"
                onClick={() => {
                  setPendingLocalDelete(null);
                  setConfirmClearLocal(false);
                  setShowLocalData(true);
                }}
              >
                取消
              </button>
              <button
                className={styles.dangerButton}
                type="button"
                onClick={() =>
                  void (confirmClearLocal
                    ? clearLocalData()
                    : deleteLocalBoard(pendingLocalDelete!))
                }
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
