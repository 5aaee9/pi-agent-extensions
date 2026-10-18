# Spec Delta

## Purpose

Show and accept a dim next-message suggestion in the resident composer without interfering with higher-priority composer behavior.

## ADDED Requirements

### Requirement: Dim ghost text in an empty composer

The browser half SHALL render a returned suggestion as dim text over the native composer placeholder only while the draft is empty, the input phase is plain, no attachments are present, the session is open and idle, and generation is enabled. The native placeholder MUST be hidden without reflowing the composer.

#### Scenario: Suggestion visible

- **WHEN** a ready suggestion exists for the current session, the draft is empty, and no attachment is present
- **THEN** dim suggestion text appears at the placeholder position and the native placeholder is visually hidden

#### Scenario: Suggestion not visible

- **WHEN** the draft is non-empty, the session is running, the session is blank or closed, attachments exist, or the switch is off
- **THEN** no ghost text is painted

#### Scenario: Draft cleared

- **WHEN** a suggestion was fetched while the draft was non-empty and the user clears the draft
- **THEN** the ghost text appears without another Host query

### Requirement: Keyboard acceptance and dismissal

Tab or Right Arrow SHALL append the visible suggestion to the editable draft using the composer's public insertion action. Escape SHALL dismiss it. Acceptance MUST NOT submit the message. The suggestion is a draft aid, not an automatic action.

#### Scenario: Tab accepts

- **WHEN** the visible suggestion exists and the user presses bare Tab in the editor
- **THEN** the suggestion is inserted into the draft and no message is submitted

#### Scenario: Right Arrow accepts

- **WHEN** the visible suggestion exists and the user presses bare Right Arrow in the editor
- **THEN** the suggestion is inserted into the draft and no message is submitted

#### Scenario: Escape dismisses

- **WHEN** the visible suggestion exists and the user presses Escape
- **THEN** the ghost text disappears and the draft is unchanged

#### Scenario: No auto-submit

- **WHEN** a suggestion is accepted
- **THEN** the composer remains editable and no prompt is sent

### Requirement: Higher-priority composer behavior

Existing drafts, open popups, attachments, paste operations, IME composition, and custom Tab or Right-Arrow bindings SHALL take priority over the suggestion. The ghost text MUST NOT consume a key owned by another command or an open menu.

#### Scenario: Custom binding

- **WHEN** Tab or Right Arrow has a bare custom shortcut binding
- **THEN** the suggestion does not consume that key

#### Scenario: Open popup

- **WHEN** a menu or listbox is open
- **THEN** Tab and Right Arrow navigate the popup rather than accepting the suggestion

#### Scenario: Paste

- **WHEN** the user pastes into the composer while a suggestion is visible
- **THEN** the paste proceeds and the suggestion is no longer shown

#### Scenario: Existing draft or attachment

- **WHEN** the draft is non-empty or an attachment exists
- **THEN** the suggestion is not painted and does not intercept acceptance keys

### Requirement: Turn, session, and settings invalidation

A new turn, session switch, or disabled setting SHALL clear or hide the pending/visible suggestion immediately. A suggestion MUST remain ephemeral and MUST NOT be persisted across page reloads or session replay.

#### Scenario: New turn starts

- **WHEN** a new turn begins
- **THEN** the current suggestion is cleared and no stale text remains

#### Scenario: Session switch

- **WHEN** the composer binds to another session
- **THEN** the previous suggestion is cleared and the new session is queried independently

#### Scenario: Switch off

- **WHEN** the user disables suggestions in Settings
- **THEN** visible ghost text disappears immediately and no new query paints it

#### Scenario: Page reload

- **WHEN** the page reloads or a session is replayed
- **THEN** no stored suggestion is shown until a new eligible live turn completes

### Requirement: Native composer appearance

The ghost row SHALL copy the native placeholder's typography, color, and inset, SHALL not reflow the composer, and SHALL repaint when the theme tokens change. It MUST expose no interactive or focusable element.

#### Scenario: Theme change

- **WHEN** the page theme changes while a suggestion is visible
- **THEN** the ghost row repaints with the new placeholder styling

#### Scenario: Accessibility

- **WHEN** assistive technology inspects the composer
- **THEN** the ghost row is hidden from the accessibility tree and the editor remains the only interactive element
