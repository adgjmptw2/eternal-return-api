export type Sleep = (ms: number) => Promise<void>

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Token bucket shared by every request of one client.
 * Tokens refill continuously; callers are served strictly in arrival order.
 */
export class RateLimiter {
  private tokens: number
  private lastRefillAt: number
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly intervalMs: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = defaultSleep,
  ) {
    this.tokens = burst
    this.lastRefillAt = now()
  }

  acquire(): Promise<void> {
    const turn = this.tail.then(() => this.take())
    this.tail = turn.catch(() => undefined)
    return turn
  }

  private refill(): void {
    const now = this.now()
    const elapsed = now - this.lastRefillAt
    if (elapsed <= 0) return
    this.tokens = Math.min(this.burst, this.tokens + elapsed / this.intervalMs)
    this.lastRefillAt = now
  }

  private async take(): Promise<void> {
    this.refill()
    while (this.tokens < 1) {
      await this.sleep(Math.ceil((1 - this.tokens) * this.intervalMs))
      this.refill()
    }
    this.tokens -= 1
  }
}
