# Spec Delta

## ADDED Requirements

### Requirement: Boundary compaction preserves other extension entries

When autocompact appends a summary at a turn or settlement boundary, it SHALL preserve all entries proposed by preceding extensions in their original order before its compaction entry. The summary SHALL use the context projected from those preceding proposals.

#### Scenario: Earlier extension metadata survives compaction

- **WHEN** an earlier extension proposes session metadata at a boundary where autocompact generates a summary
- **THEN** the session retains that metadata before the compaction entry

#### Scenario: Earlier context omission survives compaction

- **WHEN** an earlier extension omits a message at a boundary where autocompact generates a summary
- **THEN** the omission remains in session history and the omitted message stays excluded from model context
