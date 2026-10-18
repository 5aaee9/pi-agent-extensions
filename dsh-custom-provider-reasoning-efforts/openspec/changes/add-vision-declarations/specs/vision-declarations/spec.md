# Spec Delta

## Purpose

Define the vision declaration model `@indexyz/dsh-custom-provider-reasoning-efforts` supplies beside its reasoning efforts: the modality grammar a row configuration declares for a hand-written `llm-pi-ai` route's models, how a declaration is accepted or rejected, how it is planned and written onto a model entry's `input` field, the modality fields an endpoint listing publishes that discovery reads, and how the `/reasoning-efforts` command drives both tables through one seam.

## ADDED Requirements

### Requirement: A vision declaration names the request modalities a model accepts

The plugin's row configuration SHALL carry `vision`, a table keyed first by `llm-pi-ai` route and then by exact model id, whose value SHALL be a non-empty array of pi-ai model modalities — `text` and `image` — in declaration order, and SHALL be accepted only when it contains `text` (a model that accepts images accepts text) and names no member outside the vocabulary. `text` alone SHALL be accepted to strip a vision claim an inherited catalog or route default unfairly carries; `text` and `image` together SHALL be accepted to grant a hand-declared vision model. An empty array, an array that becomes empty after members the vocabulary does not know are dropped, and an array without `text` SHALL each fail the plugin's load naming the route and the model, the same load failure contract the reasoning declarations follow.

#### Scenario: A vision model is granted

- **WHEN** `vision.magpie["ollama-cloud/kimi-k3"]` is `[text, image]`
- **THEN** the declaration is accepted and names exactly those modalities in that order

#### Scenario: A model is stripped to text

- **WHEN** a model's declaration is `[text]`
- **THEN** the row accepts it and the model's `input` is written as `["text"]`

#### Scenario: A vision-only array

- **WHEN** a declaration is `[image]` without `text`
- **THEN** the load fails with an error naming the route, the model, and `text`

#### Scenario: An empty array

- **WHEN** a declaration is `[]`
- **THEN** the load fails with an error saying the declaration names no modality. The plugin does not write the empty form anywhere: `llm-pi-ai` reads an empty `input` list as "no answer", so an explicit empty array cannot express a true claim and the row config must not carry one

### Requirement: A vision declaration is planned against the field's own value and written through the settings service

Planning SHALL resolve each vision intent against the profile patch's own raw `providers` value exactly as the reasoning intents are: only a route the profile declares with an explicit `models` list, and only a model that list contains, is written; every other intent is skipped with a reason. A declaration SHALL be compared against the entry's `input` field's planned value, and SHALL be written only when that value differs, replacing the field with the declared modalities in declaration order. On the same model entry a vision declaration and a reasoning declaration SHALL be written through the same planned `providers` value without disturbing each other: adding one to an entry that already carries the other is a change in the one field the intent names. Nothing is invented: no route, `baseURL`, protocol, credential, or model entry is created by a vision intent, and the write carries the revision `describe()` returned under the same single-retry conflict contract as the reasoning write.

#### Scenario: A declared pair gains its modalities

- **WHEN** the profile declares route `magpie` with model `ollama-cloud/kimi-k3` and the vision table names that pair with `[text, image]`
- **THEN** the model entry gains `input: ["text", "image"]` and every other field of the entry and the profile is left as it was

#### Scenario: The pair already carries the declared modalities

- **WHEN** the entry's `input` field already equals the declared array
- **THEN** the plan reports the intent as already current and the values written unchanged

#### Scenario: The declared pair already carries reasoning

- **WHEN** an entry carries `reasoningEfforts` and a vision declaration names it
- **THEN** the write keeps `reasoningEfforts` exactly as it was and changes only `input`

#### Scenario: The route or model is not in the profile

- **WHEN** a vision declaration names a route the profile does not declare, a route without an explicit `models` list, or a model the route does not list
- **THEN** the result reports that pair as skipped with the reason, and `input` is not invented anywhere

### Requirement: Discovery reads the modalities an endpoint listing publishes

The plugin's endpoint interrogation — the same listing request, headers, and credential contract the reasoning discovery follows, over the same candidate routes — SHALL also read each listing entry's declared request modalities, gathered from `input_modalities`, `supported_input_modalities`, the `architecture` object's `input_modalities` / `modality`, and the nested `modalities.input` / top-level `modalities` arrays, in the order the entry publishes them. A member naming `text` or `image` (case-insensitively, also as `input-text`/`input-image`) maps to that modality; any other member is dropped; an entry that publishes no member of the vocabulary produces no vision intent. A discovered list that contains `image` SHALL become a vision intent for that model when the route's explicit `models` list declares it, and an entry that publishes a text-only vocabulary list SHALL produce no intent, because stripping an inherited claim is a decision an endpoint does not make. Discovery of modalities SHALL NOT require the listing to advertise reasoning levels, and modality discovery SHALL be contained like every other interrogation outcome: a listing that cannot be read is reported as an interrogation failure for the route, and no endpoint answer ever creates a route, a model, or a synthetic modality list.

#### Scenario: An OpenRouter-shaped listing grants vision

- **WHEN** a listing entry carries `architecture: {input_modalities: ["text", "image"]}`
- **THEN** the declared model on that route gains a discovered vision intent of `[text, image]`

#### Scenario: A text-only listing writes nothing

- **WHEN** a listing entry carries `input_modalities: ["text"]` and the model's entry carries no explicit vision declaration
- **THEN** no vision intent is produced and the model's `input` stays as it was

#### Scenario: Unknown modality names are dropped

- **WHEN** a listing entry carries `input_modalities: ["video", "audio"]`
- **THEN** the entry produces no vision intent, because every member is outside the vocabulary

#### Scenario: A listing that discloses no modalities

- **WHEN** the endpoint's listing publishes no modality field at all
- **THEN** discovery writes no `input` value and reports no failure, the same "nothing more to say" contract reasoning discovery follows

### Requirement: An explicit declaration wins over a discovered value

When a model receives both an explicit `vision` declaration and a discovered modality list, the explicit declaration SHALL be the intent that lands, exactly as the reasoning discovery yields to its own table. A discovered list SHALL NOT be written for a model the plugin's `vision` table names, whether or not the two agree. Clearing, likewise, removes the `input` field only from the pairs the plugin's own `vision` table names.

#### Scenario: Both tables name the pair

- **WHEN** the `vision` table declares `[text]` for a model whose entry the listing publishes as `["text", "image"]`
- **THEN** the value written is `["text"]` and the discovered list is not written anywhere

#### Scenario: Clear removes only its own declarations

- **WHEN** the `vision` table names a pair whose entry carries `input` and the user runs the clear mode
- **THEN** that pair's `input` field is removed, every other model's `input` stays, and the pair's `reasoningEfforts` is also removed when the reasoning declarations name it under the same call

### Requirement: Status, apply, clear, and discover speak for both tables in one command

`/reasoning-efforts` keeps its name and its `status | apply | discover | clear` modes: `status` plans both tables' intents without writing, `apply` writes the reasoning and the vision declarations, `discover` runs the probe whose answer feeds both tables, and `clear` removes the `reasoningEfforts` and `input` fields the tables name. Every reported change and every skip SHALL name the field (`reasoningEfforts` or `input`) it belongs to, so the two tables' outcomes are readable in one answer; the counts, the already-current accounting, and the failure containment the reasoning command answers provide SHALL be preserved.

#### Scenario: One answer reports both fields

- **WHEN** a plan carries one pending reasoning change, one pending vision change, and one vision skip
- **THEN** the answer names each change's field and the skip's reason, in one pass's answer

#### Scenario: When there is nothing to do for either table

- **WHEN** both tables produce no change and no intent
- **THEN** the plugin writes nothing and the answer reports that state
