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
}

const PI_RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

/** Parses a package.json; `source` names it in error messages. */
export function parseManifest(text: string, source: string): Manifest {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) {
    throw new Error(`${source} is not a JSON object`);
  }
  const { name, version, files, workspaces, pi } = value;
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
  };
}
