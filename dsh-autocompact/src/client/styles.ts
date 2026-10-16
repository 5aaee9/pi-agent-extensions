/**
 * Section styles.
 *
 * @module @indexyz/dsh-autocompact/client/styles
 */

/**
 * Section styles, injected as one `<style>` element inside the section.
 *
 * Only theme tokens are used, so light and dark themes follow the page.
 *
 * The type scale and the control sizes are the settings pages' own, copied from
 * the shipped packages: the 18/600 page title and 13px intro of
 * `dsh-client-ui-agent-preset` (the section right above this one in the nav, and
 * the heavier of the two title styles the host's sections use — Models, Account and
 * Shortcuts declare 16/500/24), 12/18 hints, and a
 * 14/22 row label from `dsh-client-ui-settings-models` (the same management-list
 * shape this page has) and `dsh-client-ui-settings-account`; the 32px field from
 * the primitives' `Input.module.css`; the 36px button and its 28px row variant
 * and the card tokens from the settings pages; the 36x20 switch from
 * `Switch.module.css`. Nothing here sizes text by hand — a plugin page reads as
 * part of the application only if its own copy sits on the same scale.
 */
export const CSS = `
.dsha-page{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary)}
.dsha-title{color:var(--dsw-alias-label-primary);margin:0;font-size:18px;font-weight:600}
.dsha-intro{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin:0;font-size:13px}
.dsha-hint{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin:0;font-size:12px;line-height:18px}
.dsha-row-label{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.dsha-card{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1));background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1));border-radius:var(--dsw-radius-xl,12px);padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.dsha-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dsha-row-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsha-switch{box-sizing:border-box;position:relative;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));cursor:pointer;transition:background .15s ease}
.dsha-switch::after{content:"";display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s ease}
.dsha-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dsha-switch[aria-checked="true"]::after{transform:translateX(16px)}
.dsha-switch:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)));outline-offset:2px}
.dsha-switch:disabled{opacity:.5;cursor:default}
.dsha-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.dsha-item{display:flex;align-items:center;gap:10px;padding:12px 0}
.dsha-item+.dsha-item{border-top:.5px solid var(--dsw-alias-border-l2)}
.dsha-list>.dsha-item:first-child{padding-top:0}
.dsha-list>.dsha-item:last-child{padding-bottom:0}
.dsha-route{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsha-input,.dsha-select{box-sizing:border-box;height:32px;min-width:0;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px}
.dsha-input:focus,.dsha-select:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}
.dsha-input[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dsha-value{width:110px;text-align:right;font-variant-numeric:tabular-nums}
.dsha-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-md,8px);background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsha-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-2))}
.dsha-button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)))}
.dsha-button:disabled{opacity:.4;cursor:default}
.dsha-button-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}
.dsha-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.dsha-button-danger{border-color:transparent;background:0 0;color:var(--dsw-alias-state-error-primary)}
.dsha-button-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,transparent)}
.dsha-item .dsha-button{height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm,6px);font-size:12px;line-height:18px}
.dsha-add{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dsha-add .dsha-select{max-width:220px}
.dsha-add .dsha-input{width:120px}
.dsha-actions{display:flex;gap:8px;align-items:center}
.dsha-notice{margin:0;font-size:12px;line-height:18px}
.dsha-notice-error{color:var(--dsw-alias-state-error-primary)}
.dsha-notice-success{color:var(--dsw-alias-state-success-primary)}
.dsha-notice-warn{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
.dsha-muted{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
/* The composer's ambient pill, copied from the host's own StatsPills.module.css
   (same padding, gap, radius, colour, density-aware type and 14px artwork) so
   this entry reads as one of the readings beside it. */
.dsha-status{box-sizing:border-box;max-width:100%;display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border-radius:999px;background:0 0;border:none;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;white-space:nowrap}
.dsha-status svg{flex:none;width:14px;height:14px}
.dsha-status:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}
.dsha-status:focus-visible{outline:var(--dsw-focus-ring-width,1px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)));outline-offset:1px}
/* The central panel this plugin registers: a page's own width, centred. */
.dsha-panel{box-sizing:border-box;width:100%;max-width:760px;margin:0 auto;padding:28px 24px 40px}
.dsha-crash{max-height:220px;overflow:auto;margin:0;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word}
`;
