import { SourceBusyError } from './host-pacer';

/**
 * A per-minute allowance of requests to one host: a sliding window of the
 * last minute's sends. Where `HostPacer` spaces requests out, this lets them
 * go at once until the minute's allowance is spent — the shape of a limit
 * stated as "N requests a minute", which a burst within it does not break.
 *
 * Over the allowance, `take` throws `SourceBusyError` with the time until the
 * oldest send leaves the window, and takes nothing. Per process, like the
 * pacer.
 */
export class RequestBudget {
  private readonly sent: number[] = [];

  constructor(
    readonly host: string,
    private readonly perMinute: number,
    private readonly now: () => number = Date.now
  ) {}

  take(): void {
    const t = this.now();
    while (this.sent.length && this.sent[0]! <= t - 60_000) this.sent.shift();
    if (this.sent.length >= this.perMinute) throw new SourceBusyError(this.host, this.sent[0]! + 60_000 - t);
    this.sent.push(t);
  }
}
