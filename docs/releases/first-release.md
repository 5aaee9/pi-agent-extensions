# First release of a new package

npm configures a Trusted Publisher in an existing package's settings. Every new npm package in this repository, including both `pi-*` and `dsh-*`, therefore follows this order: **prepare an independent empty workspace → the owner publishes its bootstrap package → the owner configures Trusted Publisher → push the verified formal release to GitHub → CI publishes and records the formal version**.

Local source commits, release preparation and dry-run verification may proceed while the owner completes the npm setup. Keep the new package's commits local until the owner confirms that both the bootstrap publication and Trusted Publisher configuration are complete. The first GitHub push containing the new package must carry its prepared formal version, normally `0.1.0`, with its complete artifacts and release notes.

### 1. Prepare the empty workspace

The agent creates a separate directory **outside the Git checkout and its npm workspaces**, using the same npm package name as the formal package. Its version is `0.0.0`, and its publish tag is `bootstrap`; reserve `0.1.0` for the functional package. Include only `package.json`, a short README explaining the placeholder, and the project's license. Do not include runtime code, dependencies, lifecycle scripts, or a `pi`/`dsh` manifest, and do not copy the bootstrap tag into the formal package's publish configuration.

Replace `<name>` with the full directory name, including its `pi-` or `dsh-` prefix:

```json
{
  "name": "@indexyz/<name>",
  "version": "0.0.0",
  "description": "Bootstrap placeholder for configuring npm trusted publishing",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/5aaee9/pi-agent-extensions.git",
    "directory": "<name>"
  },
  "publishConfig": {
    "access": "public",
    "tag": "bootstrap"
  },
  "files": ["README.md", "LICENSE"]
}
```

Check the package's npm registry state first. A 404 means the package is absent; other registry errors do not. For a package that already exists, inspect its published versions and publisher setup instead of trying to publish `0.0.0` again. Run `npm pack --dry-run` in the empty workspace and verify that only the three intended files would ship. Hand the owner the directory or packed tarball, the commands below, and the publisher fields.

### 2. The owner publishes the bootstrap package

The owner runs these commands in the empty workspace, using their own npm login:

```bash
npm login
npm publish --access public --tag bootstrap
```

Confirm that the registry serves the placeholder:

```bash
npm view '@indexyz/<name>@0.0.0' version --prefer-online
```

The empty workspace stays outside the repository. Its `0.0.0` publication establishes the npm package for configuration; it is not the formal plugin release and must not consume the formal version number.

### 3. The owner configures Trusted Publisher

In the new npm package's settings, add a GitHub Actions Trusted Publisher:

| Field                    | Value                 |
| ------------------------ | --------------------- |
| Organization or user     | `5aaee9`              |
| Repository               | `pi-agent-extensions` |
| Workflow filename        | `publish.yml`         |
| Environment              | Leave empty           |
| Allowed action, if shown | `npm publish`         |

The publish job already declares `id-token: write` and has no GitHub environment. No npm token is added to the repository. The owner confirms that both the bootstrap upload and this configuration are complete; package existence alone does not prove that trusted publishing is configured.

### 4. Push and verify the formal release

After that confirmation, finish the normal local checks and the plan steps in `docs/releases.md`, "Prepare a release locally", including its check for the other system, against the formal version's commit. Carry out an already-authorized push or merge to GitHub `main`; if publication has not been authorized, hand over the verified preparation instead. Do not request the same authorization again when it was already given conditional on the owner's setup.

CI publishes the functional version through Trusted Publisher, then creates its `@indexyz/<name>@<version>` tag and GitHub Release. Follow the workflow to completion and verify all three results. Report the bootstrap upload and formal release separately. If the workflow fails, use the normal retry procedure without changing the formal version merely to retry.

Agents prepare and verify the empty workspace and the formal release. The owner performs the bootstrap `npm publish` and configures npm Trusted Publisher.
