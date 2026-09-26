export interface DebouncedLatestTaskOptions {
  onError?: (error: unknown) => void;
  onStart?: () => void;
  onSuccess?: () => void;
}

/**
 * Coalesces bursts into the latest value and guarantees that writes never overlap.
 * A value queued while a write is running is processed immediately afterwards.
 */
export class DebouncedLatestTask<T> {
  private disposed = false;
  private pending: T | undefined;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly execute: (value: T) => Promise<void>,
    private readonly options: DebouncedLatestTaskOptions = {},
  ) {}

  schedule(value: T, delayMs: number) {
    if (this.disposed) return;
    this.pending = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.running) {
      await this.running;
      if (this.pending !== undefined) await this.flush();
      return;
    }

    if (this.pending === undefined) return;
    const value = this.pending;
    this.pending = undefined;
    this.options.onStart?.();
    const running = this.execute(value).then(
      () => this.options.onSuccess?.(),
      (error) => {
        this.options.onError?.(error);
        throw error;
      },
    );
    this.running = running;
    try {
      await running;
    } finally {
      if (this.running === running) this.running = null;
      if (this.pending !== undefined) {
        queueMicrotask(() => void this.flush().catch(() => undefined));
      }
    }
    if (this.pending !== undefined) await this.flush();
  }

  async dispose(options: { flush: boolean }): Promise<void> {
    this.disposed = true;
    if (options.flush) {
      await this.flush();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = undefined;
    if (this.running) await this.running;
  }
}
