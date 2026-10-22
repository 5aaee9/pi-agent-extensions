import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export type ChatModelConfig = Extract<ProviderModelConfig, { reasoning: boolean }>;

// Registered relay models are always chat models; fail loudly if one is not.
export function chatModels(models: readonly ProviderModelConfig[] | undefined): ChatModelConfig[] {
  if (!models) throw new Error("provider registered no models");
  return models.map((model) => {
    if (!("reasoning" in model)) throw new Error(`model ${model.id} is not a chat model`);
    return model;
  });
}
