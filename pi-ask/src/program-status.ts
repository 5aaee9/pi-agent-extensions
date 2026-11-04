import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
const APP = "pi";
const MAX_MESSAGE_BYTES = 2048;

export type ProgramStatusState = "blocked" | "done" | "error" | "idle" | "working";

export interface ProgramStatus {
  kind?: "question";
  message?: string;
  state: ProgramStatusState;
}

/** Pi's status between runs; `done` takes the session name when it is written. */
export type RestingStatus =
  | { state: "done" }
  | { message: string; state: "error" }
  | { state: "idle" };

/** Formats a root OSC 7501 record exactly as Pi does, so terminals treat it as Pi's own. */
export function formatProgramStatus(status: ProgramStatus): string {
  const pairs = [`state=${status.state}`, `app=${APP}`];
  if (status.state === "blocked" && status.kind) {
    pairs.push(`kind=${status.kind}`);
  }
  const message = truncateUtf8(
    replaceControlCharacters(status.message ?? "").trim(),
    MAX_MESSAGE_BYTES,
  );
  if (message) {
    pairs.push(`msg=${Buffer.from(message, "utf8").toString("base64")}`);
  }
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}

/**
 * Mirrors the resting status Pi before 1.5.0 computes from session events, so a fallback
 * report can hand the terminal back the status Pi would show.
 */
export class RestingStatusTracker {
  private runActive = false;
  private runResult: RestingStatus = { state: "done" };
  private resting: RestingStatus = { state: "idle" };

  get status(): RestingStatus {
    return this.resting;
  }

  reset(): void {
    this.runActive = false;
    this.runResult = { state: "done" };
    this.resting = { state: "idle" };
  }

  agentStarted(): void {
    this.runActive = true;
    this.runResult = { state: "done" };
  }

  assistantMessageEnded(stopReason: string, errorMessage: string | undefined): void {
    this.runResult =
      stopReason === "error"
        ? { state: "error", message: firstLine(errorMessage) }
        : { state: "done" };
  }

  agentSettled(aborted: boolean): void {
    this.runActive = false;
    this.resting = aborted ? { state: "idle" } : this.runResult;
  }

  compacted(reason: string): void {
    if (!this.runActive && reason === "manual") {
      this.resting = { state: "done" };
    }
  }
}

export function subscribeRestingStatus(
  pi: Pick<ExtensionAPI, "on">,
  tracker: RestingStatusTracker,
): void {
  pi.on("session_start", () => {
    tracker.reset();
  });
  pi.on("agent_start", () => {
    tracker.agentStarted();
  });
  pi.on("message_end", (event) => {
    const { message } = event;
    if (message.role === "assistant") {
      tracker.assistantMessageEnded(message.stopReason, message.errorMessage);
    }
  });
  pi.on("agent_settled", (event) => {
    tracker.agentSettled(event.aborted);
  });
  pi.on("session_compact", (event) => {
    tracker.compacted(event.reason);
  });
}

export interface ProgramStatusHost {
  env: Record<string, string | undefined>;
  isTTY: boolean;
  write: (data: string) => void;
}

export type BlockedStatusContext = Pick<ExtensionContext, "isIdle"> & {
  sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionName">;
};

/**
 * Reports an open question on hosts whose `ctx.ui.custom()` ignores `blocked`.
 * Returns an idempotent function that writes the status Pi would report after the form closes.
 */
export function reportBlockedQuestion(
  message: string,
  ctx: BlockedStatusContext,
  tracker: RestingStatusTracker,
  host: ProgramStatusHost = getProgramStatusHost(),
): () => void {
  if (!host.isTTY || host.env.PI_PROGRAM_STATUS === "0") {
    return () => {
      // Reporting is unavailable or disabled.
    };
  }
  host.write(formatProgramStatus({ state: "blocked", kind: "question", message }));
  let restored = false;
  return () => {
    if (restored) {
      return;
    }
    restored = true;
    host.write(formatProgramStatus(statusAfterQuestion(ctx, tracker.status)));
  };
}

function statusAfterQuestion(ctx: BlockedStatusContext, resting: RestingStatus): ProgramStatus {
  if (!ctx.isIdle()) {
    return { state: "working", message: ctx.sessionManager.getSessionName() };
  }
  if (resting.state === "done") {
    return { state: "done", message: ctx.sessionManager.getSessionName() };
  }
  return resting;
}

let restingStatusTracker: RestingStatusTracker | undefined;

export function getRestingStatusTracker(): RestingStatusTracker {
  restingStatusTracker ??= new RestingStatusTracker();
  return restingStatusTracker;
}

export function resetRestingStatusTracker(): void {
  restingStatusTracker = undefined;
}

function getProgramStatusHost(): ProgramStatusHost {
  return {
    env: process.env,
    isTTY: Boolean(process.stdout.isTTY),
    write: (data) => {
      process.stdout.write(data);
    },
  };
}

function firstLine(text: string | undefined): string {
  return text?.split(/\r?\n/u, 1)[0]?.trim() || "Error";
}

/** Replaces each run of C0/C1 control characters with one space, as Pi does. */
function replaceControlCharacters(text: string): string {
  let result = "";
  let inControlRun = false;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (isControl) {
      if (!inControlRun) {
        result += " ";
      }
    } else {
      result += character;
    }
    inControlRun = isControl;
  }
  return result;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) {
      break;
    }
    bytes += size;
    end += character.length;
  }
  return text.slice(0, end);
}
