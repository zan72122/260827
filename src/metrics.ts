// Local-only play metrics. Never transmitted anywhere; hidden from the
// production screen (visible only with ?debug=1). Used to tune the
// understand→play transition during development.

interface MetricsData {
  sessionStart: number;
  firstInputMs: number | null;       // time to first meaningful input
  firstDescentDoneMs: number | null; // time to first successful full descent
  firstRetryMs: number | null;       // first time the child re-scrubbed the chimney after understanding
  hintCount: number;
  descents: number;
  loopsCompleted: number;
}

const KEY = 'santa-chimney-metrics-v1';

class Metrics {
  data: MetricsData;
  private t0: number;

  constructor() {
    this.t0 = performance.now();
    this.data = {
      sessionStart: Date.now(),
      firstInputMs: null,
      firstDescentDoneMs: null,
      firstRetryMs: null,
      hintCount: 0,
      descents: 0,
      loopsCompleted: 0
    };
    this.load();
  }

  private now(): number {
    return Math.round(performance.now() - this.t0);
  }

  firstInput(): void {
    if (this.data.firstInputMs === null) {
      this.data.firstInputMs = this.now();
      this.save();
    }
  }

  descentDone(): void {
    this.data.descents++;
    if (this.data.firstDescentDoneMs === null) {
      this.data.firstDescentDoneMs = this.now();
    }
    this.save();
  }

  retry(): void {
    if (this.data.firstRetryMs === null) {
      this.data.firstRetryMs = this.now();
      this.save();
    }
  }

  hint(): void {
    this.data.hintCount++;
    this.save();
  }

  loopCompleted(): void {
    this.data.loopsCompleted++;
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode etc. — metrics stay in memory */
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const prev = JSON.parse(raw) as MetricsData;
        // keep lifetime counters across sessions, reset per-session timers
        this.data.hintCount = 0;
        this.data.loopsCompleted = prev.loopsCompleted || 0;
      }
    } catch {
      /* ignore */
    }
  }

  summary(): string {
    const d = this.data;
    return [
      `firstInput: ${d.firstInputMs ?? '-'}ms`,
      `firstDescent: ${d.firstDescentDoneMs ?? '-'}ms`,
      `firstRetry: ${d.firstRetryMs ?? '-'}ms`,
      `hints: ${d.hintCount}`,
      `descents: ${d.descents}`,
      `loops: ${d.loopsCompleted}`
    ].join('\n');
  }
}

export const metrics = new Metrics();
