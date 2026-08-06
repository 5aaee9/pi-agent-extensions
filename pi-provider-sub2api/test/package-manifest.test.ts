import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const packageRoot = new URL("../", import.meta.url);

async function readPackageManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
}

describe("published package manifest", () => {
  it("installs pi-ai for private runtime serializer imports", async () => {
    const manifest = await readPackageManifest();

    expect(manifest.dependencies?.["@earendil-works/pi-ai"]).toBe(
      manifest.devDependencies?.["@earendil-works/pi-ai"],
    );
  });
});
