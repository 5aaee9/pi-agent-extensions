// Layout only: interactive controls and their theme styles come from the DSH shell.
export const settingsStyles = `
.dsh-prompt-suggestions {
  container: dsh-prompt-suggestions / inline-size;
  min-width: 0;
  padding: 16px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
}
.dsh-prompt-suggestions-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.dsh-prompt-suggestions-heading { min-width: 0; }
.dsh-prompt-suggestions-title { margin: 0; font: inherit; font-weight: 400; }
.dsh-prompt-suggestions-description { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-prompt-suggestions-feedback { margin-top: 10px; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsh-prompt-suggestions-hint { margin: 0; color: var(--dsw-alias-label-tertiary); }
.dsh-prompt-suggestions-status { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsh-prompt-suggestions-status[data-tone="success"] { color: var(--dsw-alias-state-success-primary); }
.dsh-prompt-suggestions-status[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
@container dsh-prompt-suggestions (max-width: 360px) {
  .dsh-prompt-suggestions-header { gap: 16px; }
}
`;
