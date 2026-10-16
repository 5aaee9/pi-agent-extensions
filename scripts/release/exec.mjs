// Thin wrapper around child processes used by the release adapters.
import { spawnSync } from "node:child_process";

/** Runs a command and returns `{ code, stdout, stderr }` without throwing. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeout,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) {
    return { code: -1, stdout: result.stdout ?? "", stderr: String(result.error.message) };
  }
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Runs a command and returns its stdout, throwing with its stderr on failure. */
export function runChecked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.code})\n${detail}`);
  }
  return result.stdout;
}
