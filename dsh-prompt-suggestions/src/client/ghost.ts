/**
 * Composer ghost-text DOM helpers.
 *
 * The rc.2 composer exposes no decoration slot for a second placeholder, so the
 * overlay copies the native placeholder's geometry, hides that placeholder with
 * `visibility` (never `display`, which would reflow), and appends one inert
 * absolutely-positioned row beside it. These helpers keep the DOM contract in
 * one place so the React component only owns state.
 *
 * @module @indexyz/dsh-prompt-suggestions/client/ghost
 */

/** The parts of the resident composer this overlay needs. */
export interface ComposerParts {
  readonly card: HTMLElement;
  readonly editor: HTMLElement;
  readonly placeholder: HTMLElement;
}

/** The inert row appended beside the native placeholder. */
export interface GhostElements {
  readonly root: HTMLDivElement;
  readonly text: HTMLSpanElement;
  readonly hint: HTMLSpanElement;
}

/** Create the detached ghost row. */
export function createGhost(doc: Document): GhostElements {
  const root = doc.createElement("div");
  root.setAttribute("aria-hidden", "true");
  root.dataset["promptSuggestions"] = "";
  Object.assign(root.style, {
    display: "none",
    position: "absolute",
    pointerEvents: "none",
    userSelect: "none",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  });

  const text = doc.createElement("span");
  const hint = doc.createElement("span");
  hint.textContent = "Tab";
  Object.assign(hint.style, {
    marginLeft: "8px",
    padding: "0 5px",
    border: "1px solid currentColor",
    borderRadius: "4px",
    fontSize: "11px",
    lineHeight: "16px",
    display: "inline-block",
    verticalAlign: "1px",
    opacity: "0.65",
  });
  root.append(text, hint);
  return { root, text, hint };
}

/**
 * Locate the resident composer around the overlay's hidden anchor.
 * @param anchor - the overlay's hidden span.
 * @returns the card, editable surface and native placeholder, when present.
 */
export function findComposer(anchor: HTMLElement | null): ComposerParts | undefined {
  if (anchor === null) return undefined;
  let card = anchor.closest<HTMLElement>("[data-composer-card]");
  if (card === null) {
    let node = anchor.parentElement;
    for (let depth = 0; node !== null && depth < 12; depth += 1, node = node.parentElement) {
      if (node.matches("[data-composer-card]")) {
        card = node;
        break;
      }
    }
  }
  if (card === null) return undefined;
  const editor = card.querySelector<HTMLElement>('[contenteditable="true"]');
  const placeholder = card.querySelector<HTMLElement>("[data-composer-placeholder]");
  if (editor === null || placeholder === null) return undefined;
  return { card, editor, placeholder };
}

/**
 * Paint the suggestion over the native placeholder and return its cleanup.
 * @param ghost - the inert row created for this component.
 * @param suggestion - text to display.
 * @param placeholder - the composer's native placeholder.
 * @returns a disposer restoring the native placeholder, or undefined when the
 *   placeholder has no positioned parent.
 */
export function placeGhost(
  ghost: GhostElements,
  suggestion: string,
  placeholder: HTMLElement,
): (() => void) | undefined {
  const parent = placeholder.parentElement;
  if (parent === null) return undefined;
  const view = placeholder.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(placeholder);
  ghost.text.textContent = suggestion;
  ghost.root.style.display = "block";
  if (computed !== undefined) {
    Object.assign(ghost.root.style, {
      color: computed.color,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontStyle: computed.fontStyle,
      fontWeight: computed.fontWeight,
      letterSpacing: computed.letterSpacing,
      lineHeight: computed.lineHeight,
      top: computed.top,
      left: computed.left,
      right: computed.right,
    });
  }
  parent.append(ghost.root);
  const previousVisibility = placeholder.style.visibility;
  placeholder.style.visibility = "hidden";
  return () => {
    ghost.root.remove();
    ghost.root.style.display = "none";
    placeholder.style.visibility = previousVisibility;
  };
}
