type PerfDetail = Record<string, string | number | boolean | null | undefined>;

const importMetaEnv = typeof import.meta !== 'undefined'
  ? (import.meta as unknown as { env?: { DEV?: boolean; MODE?: string; VITE_AGENTRY_PERF?: string } }).env
  : undefined;
const enabled = Boolean(
  importMetaEnv?.VITE_AGENTRY_PERF === '1'
  || (importMetaEnv?.DEV && importMetaEnv.MODE !== 'test'),
);

function formatDetail(detail?: PerfDetail): string {
  if (!detail) return '';
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export function markPerf(_label: string): number {
  if (!enabled || typeof performance === 'undefined') return 0;
  return performance.now();
}

export function logPerf(label: string, start: number, detail?: PerfDetail): void {
  if (!enabled || typeof performance === 'undefined' || start <= 0) return;
  const duration = performance.now() - start;
  console.debug(`[perf] ${label} ${duration.toFixed(1)}ms${formatDetail(detail)}`);
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
