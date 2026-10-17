/**
 * The pi-ai thinking levels a reasoning-effort declaration may name.
 *
 * The escalation order is pi-ai's own, and the list is the vocabulary
 * `llm-pi-ai`'s `thinkingLevelMap` accepts, so a declared level is always a
 * level the Harness can route.
 *
 * @module @indexyz/dsh-custom-provider-reasoning-efforts/levels
 */

/** Every pi-ai thinking level, in escalation order. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** One pi-ai thinking level. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const LEVEL_SET: ReadonlySet<string> = new Set(THINKING_LEVELS);

/**
 * Whether a name is a pi-ai thinking level.
 *
 * @param value - candidate level name.
 * @returns true for one of {@link THINKING_LEVELS}.
 */
export function isThinkingLevel(value: string): value is ThinkingLevel {
  return LEVEL_SET.has(value);
}
