/**
 * The Settings → Autocompact page.
 *
 * The page owns the edit state (the view read from the Host, the staged draft,
 * the add-model selection) and talks to the Host through the two Remote
 * namespaces in `services.ts`; the two editable views it renders live beside it.
 *
 * @module @indexyz/dsh-autocompact/client/page
 */

import * as React from "react";
import { AddModel } from "./add-model.tsx";
import { publishView } from "./config-store.ts";
import type { CatalogGroup, NamespaceView, SettingsOp, Translate } from "./contracts.ts";
import { NS } from "./contracts.ts";
import { messageOf, parseLimit } from "./limits.ts";
import { pickNamespace, settingsFace, sessionFace } from "./services.ts";
import {
  addKeyOf,
  hasChanges,
  hasRow,
  manualRouteOf,
  type Notice,
  type Pick,
  type Status,
  toEntries,
  type ViewState,
  visibleRows,
} from "./state.ts";
import { CSS } from "./styles.ts";
import { ThresholdList } from "./threshold-list.tsx";

/** The Settings → Autocompact page. */
export function AutocompactPage(props: { readonly t: Translate }): React.ReactElement {
  const t = props.t;
  const [status, setStatus] = React.useState<Status>({ kind: "loading" });
  const [state, setState] = React.useState<ViewState | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [added, setAdded] = React.useState<string[]>([]);
  const [removed, setRemoved] = React.useState<string[]>([]);
  const [pick, setPick] = React.useState<Pick>({
    provider: "",
    model: "",
    limit: "",
    manualRoute: "",
  });
  const [catalog, setCatalog] = React.useState<{ groups?: readonly CatalogGroup[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);

  const applyView = React.useCallback((view: NamespaceView | undefined, writable?: unknown) => {
    const value = view?.value ?? {};
    // Every view this page reads or writes is also the freshest one the composer
    // status line can have, so share it instead of making it re-read the row.
    publishView(view, writable);
    setState({
      writable: writable !== false,
      // The settings namespace is the Loader entry id the Host reported, which
      // may be prefixed in a composed profile; writes address it verbatim.
      ns: view?.ns ?? NS,
      revision: view?.revision,
      enabled: value.enabled !== false,
      limits: toEntries(value.modelLimits),
    });
    setDraft({});
    setAdded([]);
    setRemoved([]);
  }, []);

  const load = React.useCallback(async () => {
    const settings = settingsFace();
    if (settings === undefined) {
      setStatus({ kind: "unavailable" });
      return;
    }
    setStatus({ kind: "loading" });
    try {
      const response = await settings.describe();
      if (!response.ok) {
        setStatus({ kind: "error", message: response.error?.message ?? t("unavailable") });
        return;
      }
      const view = pickNamespace(response.value);
      if (view === undefined) {
        setStatus({ kind: "unavailable" });
        return;
      }
      applyView(view, response.value.writable);
      setStatus({ kind: "ready" });
    } catch (error) {
      setStatus({ kind: "error", message: messageOf(error) });
    }
  }, [applyView, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const session = sessionFace();
    if (session === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await session.modelCatalog();
        if (!cancelled && response.ok) setCatalog(response.value);
      } catch {
        // The manual route field below stays available.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups: readonly CatalogGroup[] = React.useMemo(
    () => (Array.isArray(catalog?.groups) ? (catalog.groups as readonly CatalogGroup[]) : []),
    [catalog],
  );
  const selectedGroup = React.useMemo(
    () => groups.find((group) => group.id === pick.provider),
    [groups, pick.provider],
  );

  const rows = React.useMemo(
    () => visibleRows(state, added, draft, removed),
    [state, added, draft, removed],
  );

  const dirty = hasChanges(state, added, removed, draft);

  const save = React.useCallback(async () => {
    const settings = settingsFace();
    if (settings === undefined || state === null) return;
    const ops: SettingsOp[] = [];
    for (const key of removed) ops.push({ op: "unset", path: ["modelLimits", key] });
    for (const [key, raw] of Object.entries(draft)) {
      const parsed = parseLimit(raw);
      if (parsed === undefined) {
        setNotice({ kind: "error", text: t("invalid") });
        return;
      }
      ops.push({ op: "set", path: ["modelLimits", key], value: parsed });
    }
    if (ops.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await settings.mutate(state.ns, ops, state.revision);
      if (response.ok) {
        applyView(response.value, state.writable);
        setNotice({ kind: "success", text: t("saved") });
        return;
      }
      if (response.error?.code === "settings/conflict") {
        setNotice({ kind: "warn", text: t("conflict") });
        await load();
        return;
      }
      setNotice({
        kind: "error",
        text: t("failed", { message: response.error?.message ?? "unknown" }),
      });
    } catch (error) {
      setNotice({ kind: "error", text: t("failed", { message: messageOf(error) }) });
    } finally {
      setBusy(false);
    }
  }, [state, removed, draft, applyView, load, t]);

  const setEnabled = React.useCallback(
    async (next: boolean) => {
      const settings = settingsFace();
      if (settings === undefined || state === null) return;
      setBusy(true);
      setNotice(null);
      try {
        const response = await settings.update(state.ns, { enabled: next }, state.revision);
        if (response.ok) {
          applyView(response.value, state.writable);
          return;
        }
        if (response.error?.code === "settings/conflict") {
          setNotice({ kind: "warn", text: t("conflict") });
          await load();
          return;
        }
        setNotice({
          kind: "error",
          text: t("toggleFailed", { message: response.error?.message ?? "unknown" }),
        });
      } catch (error) {
        setNotice({ kind: "error", text: t("toggleFailed", { message: messageOf(error) }) });
      } finally {
        setBusy(false);
      }
    },
    [state, applyView, load, t],
  );

  const manualRoute = React.useMemo(() => manualRouteOf(pick), [pick]);
  const key = addKeyOf(groups, pick, manualRoute);
  const duplicate = hasRow(rows, key);

  const addEntry = React.useCallback(() => {
    if (key === "" || duplicate) return;
    if (parseLimit(pick.limit) === undefined) {
      setNotice({ kind: "error", text: t("invalid") });
      return;
    }
    setNotice(null);
    setAdded((current) => [...current, key]);
    setDraft((current) => ({ ...current, [key]: pick.limit }));
    setPick({ provider: "", model: "", limit: "", manualRoute: "" });
  }, [key, duplicate, pick.limit, t]);

  /** Stage one edited threshold value; kept out of `draft` until saved. */
  const setDraftValue = React.useCallback((entryKey: string, value: string) => {
    setDraft((current) => ({ ...current, [entryKey]: value }));
  }, []);

  const removeEntry = React.useCallback((entryKey: string) => {
    setAdded((current) => current.filter((value) => value !== entryKey));
    setDraft((current) => {
      const next = { ...current };
      delete next[entryKey];
      return next;
    });
    setRemoved((current) => (current.includes(entryKey) ? current : [...current, entryKey]));
  }, []);

  const body: React.ReactNode[] = [];
  if (status.kind === "loading") {
    body.push(
      <p key="loading" className="dsha-hint">
        {t("loading")}
      </p>,
    );
  } else if (status.kind === "unavailable" || status.kind === "error") {
    body.push(
      <p key="unavailable" className="dsha-notice dsha-notice-warn" role="status">
        {status.kind === "error" ? status.message : t("unavailable")}
      </p>,
    );
  } else if (state !== null) {
    const readOnly = state.writable === false;
    if (readOnly) {
      body.push(
        <p key="readonly" className="dsha-notice dsha-notice-warn" role="status">
          {t("readOnly")}
        </p>,
      );
    }
    body.push(
      <div key="switch" className="dsha-card">
        <div className="dsha-row">
          <div className="dsha-row-text">
            <span className="dsha-row-label">{t("enabled")}</span>
            <span className="dsha-hint">{t("enabledHint")}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={state.enabled ? "true" : "false"}
            aria-label={t("enabled")}
            className="dsha-switch"
            disabled={busy || readOnly}
            onClick={() => void setEnabled(!state.enabled)}
          />
        </div>
      </div>,
    );

    body.push(
      <div key="models" className="dsha-card">
        <div className="dsha-row-text">
          <span className="dsha-row-label">{t("models")}</span>
          <span className="dsha-hint">{t("modelsHint")}</span>
        </div>
        <div className="dsha-list">
          <ThresholdList
            t={t}
            rows={rows}
            draft={draft}
            busy={busy}
            readOnly={readOnly}
            onDraft={setDraftValue}
            onRemove={removeEntry}
          />
        </div>
        <AddModel
          t={t}
          groups={groups}
          selectedGroup={selectedGroup}
          pick={pick}
          busy={busy}
          readOnly={readOnly}
          duplicate={duplicate}
          canAdd={key !== "" && !duplicate}
          onPick={setPick}
          onAdd={addEntry}
        />
      </div>,
    );
    body.push(
      <div key="actions" className="dsha-actions">
        <button
          type="button"
          className="dsha-button dsha-button-primary"
          disabled={busy || readOnly || !dirty}
          onClick={() => void save()}
        >
          {busy ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          className="dsha-button"
          disabled={busy || !dirty}
          onClick={() => void load()}
        >
          {t("discard")}
        </button>
      </div>,
    );
  }

  if (notice !== null) {
    body.push(
      <p
        key="notice"
        className={`dsha-notice dsha-notice-${
          notice.kind === "warn" ? "warn" : notice.kind === "success" ? "success" : "error"
        }`}
        role="status"
      >
        {notice.text}
      </p>,
    );
  }

  return (
    <section className="dsha-page">
      <style>{CSS}</style>
      <h2 className="dsha-title">{t("title")}</h2>
      <p className="dsha-intro">{t("intro")}</p>
      {body}
    </section>
  );
}
