const TAB_ID_KEY = 'career_crox_tab_id_v2';
const STORAGE_KEY = 'career_crox_poll_leader_v2';
const CHANNEL_NAME = 'career_crox_poll_leader_v2';
const HEARTBEAT_MS = 12000;
const STALE_MS = 32000;

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function getNow() {
  return Date.now();
}

function getTabId() {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.sessionStorage.getItem(TAB_ID_KEY);
    if (existing) return existing;
    const next = `tab_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    window.sessionStorage.setItem(TAB_ID_KEY, next);
    return next;
  } catch {
    return `tab_${Date.now().toString(36)}`;
  }
}

function readLeaderState() {
  if (typeof window === 'undefined') return null;
  try {
    return safeJsonParse(window.localStorage.getItem(STORAGE_KEY) || '');
  } catch {
    return null;
  }
}

function writeLeaderState(state) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function clearLeaderState(expectedTabId) {
  if (typeof window === 'undefined') return;
  try {
    const state = readLeaderState();
    if (!state || !expectedTabId || state.tabId === expectedTabId) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

class PollLeaderCoordinator {
  constructor() {
    this.tabId = getTabId();
    this.isLeader = false;
    this.listeners = new Set();
    this.started = false;
    this.heartbeatTimer = null;
    this.channel = null;
    this.handleStorage = this.handleStorage.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handleFocus = this.handleFocus.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
  }

  ensureStarted() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    if (typeof window.BroadcastChannel !== 'undefined') {
      try {
        this.channel = new window.BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = () => this.sync('channel');
      } catch {
        this.channel = null;
      }
    }
    window.addEventListener('storage', this.handleStorage);
    window.addEventListener('focus', this.handleFocus);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.heartbeatTimer = window.setInterval(() => this.tick(), HEARTBEAT_MS);
    this.sync('init');
  }

  snapshot() {
    return {
      tabId: this.tabId,
      isLeader: this.isLeader,
      hidden: typeof document !== 'undefined' ? document.hidden : false,
      focused: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true,
    };
  }

  notify() {
    const payload = this.snapshot();
    this.listeners.forEach((listener) => {
      try { listener(payload); } catch {}
    });
    if (this.channel) {
      try { this.channel.postMessage({ type: 'leader-update', payload }); } catch {}
    }
  }

  setLeader(nextValue, reason = '') {
    const normalized = Boolean(nextValue);
    if (this.isLeader === normalized) {
      if (normalized) this.writeHeartbeat(reason);
      return;
    }
    this.isLeader = normalized;
    if (normalized) this.writeHeartbeat(reason);
    this.notify();
  }

  writeHeartbeat(reason = '') {
    writeLeaderState({
      tabId: this.tabId,
      ts: getNow(),
      hidden: typeof document !== 'undefined' ? document.hidden : false,
      focused: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true,
      reason,
    });
  }

  canTakeLead(state) {
    if (!state || !state.tabId) return true;
    if (state.tabId === this.tabId) return true;
    const ageMs = getNow() - Number(state.ts || 0);
    if (ageMs > STALE_MS) return true;

    const selfVisible = typeof document !== 'undefined' ? !document.hidden : true;
    const selfFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    const leaderHidden = Boolean(state.hidden);
    const leaderFocused = Boolean(state.focused);

    if (selfVisible && leaderHidden) return true;
    if (selfVisible && selfFocused && !leaderFocused) return true;
    return false;
  }

  sync(reason = '') {
    if (typeof window === 'undefined') return;
    const state = readLeaderState();
    if (this.canTakeLead(state)) {
      this.setLeader(true, reason || 'takeover');
      return;
    }
    this.setLeader(Boolean(state && state.tabId === this.tabId), reason || 'observe');
  }

  tick() {
    if (typeof window === 'undefined') return;
    if (this.isLeader) {
      this.writeHeartbeat('heartbeat');
      return;
    }
    this.sync('tick');
  }

  subscribe(listener) {
    this.ensureStarted();
    this.listeners.add(listener);
    try { listener(this.snapshot()); } catch {}
    return () => {
      this.listeners.delete(listener);
    };
  }

  handleStorage(event) {
    if (event && event.key && event.key !== STORAGE_KEY) return;
    this.sync('storage');
  }

  handleVisibility() {
    this.sync('visibility');
  }

  handleFocus() {
    this.sync('focus');
  }

  handleBlur() {
    if (this.isLeader) this.writeHeartbeat('blur');
  }

  handleBeforeUnload() {
    if (this.isLeader) {
      clearLeaderState(this.tabId);
      this.isLeader = false;
      this.notify();
    }
  }
}

let coordinator = null;

function getCoordinator() {
  if (!coordinator) coordinator = new PollLeaderCoordinator();
  return coordinator;
}

export function subscribePollingLeader(listener) {
  return getCoordinator().subscribe(listener);
}

export function getPollingLeaderSnapshot() {
  return getCoordinator().snapshot();
}
