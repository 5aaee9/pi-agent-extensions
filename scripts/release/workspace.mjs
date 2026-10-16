// Lists the publishable workspace packages from the root manifest.

/**
 * `readFile(path)` returns a file's text relative to the repository root, or
 * `null` when it does not exist. Returns `{ dir, name, version, manifest }` for
 * every non-private workspace package.
 */
export function listPackages(readFile) {
  const rootText = readFile("package.json");
  if (rootText === null) {
    throw new Error("package.json is missing at the repository root");
  }
  const root = JSON.parse(rootText);
  if (!Array.isArray(root.workspaces) || root.workspaces.length === 0) {
    throw new Error("package.json must declare its workspaces");
  }
  const packages = [];
  for (const dir of root.workspaces) {
    const text = readFile(`${dir}/package.json`);
    if (text === null) {
      throw new Error(`workspace ${dir} has no package.json`);
    }
    const manifest = JSON.parse(text);
    if (manifest.private) {
      continue;
    }
    packages.push({ dir, name: manifest.name, version: manifest.version, manifest });
  }
  return packages;
}
