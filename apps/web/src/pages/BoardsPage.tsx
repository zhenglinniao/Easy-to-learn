import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AccountService } from '../features/account';
import { getOptionalSupabaseClient, useAuth } from '../features/auth';
import { RemoteBoardRepository, type BoardSummary } from '../features/boards';
import { SiteHeader } from './SiteHeader';
import styles from './pages.module.css';

export default function BoardsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const client = getOptionalSupabaseClient();
  const repository = useMemo(() => (client ? new RemoteBoardRepository(client) : null), [client]);
  const account = useMemo(() => (client ? new AccountService(client) : null), [client]);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BoardSummary | null>(null);
  const [renameBoard, setRenameBoard] = useState<BoardSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [pendingDeletion, setPendingDeletion] = useState<string | null>(null);
  useEffect(() => {
    if (!user || !repository || !account) return;
    void Promise.all([repository.list(), account.pendingDeletion()])
      .then(([items, pending]) => {
        setBoards(items);
        setPendingDeletion(pending?.executeAfter ?? null);
      })
      .catch(() => setError('暂时无法加载云端画板。'));
  }, [account, repository, user]);
  if (loading) return <p className="route-loading">正在恢复登录状态…</p>;
  if (!user) return <Navigate to="/login?redirect=/boards" replace />;
  const create = async () => {
    if (!repository) return;
    setBusy(true);
    try {
      const board = await repository.create();
      navigate(`/canvas/${board.boardId}`);
    } catch {
      setError('无法创建画板，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!repository || !confirmDelete) return;
    setBusy(true);
    try {
      await repository.delete(confirmDelete.id);
      setBoards((items) => items.filter(({ id }) => id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch {
      setError('删除失败，画板没有被改动。');
    } finally {
      setBusy(false);
    }
  };
  const rename = async () => {
    if (!repository || !renameBoard || !renameTitle.trim()) return;
    setBusy(true);
    try {
      await repository.rename(renameBoard.id, renameTitle);
      setBoards((items) =>
        items.map((board) =>
          board.id === renameBoard.id ? { ...board, title: renameTitle.trim() } : board,
        ),
      );
      setRenameBoard(null);
    } catch {
      setError('重命名失败，原名称已保留。');
    } finally {
      setBusy(false);
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
          新建画板
        </button>
      </section>
      {error && (
        <p className={styles.formMessage} role="status">
          {error}
        </p>
      )}
      <section className={styles.boardGrid} aria-label="画板列表">
        {boards.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>第一块画板，等你落笔。</strong>
            <p>创建画板，或先以游客身份试用无限画布。</p>
            <button className={styles.primaryButton} type="button" onClick={() => void create()}>
              创建第一块画板
            </button>
          </div>
        ) : (
          boards.map((board) => (
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
          <button
            type="button"
            onClick={() => void account?.cancelDeletion().then(() => setPendingDeletion(null))}
          >
            取消删除
          </button>
        ) : (
          <button
            className={styles.dangerButton}
            type="button"
            onClick={() =>
              void account
                ?.requestDeletion()
                .then(({ executeAfter }) => setPendingDeletion(executeAfter))
                .catch(() => setError('请重新登录后再申请删除账户。'))
            }
          >
            申请删除账户
          </button>
        )}
      </section>
      {confirmDelete && (
        <div className={styles.dialogBackdrop} role="presentation">
          <div
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
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
          </div>
        </div>
      )}
      {renameBoard && (
        <div className={styles.dialogBackdrop} role="presentation">
          <form
            className={styles.dialog}
            aria-labelledby="rename-title"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <h2 id="rename-title">重命名画板</h2>
            <label>
              画板名称
              <input
                autoFocus
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
