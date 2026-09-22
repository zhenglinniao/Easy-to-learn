import styles from './CanvasPage.module.css';

export interface ConflictResolutionDialogProps {
  busy: boolean;
  error: string | null;
  onOpenRemote(): void;
  onSaveAsNew(): void;
  onDownload(): void;
}

export function ConflictResolutionDialog({
  busy,
  error,
  onOpenRemote,
  onSaveAsNew,
  onDownload,
}: ConflictResolutionDialogProps) {
  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section
        className={styles.conflictDialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
      >
        <p className={styles.conflictEyebrow}>已保护你的本地内容</p>
        <h2 id="conflict-title">云端画板在其他位置发生了修改</h2>
        <p className={styles.conflictSummary}>
          为避免静默覆盖，我们已经停止同步并保存本地副本。请选择一种恢复方式。
        </p>
        <div className={styles.conflictActions}>
          <button type="button" disabled={busy} onClick={onOpenRemote}>
            <strong>打开云端版本</strong>
            <span>放弃当前本地修改，继续使用最新云端内容</span>
          </button>
          <button
            className={styles.recommendedAction}
            type="button"
            disabled={busy}
            onClick={onSaveAsNew}
          >
            <strong>本地版本另存为新画板</strong>
            <span>保留两份内容，不覆盖任意已有画板</span>
          </button>
          <button type="button" disabled={busy} onClick={onDownload}>
            <strong>下载本地完整副本</strong>
            <span>导出场景、辅导板与图片，稍后再处理</span>
          </button>
        </div>
        {error ? (
          <p className={styles.conflictError} role="status">
            {error}
          </p>
        ) : null}
        <p className={styles.conflictFootnote}>
          Easy to learn 不提供“强制覆盖云端”，避免不可恢复的数据丢失。
        </p>
      </section>
    </div>
  );
}
