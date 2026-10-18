/** Localized copy for the settings row and the composer overlay. */
export const DICT = {
  en: {
    label: "Next-message suggestions",
    description: "Show a dim suggestion in the empty composer after a successful reply.",
    hint: "Tab or → adds it to the draft; Esc dismisses it. One auxiliary model request per completed reply.",
    switch: "Enable next-message suggestions",
    disabledHint: "Suggestions are off. The composer stays exactly as it is.",
    saved: "Saved",
    saving: "Saving…",
    failed: "Unable to load or save suggestion settings",
    readonly: "This profile is read-only",
    conflict: "Settings changed elsewhere. Review the reloaded values and try again.",
    retry: "Suggestion model unavailable",
  },
  zh: {
    label: "下一句建议",
    description: "回复成功后，在空白输入框中以淡色显示下一句可能的消息。",
    hint: "按 Tab 或 → 填入草稿，按 Esc 关闭。每个完成回合会增加一次辅助模型请求。",
    switch: "启用下一句建议",
    disabledHint: "建议已关闭，输入框保持原样。",
    saved: "已保存",
    saving: "正在保存…",
    failed: "无法加载或保存建议设置",
    readonly: "当前配置为只读",
    conflict: "设置已在其他位置修改，请检查重新加载的值后重试。",
    retry: "建议模型不可用",
  },
} as const;

/** Interpolation is not used by this plugin; the translator stays simple. */
export type Translate = (key: string) => string;
