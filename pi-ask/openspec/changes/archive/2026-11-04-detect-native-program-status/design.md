# Design

## Context

Pi 1.5.0's interactive showExtensionCustom reads options.blocked immediately before mounting an inline component. Pi 1.4.0 mounts the component without reading it. Neither exposes a public capability query. See the installed dist/modes/interactive/interactive-mode.js and docs/tui.md.

## Goals / Non-Goals

Select native status by runtime behavior, preserve the explicitly requested fallback, and verify the user-visible dialog flow. Do not infer support from release numbers or patch the host.

## Decisions

Give custom() a blocked getter that records native consumption. Before the returned component first renders, start fallback reporting only if the option was not consumed. Keep the component itself (including focus accessors) intact; wrap its render method. Always restore a started fallback in the dialog's finally block, including cancellation and errors. Native handling never writes a fallback sequence.

Keep the lightweight session status tracker because an older host's first form may open after a run has completed. Remove VERSION-based feature checks. Pin Pi 1.4.0 under an npm test alias and node-pty, already used in the workspace, for real old/new-host PTY tests. Test schema preparation and non-TUI tool calls through a real CLI and local HTTP model server, replacing mocked tool/dialog tests in the touched areas.

## Risks / Trade-offs

The capability detection depends on the host reading blocked before rendering the inline component. Verify this ordering with actual 1.4.0 and 1.5.0 hosts. A host that has native support but disables status still consumes the option, so fallback must remain silent. No terminal interception or source inspection is used at runtime.
