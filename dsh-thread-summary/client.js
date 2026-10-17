window.__ModuleLoader__.load({
	id: "@indexyz/dsh-thread-summary",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/styles.ts
		const summaryStyles = `
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
		//#endregion
		//#region src/client/index.tsx
		const inject = [
			"slots",
			"locale",
			"remote.settings",
			"remote.session"
		];
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
				conflict: "Settings changed elsewhere. Review the reloaded values and save again."
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
				conflict: "设置已在其他位置修改，请检查重新加载的值后再次保存。"
			}
		};
		let pluginCtx;
		function settingsFace() {
			try {
				const face = pluginCtx?.get("remote.settings");
				return typeof face?.describe === "function" && typeof face.update === "function" ? face : void 0;
			} catch {
				return;
			}
		}
		function sessionFace() {
			try {
				const face = pluginCtx?.get("remote.session");
				return typeof face?.modelCatalog === "function" ? face : void 0;
			} catch {
				return;
			}
		}
		function splitRoute(route) {
			const slash = route.indexOf("/");
			return slash > 0 ? [route.slice(0, slash), route.slice(slash + 1)] : [route, ""];
		}
		function ModelPicker({ label, value, options, placeholder, disabled, onChange }) {
			const id = (0, react.useId)();
			const [open, setOpen] = (0, react.useState)(false);
			const selected = options.find((option) => option.id === value);
			const unavailable = disabled || options.length === 0;
			(0, react.useEffect)(() => {
				if (unavailable) setOpen(false);
			}, [unavailable]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-summary-field",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					id: `${id}-label`,
					className: "dsh-summary-field-label",
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
					open: open && !unavailable,
					onClose: () => setOpen(false),
					selectedId: value,
					onSelect: (next) => {
						onChange(next);
						setOpen(false);
					},
					items: options.map((option) => ({
						id: option.id,
						label: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-summary-value",
							title: option.name || option.id,
							children: option.name || option.id
						})
					})),
					portal: true,
					autoFocus: true,
					className: "dsh-summary-picker",
					listClassName: "dsh-summary-menu",
					anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						className: "dsh-summary-trigger",
						"aria-labelledby": `${id}-label ${id}-value`,
						"aria-haspopup": "menu",
						"aria-expanded": open && !unavailable,
						disabled: unavailable,
						onClick: () => setOpen((current) => !current),
						onKeyDown: (event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setOpen(true);
							}
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							id: `${id}-value`,
							className: `dsh-summary-value${selected ? "" : " dsh-summary-placeholder"}`,
							title: selected?.name || value,
							children: selected?.name || selected?.id || placeholder
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							className: "dsh-summary-chevron",
							width: "14",
							height: "14",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.5",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								d: "m6 9 6 6 6-6",
								strokeLinecap: "round",
								strokeLinejoin: "round"
							})
						})]
					})
				})]
			});
		}
		function SummaryItem() {
			const t = pluginCtx?.locale.bind(NS) ?? ((key) => key);
			const [view, setView] = (0, react.useState)();
			const [provider, setProvider] = (0, react.useState)("");
			const [model, setModel] = (0, react.useState)("");
			const [groups, setGroups] = (0, react.useState)([]);
			const [enabled, setEnabled] = (0, react.useState)(true);
			const [writable, setWritable] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(true);
			const [saving, setSaving] = (0, react.useState)(false);
			const savingRef = (0, react.useRef)(false);
			const [status, setStatus] = (0, react.useState)("");
			const restore = (found) => {
				setView(found);
				const [savedProvider, savedModel] = splitRoute(found.value?.model ?? "");
				setProvider(savedProvider);
				setModel(savedModel);
				setEnabled(found.value?.enabled ?? true);
			};
			(0, react.useEffect)(() => {
				let disposed = false;
				const load = async () => {
					try {
						const face = settingsFace();
						if (!face) throw new Error(t("failed"));
						const [settings, catalog] = await Promise.allSettled([face.describe(), sessionFace()?.modelCatalog() ?? Promise.reject(new Error(t("unavailable")))]);
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
							const chosen = value.groups.find((group) => group.id === value.default?.provider && group.models.length > 0) ?? value.groups.find((group) => group.models.length > 0);
							setProvider(chosen?.id ?? "");
							setModel(chosen?.models.find((item) => chosen.id === value.default?.provider && item.id === value.default.model)?.id ?? chosen?.models[0]?.id ?? "");
						}
					} catch (error) {
						if (!disposed) setStatus(error instanceof Error ? error.message : t("failed"));
					} finally {
						if (!disposed) setLoading(false);
					}
				};
				load();
				return () => {
					disposed = true;
				};
			}, []);
			const providers = groups.map(({ id, name }) => ({
				id,
				name
			}));
			if (provider && !providers.some((item) => item.id === provider)) providers.unshift({
				id: provider,
				name: provider
			});
			const models = [...groups.find((group) => group.id === provider)?.models ?? []];
			if (model && !models.some((item) => item.id === model)) models.unshift({
				id: model,
				name: model
			});
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
					const result = await face.update(NS, {
						...provider && model ? { model: `${provider}/${model}` } : {},
						enabled
					}, view?.revision);
					if (result.ok) {
						restore(result.value);
						setStatus(t("saved"));
					} else if (result.error?.code === "settings/conflict") {
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
			const statusTone = status === t("saved") ? "success" : status === t("readonly") ? "info" : "error";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-thread-summary",
				"aria-label": t("label"),
				"aria-busy": loading || saving,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: summaryStyles }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-summary-header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-summary-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: "dsh-summary-title",
								children: t("label")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-summary-description",
								children: t("description")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
							checked: enabled,
							disabled: locked,
							label: t("enabled"),
							onChange: (next) => {
								setEnabled(next);
								setStatus("");
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-summary-fields",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelPicker, {
							label: t("provider"),
							value: provider,
							options: providers,
							placeholder: t(loading ? "loading" : providers.length ? "chooseProvider" : "noProviders"),
							disabled: locked,
							onChange: (next) => {
								setProvider(next);
								setModel(groups.find((group) => group.id === next)?.models[0]?.id ?? "");
								setStatus("");
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelPicker, {
							label: t("model"),
							value: model,
							options: models,
							placeholder: t(loading ? "loading" : models.length ? "chooseModel" : "unavailable"),
							disabled: locked || !provider,
							onChange: (next) => {
								setModel(next);
								setStatus("");
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-summary-footer",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-summary-feedback",
							children: status ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								"aria-live": "polite",
								className: "dsh-summary-status",
								"data-tone": statusTone,
								children: status
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-summary-hint",
								children: t(enabled ? "hint" : "disabledHint")
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							size: "sm",
							className: "dsh-summary-save",
							onClick: () => void save(),
							disabled: locked || enabled && (!provider || !model),
							children: saving ? t("saving") : t("save")
						})]
					})
				]
			});
		}
		var SummaryBoundary = class extends react.Component {
			state = { failed: false };
			static getDerivedStateFromError() {
				return { failed: true };
			}
			render() {
				return this.state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					role: "alert",
					children: this.props.fallback
				}) : this.props.children;
			}
		};
		function apply(ctx) {
			pluginCtx = ctx;
			ctx.effect(() => ctx.locale.register(NS, DICT), "dsh-thread-summary: locale");
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: NS,
				order: 40,
				label: () => t("label")
			}, () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryBoundary, {
				fallback: t("failed"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryItem, {})
			}))), "dsh-thread-summary: general setting");
		}
		//#endregion
		exports.ModelPicker = ModelPicker;
		exports.SummaryBoundary = SummaryBoundary;
		exports.SummaryItem = SummaryItem;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
