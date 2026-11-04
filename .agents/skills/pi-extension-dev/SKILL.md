---
name: pi-extension-dev
description: Build, change, or debug a Pi coding-agent extension in this npm workspace. Use when creating or editing anything under a root-level pi-*/ package directory, when registering commands, providers, events, or UI with Pi's ExtensionAPI, or when unsure how a Pi API behaves.
---

# Pi extension development

Stay inside Pi's plugin system: this work does not build, test, or release any `dsh-*/` package unless the user asks.

Read `docs/pi/README.md` and follow what it links:

- Creating a package: `docs/pi/new-package.md`.
- Any Pi API: `docs/pi/reference.md`. Answer from the copy of Pi the package pins, reading the relevant doc and the closest example under `examples/extensions/`, and confirm signatures in the `.d.ts` files when the doc is not explicit.
- The steps of a change, from reading the package's specs through its release decision: `docs/workflow.md`, "Change a package".
- Testing and verifying, without a root command that spans both systems: `docs/conventions.md`, "Tests", and `docs/pi/README.md`, "Tests" and "Verify".

End with what changed, what was verified and how (commands and the observed result), the release decision recorded, and anything not verified.
