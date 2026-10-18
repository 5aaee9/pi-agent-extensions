/**
 * Contracts this browser half depends on.
 *
 * The bundle is loaded from the page's module table, so it imports no Harness
 * package types at runtime; these declarations are the honest record of the
 * services and slot props it actually uses.
 *
 * @module @indexyz/dsh-prompt-suggestions/client/contracts
 */

/** Locale namespace, settings entry id, and settings namespace share one name. */
export const NS = "prompt-suggestions";

/** Error half of one Remote response. */
export interface RemoteError {
  readonly code?: string;
  readonly message?: string;
}

/** Envelope every Remote method answers with. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error?: RemoteError };

/** One settings namespace as the Host reports it. */
export interface NamespaceView {
  readonly ns: string;
  readonly revision?: number;
  readonly value?: { readonly enabled?: boolean };
}

/** Body of `settings.describe()`. */
export interface SettingsDescribe {
  readonly writable?: boolean;
  readonly namespaces?: readonly NamespaceView[];
}

/** The `settings` Remote namespace face this half reads and writes. */
export interface SettingsFace {
  describe(): Promise<RemoteResult<SettingsDescribe>>;
  update(
    ns: string,
    patch: Record<string, unknown>,
    revision?: number,
  ): Promise<RemoteResult<NamespaceView>>;
}

/** The generic Connection call face the suggestion query uses. */
export interface ConnectionFace {
  readonly rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<RemoteResult<unknown>>;
  };
}

/** Locale client service. */
export interface LocaleFace {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void;
  bind(namespace: string): (key: string) => string;
}

/** One effective keyboard binding as the shortcut catalog reports it. */
export interface NormalizedShortcutBinding {
  readonly code: string;
  readonly modifiers: readonly string[];
}

/** One editable shortcut catalog row. */
export interface ShortcutCatalogEntry {
  readonly binding: NormalizedShortcutBinding | null;
}

/** One fixed, owner-held shortcut row. */
export interface ShortcutFixedEntry {
  readonly bindings: readonly NormalizedShortcutBinding[];
}

/** The subset of the `shortcuts` service consulted before accepting a key. */
export interface ShortcutsFace {
  readonly catalog?: { getSnapshot(): readonly ShortcutCatalogEntry[] };
  readonly fixedCatalog?: { getSnapshot(): readonly ShortcutFixedEntry[] };
}

/** Slot runtime face for the registrations this half makes. */
export interface SlotsFace {
  inject(slot: string, register: () => unknown): unknown;
  register(
    options: Record<string, unknown>,
    render: (props: Record<string, unknown>) => unknown,
  ): unknown;
}

/** The plugin context this half receives from the module loader. */
export interface ClientContext {
  get<T = unknown>(service: string): T | undefined;
  effect(effect: () => unknown, label?: string): unknown;
  readonly locale: LocaleFace;
  readonly slots: SlotsFace;
}

/** One published composer input snapshot (the subset the overlay reads). */
export interface InputState {
  readonly draft: string;
  readonly phase: "plain" | "adjudicating" | "claimed" | "submitting";
  readonly attachmentIds: readonly unknown[];
}

/** One Session lifecycle snapshot (the subset the overlay reads). */
export interface SessionSnapshot {
  readonly running: boolean;
  readonly blank: boolean;
  readonly openState: "cold" | "loading" | "open" | "error";
  readonly removed: boolean;
  readonly lastAgentError: string | null;
}

/** Selector hook over one observable snapshot. */
export type SnapshotHook<T> = <Selected>(selector: (value: T) => Selected) => Selected;

/** The stable composer actions the overlay may call. */
export interface InputActions {
  captureInsertion(): { readonly start: number; readonly end: number };
  insertText(text: string, span: { readonly start: number; readonly end: number }): boolean;
  setDraft(text: string): void;
}

/** Props the `conversation.input.overlay` slot supplies. */
export interface OverlayProps {
  readonly sessionId: string;
  readonly useInput: SnapshotHook<InputState>;
  readonly useSession: SnapshotHook<SessionSnapshot>;
  readonly inputActions: InputActions;
}

/** One suggestion answer returned by the Host route. */
export type SuggestionReply =
  | { readonly state: "ready"; readonly text: string }
  | { readonly state: "pending" }
  | { readonly state: "none" }
  | { readonly state: "disabled" };
