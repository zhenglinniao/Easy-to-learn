export const downloadJson = (filename: string, value: unknown): void => {
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
};
