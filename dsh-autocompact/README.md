# @indexyz/dsh-autocompact

Set an earlier automatic compaction threshold per model, or for every model at once, on
the [dsh (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) coding
agent. This is the dsh port of [`@indexyz/pi-autocompact`](https://github.com/5aaee9/pi-agent-extensions/tree/main/pi-autocompact).

```bash
dsh plugin --profile web add @indexyz/dsh-autocompact
```

To install a repository checkout, run from the repository root:

```bash
npm install
npm run build --workspace @indexyz/dsh-autocompact
dsh plugin --profile web add ./dsh-autocompact
```

Build output is Git-ignored. Local `link:` installs read that output directly;
`npm pack` builds it automatically before creating a published package.

It is built and tested against dsh `0.2.2-alpha.2` and declares that range as
`engines.dsh` (`>=0.2.0-rc.2 <0.3.0-0`), which the plugin market reads before it
installs: on a harness outside it the market refuses the install instead of
installing something that breaks. That range includes `0.2.1-rc.2`. Preset
backends are resolved with `agentPresets.serviceFor`, which both registry
versions provide; `0.2.1-rc.2` no longer exports `serviceForAgent`, and importing
that name prevents the plugin from activating. Node `22.19.0` or newer is
required as well.

```text
/autocompact 300k    # 300,000 tokens, current session/model only
/autocompact 0.3m    # same threshold; k/m are decimal units
/autocompact 300000
/autocompact         # show current threshold and native enabled state
/autocompact off     # use the backend defaults, ignoring global plugin defaults in this session
/autocompact default # clear the session override and inherit the global default
```

Commands never write configuration, append threshold entries to the session log,
reload plugins, or modify the model's real context-window metadata. Overrides are
keyed by exact `provider/model`. Switching models preserves each model's session
override; new, resumed, and forked sessions start clean. `off` does not disable
the backend's own automatic compaction or overflow recovery.

The effective threshold for a route is resolved in this order: the session's
`/autocompact` override (an explicit `off` suppresses everything below it), the
route's own entry in `modelLimits`, then the deployment-wide `defaultLimit`. A
route with none of these keeps the backend's own automatic compaction.

## Settings page

**Settings → Autocompact** manages the persisted deployment defaults that every
session inherits, so a threshold can be set without editing YAML:

- a master switch for all configured thresholds;
- a **Default threshold** applied to every model that has no threshold of its own,
  left blank to keep those models on the backend's compaction;
- one row per exact `provider/model` route with its threshold in tokens, editable
  in place and removable;
- an add-model control fed by the live model catalog, with a manual
  `provider/model` field when the catalog is unavailable.

The composer's status pill opens this section (see below); the same editor is also
registered as a central panel, which is the pill's fallback destination when the
settings shell's store cannot be reached.

The page writes the bundle row's `modelLimits` and `defaultLimit` through the Host
`settings` service, guarded by the row's revision and validated by its Config schema,
so values land in the profile patch layer and survive upgrades. `writable: false`
profiles render the page read-only. `modelLimits`, `defaultLimit`, and `enabled` are
declared `.volatile()`: the settings service lists only entries whose Config has a
volatile field and accepts writes only to volatile paths, and a volatile field is
what makes a saved edit reach the running plugin without a restart. `retainTokens`
stays ordinary configuration and is edited in YAML only.

The client half reaches that namespace as its own Cordis service
(`remote.settings`, declared in `inject`) rather than as a property of the
`remote` service: Cordis resolves a nested service only for a context that
declares it, and reading it otherwise throws. The model catalog is read
opportunistically from `remote.session`, so a deployment without it still gets
the manual route field. The section also carries its own error boundary, so a
crash shows its message and stack in place instead of leaving an empty page.

The page's type scale and controls are settings-page values, copied from the
shipped packages rather than chosen here: the 18/600 page title and 13px intro of
`dsh-client-ui-agent-preset`, a 12/18 hint and 14/22 row label from
`dsh-client-ui-settings-models` (the same management-list shape this page has) and
`dsh-client-ui-settings-account`, the 32px field from the primitives'
`Input.module.css`, the 36px button with its 28px row variant and the card tokens
from the settings pages, and the 36x20 switch from `Switch.module.css`. The host's
sections are not uniform — Models, Account and Shortcuts declare a 16/500/24 page
title, Agent presets an 18/600 one — so this takes the heavier of the two, which is
the section adjacent to this one. Tokens the Theme provider does not document
(`label-tertiary`, `border-l3`, `settings-card-*`, `button-primary-*`, the radii)
are used with the documented token as a fallback, so a rename degrades the
appearance instead of erasing it.

## Composer status line

A compact status entry sits in the composer's ambient row
(`conversation.composer.dock`), right beside the session's turn, token, and
context readings, so the state is visible without opening Settings:

| It shows             | When                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(icon) 128K / 300K` | a threshold applies to this session's model (its own entry or the deployment default): the first figure is the measured pressure from `contextPressure`, the second the threshold that triggers compaction |
| `(icon) 300K`        | a threshold applies, but no request has reported usage yet                                                                                                                                                 |
| `(icon) Off`         | the master switch is off                                                                                                                                                                                   |
| nothing              | neither a model threshold nor a deployment default applies, or the deployment exposes no configurable autocompact row                                                                                      |

The pill is dressed as one of the host's own ambient readings: the icon artwork (the host's data-outline icon),
the pill padding, radius and tertiary label colour, the density-aware type size,
and the `{value}K`/`{value}M` count units all match the composer's own stats and
context readings, so nothing about it stands out. It carries no word of the
plugin's own name — the icon identifies the entry, and the tooltip (`title` and
`aria-label`) stays two short lines: the route and what the number means, then
what a click does (`deepseek/x: 128K of 300K` / `Click to open settings`).

It takes a seat in that row only when it has something to report: a model
without a threshold of its own and no deployment default under an on switch is a
non-event, and the Settings page is where "not configured" is discovered and
fixed — so an inert autocompact does not add noise to the session's own readings.

Clicking the pill opens **Settings → Autocompact**. Settings owns the panel, its
section navigation, and the store behind both, and the shell registers that store
with a handle pinned to the live instance — `{ ...handle, create: () => instance }`
— so resolving the seat through the slot registry answers the very store the panel
renders from, and the shell's own `openSection(id)` (documented on its owner props
as "open the settings panel directly on one registered section") selects this
plugin's section and opens the modal. The lookup goes by capability, not by
position: only a store whose action table carries `openSection` is asked, because a
store declared any other way mints a fresh, unsubscribed instance whose actions
change nothing on screen.

As a fallback, this plugin also registers a central panel under its own key that
renders the same editor component from the same store as the Settings section, and
the pill selects it through the `layout` service when the settings shell's store
cannot be reached (a renamed cell or action, or a profile without settings). `selectPanel`
throws for an unregistered key, so both paths are guarded; in a composition with
neither, the click is inert and the reading still renders.

It reads the session's route from the `modelSelection` projection and subscribes
to the same configuration store the Settings page writes to, so a save there
updates the line immediately. The configured number is the **deployment
default** for the route, falling back to the deployment-wide default:
`/autocompact` overrides live in Host memory for one session and are not
published to the client, so the pill shows the persisted threshold and does not
claim to be the effective value — a session override is not visible here.
A crash inside the pill is caught by its own boundary, which logs and renders
nothing, because the composer must survive a decorative widget.

## How it works on dsh

`dsh-compaction-basic` already condenses history as token pressure builds, using
`floor(min(W × thresholdRatio, W − reservedOutput − headroomTokens))`. This plugin
adds only one thing: an **earlier absolute threshold**, per model or for every
model, for the current session, expressed through the public compaction seam.

- On every `agent/pre-step` boundary the plugin measures request pressure with
  `ctx.tokenMeter` and compares it with the effective threshold. Above it, the
  plugin selects a balanced surface range that keeps the backend's own
  `retainTokens`/`retainRatio` recent tail verbatim, then calls
  `compactRegion(start, end, agent, signal)` on the session's backend. The backend
  writes the summary and the ordinary `compaction/*` records; the turn continues
  with normal tool and follow-up scheduling. No synthetic prompt is injected and
  the run is never aborted.
- Because a new prompt enters through the same `agent/pre-step` boundary, a large
  existing session is also compacted before its next request — the dsh equivalent
  of Pi's idle-input path, without a second code path.
- Failures are contained and reported once per session: a failed summary leaves
  context intact and the next step can try again.

### Where the backend comes from

The shipped Web bundle disables the Host-plane `compaction-basic` row and lets
each Agent preset mount its own instance inside an `isolate` realm. A single Host
row therefore cannot `inject` `compaction`; this plugin mounts on the Host plane
(one row serves every preset) and addresses the backend of the exact Agent at
event time:

1. `ctx.get("agentPresets")?.serviceFor(agent, "compaction")` — the
   preset-mounted instance. This is `AgentPresetRegistry#serviceFor` from
   `@deepseek-ai/dsh-agent-preset-registry` (dsh 0.2.0-rc.2 and 0.2.1-rc.2).
2. `ctx.get("compaction")` — the Host-plane instance, for compositions such as
   the headless, ACP, and SDK bundles that mount it there.

Overrides stay keyed by session and route, so they follow the Agent, not the
preset revision.

## Optional global defaults

Persist defaults in the bundle row's `config` (profile `cordis.patch.yml`), not in
the command:

```yaml
- insert:
    - id: autocompact
      name: "@indexyz/dsh-autocompact"
      config:
        defaultLimit: 300000
        modelLimits:
          provider/model-id: 400000
```

| Field          | Default | Meaning                                                                                                                 |
| -------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `modelLimits`  | `{}`    | Global default thresholds keyed by exact `provider/model`; positive integer token counts.                               |
| `defaultLimit` | unset   | Threshold applied to every model without a `modelLimits` entry; unset means those models keep the backend's compaction. |
| `retainTokens` | `20000` | Recent-tail fallback budget, used only when the mounted backend publishes no retention policy.                          |
| `enabled`      | `true`  | Master switch for the automatic pressure check.                                                                         |

Values are positive integer token counts. A `modelLimits` entry overrides
`defaultLimit`, and a session command overrides both without changing the row
configuration. The Settings page above writes `modelLimits`, `defaultLimit`, and
`enabled`, so YAML and UI stay interchangeable; clearing the default in the page
(or deleting the key in YAML) turns autocompact off for uncovered models again.

## Behavior and limitations

- The mounted backend must support explicit region compaction
  (`compactRegion` on the backend, shipped by `dsh-compaction` 0.2.0-rc.2 and
  newer). Otherwise the command reports the missing capability and the hook is
  inert.
- A backend that publishes `config.auto === false` disables automatic compaction;
  the plugin respects that and refuses to set a threshold.
- Retention follows the backend's own policy for the exact route, so the
  threshold must exceed the retained tail and stay below the real model context
  window. Both are validated before a threshold is accepted.
- A deployment-wide `defaultLimit` is validated once at load as a positive token
  count, then checked against each route's real capacity when that route is used.
  A default that does not fit one model's context window leaves that model
  uncompacted and warns once per session; other routes keep using it.
- Thresholds are not strict request-size caps: one turn or tool batch can
  overshoot. If an indivisible or too-small context cannot retain recent content
  and shrink, the plugin leaves it to the backend's overflow or manual
  compaction.
- The backend's automatic threshold is untouched, so a plugin threshold above it
  never delays compaction.
- Summary generation consumes model tokens. Failures leave context intact and are
  not retried at the same boundary; a subsequent step can try again.

## Development

Both halves are TypeScript; only their build targets differ.

```bash
npm run check          # typecheck, build both halves, then test
npm run build          # lib/ (Host, tsc) + client.js (browser half, tsdown)
npm run build:host     # Host half only: index.ts/settings.ts/compaction.ts -> lib/
npm run build:client   # browser half only: src/client/index.tsx -> client.js
```

The Host half compiles to `lib/` with `tsc`. The browser half is authored under
`src/client/` and built by [tsdown](https://tsdown.dev) (oxc/rolldown) into the
Git-ignored `client.js`: that is the artifact `exports["./client"]` publishes and
the Harness page loads, so it must be one
`window.__ModuleLoader__.load({ id, factory })` registration. The build supplies
that wrapper and leaves `react` / `react/jsx-runtime` external, because the
page's module table provides them — edit the source, then run
`npm run build:client` (the artifact carries a generated-file header, and the
workspace formatter and linter skip it).

| File                                  | Role                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `index.tsx`                           | `inject` + `apply`: the registration the loader materializes             |
| `contracts.ts`                        | the Host, locale, slot, and Remote-namespace shapes this half depends on |
| `services.ts`                         | access to those services (`remote.settings`, `remote.session`)           |
| `state.ts`                            | the page's state shapes and the pure derivations over them               |
| `limits.ts`                           | the `300k` threshold grammar and count formatting                        |
| `dictionary.ts`, `styles.ts`          | this half's localized strings and section styles                         |
| `page.tsx`                            | the section: its state, Host reads/writes, and layout                    |
| `threshold-list.tsx`, `add-model.tsx` | the two editable views the page renders                                  |
| `crash-boundary.tsx`                  | the section's own crash face                                             |

See the repository root for the workspace layout and release process.

## License

MIT
