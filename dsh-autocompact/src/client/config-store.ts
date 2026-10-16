/**
 * The configured thresholds, as every surface in this half reads them.
 *
 * The Settings page and the composer status line both need the bundle row's
 * current view; both read it here so one `settings.describe()` serves both, and
 * so a save on the page is visible to the status line without another round
 * trip (`publishView`).
 *
 * The store is deliberately React-free: `subscribe`/`getSnapshot` are the
 * `useSyncExternalStore` contract, and the snapshot reference only changes when
 * the view does.
 *
 * @module @indexyz/dsh-autocompact/client/config-store
 */

import type { NamespaceView } from "./contracts.ts";
import { messageOf } from "./limits.ts";
import { pickNamespace, settingsFace } from "./services.ts";
import { toEntries } from "./state.ts";

/** The bundle row's editable values. */
export interface AutocompactConfig {
  readonly enabled: boolean;
  /** Configured absolute token count per `provider/model` key. */
  readonly limits: Readonly<Record<string, number>>;
  readonly writable: boolean;
  /** Settings namespace the Host reported; writes address it verbatim. */
  readonly ns: string;
  readonly revision?: number;
}

/** What the surfaces know about the bundle row right now. */
export type ConfigSnapshot =
  | { readonly state: "loading" }
  /** The deployment does not expose a configurable autocompact row. */
  | { readonly state: "absent" }
  | { readonly state: "error"; readonly message: string }
  | { readonly state: "ready"; readonly config: AutocompactConfig };

let snapshot: ConfigSnapshot = { state: "loading" };
let inFlight: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** Build one config from a describe view. */
function configFrom(view: NamespaceView, writable: unknown): AutocompactConfig {
  const value = view.value ?? {};
  const limits: Record<string, number> = {};
  for (const entry of toEntries(value.modelLimits)) limits[entry.key] = entry.value;
  return {
    enabled: value.enabled !== false,
    limits,
    writable: writable !== false,
    ns: view.ns,
    revision: view.revision,
  };
}

function emit(next: ConfigSnapshot): void {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Subscribe to config changes; the `useSyncExternalStore` subscribe half. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read the current config; the `useSyncExternalStore` snapshot half. */
export function getSnapshot(): ConfigSnapshot {
  return snapshot;
}

/**
 * Adopt a view a surface already holds.
 *
 * The Settings page calls this with every view it reads or writes, so the
 * status line follows an edit immediately.
 *
 * @param view - the namespace view, or `undefined` when the row is absent.
 * @param writable - the profile's writability flag from the same response.
 */
export function publishView(view: NamespaceView | undefined, writable?: unknown): void {
  emit(
    view === undefined
      ? { state: "absent" }
      : { state: "ready", config: configFrom(view, writable) },
  );
}

/**
 * Read the bundle row from the Host.
 *
 * Concurrent callers share one request, so a page open and several status lines
 * cost one round trip.
 */
export async function load(): Promise<void> {
  if (inFlight !== undefined) return inFlight;
  const settings = settingsFace();
  if (settings === undefined) {
    emit({ state: "absent" });
    return;
  }
  inFlight = (async () => {
    try {
      const response = await settings.describe();
      if (!response.ok) {
        emit({ state: "error", message: response.error?.message ?? "" });
        return;
      }
      publishView(pickNamespace(response.value), response.value.writable);
    } catch (error) {
      emit({ state: "error", message: messageOf(error) });
    } finally {
      inFlight = undefined;
    }
  })();
  return inFlight;
}
