import { useEffect, useRef, useState } from 'react';
import { getPollingLeaderSnapshot, subscribePollingLeader } from './tabLeader';

const MIN_ACTIVE_POLL_MS = Number(import.meta.env?.VITE_MIN_ACTIVE_POLL_MS || 300000);
const MIN_HIDDEN_POLL_MS = Number(import.meta.env?.VITE_MIN_HIDDEN_POLL_MS || 1800000);
const FAILURE_BACKOFF_MULTIPLIER_CAP = 6;
const HIDDEN_BACKOFF_MULTIPLIER_CAP = 12;
const IDLE_AUTO_PAUSE_MS = Number(import.meta.env?.VITE_IDLE_AUTO_PAUSE_MS || 3 * 60 * 1000);
const DISABLE_BACKGROUND_POLLING = String(import.meta.env?.VITE_DISABLE_BACKGROUND_POLLING || 'false').toLowerCase() === 'true';

function markUserActivity() {
  if (typeof window === 'undefined') return;
  window.__CAREER_CROX_LAST_USER_ACTIVITY__ = Date.now();
}

function installActivityTracker() {
  if (typeof window === 'undefined' || window.__CAREER_CROX_ACTIVITY_TRACKER_INSTALLED__) return;
  window.__CAREER_CROX_ACTIVITY_TRACKER_INSTALLED__ = true;
  markUserActivity();
  const events = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll', 'focus'];
  for (const eventName of events) {
    window.addEventListener(eventName, markUserActivity, { passive: true, capture: true });
  }
}

installActivityTracker();

function normalizeInterval(intervalMs) {
  const value = Number(intervalMs || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(value, MIN_ACTIVE_POLL_MS);
}

function isUserRecentlyActive() {
  if (typeof document !== 'undefined' && document.hidden) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (typeof window === 'undefined') return true;
  const last = Number(window.__CAREER_CROX_LAST_USER_ACTIVITY__ || Date.now());
  return (Date.now() - last) <= IDLE_AUTO_PAUSE_MS;
}

export function usePolling(callback, intervalMs, deps = []) {
  const callbackRef = useRef(callback);
  const runningRef = useRef(false);
  const failureCountRef = useRef(0);
  const [leaderState, setLeaderState] = useState(() => getPollingLeaderSnapshot());

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => subscribePollingLeader(setLeaderState), []);

  useEffect(() => {
    const baseIntervalMs = normalizeInterval(intervalMs);
    if (!baseIntervalMs || !leaderState?.isLeader || DISABLE_BACKGROUND_POLLING) return undefined;
    let active = true;
    let timer = null;

    const scheduleNext = (overrideMs = 0) => {
      if (!active) return;
      const failureMultiplier = Math.min(FAILURE_BACKOFF_MULTIPLIER_CAP, 1 + failureCountRef.current);
      const hiddenMultiplier = (typeof document !== 'undefined' && document.hidden)
        ? Math.min(HIDDEN_BACKOFF_MULTIPLIER_CAP, 2 + failureCountRef.current)
        : 1;
      const normalizedMs = Math.max(
        overrideMs || 0,
        baseIntervalMs * failureMultiplier * hiddenMultiplier,
        typeof document !== 'undefined' && document.hidden ? MIN_HIDDEN_POLL_MS : baseIntervalMs,
      );
      const jitter = Math.min(2500, Math.round(normalizedMs * 0.08 * Math.random()));
      timer = window.setTimeout(run, normalizedMs + jitter);
    };

    const run = async () => {
      if (!active || runningRef.current) {
        scheduleNext();
        return;
      }
      if (!isUserRecentlyActive()) {
        scheduleNext(MIN_HIDDEN_POLL_MS);
        return;
      }
      runningRef.current = true;
      try {
        await callbackRef.current?.();
        failureCountRef.current = 0;
      } catch {
        failureCountRef.current = Math.min(5, failureCountRef.current + 1);
      } finally {
        runningRef.current = false;
        scheduleNext();
      }
    };

    scheduleNext(baseIntervalMs);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, leaderState?.isLeader, ...deps]);
}
