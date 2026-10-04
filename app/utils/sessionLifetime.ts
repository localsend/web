/**
 * Ends everything a transfer is waiting on at once, when the user cancels,
 * the connection fails or the peer goes away.
 *
 * Without it, a peer that disappeared left the other side waiting for a
 * message that never came, with the progress dialog open until a reload.
 */
export class SessionLifetime {
  /** Rejects with the reason once the session has ended. */
  readonly ended: Promise<never>;
  private reject!: (reason: Error) => void;
  private reason: Error | null = null;
  private cleanups: (() => void)[] = [];

  constructor(signal?: AbortSignal) {
    this.ended = new Promise<never>((_, reject) => (this.reject = reject));
    // Only observed through until() and the caller's own error handling.
    this.ended.catch(() => {});

    const cancel = () => this.end(new Error("Cancelled"));
    if (signal?.aborted) {
      cancel();
    } else {
      signal?.addEventListener("abort", cancel, { once: true });
    }
  }

  get endReason(): Error | null {
    return this.reason;
  }

  /** End the session. Only the first reason counts. */
  end(reason: Error) {
    if (this.reason) {
      return;
    }
    this.reason = reason;
    this.reject(reason);
    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
  }

  /** Run cleanup when the session ends, or right away if it already has. */
  onEnd(cleanup: () => void) {
    if (this.reason) {
      cleanup();
    } else {
      this.cleanups.push(cleanup);
    }
  }

  /** Wait for promise, unless the session ends first. */
  until<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, this.ended]);
  }
}
