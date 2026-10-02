import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const packageRoot = new URL("../", import.meta.url);

async function readPackageManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
}

describe("published package manifest", () => {
  it("declares host-provided pi packages as wildcard peers", async () => {
    const manifest = await readPackageManifest();

    // Host-provided packages must be peers so installed copies cannot bypass
    // pi's extension loader and create duplicate runtime modules.
    expect(manifest.dependencies ?? {}).not.toHaveProperty("@earendil-works/pi-ai");
    expect(manifest.dependencies ?? {}).not.toHaveProperty("@earendil-works/pi-coding-agent");
    expect(manifest.dependencies ?? {}).not.toHaveProperty("@earendil-works/pi-tui");

    for (const hostPackage of [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui",
    ]) {
      expect(manifest.peerDependencies?.[hostPackage]).toBe("*");
    }
  });

  it("pins pi-ai in devDependencies for private runtime serializer imports", async () => {
    const manifest = await readPackageManifest();

    // Local development still needs a concrete pi-ai copy: codex-compaction.ts
    // resolves pi-ai's private serializer modules by absolute URL.
    expect(manifest.devDependencies?.["@earendil-works/pi-ai"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
