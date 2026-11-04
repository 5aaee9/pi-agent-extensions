// A real terminal around the published `pi` bin, for surfaces RPC cannot reach:
// custom components, autocomplete, message renderers, and the footer.
import { setTimeout as delay } from "node:timers/promises";

import * as nodePty from "node-pty";

import { killGroup } from "./pi.ts";
import { piBin } from "./world.ts";
import type { EnvExtra, World } from "./world.ts";

const DEFAULT_WAIT_MS = 20_000;
const EXIT_WAIT_MS = 5_000;
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);

// Terminal control sequences, removed so assertions read what a person reads.
const CONTROL_SEQUENCES = new RegExp(
  `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}[()][0-9A-Za-z]|${ESC}[=>78]`,
  "gu",
);

export function stripControl(text: string): string {
  return text.replaceAll(CONTROL_SEQUENCES, "");
}

export interface TerminalOptions {
  readonly cols?: number;
  readonly rows?: number;
  readonly env?: EnvExtra;
}

export interface WaitOptions {
  /** Considers only output after this offset, from `mark()`. */
  readonly mark?: number;
  readonly timeoutMs?: number;
}

export interface Terminal {
  readonly raw: () => string;
  readonly text: () => string;
  readonly mark: () => number;
  readonly exitCode: () => number | undefined;
  readonly send: (keys: string) => void;
  readonly waitFor: (
    predicate: (text: string) => boolean,
    description: string,
    options?: WaitOptions,
  ) => Promise<void>;
  readonly waitForText: (expected: string, options?: WaitOptions) => Promise<void>;
  /** Kills the process group, leaving the session as a crash would. */
  readonly kill: () => Promise<void>;
}

interface PendingWait {
  readonly check: () => boolean;
  readonly settle: () => void;
}

interface OutputWaiters {
  readonly flush: () => void;
  readonly waitFor: Terminal["waitFor"];
  readonly onExit: () => Promise<void>;
}

function outputWaiters(raw: () => string, exitCode: () => number | undefined): OutputWaiters {
  const pending = new Set<PendingWait>();
  return {
    flush() {
      for (const wait of pending)
        if (wait.check()) {
          pending.delete(wait);
          wait.settle();
        }
    },
    onExit: async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      pending.add({ check: () => exitCode() !== undefined, settle: resolve });
      await promise;
    },
    async waitFor(predicate, description, options = {}) {
      const current = (): string => stripControl(raw().slice(options.mark ?? 0));
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const fail = (reason: string): void => {
        const output = current().slice(-3000);
        reject(new Error(`${reason} waiting for ${description}\nterminal output:\n${output}`));
      };
      const wait: PendingWait = {
        check: () => predicate(current()) || exitCode() !== undefined,
        settle: () => {
          if (predicate(current())) resolve();
          else fail(`pi exited with ${String(exitCode())}`);
        },
      };
      if (wait.check()) wait.settle();
      else pending.add(wait);
      const timer = setTimeout(() => {
        pending.delete(wait);
        fail("timed out");
      }, options.timeoutMs ?? DEFAULT_WAIT_MS);
      try {
        await promise;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function terminalEnv(world: World, extra: EnvExtra | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(world.env({ TERM: "xterm-256color", ...extra })))
    if (value !== undefined) env[key] = value;
  return env;
}

export function startTerminal(
  world: World,
  args: readonly string[],
  options: TerminalOptions = {},
): Terminal {
  const pty = nodePty.spawn(process.execPath, [piBin(), ...args], {
    cwd: world.cwd,
    cols: options.cols ?? 120,
    rows: options.rows ?? 40,
    env: terminalEnv(world, options.env),
  });
  let raw = "";
  let exitCode: number | undefined;
  const waiters = outputWaiters(
    () => raw,
    () => exitCode,
  );
  pty.onData((data: string) => {
    raw += data;
    waiters.flush();
  });
  pty.onExit((exit: Readonly<{ exitCode: number }>) => {
    exitCode = exit.exitCode;
    waiters.flush();
  });
  return {
    raw: () => raw,
    text: () => stripControl(raw),
    mark: () => raw.length,
    exitCode: () => exitCode,
    send: (keys) => {
      pty.write(keys);
    },
    waitFor: waiters.waitFor,
    waitForText: async (expected, waitOptions) => {
      await waiters.waitFor(
        (text) => text.includes(expected),
        JSON.stringify(expected),
        waitOptions,
      );
    },
    async kill() {
      if (exitCode !== undefined) return;
      const exited = waiters.onExit();
      killGroup(pty.pid);
      await Promise.race([exited, delay(EXIT_WAIT_MS, undefined, { ref: false })]);
    },
  };
}
