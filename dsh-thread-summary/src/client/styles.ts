// Layout only: interactive controls and their theme styles come from the DSH shell.
export const summaryStyles = `
.dsh-thread-summary {
  container: dsh-summary / inline-size;
  min-width: 0;
  padding: 16px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
}
.dsh-summary-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.dsh-summary-heading { min-width: 0; }
.dsh-summary-title { margin: 0; font: inherit; font-weight: 400; }
.dsh-summary-description { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-summary-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 12px; margin-top: 16px; }
.dsh-summary-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-summary-field-label { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-summary-picker { display: block; min-width: 0; width: 100%; }
.dsh-summary-picker button.dsh-summary-trigger { justify-content: space-between; gap: 8px; width: 100%; min-width: 0; padding: 0 10px; font-family: inherit; text-align: start; }
.dsh-summary-trigger:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-summary-value { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-summary-placeholder { color: var(--dsw-alias-label-tertiary); }
.dsh-summary-chevron { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
.dsh-summary-menu { min-width: min(220px, calc(100vw - 32px)); max-width: min(360px, calc(100vw - 32px)); }
.dsh-summary-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 12px; }
.dsh-summary-feedback { min-width: 0; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsh-summary-hint { margin: 0; color: var(--dsw-alias-label-tertiary); }
.dsh-summary-status { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsh-summary-status[data-tone="success"] { color: var(--dsw-alias-state-success-primary); }
.dsh-summary-status[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dsh-summary-save { flex: 0 0 auto; font-family: inherit; }
@container dsh-summary (max-width: 360px) {
  .dsh-summary-fields { grid-template-columns: minmax(0, 1fr); }
  .dsh-summary-header { gap: 16px; }
  .dsh-summary-footer { align-items: flex-start; gap: 12px; }
}
`;
