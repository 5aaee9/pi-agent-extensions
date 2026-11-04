# Verification

Each scenario's proof that it detects its failure: the regression applied to a scratch copy, never committed, and what was observed. `design.md` D7 explains why this is recorded rather than automated.

| Scenario        | Regression applied                                       | Observed                                                                                                                       |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| X1 (load check) | `fingerprint.ts` removed from `pi-model-trace`'s `files` | `npm run test:e2e -- --package @indexyz/pi-model-trace` fails: `Cannot find module './fingerprint.ts'` from the installed copy |
