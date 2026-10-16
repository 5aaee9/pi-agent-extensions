// Validated readers for the JSON documents the release scripts consume.

export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The parts of a package manifest the release scripts read. */
export interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly private: boolean;
  readonly files: readonly string[];
  readonly workspaces: readonly string[];
  readonly piResources: readonly string[];
  /**
   * The package's declared release smoke script (`release.smoke`), or `null`.
   *
   * A package that Pi cannot load declares how its installed tarball is verified
   * instead; see `docs/releases.md`, "Packages Pi does not load".
   */
  readonly smoke: string | null;
  /**
   * Whether the manifest declares a `dsh` manifest: a package the DeepSeek
   * Harness installs rather than Pi.
   *
   * The Harness supplies its host packages at runtime, so such a package's
   * tarball is installed without resolving peers; see `docs/releases.md`.
   */
  readonly dsh: boolean;
}

const PI_RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

/** Parses a package.json; `source` names it in error messages. */
export function parseManifest(text: string, source: string): Manifest {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) {
    throw new Error(`${source} is not a JSON object`);
  }
  const { name, version, files, workspaces, pi, release } = value;
  const piRecord = isRecord(pi) ? pi : {};
  const piResources = PI_RESOURCE_KEYS.flatMap((key) => {
    const entries = piRecord[key];
    return isStringArray(entries) ? entries : [];
  });
  return {
    name: typeof name === "string" ? name : "",
    version: typeof version === "string" ? version : "",
    private: value["private"] === true,
    files: isStringArray(files) ? files : [],
    workspaces: isStringArray(workspaces) ? workspaces : [],
    piResources,
    smoke: readSmoke(release, source),
    dsh: isRecord(value["dsh"]),
  };
}

/** Reads `release.smoke`, which must be a relative TypeScript path. */
function readSmoke(release: unknown, source: string): string | null {
  const smoke = (isRecord(release) ? release : {})["smoke"];
  if (smoke === undefined) {
    return null;
  }
  if (typeof smoke !== "string" || smoke === "") {
    throw new Error(`${source}: "release.smoke" must be a non-empty string`);
  }
  if (smoke.startsWith("/") || !smoke.endsWith(".ts")) {
    throw new Error(`${source}: "release.smoke" must be a relative ".ts" path, got "${smoke}"`);
  }
  return smoke;
}
