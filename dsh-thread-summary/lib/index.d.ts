import type { Context } from "@deepseek-ai/cordis";
import type { SessionTitleProvider } from "@deepseek-ai/dsh-session-title";
import type { ContextFormed } from "@deepseek-ai/dsh-llm";
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "dsh-thread-summary": {
            kind: "dsh-thread-summary";
        } & ContextFormed;
    }
}
export declare const name = "thread-summary";
export declare const inject: readonly ["llm", "sessionTitle"];
export declare const MAX_INPUT_BYTES = 4096;
export declare const MAX_TITLE_CHARACTERS = 36;
export declare const MAX_TITLE_BYTES = 80;
export declare const MAX_OUTPUT_TOKENS = 256;
export declare const SUMMARY_TIMEOUT_MS = 60000;
export interface VolatileField<T> {
    get(): T | undefined;
}
export interface ThreadSummaryConfig {
    enabled?: boolean | VolatileField<boolean>;
    model?: string | VolatileField<string>;
}
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    model: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    model: import("@deepseek-ai/schemastery").default<string, string, "volatile-defined">;
}>>, "plain">;
export declare const SUMMARY_INSTRUCTIONS: string;
export declare function parseModelRoute(route: string): {
    provider: string;
    model: string;
} | undefined;
export declare function normalizeTitle(value: string): string;
/** Budget the actual wire text, including JSON escapes, framing and instructions. */
export declare function buildSummaryPrompt(text: string): string;
/** The service owns scheduling and persistence; this provider owns one bounded auxiliary call. */
export declare function createTitleProvider(llm: Pick<Context["llm"], "stream">, config: ThreadSummaryConfig): SessionTitleProvider;
export declare function apply(ctx: Context, config: ThreadSummaryConfig): void;
//# sourceMappingURL=index.d.ts.map