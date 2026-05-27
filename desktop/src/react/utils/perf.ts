type PerfDetail = Record<string, string | number | boolean | null | undefined>;

const importMetaEnv = typeof import.meta !== 'undefined'
  ? (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string; VITE_AGENTRY_PERF?: string } }).env
  : undefined;
const envEnabled = Boolean(
  importMetaEnv?.VITE_AGENTRY_PERF === '1'
  || (importMetaEnv?.DEV && importMetaEnv.MODE !== 'test'),
);
const persistedPrefixes = ['welcome.agent.'];

let perfTraceSeq = 0;
type PerfTrace = {
  id: string;
  label: string;
  detail?: PerfDetail;
  expiresAt: number;
};

let longTaskObserverStarted = false;
let eventLoopObserverStarted = false;
let activeTrace: PerfTrace | null = null;
let recentTrace: PerfTrace | null = null;
let persistBuffer: string[] = [];
let persistFlushTimer: number | null = null;

function shouldPersist(label: string): boolean {
  return persistedPrefixes.some(prefix => label.startsWith(prefix));
}

function shouldCapture(label: string): boolean {
  return envEnabled || shouldPersist(label);
}

function formatDetail(detail?: PerfDetail): string {
  if (!detail) return '';
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function clientClock(): string {
  const now = new Date();
  return [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':') + '.' + String(now.getMilliseconds()).padStart(3, '0');
}

function detailForTrace(trace: PerfTrace): PerfDetail {
  return { ...(trace.detail || {}), trace: trace.id, traceLabel: trace.label };
}

function currentTraceDetail(): PerfDetail | undefined {
  if (!activeTrace) return undefined;
  if (typeof performance !== 'undefined' && performance.now() > activeTrace.expiresAt) {
    recentTrace = activeTrace;
    activeTrace = null;
    return undefined;
  }
  return detailForTrace(activeTrace);
}

function recentTraceDetail(): PerfDetail | undefined {
  const active = currentTraceDetail();
  if (active) return active;
  if (!recentTrace) return undefined;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now > recentTrace.expiresAt) {
    recentTrace = null;
    return undefined;
  }
  return detailForTrace(recentTrace);
}

function mergeTraceDetail(detail?: PerfDetail): PerfDetail | undefined {
  if (detail?.trace) return detail;
  const trace = currentTraceDetail();
  if (!trace) return detail;
  return { ...trace, ...(detail || {}) };
}

function flushPersistedPerfLines(): void {
  persistFlushTimer = null;
  if (persistBuffer.length === 0 || typeof window === 'undefined') return;
  const lines = persistBuffer;
  persistBuffer = [];
  try {
    window.__hanaLog?.('log', 'perf', lines.join('\n'));
  } catch {
    // perf logging must never affect the UI path being measured
  }
}

function persistPerfLine(line: string): void {
  if (typeof window === 'undefined') return;
  persistBuffer.push(line);
  if (persistBuffer.length >= 20) {
    if (persistFlushTimer != null) {
      window.clearTimeout(persistFlushTimer);
      persistFlushTimer = null;
    }
    flushPersistedPerfLines();
    return;
  }
  if (persistFlushTimer == null) {
    persistFlushTimer = window.setTimeout(flushPersistedPerfLines, 50);
  }
}

function emitPerfLine(label: string, message: string): void {
  const line = `${message} client=${clientClock()}`;
  if (envEnabled) console.debug(`[perf] ${line}`);
  if (!shouldPersist(label) || typeof window === 'undefined') return;
  persistPerfLine(line);
}

export function markPerf(label: string): number {
  if (!shouldCapture(label) || typeof performance === 'undefined') return 0;
  return performance.now();
}

export function logPerf(label: string, start: number, detail?: PerfDetail): void {
  if (!shouldCapture(label) || typeof performance === 'undefined' || start <= 0) return;
  const duration = performance.now() - start;
  emitPerfLine(label, `${label} ${duration.toFixed(1)}ms${formatDetail(mergeTraceDetail(detail))}`);
}

export function logPerfEvent(label: string, detail?: PerfDetail): void {
  if (!shouldCapture(label)) return;
  emitPerfLine(label, `${label}${formatDetail(mergeTraceDetail(detail))}`);
}

export function beginPerfTrace(label: string, detail?: PerfDetail, ttlMs = 15_000): string {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const traceId = `${Date.now().toString(36)}-${++perfTraceSeq}`;
  activeTrace = {
    id: traceId,
    label,
    detail,
    expiresAt: now + ttlMs,
  };
  logPerfEvent(`${label}.trace`, { ...(detail || {}), trace: traceId, phase: 'start' });
  return traceId;
}

export function endPerfTrace(traceId: string, detail?: PerfDetail): void {
  if (!activeTrace || activeTrace.id !== traceId) return;
  logPerfEvent(`${activeTrace.label}.trace`, { ...(detail || {}), trace: traceId, phase: detail?.phase || 'end' });
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  recentTrace = { ...activeTrace, expiresAt: now + 5_000 };
  activeTrace = null;
}

export function logAsyncPerf<T>(
  label: string,
  run: () => Promise<T>,
  detail?: PerfDetail | ((result: T) => PerfDetail),
): Promise<T> {
  const start = markPerf(label);
  return run().then((result) => {
    logPerf(label, start, typeof detail === 'function' ? detail(result) : detail);
    return result;
  }, (err) => {
    logPerf(label, start, { ...(typeof detail === 'function' ? {} : detail), failed: true });
    throw err;
  });
}

export function logNextFramePerf(label: string, detail?: PerfDetail): void {
  const start = markPerf(label);
  if (start <= 0 || typeof requestAnimationFrame === 'undefined') return;
  requestAnimationFrame(() => logPerf(label, start, detail));
}

function initEventLoopLagObserver(): void {
  if (eventLoopObserverStarted || typeof window === 'undefined' || typeof performance === 'undefined') return;
  eventLoopObserverStarted = true;
  const intervalMs = 250;
  let expected = performance.now() + intervalMs;
  window.setInterval(() => {
    const now = performance.now();
    const delay = now - expected;
    expected = now + intervalMs;
    if (delay < 150) return;
    const trace = recentTraceDetail();
    if (!trace) return;
    logPerfEvent('welcome.agent.eventLoopLag', {
      ...trace,
      delay: Math.round(delay),
    });
  }, intervalMs);
}

export function initPerfObservers(): void {
  initEventLoopLagObserver();
  if (longTaskObserverStarted || typeof PerformanceObserver === 'undefined') return;
  const supported = PerformanceObserver.supportedEntryTypes || [];
  if (!supported.includes('longtask')) return;
  longTaskObserverStarted = true;
  try {
    const observer = new PerformanceObserver((list) => {
      const trace = currentTraceDetail();
      if (!trace) return;
      for (const entry of list.getEntries()) {
        if (entry.duration < 120) continue;
        logPerfEvent('welcome.agent.longtask', {
          ...(trace || {}),
          duration: Math.round(entry.duration),
          start: Math.round(entry.startTime),
          name: entry.name || 'longtask',
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    longTaskObserverStarted = false;
  }
}
