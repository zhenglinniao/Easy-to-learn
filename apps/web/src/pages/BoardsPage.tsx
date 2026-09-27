import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AccountService } from '../features/account';
import { ModalFocusBoundary } from '../components/ModalFocusBoundary';
import { useAuth } from '../features/auth';
import { RemoteBoardRepository, toBoardMessage, type BoardSummary } from '../features/boards';
import { SiteHeader } from './SiteHeader';
import styles from './pages.module.css';

export default function BoardsPage() {
  const { client, user, loading } = useAuth();
  const navigate = useNavigate();
  const repository = useMemo(() => (client ? new RemoteBoardRepository(client) : null), [client]);
  const account = useMemo(() => (client ? new AccountService(client) : null), [client]);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BoardSummary | null>(null);
  const [renameBoard, setRenameBoard] = useState<BoardSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [pendingDeletion, setPendingDeletion] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!user || !repository || !account) return;
    let active = true;
    void repository
      .list()
      .then((items) => {
        if (active) {
          setBoards(items);
          setLoadedUserId(user.id);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          // 账户切换后即使新列表加载失败，也绝不能继续展示上个账户的画板。
          setBoards([]);
          setLoadedUserId(user.id);
          setError(toBoardMessage(cause, '暂时无法加载云端画板。'));
        }
      })
      .finally(() => {
        if (active) setInitializing(false);
      });
    void account
      .pendingDeletion()
      .then((pending) => {
        if (active) setPendingDeletion(pending?.executeAfter ?? null);
      })
      .catch(() => {
        // 账户删除状态不应阻断核心画板列表。
      });
    return () => {
      active = false;
    };
  }, [account, repository, user]);
  if (loading) return <p className="route-loading">正在恢复登录状态…</p>;
  if (!user) return <Navigate to="/login?redirect=/boards" replace />;
  const visibleBoards = loadedUserId === user.id ? boards : [];
  const boardListInitializing = initializing || loadedUserId !== user.id;
  const create = async () => {
    if (!repository || busy) return;
    setBusy(true);
    setError(null);
    try {
      const board = await repository.create();
      if (mounted.current) navigate(`/canvas/${board.boardId}`);
    } catch (cause) {
      if (mounted.current) setError(toBoardMessage(cause, '无法创建画板，请稍后重试。'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (!repository || !confirmDelete) return;
    setBusy(true);
    try {
      await repository.delete(confirmDelete.id);
      if (!mounted.current) return;
      setBoards((items) => items.filter(({ id }) => id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch {
      if (mounted.current) setError('删除失败，画板没有被改动。');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const rename = async () => {
    if (!repository || !renameBoard || !renameTitle.trim()) return;
    setBusy(true);
    try {
      await repository.rename(renameBoard.id, renameTitle);
      if (!mounted.current) return;
      setBoards((items) =>
        items.map((board) =>
          board.id === renameBoard.id ? { ...board, title: renameTitle.trim() } : board,
        ),
      );
      setRenameBoard(null);
    } catch {
      if (mounted.current) setError('重命名失败，原名称已保留。');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const cancelAccountDeletion = async () => {
    if (!account || accountBusy) return;
    setAccountBusy(true);
    setError(null);
    try {
      await account.cancelDeletion();
      if (mounted.current) setPendingDeletion(null);
    } catch {
      if (mounted.current) setError('取消账户删除失败，请稍后重试。');
    } finally {
      if (mounted.current) setAccountBusy(false);
    }
  };
  const requestAccountDeletion = async () => {
    if (!account || accountBusy) return;
    setAccountBusy(true);
    setError(null);
    try {
      const { executeAfter } = await account.requestDeletion();
      if (mounted.current) setPendingDeletion(executeAfter);
    } catch {
      if (mounted.current) setError('请重新登录后再申请删除账户。');
    } finally {
      if (mounted.current) setAccountBusy(false);
    }
  };
  return (
    <main className={styles.page}>
      <SiteHeader />
      <section className={styles.dashboardHeader}>
        <div>
          <p className={styles.eyebrow}>你的学习空间</p>
          <h1>我的画板</h1>
          <p>{user.email}</p>
        </div>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? '正在创建…' : '新建画板'}
        </button>
      </section>
      {error && (
        <p className={styles.formMessage} role="status">
          {error}
        </p>
      )}
      <section className={styles.boardGrid} aria-label="画板列表">
        {boardListInitializing ? (
          <div className={styles.emptyState} role="status">
            <strong>正在整理你的画板…</strong>
          </div>
        ) : visibleBoards.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>第一块画板，等你落笔。</strong>
            <p>创建画板，或先以游客身份试用无限画布。</p>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? '正在创建…' : '创建第一块画板'}
            </button>
          </div>
        ) : (
          visibleBoards.map((board) => (
            <article className={styles.boardCard} key={board.id}>
              <LinkLike onClick={() => navigate(`/canvas/${board.id}`)}>
                <span>最近更新</span>
                <strong>{board.title}</strong>
                <small>{new Date(board.updatedAt).toLocaleString('zh-CN')}</small>
              </LinkLike>
              <div className={styles.boardActions}>
                <button
                  type="button"
                  onClick={() => {
                    setRenameBoard(board);
                    setRenameTitle(board.title);
                  }}
                >
                  重命名
                </button>
                <button type="button" onClick={() => setConfirmDelete(board)}>
                  删除
                </button>
              </div>
            </article>
          ))
        )}
      </section>
      <section className={styles.accountCard}>
        <div>
          <strong>账户与数据</strong>
          <p>
            {pendingDeletion
              ? `账户将在 ${new Date(pendingDeletion).toLocaleString('zh-CN')} 后删除。`
              : '你可以申请删除账户；提交后有 7 天冷静期。'}
          </p>
        </div>
        {pendingDeletion ? (
          <button type="button" disabled={accountBusy} onClick={() => void cancelAccountDeletion()}>
            {accountBusy ? '正在取消…' : '取消删除'}
          </button>
        ) : (
          <button
            className={styles.dangerButton}
            type="button"
            disabled={accountBusy}
            onClick={() => void requestAccountDeletion()}
          >
            {accountBusy ? '正在提交…' : '申请删除账户'}
          </button>
        )}
      </section>
      {confirmDelete && (
        <div className={styles.dialogBackdrop} role="presentation">
          <ModalFocusBoundary
            className={styles.dialog}
            role="alertdialog"
            ariaLabelledby="delete-title"
            onDismiss={() => {
              if (!busy) setConfirmDelete(null);
            }}
          >
            <h2 id="delete-title">永久删除“{confirmDelete.title}”？</h2>
            <p>数据库记录会立即删除，关联图片将在 24 小时内清理。此操作没有回收站。</p>
            <div>
              <button type="button" onClick={() => setConfirmDelete(null)}>
                取消
              </button>
              <button
                className={styles.dangerButton}
                type="button"
                disabled={busy}
                onClick={() => void remove()}
              >
                确认删除
              </button>
            </div>
          </ModalFocusBoundary>
        </div>
      )}
      {renameBoard && (
        <div className={styles.dialogBackdrop} role="presentation">
          <ModalFocusBoundary
            className={styles.dialog}
            ariaLabelledby="rename-title"
            onDismiss={() => {
              if (!busy) setRenameBoard(null);
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <h2 id="rename-title">重命名画板</h2>
              <label>
                画板名称
                <input
                  maxLength={120}
                  required
                  value={renameTitle}
                  onChange={(event) => setRenameTitle(event.target.value)}
                />
              </label>
              <div>
                <button type="button" onClick={() => setRenameBoard(null)}>
                  取消
                </button>
                <button type="submit" disabled={busy || !renameTitle.trim()}>
                  保存名称
                </button>
              </div>
            </form>
          </ModalFocusBoundary>
        </div>
      )}
    </main>
  );
}

function LinkLike({ children, onClick }: { children: React.ReactNode; onClick(): void }) {
  return (
    <button className={styles.boardOpen} type="button" onClick={onClick}>
      {children}
    </button>
  );
}
