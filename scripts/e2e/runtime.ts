import { spawnSync } from "node:child_process";

export const MAX_OUTPUT = 8_000;
export interface CommandResult {
  readonly command: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}
export class CommandOptions {
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv> | undefined;
  readonly timeoutMs: number;
  readonly input: string | undefined;
  constructor(cwd: string, timeoutMs: number, env?: Readonly<NodeJS.ProcessEnv>, input?: string) {
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.env = env;
    this.input = input;
  }
}
export function shorten(value: string): string {
  if (value.length <= MAX_OUTPUT) return value;
  const half = Math.floor(MAX_OUTPUT / 2);
  return `${value.slice(0, half)}\n... output truncated ...\n${value.slice(-half)}`;
}
export function formatCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args].map((part) => JSON.stringify(part)).join(" ");
}
export function runCommand(
  executable: string,
  args: readonly string[],
  options: CommandOptions,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    timeout: options.timeoutMs,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT * 4,
  });
  return {
    command: formatCommand(executable, args),
    code: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.error?.message ?? result.stderr,
    timedOut: result.error?.message.includes("ETIMEDOUT") ?? false,
  };
}
export function commandFailure(result: CommandResult): string {
  const status = result.timedOut
    ? "timed out"
    : `exited ${result.code === null ? "without a code" : String(result.code)}${result.signal ? ` (${result.signal})` : ""}`;
  return `${result.command} ${status}\nstdout:\n${shorten(result.stdout)}\nstderr:\n${shorten(result.stderr)}`;
}
