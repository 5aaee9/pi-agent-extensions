import { randomUUID } from "node:crypto";
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { RequestModes } from "./types.ts";
import { asRecord } from "./util.ts";

export interface RequestModeSaveTarget {
  provider: string;
  // Omitted for the provider defaults.
  modelId?: string;
}

// Patch the raw JSON rather than serializing RelayConfig: credential
// expressions and settings this extension does not know must survive a save.
export async function writeRequestModes(
  configPath: string,
  target: RequestModeSaveTarget,
  modes: RequestModes,
) {
  const path = await realpath(configPath);
  const permissions = (await stat(path)).mode & 0o777;
  const text = await readFile(path, "utf8");
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    // JSON.parse messages quote file content, which may contain a token.
    throw new Error("configuration is not valid JSON");
  }
  const root = asRecord(config);
  if (!root) throw new Error("configuration top-level value must be an object");
  const entry = Object.hasOwn(root, target.provider) ? asRecord(root[target.provider]) : undefined;
  if (!entry) throw new Error(`provider ${target.provider} is not an object in the configuration`);

  const saved = { ...modes };
  if (target.modelId === undefined) {
    entry.requestModes = saved;
  } else {
    const models = entry.modelRequestModes === undefined ? {} : asRecord(entry.modelRequestModes);
    if (!models) throw new Error(`provider ${target.provider} modelRequestModes must be an object`);
    entry.modelRequestModes = { ...models, [target.modelId]: saved };
  }

  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(root, null, 2)}\n`, {
      flag: "wx",
      mode: permissions,
    });
    await chmod(temporary, permissions);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

// Saves from one extension instance run one at a time, each on a fresh read.
// Other processes can still interleave: the last writer wins.
export function createRequestModeStore(configPath: string) {
  let queue: Promise<unknown> = Promise.resolve();
  return (target: RequestModeSaveTarget, modes: RequestModes) => {
    const save = queue.then(() => writeRequestModes(configPath, target, modes));
    queue = save.catch(() => undefined);
    return save;
  };
}
