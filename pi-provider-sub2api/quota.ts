import {
  billingByProvider,
  billingRefreshes,
  quotaByProvider,
  quotaRefreshes,
  USAGE_REQUEST_TIMEOUT_MS,
} from "./types.ts";
import type {
  BillingInfo,
  BillingRefreshResult,
  DailyUsage,
  QuotaAmount,
  QuotaInfo,
  QuotaRefreshResult,
  RateLimit,
  RelayConfig,
} from "./types.ts";
import {
  asRecord,
  discardResponse,
  fetchText,
  firstFiniteNumber,
  firstNumber,
  firstStrictNonNegativeNumber,
  firstString,
  isRetryableError,
  toPositiveInteger,
} from "./util.ts";

function hasQuotaFields(value: Record<string, unknown>) {
  return [
    "mode",
    "quota",
    "subscription",
    "planName",
    "plan_name",
    "rate_limits",
    "rateLimits",
    "daily_usage",
    "dailyUsage",
    "usage",
  ].some((key) => key in value);
}

function selectQuotaPayload(value: unknown) {
  const root = asRecord(value);
  if (!root) return undefined;
  if (hasQuotaFields(root)) return root;
  const data = asRecord(root.data);
  return data && hasQuotaFields(data) ? data : undefined;
}

function parseRateLimits(payload: Record<string, unknown>) {
  const usage = asRecord(payload.usage);
  const raw = payload.rate_limits ?? payload.rateLimits ?? usage?.rate_limits ?? usage?.rateLimits;
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, 100).flatMap((value): RateLimit[] => {
    const entry = asRecord(value);
    if (!entry) return [];
    const limit = firstNumber(entry.limit, entry.total) ?? 0;
    const reportedRemaining = firstNumber(entry.remaining, entry.left);
    const reportedUsed = firstNumber(entry.used, entry.consumed);
    const used = reportedUsed ?? Math.max(0, limit - (reportedRemaining ?? limit));
    const remaining = reportedRemaining ?? Math.max(0, limit - used);
    return [
      {
        limit,
        remaining,
        used,
        window: firstString(entry.window, entry.period, entry.name) ?? "default",
        resetAt: firstString(entry.reset_at, entry.resetAt, entry.resets_at) ?? "",
      },
    ];
  });
}

function parseDailyUsage(payload: Record<string, unknown>) {
  const usage = asRecord(payload.usage);
  const raw = payload.daily_usage ?? payload.dailyUsage ?? usage?.daily_usage ?? usage?.dailyUsage;
  if (!Array.isArray(raw)) return [];

  return raw.slice(0, 400).flatMap((value): DailyUsage[] => {
    const entry = asRecord(value);
    if (!entry) return [];
    return [parseUsageEntry(entry)];
  });
}

function parseUsageEntry(entry: Record<string, unknown>, fallbackDate = "") {
  const inputTokens = firstNumber(entry.input_tokens, entry.inputTokens) ?? 0;
  const outputTokens = firstNumber(entry.output_tokens, entry.outputTokens) ?? 0;
  const cacheReadTokens = firstNumber(entry.cache_read_tokens, entry.cacheReadTokens) ?? 0;
  const cacheWriteTokens =
    firstNumber(
      entry.cache_write_tokens,
      entry.cacheWriteTokens,
      entry.cache_creation_tokens,
      entry.cacheCreationTokens,
    ) ?? 0;
  return {
    date: firstString(entry.date, entry.day) ?? fallbackDate,
    requests: firstNumber(entry.requests, entry.request_count, entry.requestCount) ?? 0,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens:
      firstNumber(entry.total_tokens, entry.totalTokens) ??
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost: firstNumber(entry.cost) ?? 0,
    actualCost: firstNumber(entry.actual_cost, entry.actualCost, entry.cost) ?? 0,
  } satisfies DailyUsage;
}

function parseSubscriptionLimits(payload: Record<string, unknown>) {
  const subscription = asRecord(payload.subscription);
  if (!subscription) return [];

  return [
    {
      window: "daily",
      limit: firstNumber(subscription.daily_limit_usd, subscription.dailyLimitUsd) ?? 0,
      used: firstNumber(subscription.daily_usage_usd, subscription.dailyUsageUsd) ?? 0,
    },
    {
      window: "weekly",
      limit: firstNumber(subscription.weekly_limit_usd, subscription.weeklyLimitUsd) ?? 0,
      used: firstNumber(subscription.weekly_usage_usd, subscription.weeklyUsageUsd) ?? 0,
    },
    {
      window: "monthly",
      limit: firstNumber(subscription.monthly_limit_usd, subscription.monthlyLimitUsd) ?? 0,
      used: firstNumber(subscription.monthly_usage_usd, subscription.monthlyUsageUsd) ?? 0,
    },
  ]
    .filter((entry) => entry.limit > 0)
    .map((entry): RateLimit => ({
      ...entry,
      remaining: Math.max(0, entry.limit - entry.used),
      resetAt: "",
    }));
}

function parseQuotaAmount(payload: Record<string, unknown>) {
  const quota = asRecord(payload.quota);
  if (!quota) return undefined;
  const limit = firstNumber(quota.limit);
  if (limit === undefined || limit <= 0) return undefined;
  const used = firstNumber(quota.used) ?? 0;
  return {
    limit,
    used,
    remaining: firstNumber(quota.remaining) ?? Math.max(0, limit - used),
    unit: firstString(quota.unit, payload.unit) ?? "USD",
  } satisfies QuotaAmount;
}

export function getLatestDailyUsage(dailyUsage: DailyUsage[]) {
  return dailyUsage.reduce<DailyUsage | undefined>((latest, current) => {
    if (!latest || current.date > latest.date) return current;
    return latest;
  }, undefined);
}

export function parseQuotaInfo(value: unknown, usageUrl: string): QuotaInfo | undefined {
  const payload = selectQuotaPayload(value);
  if (!payload) return undefined;

  const rateLimits = parseRateLimits(payload);
  const subscriptionLimits = parseSubscriptionLimits(payload);
  const dailyUsage = parseDailyUsage(payload);
  const latestDay = getLatestDailyUsage(dailyUsage);
  const usage = asRecord(payload.usage);
  const today = asRecord(usage?.today);
  const total = asRecord(usage?.total);
  const todayUsage = today ? parseUsageEntry(today, "today") : undefined;
  const todayCost =
    firstNumber(
      today?.actual_cost,
      today?.actualCost,
      today?.cost,
      payload.today_cost,
      payload.todayCost,
      todayUsage?.actualCost,
      latestDay?.actualCost,
      latestDay?.cost,
    ) ?? 0;
  const totalCost =
    firstNumber(
      total?.actual_cost,
      total?.actualCost,
      total?.cost,
      payload.total_cost,
      payload.totalCost,
    ) ?? dailyUsage.reduce((sum, day) => sum + day.actualCost, 0);

  return {
    usageUrl,
    rateLimits,
    subscriptionLimits,
    dailyUsage,
    todayUsage,
    quota: parseQuotaAmount(payload),
    todayCost,
    totalCost,
    planName: firstString(payload.planName, payload.plan_name),
    remaining: firstFiniteNumber(payload.remaining),
    unit: firstString(payload.unit),
    expiresAt: firstString(payload.expires_at, payload.expiresAt),
    status:
      firstString(payload.status) ??
      (payload.isValid === true || payload.is_valid === true ? "valid" : "unknown"),
    mode: firstString(payload.mode) ?? "unknown",
    lastUpdated: Date.now(),
  };
}

export function getUsageUrls(relay: RelayConfig) {
  return [...new Set([`${relay.anthropicBaseUrl}/usage`, `${relay.baseUrl}/usage`])];
}

export function getBillingUrl(relay: RelayConfig) {
  return `${relay.baseUrl}/sub2api/billing`;
}

function parseBillingInfo(value: unknown, billingUrl: string): BillingInfo | undefined {
  const payload = asRecord(value);
  if (!payload || firstString(payload.object) !== "sub2api.key_billing") return undefined;
  const schemaVersion = toPositiveInteger(payload.schema_version ?? payload.schemaVersion);
  const billingScope = firstString(payload.billing_scope, payload.billingScope);
  const groupRateMultiplier = firstStrictNonNegativeNumber(
    payload.group_rate_multiplier,
    payload.groupRateMultiplier,
  );
  const resolvedRateMultiplier = firstStrictNonNegativeNumber(
    payload.resolved_rate_multiplier,
    payload.resolvedRateMultiplier,
  );
  const effectiveRateMultiplier = firstStrictNonNegativeNumber(
    payload.effective_rate_multiplier,
    payload.effectiveRateMultiplier,
  );
  const peakRateEnabled = payload.peak_rate_enabled ?? payload.peakRateEnabled;
  if (
    schemaVersion !== 1 ||
    billingScope !== "token" ||
    groupRateMultiplier === undefined ||
    resolvedRateMultiplier === undefined ||
    effectiveRateMultiplier === undefined ||
    typeof peakRateEnabled !== "boolean"
  ) {
    return undefined;
  }

  return {
    billingUrl,
    schemaVersion,
    billingScope,
    groupRateMultiplier,
    userRateMultiplier: firstStrictNonNegativeNumber(
      payload.user_rate_multiplier,
      payload.userRateMultiplier,
    ),
    resolvedRateMultiplier,
    peakRateEnabled,
    peakStart: firstString(payload.peak_start, payload.peakStart),
    peakEnd: firstString(payload.peak_end, payload.peakEnd),
    peakRateMultiplier: firstStrictNonNegativeNumber(
      payload.peak_rate_multiplier,
      payload.peakRateMultiplier,
    ),
    appliedPeakMultiplier: firstStrictNonNegativeNumber(
      payload.applied_peak_multiplier,
      payload.appliedPeakMultiplier,
    ),
    effectiveRateMultiplier,
    timezone: firstString(payload.timezone),
    observedAt: firstString(payload.observed_at, payload.observedAt),
    lastUpdated: Date.now(),
  };
}

async function fetchBilling(
  relay: RelayConfig,
  signal: AbortSignal,
): Promise<BillingRefreshResult> {
  const billingUrl = getBillingUrl(relay);
  const result = await fetchText(billingUrl, {
    headers: { Authorization: `Bearer ${relay.apiKey}`, Accept: "application/json" },
    signal,
  });
  if (!result) return { kind: "temporary", detail: "network request failed" };
  const { response } = result;
  if (response.status === 404 || response.status === 405) {
    discardResponse(response);
    return { kind: "not-found" };
  }
  if (response.status === 401 || response.status === 403) {
    discardResponse(response);
    return { kind: "auth", status: response.status };
  }
  if (!response.ok) {
    discardResponse(response);
    return { kind: "temporary", detail: `HTTP ${response.status}` };
  }
  if ("bodyError" in result) {
    return isRetryableError(result.bodyError)
      ? { kind: "temporary", detail: "response body failed" }
      : { kind: "invalid" };
  }
  if (!("text" in result)) return { kind: "invalid" };

  try {
    if (/<!doctype|<html/i.test(result.text)) return { kind: "invalid" };
    const info = parseBillingInfo(JSON.parse(result.text) as unknown, billingUrl);
    return info ? { kind: "ok", info } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export function refreshBilling(relay: RelayConfig, signal: AbortSignal, canCommit: () => boolean) {
  const pending = billingRefreshes.get(relay.provider);
  if (pending) return pending;

  const promise = fetchBilling(relay, signal)
    .then((result) => {
      if (!canCommit()) {
        return result.kind === "ok"
          ? ({ kind: "temporary", detail: "request cancelled" } as const)
          : result;
      }
      if (result.kind === "ok") {
        billingByProvider.set(relay.provider, result.info);
      } else if (["not-found", "auth", "invalid"].includes(result.kind)) {
        billingByProvider.delete(relay.provider);
      }
      return result;
    })
    .catch((): BillingRefreshResult => ({
      kind: "temporary",
      detail: "network request failed",
    }))
    .finally(() => {
      if (billingRefreshes.get(relay.provider) === promise) {
        billingRefreshes.delete(relay.provider);
      }
    });
  billingRefreshes.set(relay.provider, promise);
  return promise;
}

async function fetchQuotaAt(
  relay: RelayConfig,
  usageUrl: string,
  signal: AbortSignal,
): Promise<QuotaRefreshResult> {
  const result = await fetchText(
    usageUrl,
    {
      headers: { Authorization: `Bearer ${relay.apiKey}`, Accept: "application/json" },
      signal,
    },
    USAGE_REQUEST_TIMEOUT_MS,
  );
  if (!result) return { kind: "temporary", detail: "network request failed" };
  const { response } = result;
  if (response.status === 404 || response.status === 405) {
    discardResponse(response);
    return { kind: "not-found" };
  }
  if (response.status === 401 || response.status === 403) {
    discardResponse(response);
    return { kind: "auth", status: response.status };
  }
  if (!response.ok) {
    discardResponse(response);
    return { kind: "temporary", detail: `HTTP ${response.status}` };
  }
  if ("bodyError" in result) {
    return isRetryableError(result.bodyError)
      ? { kind: "temporary", detail: "response body failed" }
      : { kind: "invalid" };
  }
  if (!("text" in result)) return { kind: "invalid" };

  try {
    if (/<!doctype|<html/i.test(result.text)) return { kind: "invalid" };
    const info = parseQuotaInfo(JSON.parse(result.text) as unknown, usageUrl);
    return info ? { kind: "ok", info } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

async function refreshQuotaFromNetwork(
  relay: RelayConfig,
  signal: AbortSignal,
  canCommit: () => boolean,
): Promise<QuotaRefreshResult> {
  const knownUrl = quotaByProvider.get(relay.provider)?.usageUrl;
  const candidates = [knownUrl, ...getUsageUrls(relay)].filter(
    (url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index,
  );
  const failures: QuotaRefreshResult[] = [];
  for (const usageUrl of candidates) {
    const result = await fetchQuotaAt(relay, usageUrl, signal);
    if (result.kind !== "ok") {
      failures.push(result);
      continue;
    }
    if (!canCommit()) return { kind: "temporary", detail: "request cancelled" };
    quotaByProvider.set(relay.provider, result.info);
    return result;
  }
  return (
    failures.find((result) => result.kind === "auth") ??
    failures.find((result) => result.kind === "temporary") ??
    failures.find((result) => result.kind === "invalid") ?? { kind: "not-found" }
  );
}

export function refreshQuota(relay: RelayConfig, signal: AbortSignal, canCommit: () => boolean) {
  const pending = quotaRefreshes.get(relay.provider);
  if (pending) return pending;

  const promise = refreshQuotaFromNetwork(relay, signal, canCommit)
    .catch((): QuotaRefreshResult => ({ kind: "temporary", detail: "network request failed" }))
    .finally(() => {
      if (quotaRefreshes.get(relay.provider) === promise) quotaRefreshes.delete(relay.provider);
    });
  quotaRefreshes.set(relay.provider, promise);
  return promise;
}
