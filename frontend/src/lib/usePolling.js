import { useEffect, useRef } from 'react';

export function usePolling(callback, intervalMs, deps = []) {
  const callbackRef = useRef(callback);
  const runningRef = useRef(false);
  const failureCountRef = useRef(0);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!intervalMs) return undefined;
    let active = true;
    let timer = null;

    const scheduleNext = () => {
      if (!active) return;
      const backoffMultiplier = Math.min(4, 1 + failureCountRef.current);
      const nextMs = failureCountRef.current > 0 ? intervalMs * backoffMultiplier : intervalMs;
      timer = window.setTimeout(run, nextMs);
    };

    const run = async () => {
      if (!active || runningRef.current) {
        scheduleNext();
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        scheduleNext();
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) {
        timer = window.setTimeout(run, Math.max(intervalMs * 2, 10000));
        return;
      }
      runningRef.current = true;
      try {
        await callbackRef.current?.();
        failureCountRef.current = 0;
      } catch {
        failureCountRef.current = Math.min(3, failureCountRef.current + 1);
      } finally {
        runningRef.current = false;
        scheduleNext();
      }
    };

    run();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);
}
