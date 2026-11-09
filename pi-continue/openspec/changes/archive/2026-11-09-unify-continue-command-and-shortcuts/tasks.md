# Tasks

## 1. One path for the command and the shortcuts

- [x] 1.1 Merge the waiting into one `continueTurn()`, used by `/continue` and the shortcuts.
- [x] 1.2 Keep only argument validation and the print and JSON wait in the command handler.

## 2. Prove it through the host

- [x] 2.1 Run the running-turn and settling scenarios for both `F5` and `/continue`; the `/continue` running-turn scenario was seen failing before the merge.

## 3. Ship

- [x] 3.1 Update `README.md`, and widen the pending `patch` intent's summary to the command.
- [x] 3.2 Remove the package test that required `/continue` submitted during a running turn to retry once aborted, which this change reverses. The `/continue` settling scenario covers its failure mode, reading the branch before the abort settled, seen failing with the wait removed.
