import { Component, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, Menu, Switch } from "@deepseek-ai/dsh-client-ui-primitives";
import { summaryStyles } from "./styles.ts";

export const inject = ["slots", "locale", "remote.settings", "remote.session"] as const;
const NS = "thread-summary";
const DICT = {
  en: {
    label: "Summary model",
    enabled: "Generate session titles",
    description: "Name new sessions from your first message.",
    hint: "Uses a separate model from your conversation.",
    disabledHint: "Automatic titles are off. Sessions use a default title.",
    chooseProvider: "Select provider",
    chooseModel: "Select model",
    noProviders: "No providers available",
    provider: "Provider",
    model: "Model",
    loading: "Loading models…",
    unavailable: "No models available",
    save: "Save",
    saved: "Saved",
    invalid: "Choose a provider and model",
    saving: "Saving…",
    failed: "Unable to load or save summary settings",
    readonly: "This profile is read-only",
    conflict: "Settings changed elsewhere. Review the reloaded values and save again.",
  },
  zh: {
    label: "摘要模型",
    enabled: "自动生成会话标题",
    description: "根据首条消息，为新会话生成简短标题。",
    hint: "使用独立模型，不影响对话模型。",
    disabledHint: "自动标题已关闭，会话将使用默认标题。",
    chooseProvider: "选择服务商",
    chooseModel: "选择模型",
    noProviders: "没有可用服务商",
    provider: "服务商",
    model: "模型",
    loading: "正在加载模型…",
    unavailable: "没有可用模型",
    save: "保存",
    saved: "已保存",
    invalid: "请选择服务商和模型",
    saving: "正在保存…",
    failed: "无法加载或保存摘要设置",
    readonly: "当前配置为只读",
    conflict: "设置已在其他位置修改，请检查重新加载的值后再次保存。",
  },
};
type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error?: { code?: string; message?: string } };
type NamespaceView = {
  ns: string;
  revision?: number;
  value?: { enabled?: boolean; model?: string };
};
type SettingsDescribe = { writable?: boolean; namespaces?: readonly NamespaceView[] };
type SettingsFace = {
  describe(): Promise<RemoteResult<SettingsDescribe>>;
  update(
    ns: string,
    patch: Record<string, unknown>,
    revision?: number,
  ): Promise<RemoteResult<NamespaceView>>;
};
type Provider = { id: string; name: string };
type Model = { id: string; name: string };
type ModelGroup = { id: string; name: string; models: Model[] };
type ModelCatalog = {
  default?: { provider: string; model: string };
  groups: ModelGroup[];
};
type SessionFace = {
  modelCatalog(): Promise<RemoteResult<ModelCatalog>>;
};
type ClientContext = {
  get<T = unknown>(service: string): T | undefined;
  effect(effect: () => unknown, label?: string): unknown;
  locale: {
    register(ns: string, dict: Record<string, Record<string, string>>): () => void;
    bind(ns: string): (key: string) => string;
  };
  slots: {
    inject(name: string, callback: () => unknown): unknown;
    register(
      options: Record<string, unknown>,
      render: (props: Record<string, unknown>) => unknown,
    ): unknown;
  };
};
let pluginCtx: ClientContext | undefined;

function settingsFace(): SettingsFace | undefined {
  try {
    const face = pluginCtx?.get<SettingsFace>("remote.settings");
    return typeof face?.describe === "function" && typeof face.update === "function"
      ? face
      : undefined;
  } catch {
    return undefined;
  }
}

function sessionFace(): SessionFace | undefined {
  try {
    const face = pluginCtx?.get<SessionFace>("remote.session");
    return typeof face?.modelCatalog === "function" ? face : undefined;
  } catch {
    return undefined;
  }
}

function splitRoute(route: string): [string, string] {
  const slash = route.indexOf("/");
  return slash > 0 ? [route.slice(0, slash), route.slice(slash + 1)] : [route, ""];
}

export function ModelPicker({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly Model[];
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value);
  const unavailable = disabled || options.length === 0;
  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);
  return (
    <div className="dsh-summary-field">
      <span id={`${id}-label`} className="dsh-summary-field-label">
        {label}
      </span>
      <Menu
        open={open && !unavailable}
        onClose={() => setOpen(false)}
        selectedId={value}
        onSelect={(next) => {
          onChange(next);
          setOpen(false);
        }}
        items={options.map((option) => ({
          id: option.id,
          label: (
            <span className="dsh-summary-value" title={option.name || option.id}>
              {option.name || option.id}
            </span>
          ),
        }))}
        portal
        autoFocus
        className="dsh-summary-picker"
        listClassName="dsh-summary-menu"
        anchor={
          <Button
            variant="outline"
            className="dsh-summary-trigger"
            aria-labelledby={`${id}-label ${id}-value`}
            aria-haspopup="menu"
            aria-expanded={open && !unavailable}
            disabled={unavailable}
            onClick={() => setOpen((current) => !current)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <span
              id={`${id}-value`}
              className={`dsh-summary-value${selected ? "" : " dsh-summary-placeholder"}`}
              title={selected?.name || value}
            >
              {selected?.name || selected?.id || placeholder}
            </span>
            <svg
              className="dsh-summary-chevron"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        }
      />
    </div>
  );
}

export function SummaryItem(): JSX.Element {
  const t = pluginCtx?.locale.bind(NS) ?? ((key: string) => key);
  const [view, setView] = useState<NamespaceView>();
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [writable, setWritable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [status, setStatus] = useState("");

  const restore = (found: NamespaceView) => {
    setView(found);
    const [savedProvider, savedModel] = splitRoute(found.value?.model ?? "");
    setProvider(savedProvider);
    setModel(savedModel);
    setEnabled(found.value?.enabled ?? true);
  };

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const face = settingsFace();
        if (!face) throw new Error(t("failed"));
        const [settings, catalog] = await Promise.allSettled([
          face.describe(),
          sessionFace()?.modelCatalog() ?? Promise.reject(new Error(t("unavailable"))),
        ]);
        if (disposed) return;
        if (settings.status === "rejected") throw settings.reason;
        if (!settings.value.ok) throw new Error(settings.value.error?.message ?? t("failed"));
        const description = settings.value.value;
        const found = description.namespaces?.find((item) => item.ns === NS);
        if (!found) throw new Error(t("failed"));
        restore(found);
        setWritable(description.writable !== false);
        if (description.writable === false) setStatus(t("readonly"));
        if (catalog.status === "rejected") throw catalog.reason;
        if (!catalog.value.ok) throw new Error(catalog.value.error?.message ?? t("unavailable"));
        const value = catalog.value.value;
        setGroups(value.groups.filter((group) => group.models.length > 0));
        if (!found.value?.model) {
          const chosen =
            value.groups.find(
              (group) => group.id === value.default?.provider && group.models.length > 0,
            ) ?? value.groups.find((group) => group.models.length > 0);
          setProvider(chosen?.id ?? "");
          setModel(
            chosen?.models.find(
              (item) => chosen.id === value.default?.provider && item.id === value.default.model,
            )?.id ??
              chosen?.models[0]?.id ??
              "",
          );
        }
      } catch (error) {
        if (!disposed) setStatus(error instanceof Error ? error.message : t("failed"));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const providers: Provider[] = groups.map(({ id, name }) => ({ id, name }));
  if (provider && !providers.some((item) => item.id === provider))
    providers.unshift({ id: provider, name: provider });
  const models = [...(groups.find((group) => group.id === provider)?.models ?? [])];
  if (model && !models.some((item) => item.id === model))
    models.unshift({ id: model, name: model });

  const save = async () => {
    if (!writable || loading || savingRef.current) return;
    if (enabled && (!provider || !model)) {
      setStatus(t("invalid"));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setStatus("");
    try {
      const face = settingsFace();
      if (!face) throw new Error(t("failed"));
      const result = await face.update(
        NS,
        {
          ...(provider && model ? { model: `${provider}/${model}` } : {}),
          enabled,
        },
        view?.revision,
      );
      if (result.ok) {
        restore(result.value);
        setStatus(t("saved"));
      } else if (result.error?.code === "settings/conflict") {
        // Until reload succeeds no further write may bypass the revision guard.
        setWritable(false);
        const latest = await face.describe();
        if (!latest.ok) throw new Error(latest.error?.message ?? t("failed"));
        const found = latest.value.namespaces?.find((item) => item.ns === NS);
        if (!found) throw new Error(t("failed"));
        restore(found);
        setWritable(latest.value.writable !== false);
        setStatus(t("conflict"));
      } else throw new Error(result.error?.message ?? t("failed"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("failed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const locked = !writable || loading || saving;
  const statusTone =
    status === t("saved") ? "success" : status === t("readonly") ? "info" : "error";

  return (
    <section className="dsh-thread-summary" aria-label={t("label")} aria-busy={loading || saving}>
      <style>{summaryStyles}</style>
      <div className="dsh-summary-header">
        <div className="dsh-summary-heading">
          <h3 className="dsh-summary-title">{t("label")}</h3>
          <p className="dsh-summary-description">{t("description")}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={locked}
          label={t("enabled")}
          onChange={(next) => {
            setEnabled(next);
            setStatus("");
          }}
        />
      </div>
      <div className="dsh-summary-fields">
        <ModelPicker
          label={t("provider")}
          value={provider}
          options={providers}
          placeholder={t(loading ? "loading" : providers.length ? "chooseProvider" : "noProviders")}
          disabled={locked}
          onChange={(next) => {
            setProvider(next);
            setModel(groups.find((group) => group.id === next)?.models[0]?.id ?? "");
            setStatus("");
          }}
        />
        <ModelPicker
          label={t("model")}
          value={model}
          options={models}
          placeholder={t(loading ? "loading" : models.length ? "chooseModel" : "unavailable")}
          disabled={locked || !provider}
          onChange={(next) => {
            setModel(next);
            setStatus("");
          }}
        />
      </div>
      <div className="dsh-summary-footer">
        <div className="dsh-summary-feedback">
          {status ? (
            <p
              role="status"
              aria-live="polite"
              className="dsh-summary-status"
              data-tone={statusTone}
            >
              {status}
            </p>
          ) : (
            <p className="dsh-summary-hint">{t(enabled ? "hint" : "disabledHint")}</p>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          className="dsh-summary-save"
          onClick={() => void save()}
          disabled={locked || (enabled && (!provider || !model))}
        >
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </section>
  );
}

export class SummaryBoundary extends Component<
  { children: ReactNode; fallback: string },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? <div role="alert">{this.props.fallback}</div> : this.props.children;
  }
}

export function apply(ctx: ClientContext): void {
  pluginCtx = ctx;
  ctx.effect(() => ctx.locale.register(NS, DICT), "dsh-thread-summary: locale");
  const t = ctx.locale.bind(NS);
  ctx.effect(
    () =>
      ctx.slots.inject("settings.general.item", () =>
        ctx.slots.register(
          { name: "settings.general.item", id: NS, order: 40, label: () => t("label") },
          () => (
            <SummaryBoundary fallback={t("failed")}>
              <SummaryItem />
            </SummaryBoundary>
          ),
        ),
      ),
    "dsh-thread-summary: general setting",
  );
}
