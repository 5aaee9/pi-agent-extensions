// Thin wrapper around child processes used by the release adapters.
import { spawnSync } from "node:child_process";

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly input?: string;
  readonly timeout?: number;
}

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a command and returns its exit code and output without throwing. */
export function run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeout,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error !== undefined) {
    return { code: -1, stdout: "", stderr: result.error.message };
  }
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Runs a command and returns its stdout, throwing with its stderr on failure. */
export function runChecked(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): string {
  const result = run(command, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.code})\n${detail}`);
  }
  return result.stdout;
}

/** The message of an unknown thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
