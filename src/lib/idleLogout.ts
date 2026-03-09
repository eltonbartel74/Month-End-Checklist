import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "meh:lastActiveAt";

export function markActive() {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function getLastActiveAt(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Sets up an inactivity watcher. If there is no user activity for `idleMs`,
 * we sign out and redirect to /login.
 */
export function startIdleLogout(opts: {
  sb: SupabaseClient;
  idleMs: number;
  onIdle?: () => void;
}) {
  const { sb, idleMs, onIdle } = opts;

  const onActivity = () => markActive();
  const events: Array<keyof WindowEventMap> = [
    "click",
    "keydown",
    "mousemove",
    "scroll",
    "touchstart",
    "focus",
  ];

  // Initialise
  markActive();
  for (const ev of events) window.addEventListener(ev, onActivity, { passive: true });

  const interval = window.setInterval(async () => {
    const last = getLastActiveAt();
    if (!last) return;

    const idleFor = Date.now() - last;
    if (idleFor < idleMs) return;

    try {
      onIdle?.();
      await sb.auth.signOut();
    } finally {
      // Hard redirect so middleware + cookies are consistent.
      window.location.href = "/login";
    }
  }, 60_000);

  return () => {
    window.clearInterval(interval);
    for (const ev of events) window.removeEventListener(ev, onActivity);
  };
}
