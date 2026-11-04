// What each Pi package registers once configured. A row with no commands and no
// models must name another observable effect, so a package that failed to load
// cannot pass. A new Pi package fails the run until it has a row here.
import type { Scenario } from "./scenario.ts";
import { json } from "./servers.ts";
import type { LocalServer, Reply } from "./servers.ts";
import { PROBE_ARGS } from "./world.ts";

export interface Registration {
  readonly commands: readonly string[];
  readonly models: readonly string[];
  /** Whether the package's own traffic must reach a local server. */
  readonly online: boolean;
  /** Writes the package's configuration against a local server, when it has one. */
  readonly configure?: (context: Scenario) => Promise<void>;
  /** Asserts an effect at the local server for a package with no registrations. */
  readonly effect?: (context: Scenario, chat: LocalServer) => Promise<void>;
}

const relayReply = (url: string): Reply => {
  if (url.endsWith("/backend-api/codex/models")) return json({ models: [{ slug: "gpt-5.5" }] });
  if (url.endsWith("/v1/models")) return json({ data: [{ id: "gpt-5.5" }] });
  return json({ error: "not found" }, 404);
};

export const REGISTRATIONS: Readonly<Record<string, Registration>> = {
  "pi-ask": {
    commands: ["ask-settings", "answer", "answer:again", "ask:replay"],
    models: [],
    online: false,
  },
  "pi-autocompact": { commands: ["autocompact"], models: [], online: false },
  "pi-continue": { commands: ["continue"], models: [], online: false },
  "pi-idle-compression": { commands: ["idle-compression"], models: [], online: false },
  "pi-model-trace": { commands: ["model-trace"], models: [], online: false },
  "pi-custom-provider": {
    commands: ["refresh-custom-provider-models"],
    models: ["local-openai/served-model"],
    online: true,
    async configure({ server, world }) {
      const upstream = await server((request) =>
        request.url.endsWith("/v1/models")
          ? json({ data: [{ id: "served-model" }] })
          : json({ error: "not found" }, 404),
      );
      world.writeAgentFile("custom-provider.json", {
        modelsDev: false,
        providers: {
          "local-openai": {
            baseURL: `${upstream.baseUrl}/v1`,
            apiKey: "local",
            api: "openai-completions",
          },
        },
      });
    },
  },
  "pi-provider-sub2api": {
    commands: [
      "openai-compress",
      "toggle-ultra",
      "toggle-fast",
      "toggle-ultrafast",
      "toggle-daybreak",
      "sub2api-save",
      "sub2api-refresh",
    ],
    models: ["relay/gpt-5.5"],
    online: true,
    async configure({ server, world }) {
      const relay = await server((request) => relayReply(request.url));
      world.writeAgentFile("sub2api.json", {
        relay: { baseURL: relay.baseUrl, token: "local", api: "openai-codex-responses" },
      });
    },
  },
  "pi-skill": {
    commands: [],
    models: [],
    online: false,
    async effect({ rpc, world }, chat) {
      world.writeAgentFile(
        "skills/known/SKILL.md",
        "---\nname: known\ndescription: a known skill\n---\nDo the known thing.\n",
      );
      const client = rpc(["--no-session", ...PROBE_ARGS]);
      await client.prompt("$known hi");
      const sent = chat.requests.at(-1)?.body ?? "";
      if (!sent.includes('<skill name=\\"known\\"'))
        throw new Error(`pi-skill did not deliver the skill block: ${sent}`);
    },
  },
};
