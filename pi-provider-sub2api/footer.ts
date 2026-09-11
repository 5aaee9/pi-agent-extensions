import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { getLatestDailyUsage } from "./quota.ts";
import { quotaByProvider, relaysByProvider, USAGE_FOOTER_KEY } from "./types.ts";
import type {
  BillingRefreshResult,
  QuotaInfo,
  QuotaRefreshResult,
  RateLimit,
  RelayConfig,
} from "./types.ts";
import { asRecord, firstNumber, sanitizeDisplayString } from "./util.ts";

export type FooterTheme = ExtensionContext["ui"]["theme"];
export type UsageFooterColor = "accent" | "dim";

export interface UsageFooterLine {
  text: string;
  color: UsageFooterColor;
}

interface FooterUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function normalizeWindowLabel(window: string) {
  const value = window.toLowerCase();
  if (value === "1d" || value === "day" || value === "daily") return "daily";
  if (value === "7d" || value === "week" || value === "weekly") return "weekly";
  if (value === "30d" || value === "month" || value === "monthly") return "monthly";
  return value || "default";
}

function shortWindowLabel(window: string) {
  const label = normalizeWindowLabel(window);
  if (label === "daily") return "d";
  if (label === "weekly") return "w";
  if (label === "monthly") return "m";
  return label;
}

function formatMoney(value: number, fractionDigits = 2) {
  return `$${value.toFixed(fractionDigits)}`;
}

function formatCompactTokens(value: number) {
  if (value < 1_000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

function pickQuotaWindows(rateLimits: RateLimit[]) {
  const byLabel = new Map(
    rateLimits.map((rateLimit) => [normalizeWindowLabel(rateLimit.window), rateLimit]),
  );
  const preferred = ["5h", "daily", "weekly"].flatMap((label) => {
    const rateLimit = byLabel.get(label);
    return rateLimit ? [rateLimit] : [];
  });
  return preferred.length ? preferred : rateLimits;
}

export function formatQuotaStatus(provider: string, info: QuotaInfo) {
  const heading = provider;
  const windows = (
    info.subscriptionLimits.length ? info.subscriptionLimits : pickQuotaWindows(info.rateLimits)
  ).filter((rateLimit) => rateLimit.limit > 0);
  if (windows.length) {
    const percentages = windows.map((rateLimit) => {
      const percent = Math.round((rateLimit.used / rateLimit.limit) * 100);
      return `${shortWindowLabel(rateLimit.window)} ${percent}%`;
    });
    return sanitizeDisplayString(`${heading} · ${percentages.join(" · ")}`, 200);
  }
  const latestUsage = info.todayUsage ?? getLatestDailyUsage(info.dailyUsage);
  const usageParts = [`d ${formatMoney(info.todayCost)}`];
  if (latestUsage?.totalTokens) {
    usageParts.push(`${formatCompactTokens(latestUsage.totalTokens)} tok`);
  }
  return sanitizeDisplayString(`${heading} · ${usageParts.join(" · ")}`, 200);
}

function formatFooterTokens(value: number) {
  if (value < 1_000) return value.toString();
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${Math.round(value / 1_000_000)}M`;
}

function addFooterUsage(totals: FooterUsageTotals, value: unknown) {
  const usage = asRecord(value);
  if (!usage) return;
  totals.input += firstNumber(usage.input) ?? 0;
  totals.output += firstNumber(usage.output) ?? 0;
  totals.cacheRead += firstNumber(usage.cacheRead) ?? 0;
  totals.cacheWrite += firstNumber(usage.cacheWrite) ?? 0;
  totals.cost += firstNumber(asRecord(usage.cost)?.total) ?? 0;
}

function collectFooterUsage(ctx: ExtensionContext) {
  const totals: FooterUsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
  for (const entry of ctx.sessionManager.getEntries()) {
    const record = asRecord(entry);
    if (record?.type === "message") {
      const message = asRecord(record.message);
      if (message?.role === "assistant" || message?.role === "toolResult") {
        addFooterUsage(totals, message.usage);
      }
    } else if (record?.type === "branch_summary" || record?.type === "compaction") {
      addFooterUsage(totals, record.usage);
    }
  }
  return totals;
}

function formatFooterCwd(cwd: string, home: string) {
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));
  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeFooterStatus(text: string) {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function renderFooterStats(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  width: number,
) {
  const totals = collectFooterUsage(ctx);
  const parts: string[] = [];
  if (totals.input) parts.push(`↑${formatFooterTokens(totals.input)}`);
  if (totals.output) parts.push(`↓${formatFooterTokens(totals.output)}`);
  if (totals.cacheRead) parts.push(`R${formatFooterTokens(totals.cacheRead)}`);
  if (totals.cacheWrite) parts.push(`W${formatFooterTokens(totals.cacheWrite)}`);
  if (totals.cost || ctx.model?.provider === "kimi-coding") {
    parts.push(
      `$${totals.cost.toFixed(3)}${ctx.model?.provider === "kimi-coding" ? " (sub)" : ""}`,
    );
  }

  const contextUsage = ctx.getContextUsage();
  const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const contextPercent = contextUsage?.percent;
  parts.push(
    contextPercent === null || contextPercent === undefined
      ? `?/${formatFooterTokens(contextWindow)}`
      : `${contextPercent.toFixed(1)}%/${formatFooterTokens(contextWindow)}`,
  );

  const left = parts.join(" ");
  const modelName = ctx.model?.id ?? "no-model";
  const modelWithThinking = ctx.model?.reasoning
    ? `${modelName} • ${ctx.thinkingLevel === "off" ? "thinking off" : ctx.thinkingLevel}`
    : modelName;
  let right = modelWithThinking;
  if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
    const withProvider = `(${ctx.model.provider}) ${modelWithThinking}`;
    if (visibleWidth(left) + 2 + visibleWidth(withProvider) <= width) right = withProvider;
  }

  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);
  if (leftWidth + 2 + rightWidth <= width) {
    return `${left}${" ".repeat(width - leftWidth - rightWidth)}${right}`;
  }
  const availableForRight = width - leftWidth - 2;
  if (availableForRight <= 0) return truncateToWidth(left, width, "...");
  const truncatedRight = truncateToWidth(right, availableForRight, "");
  return `${left}${" ".repeat(Math.max(1, width - leftWidth - visibleWidth(truncatedRight)))}${truncatedRight}`;
}

export function renderUsageFooter(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  theme: FooterTheme,
  usageLine: UsageFooterLine | undefined,
  ultraEnabled: boolean,
  fastEnabled: boolean,
  width: number,
) {
  let cwd = formatFooterCwd(ctx.cwd, homedir());
  const branch = footerData.getGitBranch();
  if (branch) cwd += ` (${branch})`;
  const sessionName = ctx.sessionManager.getSessionName();
  if (sessionName) cwd += ` • ${sessionName}`;

  const lines = [
    theme.fg("dim", truncateToWidth(cwd, width, "...")),
    theme.fg("dim", renderFooterStats(ctx, footerData, width)),
  ];
  const otherStatuses = [...footerData.getExtensionStatuses().entries()]
    .filter(([key]) => key !== USAGE_FOOTER_KEY)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => sanitizeFooterStatus(text));
  if (otherStatuses.length) {
    lines.push(truncateToWidth(otherStatuses.join(" "), width, theme.fg("dim", "...")));
  }
  if (usageLine) {
    let text = ultraEnabled ? `${usageLine.text} [ULTRA ENABLED]` : usageLine.text;
    if (fastEnabled) text += " [FAST]";
    lines.push(theme.fg(usageLine.color, truncateToWidth(text, width, "...")));
  }
  return lines;
}

export function refreshActiveQuota(
  ctx: ExtensionContext,
  provider: string,
  refresh: (relay: RelayConfig) => Promise<QuotaRefreshResult>,
  refreshBillingInfo: (relay: RelayConfig) => Promise<BillingRefreshResult>,
  isCurrent: () => boolean,
  setUsageLine: (
    ctx: ExtensionContext,
    provider: string,
    text: string,
    color?: UsageFooterColor,
  ) => void,
  clearUsageLine: (ctx: ExtensionContext) => void,
) {
  if (!ctx.hasUI || !isCurrent()) return;
  const relay = relaysByProvider.get(provider);
  if (!relay) {
    clearUsageLine(ctx);
    return;
  }

  const cached = quotaByProvider.get(provider);
  if (cached) setUsageLine(ctx, provider, formatQuotaStatus(provider, cached));
  else setUsageLine(ctx, provider, `${provider} · loading…`, "dim");
  void refreshBillingInfo(relay).then(() => {
    const latest = quotaByProvider.get(provider);
    if (isCurrent() && latest) {
      setUsageLine(ctx, provider, formatQuotaStatus(provider, latest));
    }
  });
  void refresh(relay).then((result) => {
    if (!isCurrent()) return;
    if (result.kind === "ok") {
      setUsageLine(ctx, provider, formatQuotaStatus(provider, result.info));
    } else if (!quotaByProvider.has(provider)) {
      setUsageLine(ctx, provider, `${provider} · usage unavailable`, "dim");
    }
  });
}
