import { useEffect, useRef, useState } from 'react';

/** Like useState, but the value is mirrored to sessionStorage under `key` -
 * survives navigating to another page and back within the same browser tab,
 * but clears when the tab/browser closes (unlike localStorage, which would
 * leave stale drafts lingering for days and confuse whoever opens the page
 * next). Falls back silently to plain in-memory state if sessionStorage is
 * unavailable (private browsing, quota exceeded, etc.) - draft persistence
 * is a nice-to-have, never worth breaking the page over.
 *
 * Never pass sensitive values (passwords, tokens) or non-JSON-serializable
 * values (File/Blob, React nodes, functions) through this - they either
 * shouldn't be persisted at all or can't round-trip through JSON. */
export function usePersistedState<T>(key: string, initialValue: T) {
  const fullKey = `ops-draft:${key}`;
  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(fullKey);
      return raw !== null ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  // initialValue is only read on first mount (matches useState semantics) -
  // ref avoids re-running the write effect if a caller passes a fresh
  // literal/object as initialValue on every render.
  const keyRef = useRef(fullKey);
  useEffect(() => {
    try {
      sessionStorage.setItem(keyRef.current, JSON.stringify(state));
    } catch {
      // ignore - see module docstring
    }
  }, [state]);

  return [state, setState] as const;
}

/** Clears a persisted draft - call after a real (non-dry-run) submission
 * succeeds, so the next visit starts from a blank form instead of showing
 * already-acted-upon input as if it were still pending. */
export function clearPersistedState(key: string) {
  try {
    sessionStorage.removeItem(`ops-draft:${key}`);
  } catch {
    // ignore
  }
}
