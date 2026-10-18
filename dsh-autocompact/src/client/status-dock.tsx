/**
 * The autocompact status line in the composer's ambient row.
 *
 * A session's model can carry an autocompact threshold, and the one question
 * this entry answers at a glance is "will this session compact early, and how
 * close is it?". It sits beside the session's turn, token, and context readings,
 * and opens this plugin's threshold page when the user acts on it. It reads:
 *
 * - the session's current route from the `modelSelection` projection,
 * - the measured pressure from the `contextPressure` projection,
 * - the configured thresholds from {@link module:@indexyz/dsh-autocompact/client/config-store}.
 *
 * The configured value is the deployment default for that route, or the
 * deployment-wide default when the route has no entry of its own. A session can
 * override it with `/autocompact`, and that override lives in Host memory for
 * the session only, so this line reports the persisted value rather than
 * claiming to be the effective one.
 *
 * @module @indexyz/dsh-autocompact/client/status-dock
 */

import * as React from "react";
import { getSnapshot, load, subscribe } from "./config-store.ts";
import { NS } from "./contracts.ts";
import type { Translate } from "./contracts.ts";
import { formatTokens } from "./limits.ts";
import { layoutFace, openSettingsSection } from "./services.ts";
import { CSS } from "./styles.ts";

/** Route half of the `modelSelection` projection's view. */
interface ModelSelection {
  readonly provider: string;
  readonly model: string;
}

/** The `modelSelection` projection's view. */
interface ModelSelectionView {
  /** The selection the next request uses, once chosen. */
  readonly lastUsed: ModelSelection | null;
  /** The pending selection, or the last used one. */
  readonly next: ModelSelection | null;
}

/** The `contextPressure` projection's view. */
interface ContextPressureView {
  readonly contextWindow?: number;
  /** Prompt-side pressure of the last reported request. */
  readonly pressureTokens?: number;
  /** That pressure plus the surface's movement since the sample. */
  readonly projectedTokens?: number;
}

/** A projection reader as the slot kit passes one in. */
type ProjectionReader = (key: string) => unknown;

/** Props the slot kit hands this entry beyond the bound translator. */
export interface AutocompactStatusProps {
  readonly t: Translate;
  /** The slot kit's standard props, including `useProjection`. */
  readonly kit?: Readonly<Record<string, unknown>>;
}

/** Stand-in reader for a composition whose kit has no projection hook. */
const noProjection: ProjectionReader = () => undefined;

/** Resolve the kit's projection hook, or a reader that always answers absent. */
function readerOf(kit: Readonly<Record<string, unknown>> | undefined): ProjectionReader {
  const hook = kit?.["useProjection"];
  return typeof hook === "function" ? (hook as ProjectionReader) : noProjection;
}

/** The `provider/model` route a selection denotes. */
function routeOf(view: ModelSelectionView | undefined): string | undefined {
  const picked = view?.next ?? view?.lastUsed;
  return picked === null || picked === undefined ? undefined : `${picked.provider}/${picked.model}`;
}

/** The freshest pressure figure the projection reports. */
function pressureOf(view: ContextPressureView | undefined): number | undefined {
  return view?.projectedTokens ?? view?.pressureTokens;
}

/**
 * The icon that identifies this entry.
 *
 * Copies the artwork of the host's `IconDataOutlineRegular`: the context store
 * with its old rounds folded away, `currentColor`, on the 16-unit grid with a 1px
 * stroke — the pill CSS renders it at 14px, the same as the icons beside it.
 * Copied rather than imported because a bundle plugin must not load a Harness
 * Client package.
 */
function StatusIcon(): React.ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      strokeWidth="1"
    >
      <path
        d="M7.8667 0.349609C8.96906 0.349634 10.0601 0.481272 11.0317 0.735352C11.9973 0.987845 12.8453 1.362 13.4644 1.84766C14.0744 2.32629 14.507 2.95539 14.5161 3.69336H14.5171V8.53516C14.0843 8.32076 13.6108 8.17679 13.1108 8.11816C13.1831 7.96848 13.2162 7.82856 13.2163 7.70312V5.76758C12.6269 6.16618 11.8739 6.47995 11.0317 6.7002C10.0602 6.95423 8.96896 7.08494 7.8667 7.08496C6.76461 7.08493 5.67411 6.95415 4.70264 6.7002C3.85994 6.48006 3.10694 6.1662 2.51709 5.76758V7.70312L2.521 7.78418C2.56374 8.19554 2.93361 8.74414 3.91357 9.23145C4.9281 9.73585 6.35004 10.0371 7.8667 10.0371C8.26373 10.0371 8.6543 10.0141 9.03271 9.97461C8.75596 10.3799 8.54664 10.8349 8.42041 11.3232C8.23666 11.3313 8.0518 11.3369 7.8667 11.3369C6.20108 11.3369 4.57025 11.01 3.33447 10.3955C3.04163 10.2499 2.76658 10.0836 2.51709 9.90039V11.6738C2.51728 12.1379 2.88589 12.7556 3.92236 13.292C4.93457 13.8157 6.35342 14.1289 7.8667 14.1289C8.12318 14.1289 8.37694 14.1161 8.62646 14.0986C8.82021 14.5535 9.08999 14.9682 9.41943 15.3271C8.91285 15.3934 8.39149 15.4287 7.8667 15.4287C6.19761 15.4287 4.56379 15.0869 3.32568 14.4463C2.11244 13.8185 1.21649 12.8562 1.21631 11.6738V3.76367C1.21595 3.74853 1.21438 3.733 1.21436 3.71777C1.21436 2.96917 1.65103 2.33053 2.26807 1.84668C2.88747 1.36112 3.73675 0.987685 4.70264 0.735352C5.67413 0.481376 6.76457 0.349636 7.8667 0.349609ZM7.8667 1.65039C6.86269 1.65042 5.88326 1.77028 5.03076 1.99316C4.17183 2.2176 3.50421 2.52956 3.06982 2.87012C2.65043 3.19909 2.52622 3.48898 2.51709 3.69336V3.74414C2.52719 3.94845 2.65185 4.23772 3.06982 4.56543C3.50425 4.90601 4.17172 5.21795 5.03076 5.44238C5.88326 5.66527 6.8627 5.78513 7.8667 5.78516C8.8707 5.78513 9.85015 5.66525 10.7026 5.44238C11.5611 5.21787 12.2286 4.9049 12.6626 4.56445C13.0982 4.22252 13.2163 3.9231 13.2163 3.71777L13.2104 3.63574C13.1818 3.43623 13.044 3.16941 12.6626 2.87012C12.2286 2.52957 11.5614 2.21773 10.7026 1.99316C9.85009 1.77025 8.8708 1.65041 7.8667 1.65039Z"
        fill="currentColor"
      />
      <path
        d="M12.8936 10.0361L13.2061 10.5566C13.2296 10.5959 13.2651 10.6562 13.3027 10.707C13.3469 10.7666 13.4148 10.8431 13.5195 10.9023C13.6244 10.9617 13.725 10.9801 13.7988 10.9873C13.8619 10.9934 13.9318 10.9932 13.9775 10.9932H14.6162L14.8896 11.4502L14.5947 11.9443C14.5698 11.9859 14.5312 12.0483 14.5029 12.1084C14.4781 12.1611 14.4514 12.2312 14.4395 12.3164L14.4326 12.4072L14.4395 12.4971C14.4514 12.5825 14.4781 12.6532 14.5029 12.7061C14.5312 12.7661 14.5689 12.8287 14.5938 12.8701L14.8896 13.3633L14.6162 13.8213H13.9775C13.9318 13.8213 13.8619 13.821 13.7988 13.8271C13.7433 13.8326 13.6728 13.8442 13.5967 13.875L13.5195 13.9121C13.4148 13.9714 13.3469 14.0478 13.3027 14.1074C13.265 14.1583 13.2296 14.2186 13.2061 14.2578L12.8936 14.7783H12.3115L11.999 14.2578C11.9755 14.2186 11.9401 14.1583 11.9023 14.1074C11.8693 14.0628 11.823 14.0083 11.7578 13.959L11.6855 13.9121L11.6074 13.875C11.5316 13.8445 11.4615 13.8325 11.4062 13.8271C11.3432 13.821 11.2733 13.8213 11.2275 13.8213H10.5889L10.3135 13.3633L10.6104 12.8701C10.6352 12.8287 10.6739 12.7661 10.7021 12.7061C10.7352 12.6357 10.7724 12.534 10.7725 12.4072C10.7724 12.2804 10.7352 12.1788 10.7021 12.1084C10.6739 12.0483 10.6353 11.9859 10.6104 11.9443L10.3135 11.4502L10.5889 10.9932H11.2275C11.2733 10.9932 11.3432 10.9934 11.4062 10.9873C11.4801 10.9801 11.5808 10.9616 11.6855 10.9023C11.7903 10.843 11.8582 10.7666 11.9023 10.707C11.94 10.6562 11.9755 10.5959 11.999 10.5566L12.3115 10.0361H12.8936Z"
        stroke="currentColor"
        strokeMiterlimit="10"
      />
    </svg>
  );
}

/**
 * Send the user to this plugin's thresholds.
 *
 * Settings owns the panel, its section navigation, and the store behind both, so
 * the shell's own `openSection` is the real destination; the central panel this
 * plugin registers carries the same editor and is only the fallback, for a
 * composition where the settings shell's store cannot be reached (a renamed cell
 * or action, or a profile without settings). Both calls are guarded — `selectPanel`
 * throws for an unregistered key, and a pill must never take the composer row down.
 */
function openThresholds(): void {
  try {
    if (openSettingsSection(NS)) return;
  } catch (error) {
    console.error("[dsh-autocompact] opening the settings section failed:", error);
  }
  try {
    layoutFace()?.selectPanel(NS);
  } catch (error) {
    console.error("[dsh-autocompact] opening the threshold panel failed:", error);
  }
}

/**
 * One ambient pill: the entry's icon and its reading, and a way to act on it.
 *
 * The icon carries the identity and the title carries the meaning, so no word of
 * this plugin's name takes space in a row the session's own readings share.
 */
function StatusPill(props: {
  readonly state: "on" | "off";
  readonly title: string;
  readonly text: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="dsha-status"
      data-state={props.state}
      title={props.title}
      aria-label={props.title}
      onClick={openThresholds}
    >
      <style>{CSS}</style>
      <StatusIcon />
      <span>{props.text}</span>
    </button>
  );
}

/**
 * Render the status entry.
 *
 * The ambient row is shared with the session's own readings, so this entry only
 * takes a seat when it has something to report: a threshold that applies to this
 * session's model, or a master switch that has turned every threshold off. A row
 * that is merely not configured for this model says nothing — the Settings page
 * is where "not configured" is discovered and fixed.
 */
export function AutocompactStatus(props: AutocompactStatusProps): React.ReactElement | null {
  const t = props.t;
  const read = readerOf(props.kit);
  // Both reads are unconditional: the kit's hook is a hook, and the reader
  // resolves this session's row before the early returns below.
  const selection = read("modelSelection") as ModelSelectionView | undefined;
  const pressure = read("contextPressure") as ContextPressureView | undefined;
  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);

  React.useEffect(() => {
    void load();
  }, []);

  if (snapshot.state !== "ready") return null;

  const enabled = snapshot.config.enabled;
  const route = routeOf(selection);
  // The route's own entry wins; without one the deployment default covers it.
  const limit =
    route === undefined
      ? undefined
      : (snapshot.config.limits[route] ?? snapshot.config.defaultLimit);
  // An off switch was a deliberate choice and is what stops every threshold, so it
  // is reported whatever model the session uses.
  if (!enabled) {
    return (
      <StatusPill
        state="off"
        title={t("dockTitleOff", { action: t("dockAction") })}
        text={t("dockOff")}
      />
    );
  }
  // Under an on switch, a model with no threshold is a non-event: no seat.
  if (limit === undefined) return null;

  const threshold = formatTokens(limit);
  const now = pressureOf(pressure);
  if (now === undefined) {
    return (
      <StatusPill
        state="on"
        title={t("dockTitleLimit", {
          route: route ?? "",
          limit: threshold,
          action: t("dockAction"),
        })}
        text={threshold}
      />
    );
  }
  // The host writes this pair as `used / capacity`; this pill reads the same way,
  // with the pressure in force first and the threshold that triggers it second.
  return (
    <StatusPill
      state="on"
      title={t("dockTitleLimitNow", {
        route: route ?? "",
        limit: threshold,
        tokens: formatTokens(now),
        action: t("dockAction"),
      })}
      text={`${formatTokens(now)} / ${threshold}`}
    />
  );
}
