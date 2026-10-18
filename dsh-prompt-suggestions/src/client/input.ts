import type { ShortcutsFace } from "./contracts.ts";

/**
 * Whether a popup owns Tab/arrow input right now.
 *
 * Slash-command, mention and model menus are open overlays; they must keep
 * their keyboard navigation ahead of suggestion acceptance.
 * @param doc - the page document.
 * @returns true when an open menu/listbox is visible.
 */
export function menuOpen(doc: Document): boolean {
  const elements = doc.querySelectorAll<HTMLElement>(
    '[role="listbox"], [role="menu"], [data-trigger-menu]',
  );
  return [...elements].some(
    (element) => element.offsetParent !== null || element.getClientRects().length > 0,
  );
}

/**
 * Whether the user assigned a bare Tab or Right Arrow to another command.
 *
 * Editable and fixed shortcut rows are both consulted, because either may own
 * a physical combination. A binding with modifiers does not conflict with the
 * bare acceptance keys used here.
 * @param shortcuts - the optional client shortcut registry.
 * @param code - physical `KeyboardEvent.code` of the candidate key.
 * @returns true when another action reserves the bare key.
 */
export function hasCustomBinding(shortcuts: ShortcutsFace | undefined, code: string): boolean {
  const bare = (binding: {
    readonly code: string;
    readonly modifiers: readonly string[];
  }): boolean => binding.code === code && binding.modifiers.length === 0;
  for (const entry of shortcuts?.catalog?.getSnapshot() ?? []) {
    if (entry.binding !== null && bare(entry.binding)) return true;
  }
  for (const entry of shortcuts?.fixedCatalog?.getSnapshot() ?? []) {
    if (entry.bindings.some(bare)) return true;
  }
  return false;
}

/**
 * Normalize the two acceptance keys.
 * @param event - composer keydown.
 * @returns the physical code to accept, or undefined when this is not a bare
 *   acceptance gesture.
 */
export function acceptKeyOf(event: KeyboardEvent): "Tab" | "ArrowRight" | undefined {
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return undefined;
  if (event.key === "Tab") return "Tab";
  if (event.key === "ArrowRight") return "ArrowRight";
  return undefined;
}
