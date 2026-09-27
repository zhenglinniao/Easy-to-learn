export const isCurrentCanvasTask = (
  signal: AbortSignal,
  expectedBoardId: string,
  currentBoardId: string,
): boolean => !signal.aborted && expectedBoardId === currentBoardId;
