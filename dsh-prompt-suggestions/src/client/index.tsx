import type { ClientContext, OverlayProps } from "./contracts.ts";
import { NS } from "./contracts.ts";
import { Boundary } from "./boundary.tsx";
import { bindClientContext } from "./context.ts";
import { DICT } from "./dictionary.ts";
import { SuggestionOverlay } from "./overlay.tsx";
import { SettingsItem } from "./settings.tsx";

/** Services required before this browser half can register its slots. */
export const inject = ["connection", "locale", "slots", "remote.settings"] as const;

/**
 * Register the composer overlay and the General settings switch.
 *
 * The slot bodies are wrapped in a local error boundary: a composer or settings
 * rendering failure degrades this plugin only, never the host page.
 * @param ctx - the browser plugin context from the module loader.
 */
export function apply(ctx: ClientContext): void {
  bindClientContext(ctx);
  ctx.effect(() => ctx.locale.register(NS, DICT), "dsh-prompt-suggestions: locale");
  const t = ctx.locale.bind(NS);

  ctx.effect(
    () =>
      ctx.slots.inject("conversation.input.overlay", () =>
        ctx.slots.register({ name: "conversation.input.overlay", id: NS, order: 50 }, (props) => (
          <Boundary fallback={<span hidden aria-hidden="true" />}>
            <SuggestionOverlay {...(props as unknown as OverlayProps)} t={t} />
          </Boundary>
        )),
      ),
    "dsh-prompt-suggestions: composer overlay",
  );

  ctx.effect(
    () =>
      ctx.slots.inject("settings.general.item", () =>
        ctx.slots.register(
          { name: "settings.general.item", id: NS, order: 45, label: () => t("label") },
          () => (
            <Boundary fallback={<div role="alert">{t("failed")}</div>}>
              <SettingsItem t={t} />
            </Boundary>
          ),
        ),
      ),
    "dsh-prompt-suggestions: general setting",
  );
}
