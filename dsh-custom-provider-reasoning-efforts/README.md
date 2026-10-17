# @indexyz/dsh-custom-provider-reasoning-efforts

Give a hand-written [dsh (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness)
provider route the reasoning levels its gateway actually offers.

```bash
dsh plugin --profile web add @indexyz/dsh-custom-provider-reasoning-efforts
```

It is built and tested against dsh `0.2.0-rc.2` and declares that range as
`engines.dsh` (`>=0.2.0-rc.2 <0.3.0-0`), which the plugin market reads before it
installs. Node `22.19.0` or newer is required as well.

To try a repository checkout instead (after `npm install` at the repository root):

```bash
npm run build --workspace @indexyz/dsh-custom-provider-reasoning-efforts
dsh plugin --profile web add ./dsh-custom-provider-reasoning-efforts
```

The generated `lib/` directory is Git-ignored. Build before a local `link:`
install; `npm pack` builds and includes the output automatically.

## Why a custom route loses its levels

`llm-pi-ai` resolves a model's reasoning capability from the profile entry's
`reasoningEfforts` field and, only when that field is absent, from the installed
pi-ai catalog. A route the catalog does not ship — `magpie` in the configuration
this plugin was written for — has no catalog entry at all, so:

| Step                                      | Result                                                       |
| ----------------------------------------- | ------------------------------------------------------------ |
| `catalogModels("magpie").get(id)`         | empty map, so `base` is undefined                            |
| `resolveModelReasoning(entry, undefined)` | `{reasoning: base?.reasoning ?? false}` → `reasoning: false` |
| `reasoningInfo(model)`                    | `if (!model.reasoning) return {}`                            |
| model-selection menu                      | no levels to offer                                           |

The gateway may advertise exactly what is missing — `reasoning: true` and
`supported_reasoning_levels: [{effort: "low"}, {effort: "high"}, {effort: "max"}]`
— but the Harness endpoint probe parses only `id`, `name`, `contextWindow`, and
`maxTokens`, and it does not persist what it reads, so discovery cannot fill the
gap by itself. The one thing that fixes it is the field the profile already
supports, on every model entry of that route. This plugin writes it.

## Declarations

Declarations live in this plugin's own row in the profile patch
(`~/.dsh/profiles/<profile>/cordis.patch.yml`):

```yaml
- insert:
    - id: custom-provider-reasoning-efforts
      name: "@indexyz/dsh-custom-provider-reasoning-efforts"
      config:
        providers:
          magpie:
            ollama-cloud/kimi-k3:
              low: low
              high: high
              max: max
            ollama-cloud/deepseek-v4.1-flash:
              low: low
              high: high
              max: max
```

Each model's value is either the levels it offers — keyed by pi-ai thinking level
(`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) and mapped to the wire
spelling that level dispatches — or `false` for a model the route serves but that
cannot reason. `off: null` is the one level that may carry no wire value, because
not thinking is the parameter's absence. A declaration that is empty, offers no
level beyond `off`, puts `null` or an empty string on a thinking level, or names a
level pi-ai does not know fails the plugin's load with the route, the model, and
the level named.

The plugin writes only models the route already declares in the profile: it
never invents a route, a `baseURL`, a protocol, a credential reference, or a
model entry. A declaration for a route or model the profile does not carry is
reported by the command and skipped.

## The `/reasoning-efforts` command

```text
/reasoning-efforts           # what is pending; writes nothing (same as `status`)
/reasoning-efforts status    # same
/reasoning-efforts apply     # write the declarations above
/reasoning-efforts discover  # interrogate each custom route, then write
/reasoning-efforts clear     # remove the reasoningEfforts the declarations name
```

Every mode reports the route/model pairs it changed, how many were already
current, and every pair it skipped with the reason. `status`, `apply`, and
`clear` perform no network request. Nothing is written when the plan finds no
change, so a repeat run leaves the file untouched.

## Endpoint discovery

A route is a discovery candidate when its profile declares both an explicit,
non-empty `models` list and a `baseURL` — the shape of a hand-written route.
`discoverRoutes` names the candidates instead when a deployment wants otherwise.
Each candidate is interrogated once at `GET {baseURL}/models` (Anthropic Messages
at the root `/v1/models`), with `authorization: Bearer <key>` for the OpenAI
protocols and `x-api-key` plus `anthropic-version` for Anthropic Messages. The
key is resolved from the route's own `apiKeyEnv` through the credential store,
falling back to the process environment; when neither resolves, the probe is
sent unauthenticated rather than failing.

The reply's `data` array, or the `models` object some compatible gateways expose,
is read; reasoning is taken from `supported_reasoning_levels`,
`reasoning_levels`, `supported_reasoning_efforts`, or the `reasoning` object's
`efforts` / `supported_efforts`, with string entries or `{effort}` / `{level}` /
`{id}` / `{name}` objects. A name that is a pi-ai thinking level maps to itself
as its wire spelling and `off` maps to `null`; anything else is ignored. Only
models the route already declares are considered, so a gateway listing hundreds
of models cannot add any. An explicit declaration always wins over a discovered
one, and a model whose entry advertises no levels is left exactly as it is.

### The Codex manifest, for a relay whose inventory says nothing

A relay that proxies a Codex backend sometimes publishes an inventory with no
capability at all — only `id`, `display_name`, and `owned_by`, the shape
[`pi-provider-sub2api`](../pi-provider-sub2api) also works around. The same relay
usually answers the backend's own model list at
`GET {root}/backend-api/codex/models` (`root` is the route's `baseURL` with a
trailing `/v1` removed), where each entry carries `slug` and the efforts the
backend accepts:

```json
{
  "models": [
    {
      "slug": "gpt-6.1-sol",
      "supported_reasoning_levels": [
        { "effort": "low" },
        { "effort": "medium" },
        { "effort": "high" },
        { "effort": "xhigh" },
        { "effort": "max" },
        { "effort": "ultra" }
      ]
    }
  ]
}
```

That manifest is a second discovery source. It is consulted only for an
`openai-responses` route whose own listing described no level for at least one
model the route declares, so a relay that already answers costs no extra request;
its levels are merged with the listing's (the listing's own spellings win) and
only the route's declared models are considered. A relay without the endpoint
answers `403`, `404`, or something that is not a manifest, which means "nothing
more to say" rather than a failure; an endpoint that is unreachable, or that
answers with its own error status, is reported. `ultra` is not a pi-ai thinking
level, so it is dropped from a discovered declaration — declare `max: ultra` in
the route's own `providers` entry to wire the `max` level to it.

Discovery is on by default and runs once after startup (see `applyOnLoad` and
`discover` below); `/reasoning-efforts discover` runs it on demand. Every
interrogation failure is contained to a warning and one line in the command's
answer — a gateway that is down never blocks startup or a declaration that does
not need the network.

## Configuration

| Field            | Default     | Meaning                                                                                                    |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `providers`      | `{}`        | Declarations keyed by provider route and then by exact model id; each value is an effort table or `false`. |
| `discover`       | `true`      | Whether the load-time pass interrogates endpoints as well as applying declarations.                        |
| `discoverRoutes` | `[]`        | Routes to interrogate instead of the heuristic's own set; empty means the heuristic.                       |
| `namespace`      | `llm-pi-ai` | The configurable namespace whose `providers` field is written.                                             |
| `applyOnLoad`    | `true`      | Whether the plugin writes at load. Off leaves `/reasoning-efforts` as the only writer.                     |

## Behavior and limitations

- The write goes through the Harness settings service
  (`settings.describe()` / `update()`), the same seam the Models page uses, so
  the Loader validates the change and reconciles the running `llm-pi-ai` row.
  `providers` is a `volatile` field, so the change is live: the next
  `resolveModelInfo()` — and the model-selection menu's next read — sees the
  levels. No restart is involved.
- Because that write is a configuration write, the `llm-pi-ai` config node is
  re-serialized: comments inside that node do not survive a write, and the plugin
  writes only when it has an actual change to make. The declarations themselves
  are persisted, so they keep working if the plugin is later removed;
  `/reasoning-efforts clear` is the way back.
- Only models the profile's own patch layer declares can be filled. A route that
  comes from a lower layer, or a model the route does not list, is reported and
  skipped.
- A gateway that advertises `reasoning: true` with no level list gets no
  declaration: there is no level to offer, and inventing one would claim a
  capability the endpoint did not declare.
- A level name is used as its own wire spelling. A gateway that accepts a
  different spelling for a level needs that spelling written explicitly in the
  declaration.
- Discovery reads `openai-completions`, `openai-responses`, and
  `anthropic-messages` listings; any other protocol is reported as unsupported
  and left to explicit declarations.
- The load-time pass waits for the launcher's readiness signal when the
  composition provides one, runs asynchronously, and contains every failure to a
  log line. It never throws out of the plugin's load and never delays startup.

## Development

The host half is TypeScript compiled to `lib/` with `tsc`; there is no browser
half.

```bash
npm run check          # typecheck, build, then test
npm run build          # lib/ (Host half)
npm test               # 96 Vitest cases
```

`test/smoke-release.ts` is the package's declared `release.smoke` check: the
release engine runs it against the packed and installed tarball, verifying the
manifest targets, the built host entry, and the bundle patch the `dsh` manifest
points at.

See the repository root for the workspace layout and release process.

## License

MIT
