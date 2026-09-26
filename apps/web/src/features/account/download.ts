export const downloadJson = (filename: string, value: unknown): void => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('没有可导出的 JSON 数据');
  const blob = new Blob([serialized], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Firefox may not start reading a detached Blob URL until the current task
    // completes. Revoking it in a microtask can intermittently produce an empty
    // download, so keep it alive through one macrotask.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};
