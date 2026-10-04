/**
 * Coalesce progress updates so they reach the UI at most once per frame.
 *
 * Senders and receivers report progress once per chunk, thousands of times a
 * second. Applying every one re-rendered the session dialog each time, which
 * with a few hundred files kept both main threads busy enough to slow the
 * transfer itself. Only the latest value per file matters, so keep that and
 * apply it once per frame, which is as often as the screen can show it.
 */
export class ProgressBatcher {
  private pending = new Map<string, number>();
  private frame: number | null = null;

  constructor(
    private readonly apply: (updates: ReadonlyMap<string, number>) => void,
    private readonly schedule: (callback: () => void) => number = (callback) =>
      requestAnimationFrame(callback),
    private readonly cancel: (handle: number) => void = (handle) =>
      cancelAnimationFrame(handle),
  ) {}

  /** Record the bytes done for a file, applied with the next frame. */
  push(id: string, curr: number) {
    this.pending.set(id, curr);
    this.frame ??= this.schedule(() => this.flush());
  }

  /** Apply everything pending now, e.g. before showing a file as finished. */
  flush() {
    if (this.frame !== null) {
      this.cancel(this.frame);
      this.frame = null;
    }

    if (this.pending.size === 0) {
      return;
    }

    const updates = this.pending;
    this.pending = new Map();
    this.apply(updates);
  }
}
