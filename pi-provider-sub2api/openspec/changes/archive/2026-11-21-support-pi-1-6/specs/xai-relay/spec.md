## MODIFIED Requirements

### Requirement: Supported Pi baseline

The package SHALL require Pi 1.6.0 or newer and SHALL use exactly Pi 1.6.0 for baseline implementation and acceptance. Earlier Pi versions SHALL be outside the support contract. User-facing requirements SHALL state this minimum.

#### Scenario: Baseline acceptance

- **WHEN** the feature is verified for release
- **THEN** host loading and the xAI conversation checks run on Pi 1.6.0
- **AND** checks on newer hosts do not replace that baseline

### Requirement: xAI metadata resolution

Valid remote limits and modalities SHALL take precedence over exact-ID cached xAI metadata, then bundled xAI metadata, then defaults. Missing fields SHALL resolve independently. Prices SHALL use cached then bundled xAI catalog rates scaled by the entry multiplier, including tiers. Defaults SHALL be 200000 context, at most 16384 output tokens, text-only input, and zero estimated prices. Output limits SHALL be positive and fit the resolved context.

#### Scenario: Partial metadata

- **WHEN** the inventory supplies context, the cached xAI entry supplies only output limits and prices, and bundled metadata supplies modalities
- **THEN** each field uses its highest-precedence valid value
- **AND** invalid limit aliases are skipped in favor of later valid aliases or lower-precedence values

#### Scenario: Bundled Grok capabilities

- **WHEN** the relay advertises `grok-4.6` or `grok-4.7` without limits/modalities and no usable cached values exist
- **THEN** the registered model uses the host's bundled xAI limits, text/image input, and catalog rates for fields not supplied remotely
- **AND** generic metadata defaults do not replace available bundled fields

#### Scenario: Model absent from catalogs

- **WHEN** an unfamiliar model or alias has no usable limits/modalities metadata
- **THEN** it uses the documented defaults, with output capped at `min(16384, context)` regardless of ID spelling
- **AND** documentation explains that defaults can reduce usable limits and image support, and zero estimates do not mean free service
