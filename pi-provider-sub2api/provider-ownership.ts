import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// Pi loads every extension graph with a fresh module cache, including the
// replacement created by /reload while a child session is still alive. Ownership
// has to live outside that graph, on the shared runtime the sessions already use.
const CLAIMS = Symbol.for("@indexyz/pi-provider-sub2api/provider-claims");

interface ProviderClaim {
  readonly providers: ReadonlySet<string>;
  runtime?: object;
}

function claims(): Set<ProviderClaim> {
  const host = globalThis as typeof globalThis & { [CLAIMS]?: Set<ProviderClaim> };
  return (host[CLAIMS] ??= new Set());
}

export function claimProviders(providers: readonly string[]): ProviderClaim {
  const claim: ProviderClaim = { providers: new Set(providers) };
  claims().add(claim);
  return claim;
}

// Session start is the first time this instance can see which runtime received
// its registrations. Until then the claim counts for every runtime, because the
// queued registration may still be flushed onto the one that is shutting down.
export function bindProviderClaim(claim: ProviderClaim, runtime: object | undefined): void {
  if (claim.runtime === undefined && runtime !== undefined) claim.runtime = runtime;
}

export function modelRuntimeOf(ctx: ExtensionContext): object | undefined {
  // The facade types `runtime` private. That object is the ModelRuntime child
  // sessions share; each session wraps it in its own registry.
  const registry: object = ctx.modelRegistry;
  if (!("runtime" in registry)) return undefined;
  const { runtime } = registry;
  return typeof runtime === "object" && runtime !== null ? runtime : undefined;
}

function holdsProvider(
  claim: ProviderClaim,
  provider: string,
  runtime: object | undefined,
): boolean {
  if (!claim.providers.has(provider)) return false;
  if (claim.runtime === undefined || runtime === undefined) return true;
  return claim.runtime === runtime;
}

// Providers no other live instance still holds on this runtime. A second
// shutdown is a no-op so the handler can run again.
export function releaseProviderClaim(
  claim: ProviderClaim,
  runtime: object | undefined,
): readonly string[] {
  const live = claims();
  if (!live.delete(claim)) return [];
  const unregister: string[] = [];
  for (const provider of claim.providers) {
    let held = false;
    for (const other of live) {
      if (!holdsProvider(other, provider, runtime)) continue;
      held = true;
      break;
    }
    if (!held) unregister.push(provider);
  }
  return unregister;
}
