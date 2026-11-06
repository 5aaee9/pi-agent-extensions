import type { ExtensionContext, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

// Pi loads every extension graph with a fresh module cache, including the
// replacement created by /reload while a child session is still alive. Ownership
// has to live outside that graph. A factory can also run and never start a
// session, so a claim counts only after its registration is flushed onto a runtime.
const CLAIMS = Symbol.for("@indexyz/pi-provider-sub2api/provider-claims");
const REGISTER_HOOK = Symbol.for("@indexyz/pi-provider-sub2api/register-hook");
const REGISTRATION_CLAIM = Symbol.for("@indexyz/pi-provider-sub2api/registration-claim");

interface ProviderClaim {
  readonly providers: ReadonlySet<string>;
  runtime?: object;
}

function claims(): Set<ProviderClaim> {
  const host = globalThis as typeof globalThis & { [CLAIMS]?: Set<ProviderClaim> };
  return (host[CLAIMS] ??= new Set());
}

function forgetUnboundClaims(except: ProviderClaim | undefined): void {
  const live = claims();
  for (const other of live) {
    if (other !== except && other.runtime === undefined) live.delete(other);
  }
}

// The host flushes queued registrations by calling ModelRuntime.registerProvider.
// That is the first moment a load is attached to a runtime; a factory that never
// reaches it must not keep a relay alive for anyone else.
function ensureRegisterHook(): void {
  const host = globalThis as typeof globalThis & { [REGISTER_HOOK]?: true };
  if (host[REGISTER_HOOK]) return;
  host[REGISTER_HOOK] = true;
  const original = ModelRuntime.prototype.registerProvider;
  ModelRuntime.prototype.registerProvider = function (
    this: ModelRuntime,
    ...args: Parameters<ModelRuntime["registerProvider"]>
  ): ReturnType<ModelRuntime["registerProvider"]> {
    const config = args[1];
    if (config && typeof config === "object") {
      const claim = (config as { [REGISTRATION_CLAIM]?: ProviderClaim })[REGISTRATION_CLAIM];
      if (claim) bindProviderClaim(claim, this);
    }
    return original.apply(this, args);
  };
}

export function claimProviders(providers: readonly string[]): ProviderClaim {
  ensureRegisterHook();
  const claim: ProviderClaim = { providers: new Set(providers) };
  claims().add(claim);
  return claim;
}

export function attachRegistrationClaim(config: ProviderConfig, claim: ProviderClaim): void {
  Object.defineProperty(config, REGISTRATION_CLAIM, { value: claim });
}

// Session start repeats the bind for a host that flushed registrations without
// going through ModelRuntime.registerProvider.
export function bindProviderClaim(claim: ProviderClaim, runtime: object | undefined): void {
  if (runtime !== undefined && claim.runtime === undefined) claim.runtime = runtime;
  if (claim.runtime === undefined) return;
  forgetUnboundClaims(claim);
  claims().add(claim);
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
  if (claim.runtime === undefined || !claim.providers.has(provider)) return false;
  if (runtime === undefined) return true;
  return claim.runtime === runtime;
}

// Providers no other live instance still holds on this runtime. A second
// shutdown is a no-op so the handler can run again. Claims that never reached
// a runtime are dropped here so a discovery load cannot outlive the process.
export function releaseProviderClaim(
  claim: ProviderClaim,
  runtime: object | undefined,
): readonly string[] {
  bindProviderClaim(claim, runtime);
  const live = claims();
  forgetUnboundClaims(claim);
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
