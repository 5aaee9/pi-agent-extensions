# @indexyz/pi-model-trace

Attribute the model actually serving pi via [ModelTrace](https://github.com/xqy2006/ModelTrace) numeric fingerprinting.

## Install

```bash
pi install npm:@indexyz/pi-model-trace
```

Releases are published to npm as `@indexyz/pi-model-trace`; each release is tagged `@indexyz/pi-model-trace@<version>`.

Requires Pi 1.5.0 or newer.

To try a repository checkout (after `npm install` at the repository root):

```bash
pi -e ./pi-model-trace/index.ts
```

## Usage

```
/model-trace                # probe the currently selected model
/model-trace provider/id    # probe a specific registered model
```

The command runs **three independent probes** against the target model. Each probe
is executed in its own **non-persisted pi session** — a fresh `pi -p --no-session
--no-tools -a` child process with an empty context, no session persistence, and all
tools disabled, so the model has to answer the numeric challenge directly and
cannot reuse prior context or call tools. Transport-level probe failures are
retried once. Probes use the current Pi installation and preserve the session's
thinking level, including `off`; `PI_MODEL_TRACE_BIN` explicitly overrides the
probe executable. Each probe has a ten-minute timeout and a one-MiB combined
stdout/stderr limit. Failed or truncated output does not contribute to attribution.
Switching or closing the session cancels active probes without retries or a late
report.

Each challenge asks the model to emit ~300 integers between 1 and 355. The raw
answers are scored locally against the bundled ModelTrace unified fingerprint bank
(`data/unified_bank.json`, 30 GPT, Claude, Doubao, Gemini, GLM, Grok, and Kimi
candidates), which computes:

```
0.75 × nuisance-projected Hellinger centroid similarity
+ 0.25 × ordered-block digit-sequence feature
```

The three scores are averaged and converted to closed-set model and family
probabilities through the bank's calibrated temperature. The result is appended
to the transcript as a `model-trace` message.

## Notes

- Results are closed-set probabilities **within the bundled bank only** — an
  unlisted model is attributed to its nearest candidate. Treat them as a
  reference signal, not definitive proof.
- The model still sees pi's system prompt during probes; providers or harnesses
  whose prompts differ strongly from the bank's采集环境 can skew attribution.
- Probe processes load persisted and project resources independently. Providers
  registered only in the parent session's memory are not available in probes.
- Probes consume the target model's inference quota (three ~300-token answers).
- The fingerprint core and challenge generator are TypeScript ports of upstream
  `fingerprint-core.mjs` / `fingerprint.py` (MIT License, © 2026 xqy2006).

## Development

```bash
npm run check --workspace @indexyz/pi-model-trace
npm run test:e2e -- --package @indexyz/pi-model-trace
```

The command regression tests run real Pi RPC sessions and probe subprocesses
against a local OpenAI-compatible HTTP endpoint; they need no model credentials.
