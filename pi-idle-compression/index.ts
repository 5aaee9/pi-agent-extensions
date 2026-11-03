import { join } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  formatDuration,
  readSettings,
  resolveIdleSettings,
  type IdleSettings,
} from "./settings.ts";

const STATUS_KEY = "idle-compression";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settingsFor(ctx: ExtensionContext): Promise<IdleSettings | undefined> {
  const model = ctx.model;
  if (!model) return undefined;
  const settings = await readSettings(join(getAgentDir(), "settings.json"));
  return resolveIdleSettings(settings, model.provider, model.id);
}

export default function piIdleCompression(pi: ExtensionAPI): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** When the current idle period began; undefined while Pi is working or the
   * period already ended (input, a run, a compaction, or our own expiry). */
  let idleSince: number | undefined;
  let deadline: number | undefined;
  // Bumped by every arm and cancel so a settings read that finishes late
  // never arms a timer for a period that has already ended.
  let generation = 0;
  let shutdown = false;

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    deadline = undefined;
  };

  const cancel = (): void => {
    generation++;
    clearTimer();
    idleSince = undefined;
  };

  const fire = (ctx: ExtensionContext, armed: number, settings: IdleSettings): void => {
    timer = undefined;
    deadline = undefined;
    if (armed !== generation || shutdown) return;
    // One compaction per idle period: the next one starts at the next settle.
    idleSince = undefined;
    // ctx.compact() aborts a running agent first; idle compaction must never
    // interrupt work or race a queued prompt.
    if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
    if (ctx.sessionManager.getBranch().at(-1)?.type === "compaction") return;
    // Pi reports a compacted context as unmeasured until the next reply.
    if (ctx.getContextUsage()?.tokens === null) return;
    const idle = formatDuration(settings.idleMinutes * 60_000);
    ctx.ui.notify(`Idle for ${idle}: compacting context…`, "info");
    ctx.ui.setStatus(STATUS_KEY, "Idle compaction…");
    const finish = (text: string, type: "info" | "warning"): void => {
      if (shutdown) return;
      try {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        ctx.ui.notify(text, type);
      } catch (error) {
        console.warn(`[idle-compression] ${text} (not shown: ${message(error)})`);
      }
    };
    ctx.compact({
      onComplete: () => finish(`Idle compaction completed after ${idle} without input.`, "info"),
      onError: (error) => finish(`Idle compaction failed: ${error.message}`, "warning"),
    });
  };

  const arm = async (ctx: ExtensionContext, since: number): Promise<void> => {
    const armed = ++generation;
    clearTimer();
    idleSince = since;
    let settings: IdleSettings | undefined;
    try {
      settings = await settingsFor(ctx);
    } catch (error) {
      if (armed === generation && !shutdown) {
        ctx.ui.notify(`Idle compression settings: ${message(error)}`, "error");
      }
      return;
    }
    if (armed !== generation || shutdown || !settings?.enabled) return;
    const resolved = settings;
    const at = since + resolved.idleMinutes * 60_000;
    deadline = at;
    timer = setTimeout(
      () => {
        try {
          fire(ctx, armed, resolved);
        } catch (error) {
          // A timer callback has no caller to report to; a throw here would be an
          // uncaught exception. The usual cause is a context made stale by a
          // runtime torn down without session_shutdown.
          console.warn(`[idle-compression] Idle compaction skipped: ${message(error)}`);
        }
      },
      Math.max(0, at - Date.now()),
    );
    // A pending idle timer must never keep print or RPC mode from exiting.
    timer.unref();
  };

  pi.on("session_start", async (_event, ctx) => {
    shutdown = false;
    cancel();
    // A resumed or reloaded conversation is idle too; its idle time starts now,
    // so opening an old session never compacts before the user can type.
    const branch = ctx.sessionManager.getBranch();
    const replied = branch.some(
      (entry) => entry.type === "message" && entry.message.role === "assistant",
    );
    if (replied && branch.at(-1)?.type !== "compaction") await arm(ctx, Date.now());
  });

  pi.on("session_shutdown", () => {
    shutdown = true;
    cancel();
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await arm(ctx, Date.now());
  });

  pi.on("agent_start", () => {
    cancel();
  });

  pi.on("input", () => {
    cancel();
  });

  pi.on("session_compact", () => {
    cancel();
  });

  pi.on("model_select", async (_event, ctx) => {
    // Keep the original idle start; only the effective idle time changes.
    if (idleSince !== undefined) await arm(ctx, idleSince);
  });

  pi.registerCommand("idle-compression", {
    description: "Show idle compaction settings and the time left before it runs",
    handler: async (_args, ctx) => {
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("Idle compression: no model selected.", "warning");
        return;
      }
      let settings: IdleSettings | undefined;
      try {
        settings = await settingsFor(ctx);
      } catch (error) {
        ctx.ui.notify(`Idle compression settings: ${message(error)}`, "error");
        return;
      }
      if (!settings) return;
      const key = `${model.provider}/${model.id}`;
      if (!settings.enabled) {
        ctx.ui.notify(`${key}: idle compression disabled.`, "info");
        return;
      }
      const idle = formatDuration(settings.idleMinutes * 60_000);
      const state =
        deadline === undefined
          ? "No idle period armed."
          : `Compacts in ${formatDuration(deadline - Date.now())} without input.`;
      ctx.ui.notify(`${key}: compact after ${idle} idle. ${state}`, "info");
    },
  });
}
