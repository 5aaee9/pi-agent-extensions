/**
 * Browser-local mirror of the Host `enabled` switch.
 *
 * The Settings row and the composer overlay live in separate React trees, so a
 * tiny module store lets a saved switch hide or reveal the overlay immediately.
 * The Host remains authoritative: the suggestion route returns `disabled` when
 * its live config is off.
 *
 * @module @indexyz/dsh-prompt-suggestions/client/enabled
 */

import { useEffect, useState } from "react";

let enabled = true;
const listeners = new Set<() => void>();

/** Current mirror value. */
export function enabledSnapshot(): boolean {
  return enabled;
}

/** Publish one local value to every subscribed component. */
export function setEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  for (const listener of listeners) listener();
}

/** Subscribe to local mirror changes. */
export function subscribeEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook over the local mirror. */
export function useEnabled(): boolean {
  const [value, setValue] = useState(enabledSnapshot);
  useEffect(() => {
    setValue(enabledSnapshot());
    return subscribeEnabled(() => setValue(enabledSnapshot()));
  }, []);
  return value;
}
