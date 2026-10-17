import type { Model } from "@earendil-works/pi-ai";

import { FAST_MODE_APIS, OPENAI, relaysByProvider } from "./types.ts";
import type { DaybreakMode, RequestModes, ServiceTierMode, SupportedApi } from "./types.ts";

type ModeModel = Pick<Model<any>, "provider" | "id" | "api">;

export const SERVICE_TIER_WIRE = {
  default: "default",
  fast: "priority",
  ultrafast: "ultrafast",
} as const satisfies Record<ServiceTierMode, string>;
export type ServiceTierWire = (typeof SERVICE_TIER_WIRE)[ServiceTierMode];

export const DAYBREAK_WIRE = {
  standard: "standard",
  blue: "daybreak_blue",
} as const satisfies Record<DaybreakMode, string>;
export type DaybreakWire = (typeof DAYBREAK_WIRE)[DaybreakMode];

// Protocol guards only: they say where a field may be sent, not whether the
// upstream model or account is eligible for it.
export function supportsRequestModes(model: ModeModel | undefined): model is ModeModel {
  return (
    model !== undefined &&
    relaysByProvider.has(model.provider) &&
    OPENAI.test(model.id) &&
    FAST_MODE_APIS.has(model.api as SupportedApi)
  );
}

export function supportsServiceTier(
  model: ModeModel | undefined,
  tier: ServiceTierMode,
): model is ModeModel {
  // Ultrafast is a Responses tier; Chat Completions keeps default and Fast only.
  return (
    supportsRequestModes(model) && (tier !== "ultrafast" || model.api !== "openai-completions")
  );
}

export function supportsDaybreak(model: ModeModel | undefined): model is ModeModel {
  return supportsRequestModes(model) && model.api !== "openai-completions";
}

export function describeRequestModes(modes: RequestModes) {
  const parts = [
    modes.serviceTier && `serviceTier ${modes.serviceTier}`,
    modes.daybreak && `daybreak ${modes.daybreak}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "no modes";
}

// Temporary per-model preferences live only as long as the loaded extension
// instance; resolution layers them over the saved model and provider fields.
export function createRequestModeState() {
  const temporary = new Map<string, Map<string, RequestModes>>();

  const resolve = (model: Pick<ModeModel, "provider" | "id">): RequestModes => {
    const relay = relaysByProvider.get(model.provider);
    if (!relay) return {};
    const layers = [
      temporary.get(model.provider)?.get(model.id),
      relay.modelRequestModes.get(model.id),
      relay.requestModes,
    ];
    const serviceTier = layers.find((layer) => layer?.serviceTier)?.serviceTier;
    const daybreak = layers.find((layer) => layer?.daybreak)?.daybreak;
    return {
      ...(serviceTier ? { serviceTier } : {}),
      ...(daybreak ? { daybreak } : {}),
    };
  };

  return {
    resolve,
    active(model: ModeModel | undefined): RequestModes {
      if (!supportsRequestModes(model)) return {};
      const { serviceTier, daybreak } = resolve(model);
      return {
        ...(serviceTier && supportsServiceTier(model, serviceTier) ? { serviceTier } : {}),
        ...(daybreak && supportsDaybreak(model) ? { daybreak } : {}),
      };
    },
    set(model: Pick<ModeModel, "provider" | "id">, modes: RequestModes) {
      let models = temporary.get(model.provider);
      if (!models) temporary.set(model.provider, (models = new Map()));
      models.set(model.id, { ...models.get(model.id), ...modes });
    },
  };
}

export type RequestModeState = ReturnType<typeof createRequestModeState>;
