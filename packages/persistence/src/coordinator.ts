export interface SyncLease {
  boardId: string;
  release(): void;
}

type SyncMessage =
  | { type: 'claim'; boardId: string; writerId: string; expiresAt: number }
  | { type: 'ack'; boardId: string; writerId: string; expiresAt: number }
  | { type: 'release'; boardId: string; writerId: string };

export class BroadcastSyncCoordinator {
  private readonly claims = new Map<string, Map<string, number>>();
  private readonly activeLeases = new Map<
    string,
    { token: symbol; renewalTimer: ReturnType<typeof setInterval> }
  >();
  private readonly channel: BroadcastChannel;

  constructor(
    private readonly writerId: string = crypto.randomUUID(),
    channelName = 'easy-to-learn-sync',
    private readonly leaseMs = 5_000,
    private readonly settleMs = 75,
  ) {
    this.channel = new BroadcastChannel(channelName);
    this.channel.addEventListener('message', (event: MessageEvent<SyncMessage>) => {
      this.receive(event.data);
    });
  }

  async acquire(boardId: string): Promise<SyncLease | null> {
    if (this.activeLeases.has(boardId)) return null;

    const expiresAt = Date.now() + this.leaseMs;
    this.remember(boardId, this.writerId, expiresAt);
    this.channel.postMessage({ type: 'claim', boardId, writerId: this.writerId, expiresAt });
    await new Promise((resolve) => setTimeout(resolve, this.settleMs));
    this.removeExpired(boardId);
    const candidates = [...(this.claims.get(boardId)?.keys() ?? [])].sort();
    if (candidates[0] !== this.writerId) {
      this.forget(boardId, this.writerId);
      return null;
    }

    const token = Symbol(boardId);
    const renewalTimer = setInterval(
      () => this.renew(boardId, token),
      Math.max(10, Math.floor(this.leaseMs / 2)),
    );
    this.activeLeases.set(boardId, { token, renewalTimer });

    return {
      boardId,
      release: () => this.release(boardId, token),
    };
  }

  close(): void {
    for (const [boardId, lease] of this.activeLeases) {
      clearInterval(lease.renewalTimer);
      this.forget(boardId, this.writerId);
      this.channel.postMessage({ type: 'release', boardId, writerId: this.writerId });
    }
    this.activeLeases.clear();
    this.channel.close();
  }

  private receive(message: SyncMessage): void {
    if (message.type === 'claim' || message.type === 'ack') {
      this.remember(message.boardId, message.writerId, message.expiresAt);
      if (message.type === 'claim' && this.claims.get(message.boardId)?.has(this.writerId)) {
        const expiresAt = Date.now() + this.leaseMs;
        this.remember(message.boardId, this.writerId, expiresAt);
        this.channel.postMessage({
          type: 'ack',
          boardId: message.boardId,
          writerId: this.writerId,
          expiresAt,
        });
      }
    } else {
      this.forget(message.boardId, message.writerId);
    }
  }

  private remember(boardId: string, writerId: string, expiresAt: number): void {
    const boardClaims = this.claims.get(boardId) ?? new Map<string, number>();
    boardClaims.set(writerId, expiresAt);
    this.claims.set(boardId, boardClaims);
  }

  private forget(boardId: string, writerId: string): void {
    const boardClaims = this.claims.get(boardId);
    boardClaims?.delete(writerId);
    if (boardClaims?.size === 0) this.claims.delete(boardId);
  }

  private removeExpired(boardId: string): void {
    const boardClaims = this.claims.get(boardId);
    for (const [writerId, expiresAt] of boardClaims ?? []) {
      if (expiresAt <= Date.now()) boardClaims?.delete(writerId);
    }
  }

  private renew(boardId: string, token: symbol): void {
    if (this.activeLeases.get(boardId)?.token !== token) return;
    const expiresAt = Date.now() + this.leaseMs;
    this.remember(boardId, this.writerId, expiresAt);
    this.channel.postMessage({
      type: 'ack',
      boardId,
      writerId: this.writerId,
      expiresAt,
    });
  }

  private release(boardId: string, token: symbol): void {
    const activeLease = this.activeLeases.get(boardId);
    if (activeLease?.token !== token) return;
    clearInterval(activeLease.renewalTimer);
    this.activeLeases.delete(boardId);
    this.forget(boardId, this.writerId);
    this.channel.postMessage({ type: 'release', boardId, writerId: this.writerId });
  }
}
