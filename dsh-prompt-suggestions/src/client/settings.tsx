import { useEffect, useRef, useState } from "react";
import { Switch } from "@deepseek-ai/dsh-client-ui-primitives";

import type { SettingsFace } from "./contracts.ts";
import { NS } from "./contracts.ts";
import { clientService } from "./context.ts";
import type { Translate } from "./dictionary.ts";
import { setEnabled } from "./enabled.ts";
import type { EnabledSettings } from "./settings-client.ts";
import { readEnabled } from "./settings-client.ts";
import { settingsStyles } from "./styles.ts";

/**
 * General settings row for the global enable switch.
 *
 * The switch saves immediately through the revision-guarded Host settings
 * service. A conflict reloads the accepted values before another write; a
 * read-only profile and a missing settings surface render inert with status
 * text instead of failing the whole settings page.
 * @param props - bound translator.
 * @returns the settings row.
 */
export function SettingsItem({ t }: { readonly t: Translate }): JSX.Element {
  const [enabled, setLocalEnabled] = useState(true);
  const [found, setFound] = useState(false);
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const revisionRef = useRef<number | undefined>(undefined);
  const savedRef = useRef(true);
  const savingRef = useRef(false);

  const applyState = (state: EnabledSettings): void => {
    revisionRef.current = state.revision;
    savedRef.current = state.enabled;
    setLocalEnabled(state.enabled);
    setFound(state.found);
    setWritable(state.writable);
    if (state.found) setEnabled(state.enabled);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const face = clientService<SettingsFace>("remote.settings");
        if (face === undefined) throw new Error(t("failed"));
        const state = await readEnabled(face);
        if (cancelled) return;
        applyState(state);
        if (!state.found) setStatus(t("failed"));
        else if (!state.writable) setStatus(t("readonly"));
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : t("failed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean): Promise<void> => {
    if (loading || savingRef.current || !writable || !found) return;
    const face = clientService<SettingsFace>("remote.settings");
    if (face === undefined) {
      setStatus(t("failed"));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setStatus("");
    setLocalEnabled(next);
    try {
      const result = await face.update(NS, { enabled: next }, revisionRef.current);
      if (result.ok) {
        const saved = result.value.value?.enabled ?? next;
        revisionRef.current = result.value.revision;
        savedRef.current = saved;
        setLocalEnabled(saved);
        setEnabled(saved);
        setStatus(t("saved"));
      } else if (result.error?.code === "settings/conflict") {
        // No further write may bypass the revision guard until a reload lands.
        setWritable(false);
        try {
          const latest = await readEnabled(face);
          applyState(latest);
          setStatus(t("conflict"));
        } catch {
          setStatus(t("failed"));
        }
      } else {
        throw new Error(result.error?.message ?? t("failed"));
      }
    } catch (error) {
      setLocalEnabled(savedRef.current);
      setStatus(error instanceof Error ? error.message : t("failed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const locked = loading || saving || !writable || !found;
  const feedback =
    status !== "" ? status : saving ? t("saving") : t(enabled ? "hint" : "disabledHint");
  const tone =
    status === t("saved") || saving ? "success" : status === t("readonly") ? "info" : "error";
  return (
    <section
      className="dsh-prompt-suggestions"
      aria-label={t("label")}
      aria-busy={loading || saving}
    >
      <style>{settingsStyles}</style>
      <div className="dsh-prompt-suggestions-header">
        <div className="dsh-prompt-suggestions-heading">
          <h3 className="dsh-prompt-suggestions-title">{t("label")}</h3>
          <p className="dsh-prompt-suggestions-description">{t("description")}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={locked}
          label={t("switch")}
          onChange={(next) => void toggle(next)}
        />
      </div>
      <div className="dsh-prompt-suggestions-feedback">
        {status === "" && !saving ? (
          <p className="dsh-prompt-suggestions-hint">{feedback}</p>
        ) : (
          <p
            role="status"
            aria-live="polite"
            className="dsh-prompt-suggestions-status"
            data-tone={tone}
          >
            {feedback}
          </p>
        )}
      </div>
    </section>
  );
}
