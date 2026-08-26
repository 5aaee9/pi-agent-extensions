import { readFile } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const rootPackage = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));

if (!Array.isArray(rootPackage.workspaces) || rootPackage.workspaces.length === 0) {
  throw new Error("package.json must declare at least one workspace");
}

const workspacePackages = await Promise.all(
  rootPackage.workspaces.map(async (workspace) => {
    const manifest = JSON.parse(
      await readFile(new URL(`${workspace}/package.json`, repositoryRoot), "utf8"),
    );
    return { name: manifest.name, version: manifest.version };
  }),
);

const versions = new Set(workspacePackages.map(({ version }) => version));
if (versions.size !== 1) {
  const details = workspacePackages.map(({ name, version }) => `  ${name}: ${version}`).join("\n");
  throw new Error(`Workspace package versions must match:\n${details}`);
}

const [version] = versions;
const expectedVersion = process.argv[2];
if (expectedVersion && version !== expectedVersion) {
  throw new Error(`Workspace version ${version} does not match release version ${expectedVersion}`);
}

console.log(`Workspace package versions are synchronized at ${version}`);
