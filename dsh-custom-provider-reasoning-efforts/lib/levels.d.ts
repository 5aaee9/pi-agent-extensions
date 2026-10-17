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
export declare const THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** One pi-ai thinking level. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
/**
 * Whether a name is a pi-ai thinking level.
 *
 * @param value - candidate level name.
 * @returns true for one of {@link THINKING_LEVELS}.
 */
export declare function isThinkingLevel(value: string): value is ThinkingLevel;
//# sourceMappingURL=levels.d.ts.map