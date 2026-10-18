/**
 * The page's own state shapes and the pure derivations over them.
 *
 * Nothing here touches React, so the page component stays a shell around these
 * rules and each rule can be read (and tested) on its own.
 *
 * @module @indexyz/dsh-autocompact/client/state
 */

import type { CatalogGroup } from "./contracts.ts";
import { parseLimit } from "./limits.ts";

/** One `provider/model` threshold row. */
export interface Row {
  readonly key: string;
  readonly value: number;
}

/** The editable view of the bundle row, as last read from or written to the Host. */
export interface ViewState {
  readonly writable: boolean;
  /** Settings namespace writes address: the Loader entry id the Host reported. */
  readonly ns: string;
  readonly revision?: number;
  readonly enabled: boolean;
  /** Persisted deployment-wide threshold, or `undefined` when unset. */
  readonly defaultLimit: number | undefined;
  readonly limits: readonly Row[];
}

/** Page load state. */
export type Status =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

/** One transient result line. */
export interface Notice {
  readonly kind: "error" | "warn" | "success";
  readonly text: string;
}

/** The add-model draft. */
export interface Pick {
  readonly provider: string;
  readonly model: string;
  readonly limit: string;
  readonly manualRoute: string;
}

/** One `provider/model` key per configured limit, in stable order. */
export function toEntries(modelLimits: unknown): Row[] {
  if (modelLimits === null || typeof modelLimits !== "object" || Array.isArray(modelLimits)) {
    return [];
  }
  return Object.entries(modelLimits)
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => ({ key, value: value as number }));
}

/**
 * The persisted deployment default, or `undefined` when the row carries none.
 *
 * Defensive like {@link toEntries}: anything that is not a positive integer is
 * treated as unset, even though the Host validates the row before it is loaded.
 */
export function toDefaultLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** The rows the editor shows: stored limits plus staged additions, minus staged removals. */
export function visibleRows(
  state: ViewState | null,
  added: readonly string[],
  draft: Readonly<Record<string, string>>,
  removed: readonly string[],
): Row[] {
  const base = state?.limits ?? [];
  const staged = added
    .filter((key) => !base.some((entry) => entry.key === key))
    .map((key) => ({ key, value: parseLimit(draft[key] ?? "") ?? 0 }));
  return [...base, ...staged].filter((entry) => !removed.includes(entry.key));
}

/** Whether the staged edits differ from the stored view. */
export function hasChanges(
  state: ViewState | null,
  added: readonly string[],
  removed: readonly string[],
  draft: Readonly<Record<string, string>>,
): boolean {
  if (removed.length > 0 || added.length > 0) return true;
  return Object.keys(draft).some((key) => {
    const current = (state?.limits ?? []).find((entry) => entry.key === key);
    return current === undefined || String(current.value) !== String(draft[key]).trim();
  });
}

/**
 * Whether the staged deployment default differs from the stored one.
 *
 * A blank draft means "unset", so it is a change only when a value is stored.
 * Anything that does not parse counts as a change too, so the Save control that
 * reports the invalid value is reachable.
 */
export function defaultChanged(state: ViewState | null, raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return state?.defaultLimit !== undefined;
  const parsed = parseLimit(trimmed);
  return parsed === undefined || parsed !== state?.defaultLimit;
}

/** The `provider/model` key a manually typed route denotes, or `""` when incomplete. */
export function manualRouteOf(pick: Pick): string {
  const [provider, ...rest] = String(pick.manualRoute).split("/");
  const model = rest.join("/");
  return provider && model ? `${provider}/${model}` : "";
}

/**
 * The key the add control would add.
 *
 * A live catalog is addressed by its own provider/model selection; without one
 * the manually typed route stands in.
 */
export function addKeyOf(groups: readonly CatalogGroup[], pick: Pick, manualRoute: string): string {
  if (groups.length === 0) return manualRoute;
  return pick.provider && pick.model ? `${pick.provider}/${pick.model}` : "";
}

/** Whether a key already has a row. */
export function hasRow(rows: readonly Row[], key: string): boolean {
  return key !== "" && rows.some((entry) => entry.key === key);
}
