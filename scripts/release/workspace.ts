// Lists the publishable workspace packages from the root manifest.
import { type Manifest, parseManifest } from "./json.ts";

export interface WorkspacePackage {
  readonly dir: string;
  readonly name: string;
  readonly version: string;
  readonly manifest: Manifest;
}

/** Reads a file relative to the repository root, or returns `null` when it does not exist. */
export type ReadFile = (path: string) => string | null;

/** Returns every non-private workspace package. */
export function listPackages(readFile: ReadFile): WorkspacePackage[] {
  const rootText = readFile("package.json");
  if (rootText === null) {
    throw new Error("package.json is missing at the repository root");
  }
  const root = parseManifest(rootText, "package.json");
  if (root.workspaces.length === 0) {
    throw new Error("package.json must declare its workspaces");
  }
  const packages: WorkspacePackage[] = [];
  for (const dir of root.workspaces) {
    const path = `${dir}/package.json`;
    const text = readFile(path);
    if (text === null) {
      throw new Error(`workspace ${dir} has no package.json`);
    }
    const manifest = parseManifest(text, path);
    if (manifest.private) {
      continue;
    }
    if (manifest.name === "" || manifest.version === "") {
      throw new Error(`${path} must declare a name and a version`);
    }
    packages.push({ dir, name: manifest.name, version: manifest.version, manifest });
  }
  return packages;
}
