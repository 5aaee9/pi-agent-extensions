import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AskConfig } from "./config/schema.ts";
import type { AskQuestion } from "./types.ts";

let notificationSequence = 0;
const execAsync = promisify(exec);
const DEFAULT_TITLE = "pi ask";
const EVENT = "question.waiting";
const MAX_MESSAGE_LENGTH = 120;
const COMMAND_TIMEOUT_MS = 5000;

export interface AskNotificationPayload {
  event: typeof EVENT;
  message: string;
  title: string;
}

export type NotificationAttemptStatus = "attempted" | "failed" | "skipped";

export interface NotificationAttempt {
  channel: string;
  error?: string;
  status: NotificationAttemptStatus;
}

export function createQuestionWaitingNotification(
  question: Pick<AskQuestion, "label" | "prompt">,
): AskNotificationPayload {
  const subject = question.label || question.prompt;
  return {
    event: EVENT,
    title: DEFAULT_TITLE,
    message: truncate(`Question waiting: ${singleLine(subject)}`, MAX_MESSAGE_LENGTH),
  };
}

export async function notifyQuestionWaiting(
  config: AskConfig,
  payload: AskNotificationPayload,
  signal?: AbortSignal,
): Promise<NotificationAttempt[]> {
  if (!config.notifications.enabled) {
    return [{ channel: "notifications", status: "skipped" }];
  }
  const attempts: NotificationAttempt[] = [];
  for (const channel of config.notifications.channels) {
    attempts.push(await notifyChannel(channel, payload, signal));
  }
  return attempts;
}

async function notifyChannel(
  channel: AskConfig["notifications"]["channels"][number],
  payload: AskNotificationPayload,
  signal?: AbortSignal,
): Promise<NotificationAttempt> {
  const type = typeof channel === "string" ? channel : channel.type;
  if (signal?.aborted || (type !== "command" && !process.stdout.isTTY)) {
    return { channel: type, status: "skipped" };
  }
  try {
    switch (type) {
      case "bell":
        process.stdout.write("\x07");
        return { channel: type, status: "attempted" };
      case "osc9":
        process.stdout.write(`\x1b]9;${sanitizeOsc(payload.message)}\x07`);
        return { channel: type, status: "attempted" };
      case "osc777":
        process.stdout.write(
          `\x1b]777;notify;${sanitizeOscField(payload.title)};${sanitizeOscField(payload.message)}\x07`,
        );
        return { channel: type, status: "attempted" };
      case "osc7501": {
        const id = `pi-ask/${++notificationSequence}`;
        process.stdout.write(
          `\x1b]7501;state=blocked:kind=question:app=pi-ask:id=${id}:msg=${encodeBase64(sanitizeOsc(payload.message))}\x07`,
        );
        signal?.addEventListener(
          "abort",
          () => {
            process.stdout.write(`\x1b]7501;state=clear:id=${id}\x07`);
          },
          { once: true },
        );
        return { channel: type, status: "attempted" };
      }
      case "command": {
        if (typeof channel === "string") {
          return { channel: type, status: "failed", error: "Missing command" };
        }
        const env = { ...process.env };
        env.ASK_NOTIFY_EVENT = payload.event;
        env.ASK_NOTIFY_MESSAGE = payload.message;
        env.ASK_NOTIFY_TITLE = payload.title;
        await execAsync(channel.command, {
          env,
          timeout: COMMAND_TIMEOUT_MS,
        });
        return { channel: type, status: "attempted" };
      }
      default:
        return { channel: String(type), status: "skipped" };
    }
  } catch (error) {
    return {
      channel: type,
      error: error instanceof Error ? error.message : String(error),
      status: "failed",
    };
  }
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function sanitizeOsc(value: string): string {
  return [...singleLine(value)]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && (code < 127 || code > 159);
    })
    .join("");
}

function sanitizeOscField(value: string): string {
  return sanitizeOsc(value).replaceAll(";", ":");
}
