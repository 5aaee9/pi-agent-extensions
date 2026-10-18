import { useEffect, useRef, useState } from "react";

import type { ConnectionFace, OverlayProps, SettingsFace, ShortcutsFace } from "./contracts.ts";
import { clientService } from "./context.ts";
import type { Translate } from "./dictionary.ts";
import { setEnabled, useEnabled } from "./enabled.ts";
import { createGhost, findComposer, placeGhost } from "./ghost.ts";
import type { GhostElements } from "./ghost.ts";
import { acceptKeyOf, hasCustomBinding, menuOpen } from "./input.ts";
import { requestSuggestion } from "./query.ts";
import { readEnabled } from "./settings-client.ts";

/** Delay before re-asking while the Host reports an in-flight generation. */
const RETRY_MS = 1_500;
/** Delay before retrying after a transport failure. */
const ERROR_RETRY_MS = 3_000;
/** Consecutive transport failures before the overlay stops asking for this session. */
const MAX_TRANSPORT_RETRIES = 5;

/**
 * Dim next-message suggestion for the resident composer.
 *
 * The slot body is one hidden anchor; the visible row is inert DOM placed over
 * the native placeholder so it shares the editor's exact geometry without
 * touching Lexical. Acceptance inserts into the draft through the public
 * `InputActions` face and never submits. Escape, typing, a popup, attachments,
 * a claimed command, paste and custom Tab/Right-Arrow bindings all win over the
 * suggestion.
 * @param props - session identity, composer hooks/actions, and translator.
 * @returns the hidden anchor.
 */
export function SuggestionOverlay({
  sessionId,
  useInput,
  useSession,
  inputActions,
  t,
}: OverlayProps & { readonly t: Translate }): JSX.Element {
  const draft = useInput((state) => state.draft);
  const phase = useInput((state) => state.phase);
  const attachments = useInput((state) => state.attachmentIds);
  const running = useSession((state) => state.running);
  const blank = useSession((state) => state.blank);
  const openState = useSession((state) => state.openState);
  const enabled = useEnabled();
  const [suggestion, setSuggestion] = useState("");
  const [dismissed, setDismissed] = useState("");
  const [themeTick, setThemeTick] = useState(0);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const composingRef = useRef(false);
  const [ghost] = useState<GhostElements | undefined>(() =>
    typeof document === "undefined" ? undefined : createGhost(document),
  );
  const connection = clientService<ConnectionFace>("connection");

  const empty = draft === "" && phase === "plain" && attachments.length === 0;
  const eligible = enabled && empty && !running && !blank && openState === "open";
  const visible = eligible && suggestion !== "" && suggestion !== dismissed;

  // The Host stays authoritative; this read only mirrors its switch into the
  // shared browser store so the Settings row can hide the overlay immediately.
  useEffect(() => {
    let cancelled = false;
    const face = clientService<SettingsFace>("remote.settings");
    if (face === undefined) return;
    void readEnabled(face)
      .then((state) => {
        if (!cancelled && state.found) setEnabled(state.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSuggestion("");
    setDismissed("");
  }, [sessionId]);

  useEffect(() => {
    if (running) {
      setSuggestion("");
      setDismissed("");
    }
  }, [running]);

  useEffect(() => {
    if (!enabled) {
      setSuggestion("");
      setDismissed("");
    }
  }, [enabled]);

  // Ask for the session whether or not the draft is empty: the first query
  // marks the session watched, and a completed turn must generate even when the
  // user already has text, attachments or a popup. Painting and acceptance stay
  // gated by `eligible`/`visible` below. A completed turn flips `running` back to
  // false and re-runs this effect; an in-flight Host generation answers
  // `pending`, so the loop retries until a terminal answer.
  useEffect(() => {
    if (connection === undefined || !enabled || sessionId === "" || blank) return;
    if (openState !== "open") return;
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const load = async (): Promise<void> => {
      try {
        const reply = await requestSuggestion(connection, sessionId, controller.signal);
        if (disposed) return;
        failures = 0;
        if (reply.state === "ready") {
          setSuggestion(reply.text);
          setDismissed("");
          return;
        }
        if (reply.state === "pending") {
          timer = setTimeout(() => void load(), RETRY_MS);
          return;
        }
        if (reply.state === "disabled") {
          setEnabled(false);
          return;
        }
        setSuggestion("");
      } catch {
        if (disposed || controller.signal.aborted) return;
        failures += 1;
        if (failures >= MAX_TRANSPORT_RETRIES) return;
        timer = setTimeout(() => void load(), ERROR_RETRY_MS);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [sessionId, connection, enabled, running, blank, openState]);

  // Repaint over the native placeholder while a suggestion is visible. The
  // placeholder is hidden with `visibility`, so the composer never reflows.
  useEffect(() => {
    if (!visible || ghost === undefined) return;
    const parts = findComposer(anchorRef.current);
    if (parts === undefined) return;
    return placeGhost(ghost, suggestion, parts.placeholder);
  }, [visible, suggestion, ghost, themeTick]);

  // Theme providers can swap tokens without remounting; repaint so the copied
  // placeholder color and geometry follow the new theme.
  useEffect(() => {
    if (!visible || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setThemeTick((value) => value + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, [visible]);

  // Acceptance and dismissal live on the document capture phase so the composer
  // keymap cannot submit or move the caret first. Every higher-priority owner
  // (open popup, IME, custom binding, a prevented default) passes through.
  useEffect(() => {
    if (!visible) return;
    const accept = (): void => {
      if (!inputActions.insertText(suggestion, inputActions.captureInsertion())) return;
      setDismissed(suggestion);
      setSuggestion("");
    };
    const onCompositionStart = (): void => {
      composingRef.current = true;
    };
    const onCompositionEnd = (): void => {
      composingRef.current = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (composingRef.current) return;
      const parts = findComposer(anchorRef.current);
      if (parts === undefined) return;
      const target = event.target;
      if (
        !(target instanceof Node) ||
        (target !== parts.editor && !parts.editor.contains(target))
      ) {
        return;
      }
      if (menuOpen(document)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setDismissed(suggestion);
        setSuggestion("");
        return;
      }
      const code = acceptKeyOf(event);
      if (code === undefined || hasCustomBinding(clientService<ShortcutsFace>("shortcuts"), code)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      accept();
    };
    const onPaste = (event: ClipboardEvent): void => {
      const parts = findComposer(anchorRef.current);
      if (parts === undefined) return;
      const target = event.target;
      if (
        !(target instanceof Node) ||
        (target !== parts.editor && !parts.editor.contains(target))
      ) {
        return;
      }
      setDismissed(suggestion);
      setSuggestion("");
    };
    const parts = findComposer(anchorRef.current);
    parts?.editor.addEventListener("compositionstart", onCompositionStart);
    parts?.editor.addEventListener("compositionend", onCompositionEnd);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      parts?.editor.removeEventListener("compositionstart", onCompositionStart);
      parts?.editor.removeEventListener("compositionend", onCompositionEnd);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, [visible, suggestion, inputActions]);

  return (
    <span ref={anchorRef} hidden aria-hidden="true" data-prompt-suggestions-anchor={t("label")} />
  );
}
