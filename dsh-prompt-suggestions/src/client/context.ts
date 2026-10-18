import type { ClientContext } from "./contracts.ts";

let context: ClientContext | undefined;

/** Bind the module's Cordis context; the whole bundle shares one instance. */
export function bindClientContext(next: ClientContext): void {
  context = next;
}

/**
 * Read one optional Cordis service.
 *
 * `ctx.get` answers `undefined` for a missing service and never throws; the
 * `try` is for a composition whose resolver refuses a nested Remote key. A
 * missing settings, connection or shortcut service degrades the feature instead
 * of taking the composer or settings page down.
 * @param name - service name.
 * @returns the service, or undefined.
 */
export function clientService<T>(name: string): T | undefined {
  try {
    return context?.get<T>(name) ?? undefined;
  } catch {
    return undefined;
  }
}
