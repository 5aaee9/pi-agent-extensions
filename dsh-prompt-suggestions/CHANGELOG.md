# Changelog

## 0.1.1

### Patch Changes

- Rebuilt and retested against the dsh 0.2.2-alpha.2 host line, including its cordis 4.0.6-alpha.1 and schemastery 3.18.6-alpha.1 releases.

## 0.1.0

### Minor Changes

- First release: show a dim next-message suggestion in the empty dsh composer after a successful live reply, accept it with Tab or Right Arrow without auto-submitting, dismiss it with Escape, and persist a General settings switch. Generation uses the conversation's current model with low reasoning, at most eight recent visible exchanges, a 30-second deadline, no tools, no session writes, and no goal inheritance.
