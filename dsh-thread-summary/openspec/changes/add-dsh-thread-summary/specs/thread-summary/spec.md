## ADDED Requirements

### Requirement: Summary model settings

The plugin SHALL expose an enabled flag plus separate Provider and Model selectors in Settings → General, persist the resulting `provider/model` route through the Host settings service, and apply valid volatile edits to subsequent sessions without restart.

#### Scenario: Configure a summary model

- **WHEN** a user selects a Provider and one of its available Models and saves it
- **THEN** the plugin stores the combined route with revision checking and uses it for later first-prompt title generation

#### Scenario: Invalid or unavailable route

- **WHEN** the route is empty, malformed, or the profile is read-only
- **THEN** the UI reports the validation/read-only state and does not write an invalid value

#### Scenario: Native settings appearance

- **WHEN** the summary settings row is rendered in a light, dark or narrow settings surface
- **THEN** it uses the host's Button, Switch and Menu controls, General-row typography and theme tokens, with no horizontal overflow and accessible keyboard selection

### Requirement: First prompt title generation

When enabled and configured, the plugin SHALL register a `sessionTitle` provider in `first-prompt` mode and generate one concise title from the first eligible user input using the configured summary model.

#### Scenario: Successful summary

- **WHEN** a new session receives its first eligible user message and the summary model returns text
- **THEN** the plugin returns a normalized title with the source message seq and model identity, and Harness persists it through the standard session title event

#### Scenario: Summary failure

- **WHEN** the auxiliary request fails, is cancelled, returns only non-text output, or returns an empty title
- **THEN** the plugin leaves the session usable and Harness applies its deterministic fallback title

#### Scenario: Manual title preservation

- **WHEN** the user has already renamed the session
- **THEN** automatic summary generation does not overwrite that title

#### Scenario: Bounded first-message request

- **WHEN** the first input exceeds the auxiliary request budget or a refresh supplies multiple messages
- **THEN** only the first message is used and attributed, and system plus framed input stays within 4,096 UTF-8 bytes without splitting Unicode characters or JSON escapes

#### Scenario: Deadline and invalid completion

- **WHEN** generation exceeds 60 seconds, is cancelled, finishes unsuccessfully, omits its finish event, or returns tool calls or no visible title
- **THEN** generation fails, releases its deadline timer, and leaves the deterministic fallback usable

#### Scenario: Title display limits

- **WHEN** the model returns a title
- **THEN** the plugin strips control codes, enclosing quotes and trailing sentence punctuation, normalizes whitespace, and limits it to 36 Unicode code points and 80 UTF-8 bytes without splitting a character

#### Scenario: Settings failure or disabled generation

- **WHEN** settings or catalog access fails, the profile is read-only, or the user disables generation without a model
- **THEN** the UI reports failures/read-only state, contains rejected remote calls, and permits saving disabled generation without requiring a model

### Requirement: Package verification

The package SHALL provide a dsh bundle manifest, built Host and Client artifacts, focused tests of the production provider, a release smoke check that evaluates the browser artifact through the module-loader contract, and documentation sufficient for live profile installation.

#### Scenario: Installed tarball smoke

- **WHEN** the package tarball is installed into an isolated directory without host peers
- **THEN** the release smoke script verifies declared files and evaluates the client bundle with the Harness module-loader contract, including General row registration and disposal
