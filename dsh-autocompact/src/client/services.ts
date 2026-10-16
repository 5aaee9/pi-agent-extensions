/**
 * Access to the Host services this page reads and writes.
 *
 * @module @indexyz/dsh-autocompact/client/services
 */

import type {
  ClientContext,
  LayoutFace,
  NamespaceView,
  SessionNamespace,
  SettingsDescribe,
  SettingsNamespace,
  SlotsFace,
} from "./contracts.ts";
import { NS } from "./contracts.ts";

/** This module's own context, captured when the entry module binds it. */
let pluginCtx: ClientContext | undefined;

/**
 * Bind the plugin context every accessor below reads through.
 *
 * @param ctx - the context `apply` received.
 */
export function bindContext(ctx: ClientContext): void {
  pluginCtx = ctx;
}

/**
 * One Remote namespace, read as its own Cordis service.
 *
 * Every namespace is a service keyed `remote.<namespace>` (the api-gateway
 * mounts it that way), and a namespace is only reachable from a context that
 * declares it in `inject`. Reading the property off the `remote` service
 * instead goes through Cordis's nested-service resolution, which throws
 * `cannot get property "<ns>" without inject` — a crash this half must not
 * cause, because a throw while the settings section renders retires the whole
 * slot entry and leaves the page empty. `ctx.get` never throws for a missing
 * service, so this reads either the namespace or `undefined`.
 */
export function clientService<T>(name: string): T | undefined {
  try {
    return pluginCtx?.get<T>(name) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The `settings` Remote namespace face, or `undefined` while it is not mounted. */
export function settingsFace(): SettingsNamespace | undefined {
  const face = clientService<SettingsNamespace>("remote.settings");
  return typeof face?.describe === "function" ? face : undefined;
}

/** The `session` Remote namespace face, or `undefined` while it is not mounted. */
export function sessionFace(): SessionNamespace | undefined {
  const face = clientService<SessionNamespace>("remote.session");
  return typeof face?.modelCatalog === "function" ? face : undefined;
}

/**
 * The client `layout` service, or `undefined` in a composition without one.
 *
 * Read through {@link clientService} for the same reason as the Remote
 * namespaces: `ctx.get` answers `undefined` instead of throwing, so a pill whose
 * navigation is unavailable still renders its reading.
 */
export function layoutFace(): LayoutFace | undefined {
  const face = clientService<LayoutFace>("layout");
  return typeof face?.selectPanel === "function" ? face : undefined;
}

/** The slot cell the settings shell registers its modal and section nav under. */
const SETTINGS_CELL = "sidebar.settings";

/** The settings shell action that opens the modal directly on one section. */
const OPEN_SECTION = "openSection";

/**
 * Open the settings modal on one registered section.
 *
 * The settings shell registers its store seat with a handle pinned to the live
 * instance — `{ ...handle, create: () => instance }` — so resolving that seat
 * through the slot registry answers the very store the panel renders from, and
 * its `openSection(id)` (documented on the shell's own owner props as "open the
 * settings panel directly on one registered section") sets the active section and
 * opens the modal. A store declared any other way mints a fresh, unsubscribed
 * instance, whose actions change nothing on screen, so the lookup goes by
 * capability: only a store whose action table carries `openSection` is asked.
 *
 * @param section - the section id to open, which is this plugin's namespace.
 * @returns whether a store was asked. The action reports nothing back, so `false`
 * means "no such store here" and the caller keeps a destination of its own.
 */
export function openSettingsSection(section: string): boolean {
  const entries = clientService<SlotsFace>("slots")?.entries?.(SETTINGS_CELL);
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    const store = entry?.store;
    if (store === undefined || typeof store.create !== "function") continue;
    if (typeof store.spec?.actions?.[OPEN_SECTION] !== "function") continue;
    const open = store.create()?.actions?.[OPEN_SECTION];
    if (typeof open !== "function") continue;
    open(section);
    return true;
  }
  return false;
}

/** Read the bundle row's view out of one describe response. */
export function pickNamespace(value: SettingsDescribe | undefined): NamespaceView | undefined {
  const namespaces = value?.namespaces;
  if (!Array.isArray(namespaces)) return undefined;
  return (
    namespaces.find((view) => view.ns === NS) ??
    namespaces.find((view) => typeof view.ns === "string" && view.ns.endsWith(NS))
  );
}
