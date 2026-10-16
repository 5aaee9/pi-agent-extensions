/**
 * Browser half of `@indexyz/dsh-autocompact`.
 *
 * The Host half owns the session-only `/autocompact` command and the pressure
 * check. This half contributes one page to Settings that edits the bundle row's
 * `modelLimits` — the persisted global defaults — through the Host `settings`
 * Remote namespace, so the profile patch keeps the value and survives upgrades.
 *
 * This is the TypeScript source of that page, organized as: `contracts` (the
 * Host/slot/locale shapes it depends on), `services` (access to them),
 * `state` + `limits` (its own state and the threshold grammar), `dictionary` +
 * `styles` (its strings and styles), `page` with `threshold-list` and
 * `add-model` (the section itself), and `crash-boundary` (its crash face).
 *
 * It is authored as an ordinary browser module (React from the page's module
 * table) and built by tsdown/oxc into `client.js`, the artifact the Harness
 * module loader materializes: the build wraps the compiled CJS body in the
 * loader's factory registration, and `react` / `react/jsx-runtime` stay external
 * because the page's module table provides them. Run `npm run build:client`
 * after editing any file here.
 *
 * @module @indexyz/dsh-autocompact/client
 */

import type { ClientContext } from "./contracts.ts";
import { NS } from "./contracts.ts";
import { PageCrashBoundary, StatusLineCrashBoundary } from "./crash-boundary.tsx";
import { DICT } from "./dictionary.ts";
import { AutocompactPage } from "./page.tsx";
import { bindContext } from "./services.ts";
import { AutocompactStatus } from "./status-dock.tsx";

/**
 * Client services this half needs before it mounts.
 *
 * `remote.settings` is declared because this page writes the bundle row's
 * `modelLimits` through that namespace: declaring it makes Cordis hold this
 * plugin until the namespace is mounted, and it is what authorizes the
 * namespace face. `remote.session` is read opportunistically for the model
 * catalog, so it stays out of `inject` — the page works without it (manual
 * route entry).
 */
export const inject = ["slots", "locale", "remote.settings"] as const;

/**
 * Register this half's dictionaries, its Settings section, and its composer
 * status line.
 *
 * @param ctx - Client context carrying the locale and slot services.
 */
export function apply(ctx: ClientContext): void {
  bindContext(ctx);
  ctx.effect(() => ctx.locale.register(NS, DICT), "dsh-autocompact: dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.effect(
    () =>
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: NS,
            order: 25,
            locale: NS,
            label: () => t("nav"),
          },
          (props) => (
            <PageCrashBoundary title={t("title")} hint={t("crash")}>
              <AutocompactPage {...props} t={t} />
            </PageCrashBoundary>
          ),
        ),
      ),
    "dsh-autocompact: settings section",
  );
  // Settings keeps which section is open in a store the settings shell owns, and
  // that store's live instance is not exposed to plugins; the Settings panel is a
  // modal, not a registered central panel either. So the page a user reaches from
  // the status pill is a central panel of this plugin's own, under the same key the
  // pill selects — one editor, one store, two surfaces.
  ctx.effect(
    () =>
      ctx.slots.inject("main", () =>
        ctx.slots.register({ name: "main", key: NS }, () => (
          <div className="dsha-panel">
            <PageCrashBoundary title={t("title")} hint={t("crash")}>
              <AutocompactPage t={t} />
            </PageCrashBoundary>
          </div>
        )),
      ),
    "dsh-autocompact: threshold panel",
  );
  // The status line belongs in the composer's ambient row, beside the session's
  // turn, token, and context readings: it renders per session, right after that
  // stats entry, and disappears with the composer.
  ctx.effect(
    () =>
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register({ name: "conversation.composer.dock", id: NS, order: 10 }, (props) => (
          <StatusLineCrashBoundary>
            <AutocompactStatus t={t} kit={props as Readonly<Record<string, unknown>>} />
          </StatusLineCrashBoundary>
        )),
      ),
    "dsh-autocompact: composer status",
  );
}
