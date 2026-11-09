# Proposal

## Why

omp (oh-my-pi) binds its retry action, `app.retry`, to `F5` and `Alt+R`, so an
interrupted turn is one keypress away. `@indexyz/pi-continue` ships only the
`/continue` command: the same retry exists, but reaching it needs typing a command.
Pi assigns neither key to a built-in action, so both are free for an extension.

## What Changes

- Register `f5` and `alt+r` as extension shortcuts that run the same retry as `/continue`.
- Share one retry function between the command and the shortcuts. `/continue` keeps
  its argument validation; a shortcut has no arguments.
- Command handlers receive `waitForIdle()`; the context a shortcut handler receives does
  not, so the shared function polls `isIdle()` in that case.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `continue-command`: a shortcut retries the interrupted turn exactly like `/continue`.

## Impact

`pi-continue/index.ts` and the terminal scenarios in `scripts/e2e/pi/pi-continue.e2e.ts`.
`@indexyz/pi-continue` gets a `minor` release intent: the package gains a capability
without changing the command.
