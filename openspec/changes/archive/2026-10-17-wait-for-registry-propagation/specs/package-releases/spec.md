# Spec Delta

## Purpose

Make the publish step wait out npm registry propagation instead of failing a version it just uploaded, on one bounded budget for the whole run, so a release records itself without a human rerun while a genuine registry problem still fails.

## ADDED Requirements

### Requirement: A version the registry does not serve yet is waited for, not failed

When the publish step uploads a version and the registry does not confirm it on the first lookup, the step SHALL re-check that version on an exponential backoff instead of failing, until the registry confirms it or the run's wait budget is exhausted. The same wait SHALL apply when `npm publish` answers that the version is already published while the registry re-check does not confirm it, because that is the same race seen on the upload path. Once the wait sees the version, the step SHALL record it — creating its tag and its GitHub Release exactly as for a confirmed upload.

#### Scenario: A version becomes visible after a short delay

- **WHEN** `npm publish` succeeds for `@indexyz/pi-skill@0.1.44` and `npm view` does not confirm the version on the first lookup
- **THEN** the step waits out the backoff without failing, confirms the version as soon as the registry serves it, and creates its tag and GitHub Release as an ordinary published version

#### Scenario: npm reports the version already published but the registry does not show it

- **WHEN** `npm publish` answers "cannot publish over the previously published versions" and the immediate `npm view` re-check does not confirm the version
- **THEN** the upload counts as already published once the wait confirms it, later uploads continue, and its tag and GitHub Release are created

### Requirement: The wait has one 30-minute budget shared by the publish run

The wait SHALL have a single deadline shared by the whole publish run, established when the run first needs to wait and never extended, so the total time the run spends waiting SHALL NOT exceed 30 minutes however many versions it waits for. Each wait SHALL be clamped to the remaining budget, so no wait extends past the deadline, and a version confirmed during the last wait SHALL still be recorded. A version the registry still does not confirm when the budget is exhausted SHALL fail the run with an error naming that version and the exhausted wait, and SHALL get no tag and no GitHub Release, leaving a rerun as the backstop.

#### Scenario: A version never becomes visible

- **WHEN** an uploaded version is still unconfirmed when the run's 30 minutes of waiting are exhausted
- **THEN** the run fails with an error naming the version and the exhausted wait, and creates no tag and no GitHub Release for it

#### Scenario: The budget is shared by the run

- **WHEN** a first version consumes the whole wait budget and a later version of the same run is still unconfirmed
- **THEN** the later version does not receive a fresh 30 minutes: it fails after a single lookup and no further waiting, and the run's total waiting stays within the budget

### Requirement: Only a live registry answer is waited on

Because the wait decides what the registry serves right now, every lookup it makes SHALL revalidate with the registry rather than answer from a cached package document that predates the upload. A version that is genuinely absent SHALL NOT be waited for: an upload that failed for a reason other than "already published", or that was not attempted because an earlier upload failed, SHALL get its single lookup and its "not on the registry; not recorded" notice. A lookup that fails with an authentication, network, or malformed-response error SHALL fail the run immediately, because a failed lookup is not absence.

#### Scenario: A version that is genuinely absent is not waited for

- **WHEN** an upload failed for a reason other than "already published", or was not attempted because an earlier upload failed, and the registry does not show that version
- **THEN** the step performs a single lookup, records nothing for it, and does not wait

#### Scenario: A failing lookup is not propagation

- **WHEN** a registry lookup fails with an authentication, network, or malformed-response error instead of answering that the version is absent
- **THEN** the run fails immediately with that error and no waiting
