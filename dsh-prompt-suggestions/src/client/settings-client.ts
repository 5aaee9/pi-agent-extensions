import type { NamespaceView, RemoteResult, SettingsDescribe, SettingsFace } from "./contracts.ts";
import { NS } from "./contracts.ts";

/** One read of this plugin's enabled namespace. */
export interface EnabledSettings {
  readonly found: boolean;
  readonly enabled: boolean;
  readonly writable: boolean;
  readonly revision?: number;
}

function findNamespace(description: SettingsDescribe): NamespaceView | undefined {
  const namespaces = description.namespaces;
  if (!Array.isArray(namespaces)) return undefined;
  return (
    namespaces.find((view) => view.ns === NS) ??
    namespaces.find((view) => typeof view.ns === "string" && view.ns.endsWith(NS))
  );
}

function unwrap<T>(result: RemoteResult<T>, fallback: string): T {
  if (result.ok) return result.value;
  throw new Error(result.error?.message ?? fallback);
}

/**
 * Read the enabled switch from the Host settings namespace.
 * @param face - the `remote.settings` service.
 * @returns the current state; `found` is false before the row is surfaced.
 */
export async function readEnabled(face: SettingsFace): Promise<EnabledSettings> {
  const description = unwrap(await face.describe(), "unable to describe settings");
  const found = findNamespace(description);
  return {
    found: found !== undefined,
    enabled: found?.value?.enabled ?? true,
    writable: description.writable !== false,
    ...(found?.revision === undefined ? {} : { revision: found.revision }),
  };
}
