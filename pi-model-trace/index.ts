import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { generateChallenges, type Challenge } from "./challenges.ts";
import {
  analyzeGlobalOutputs,
  parseNumbers,
  type AnalysisResult,
  type FingerprintBank,
} from "./fingerprint.ts";

const BANK_URL = new URL("./data/unified_bank.json", import.meta.url);
const PROBE_COUNT = 3;
const PROBE_TIMEOUT_MS = 10 * 60 * 1000;
const MESSAGE_TYPE = "model-trace";

let bankPromise: Promise<FingerprintBank> | undefined;

function loadBank(): Promise<FingerprintBank> {
  bankPromise ??= readFile(fileURLToPath(BANK_URL), "utf8").then(
    (raw) => JSON.parse(raw) as FingerprintBank,
  );
  return bankPromise;
}

type ProbeModel = NonNullable<ExtensionCommandContext["model"]>;

interface ProbeResult {
  challenge: Challenge;
  text: string;
  parsed: number;
  error?: string;
}

/**
 * Run one challenge in a fully independent pi session:
 * `pi -p --no-session --no-tools` spawns a fresh process with its own empty
 * context, no session persistence, and all tools disabled so the model must
 * answer the numeric task directly. `-a` reuses the trust decision of the
 * current project so project-local providers/extensions resolve in the child.
 */
function runProbe(
  challenge: Challenge,
  model: ProbeModel,
  thinkingLevel: ExtensionCommandContext["thinkingLevel"],
  cwd: string,
): Promise<ProbeResult> {
  const piBin = process.env.PI_MODEL_TRACE_BIN ?? "pi";
  const args = [
    "-p",
    "--no-session",
    "--no-tools",
    "-a",
    "--model",
    `${model.provider}/${model.id}`,
  ];
  if (thinkingLevel && thinkingLevel !== "off") args.push("--thinking", thinkingLevel);
  args.push(challenge.prompt);

  return new Promise((resolve) => {
    const child = spawn(piBin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), PROBE_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ challenge, text: "", parsed: 0, error: `spawn failed: ${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString("utf8").trim();
      const errors = Buffer.concat(stderr).toString("utf8").trim();
      let error: string | undefined;
      if (signal) error = `probe killed (${signal}${signal === "SIGTERM" ? ", timed out" : ""})`;
      else if (code !== 0) error = `probe exited ${code}: ${errors.slice(-300) || "no stderr"}`;
      else if (!text) error = "empty response";
      resolve({ challenge, text, parsed: parseNumbers(text).length, ...(error ? { error } : {}) });
    });
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatReport(
  analysis: AnalysisResult,
  probes: ProbeResult[],
  targetLabel: string,
): string {
  const lines: string[] = [];
  lines.push(`## ModelTrace 模型归因`);
  lines.push("");
  lines.push(`**待测模型**: \`${targetLabel}\``);
  lines.push(
    `**归因结果**: **${analysis.prediction_name}** (${formatPercent(analysis.probability)}) · 家族 **${analysis.family_prediction_name}** (${formatPercent(analysis.family_probability)})`,
  );
  lines.push("");
  lines.push(`### 家族概率`);
  for (const family of analysis.family_probabilities) {
    lines.push(`- ${family.display_name}: ${formatPercent(family.probability)}`);
  }
  lines.push("");
  lines.push(`### 候选模型 Top ${Math.min(6, analysis.results.length)}`);
  for (const item of analysis.results.slice(0, 6)) {
    lines.push(
      `- ${item.display_name}: ${formatPercent(item.probability)} (家族内 ${formatPercent(item.conditional_probability)}, 分布相似度 ${item.profile_similarity.toFixed(3)})`,
    );
  }
  lines.push("");
  lines.push(`### 探针`);
  for (const [index, probe] of probes.entries()) {
    const diagnostic = analysis.diagnostics[index];
    const status = probe.error
      ? `失败: ${probe.error}`
      : diagnostic?.accepted
        ? `${diagnostic.parsed_numbers} 个数字 (要求 ≥${diagnostic.minimum_numbers})`
        : `无效: 仅 ${probe.parsed} 个数字 (要求 ≥${diagnostic?.minimum_numbers ?? "-"})`;
    lines.push(`- ${probe.challenge.id}: ${status}`);
  }
  lines.push("");
  lines.push(
    `有效回答 ${analysis.used_outputs}/${probes.length} · 校准 β=${analysis.calibration.beta.toFixed(2)} (CV 准确率 ${formatPercent(analysis.calibration.cv_accuracy)})`,
  );
  lines.push("");
  lines.push(
    `> 结果为当前指纹库内的闭集概率，仅供参考。未收录模型会被归到最相似的现有候选；系统提示词差异也可能造成偏差。`,
  );
  return lines.join("\n");
}

function resolveTarget(
  args: string,
  ctx: ExtensionCommandContext,
): { model: ProbeModel; label: string } | { error: string } {
  const query = args.trim();
  if (!query) {
    if (!ctx.model) return { error: "No model selected. Usage: /model-trace [provider/model]" };
    return { model: ctx.model, label: `${ctx.model.provider}/${ctx.model.id}` };
  }

  const available = ctx.modelRegistry.getAvailable();
  let match: ProbeModel | undefined;
  if (query.includes("/")) {
    const [provider, ...rest] = query.split("/");
    match = ctx.modelRegistry.find(provider, rest.join("/"));
  }
  if (!match) {
    const candidates = available.filter((model) => model.id === query);
    if (candidates.length === 1) match = candidates[0];
    if (candidates.length > 1)
      return {
        error: `Ambiguous model "${query}": ${candidates.map((m) => `${m.provider}/${m.id}`).join(", ")}`,
      };
  }
  if (!match) return { error: `Unknown model "${query}". Usage: /model-trace [provider/model]` };
  return { model: match, label: `${match.provider}/${match.id}` };
}

export default function piModelTrace(pi: ExtensionAPI) {
  let running = false;

  pi.registerCommand("model-trace", {
    description:
      "Attribute the model actually serving pi: run 3 independent no-session numeric probes and score them against the ModelTrace bank",
    handler: async (args, ctx) => {
      if (running) {
        ctx.ui.notify("A /model-trace run is already in progress", "warning");
        return;
      }

      const target = resolveTarget(args, ctx);
      if ("error" in target) {
        ctx.ui.notify(target.error, "error");
        return;
      }
      const { model, label } = target;

      running = true;
      const startedAt = Date.now();
      try {
        await ctx.waitForIdle();
        const bank = await loadBank();
        const challenges = generateChallenges(PROBE_COUNT);

        ctx.ui.notify(
          `ModelTrace: probing ${label} with ${PROBE_COUNT} independent no-session probes…`,
          "info",
        );
        ctx.ui.setStatus(MESSAGE_TYPE, `model-trace: probing ${label}`);

        // Retry once on transport-level failures; invalid-but-complete answers
        // are kept as-is since they are legitimate fingerprint evidence.
        const probes = await Promise.all(
          challenges.map(async (challenge) => {
            const first = await runProbe(challenge, model, ctx.thinkingLevel, ctx.cwd);
            if (!first.error || first.error === "empty response") return first;
            ctx.ui.notify(
              `ModelTrace: ${challenge.id} failed (${first.error}), retrying…`,
              "warning",
            );
            return runProbe(challenge, model, ctx.thinkingLevel, ctx.cwd);
          }),
        );

        const outputs = probes.map((probe) => ({
          text: probe.text,
          expected_count: probe.challenge.expected_count,
        }));

        let report: string;
        try {
          const analysis = analyzeGlobalOutputs(outputs, bank);
          report = formatReport(analysis, probes, label);
        } catch (error) {
          const details = probes
            .map(
              (probe, index) =>
                `- ${probe.challenge.id}: ${probe.error ?? `${probe.parsed} numbers parsed`} (output #${index + 1})`,
            )
            .join("\n");
          report =
            `## ModelTrace 模型归因\n\n**待测模型**: \`${label}\`\n\n` +
            `分析失败: ${error instanceof Error ? error.message : String(error)}\n\n${details}`;
        }

        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        pi.sendMessage(
          {
            customType: MESSAGE_TYPE,
            content: report,
            display: true,
            details: { model: label, elapsedSeconds: Number(elapsed) },
          },
          {},
        );
        ctx.ui.notify(`ModelTrace finished in ${elapsed}s`, "info");
      } catch (error) {
        ctx.ui.notify(
          `ModelTrace failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      } finally {
        running = false;
        ctx.ui.setStatus(MESSAGE_TYPE, undefined);
      }
    },
  });
}
