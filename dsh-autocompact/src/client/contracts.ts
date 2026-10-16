/**
 * Contracts this browser half depends on.
 *
 * The page talks to the Host through Cordis services and Remote namespaces, and
 * renders inside one slot the shell owns; these are the shapes of those
 * boundaries. They are declared here rather than imported from a Harness client
 * package: a bundle plugin must not depend on one, and a local declaration is
 * also the honest record of what this page actually uses.
 *
 * @module @indexyz/dsh-autocompact/client/contracts
 */

/** Locale namespace, settings entry id, and section id share one name. */
export const NS = "autocompact";

/** Interpolation parameters for one dictionary entry. */
export type TranslateParams = Readonly<Record<string, string | number>>;

/** Localized text lookup bound to this module's locale namespace. */
export type Translate = (key: string, params?: TranslateParams) => string;

/**
 * Locale client service.
 *
 * `register` installs this module's dictionaries for its own namespace;
 * `bind` returns the translator for it, which falls back to the key itself when
 * a lookup misses — so a missing entry degrades to visible text, never a crash.
 */
export interface LocaleFace {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void;
  bind(namespace: string): Translate;
}

/**
 * The slots this half registers in.
 *
 * `settings.section` is the Settings page; `conversation.composer.dock` is the
 * ambient row below the composer card, where the session's turn, token, and
 * context readings sit — the composer declares it once per session. `main` is
 * the central panel registry keyed by sidebar entry id, which is where the
 * status pill sends a user who wants to change a threshold.
 */
export type SlotName = "settings.section" | "conversation.composer.dock" | "main";

/** One slot registration: the cell identity its kind asks for, plus the entry. */
export interface SlotRegistration {
  readonly name: SlotName;
  /** Cell id: what a `list` slot requires. */
  readonly id?: string;
  /** Cell key: what a `keyed` slot (such as `main`) requires instead. */
  readonly key?: string;
  readonly order?: number;
  readonly label?: () => string;
  readonly locale?: string;
}

/** Slot runtime face for the registrations this half makes. */
export interface SlotsFace {
  inject(slot: string, register: () => () => void): () => void;
  register(
    options: SlotRegistration,
    component: (props: SectionProps) => React.ReactElement,
  ): () => void;
  /**
   * The entries registered in one slot cell.
   *
   * Read to reach the settings shell's store seat. Its handle is pinned to the
   * live instance, so `create()` answers the store the settings panel renders
   * from rather than a fresh one.
   */
  entries?(slot: string): readonly StoredSlotEntry[];
}

/** One entry registered in a slot cell, as far as this half reads it. */
export interface StoredSlotEntry {
  /** The store seat this entry declared, if any. */
  readonly store?: StoreHandle;
}

/** A declared store: its action table, and the instance the slot renders from. */
export interface StoreHandle {
  /** The declaration: `init`, optional persistence, and the action table. */
  readonly spec?: StoreSpec;
  create(): StoreInstance;
}

/** A store declaration. */
export interface StoreSpec {
  /** The declared mutators, keyed by the action name a caller invokes. */
  readonly actions?: Record<string, unknown>;
}

/** A live store instance: its baked actions, including `openSection` on the settings shell. */
export interface StoreInstance {
  readonly actions?: Record<string, (...params: string[]) => void>;
}

/** Props the shell hands every `settings.section` entry, plus the bound translator. */
export interface SectionProps {
  /** Close the settings panel (the shell owns the open state). */
  readonly close?: () => void;
  /** Bound translator, injected by this module's own registration. */
  readonly t: Translate;
  readonly [kit: string]: unknown;
}

/** The plugin context this module declares in {@link inject}. */
export interface ClientContext {
  /** Read one Cordis service without the inject requirement; never throws for a missing service. */
  get<T = unknown>(service: string): T | undefined;
  /** Run one effect, disposing it with this plugin. */
  effect(effect: () => unknown, label?: string): () => void;
  readonly locale: LocaleFace;
  readonly slots: SlotsFace;
}

/** Error half of one Remote response. */
export interface RemoteError {
  readonly code?: string;
  readonly message?: string;
}

/** Envelope every Remote namespace method answers with. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error?: RemoteError };

/** One settings namespace as the Host reports it. */
export interface NamespaceView {
  /** The Loader entry id, which writes must address verbatim. */
  readonly ns: string;
  readonly revision?: number;
  readonly value?: {
    readonly enabled?: unknown;
    readonly modelLimits?: unknown;
  };
}

/** Body of `settings.describe()`. */
export interface SettingsDescribe {
  readonly writable?: boolean;
  readonly namespaces?: readonly NamespaceView[];
}

/** One field edit inside a settings namespace. */
export interface SettingsOp {
  readonly op: "set" | "unset";
  readonly path: readonly string[];
  readonly value?: number;
}

/** The `settings` Remote namespace face this page writes through. */
export interface SettingsNamespace {
  describe(): Promise<RemoteResult<SettingsDescribe>>;
  update(
    ns: string,
    patch: Record<string, unknown>,
    revision?: number,
  ): Promise<RemoteResult<NamespaceView>>;
  mutate(
    ns: string,
    ops: readonly SettingsOp[],
    revision?: number,
  ): Promise<RemoteResult<NamespaceView>>;
}

/** One model inside the live catalog. */
export interface CatalogModel {
  readonly id: string;
  readonly name?: string;
}

/** One provider group inside the live catalog. */
export interface CatalogGroup {
  readonly id: string;
  readonly name?: string;
  readonly models?: readonly CatalogModel[];
}

/**
 * The client `layout` service face, read only to navigate.
 *
 * `selectPanel` throws when the key is not registered, so callers hold it in a
 * `try`: a pill must never take the composer down for a missing panel.
 */
export interface LayoutFace {
  /** Select a registered central panel key, or `null` for the Conversation. */
  selectPanel(panelId: string): void;
}

/** The `session` Remote namespace face, read only for the model picker. */
export interface SessionNamespace {
  modelCatalog(): Promise<RemoteResult<{ readonly groups?: readonly CatalogGroup[] }>>;
}
