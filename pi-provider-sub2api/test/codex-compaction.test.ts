import type { Model } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import {
  convertToLlm,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerCodexCompaction,
  type CodexCompactionRelay,
  type NativeCodexCompactionDetails,
} from "../codex-compaction.ts";

type Handler = (event: any, context: any) => any;

const relay: CodexCompactionRelay = {
  provider: "relay",
  responsesUrl: "https://relay.example/v1/responses",
  apiKey: "relay-token",
};

const model = {
  id: "gpt-5.5",
  name: "GPT-5.5",
  api: "openai-codex-responses",
  provider: relay.provider,
  baseUrl: "https://relay.example/v1",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5 },
  contextWindow: 200_000,
  maxTokens: 16_384,
} as Model<"openai-codex-responses">;

function userEntry(id: string, text: string, parentId: string | null = null): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  };
}

function assistantEntry(id: string, text: string, parentId: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "openai-codex-responses",
      provider: relay.provider,
      model: model.id,
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  };
}

function compactionEntry(
  id: string,
  parentId: string,
  firstKeptEntryId: string,
  details: NativeCodexCompactionDetails,
): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    summary: "[OpenAI native compaction checkpoint]",
    firstKeptEntryId,
    tokensBefore: 50_000,
    details,
  };
}

function serializeReplay(entries: SessionEntry[]) {
  return convertResponsesMessages(
    model,
    {
      systemPrompt: "",
      messages: convertToLlm(entries.flatMap(sessionEntryToContextMessages)),
      tools: [],
    },
    new Set(["openai", "openai-codex", "opencode"]),
    { includeSystemPrompt: false },
  );
}

function createHarness(initialBranch: SessionEntry[]) {
  const handlers = new Map<string, Handler>();
  const notifications: Array<{ message: string; level: string }> = [];
  let branch = initialBranch;
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    getAllTools: () => [],
    getActiveTools: () => [],
  } as unknown as ExtensionAPI;
  registerCodexCompaction(pi, (provider) => (provider === relay.provider ? relay : undefined));

  const context = {
    model,
    hasUI: true,
    getSystemPrompt: () => "You are Codex.",
    sessionManager: {
      getBranch: () => branch,
      getSessionId: () => "session-1",
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
  return {
    handlers,
    context,
    notifications,
    setBranch(next: SessionEntry[]) {
      branch = next;
    },
  };
}

function compactEvent(branchEntries: SessionEntry[], signal = new AbortController().signal) {
  return {
    type: "session_before_compact",
    branchEntries,
    preparation: {
      firstKeptEntryId: branchEntries[0]?.id ?? "missing",
      tokensBefore: 50_000,
      messagesToSummarize: [],
      turnPrefixMessages: [],
    },
    reason: "manual",
    willRetry: false,
    customInstructions: "Preserve implementation details.",
    signal,
  };
}

function compactResponse(encryptedContent: string, itemType = "compaction") {
  return {
    id: `cmp-response-${encryptedContent}`,
    object: "response.compaction",
    created_at: 1_800_000_000,
    output: [
      {
        id: "msg-retained",
        type: "message",
        status: "completed",
        role: "user",
        content: [{ type: "input_text", text: "Remember BLUE-42." }],
      },
      { id: "cmp-item", type: itemType, encrypted_content: encryptedContent },
    ],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 7 },
      total_tokens: 130,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Codex standalone compaction", () => {
  it("compacts the current session and replaces Pi replay with the returned native window", async () => {
    const user = userEntry("user-1", "Remember BLUE-42.");
    const assistant = assistantEntry("assistant-1", "Noted.", user.id);
    const branch = [user, assistant];
    const harness = createHarness(branch);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json(compactResponse("opaque-1"));
    });

    const result = await harness.handlers.get("session_before_compact")!(
      compactEvent(branch),
      harness.context,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://relay.example/v1/responses/compact");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.redirect).toBe("error");
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer relay-token");
    expect(headers.get("chatgpt-account-id")).toBeNull();
    expect(headers.get("accept")).toBe("application/json");

    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toMatchObject({ model: model.id });
    expect(body.instructions).toContain("You are Codex.");
    expect(body.instructions).toContain("Preserve implementation details.");
    expect(body).not.toHaveProperty("stream");
    expect(body).not.toHaveProperty("store");
    expect(JSON.stringify(body.input)).toContain("Remember BLUE-42.");
    expect(JSON.stringify(body.input)).toContain("Noted.");

    expect(result.compaction).toMatchObject({
      summary: "[OpenAI native compaction checkpoint]",
      firstKeptEntryId: user.id,
      tokensBefore: 50_000,
      usage: {
        input: 70,
        output: 30,
        cacheRead: 20,
        cacheWrite: 10,
        reasoning: 7,
        totalTokens: 130,
      },
      details: {
        kind: "sub2api-codex-native-compaction",
        version: 1,
        provider: relay.provider,
        api: "openai-codex-responses",
        model: model.id,
        responsesUrl: relay.responsesUrl,
        compactResponseId: "cmp-response-opaque-1",
      },
    });

    const checkpoint = compactionEntry(
      "compact-1",
      assistant.id,
      user.id,
      result.compaction.details,
    );
    const tail = userEntry("user-2", "What was the code?", checkpoint.id);
    const compactedBranch = [user, assistant, checkpoint, tail];
    harness.setBranch(compactedBranch);
    const piReplay = serializeReplay([checkpoint, user, assistant, tail]);

    const rewritten = harness.handlers.get("before_provider_request")!(
      {
        payload: {
          model: model.id,
          store: false,
          previous_response_id: "must-be-removed",
          input: piReplay,
        },
      },
      harness.context,
    );

    expect(rewritten.previous_response_id).toBeUndefined();
    expect(rewritten.input.slice(0, 2)).toEqual(result.compaction.details.compactedWindow);
    expect(JSON.stringify(rewritten.input)).not.toContain(result.compaction.summary);
    expect(JSON.stringify(rewritten.input)).toContain("What was the code?");
    expect(JSON.stringify(rewritten.input).match(/Noted\./g)).toBeNull();

    const preamble = { role: "developer", content: "Fresh provider context." };
    const injectedTail = {
      role: "user",
      content: [{ type: "input_text", text: "Injected by a context hook." }],
    };
    const rewrittenWithContext = harness.handlers.get("before_provider_request")!(
      {
        payload: {
          model: model.id,
          store: false,
          input: [preamble, ...piReplay, injectedTail],
        },
      },
      harness.context,
    );
    expect(rewrittenWithContext.input[0]).toEqual(preamble);
    expect(rewrittenWithContext.input.slice(1, 3)).toEqual(
      result.compaction.details.compactedWindow,
    );
    expect(rewrittenWithContext.input.at(-1)).toEqual(injectedTail);
  });

  it("accepts the compaction_summary item returned by Codex relays", async () => {
    const user = userEntry("user-1", "Remember BLUE-42.");
    const harness = createHarness([user]);
    vi.stubGlobal("fetch", async () => {
      return Response.json(compactResponse("relay-opaque", "compaction_summary"));
    });

    const result = await harness.handlers.get("session_before_compact")!(
      compactEvent([user]),
      harness.context,
    );

    expect(result.compaction.details.compactedWindow.at(-1)).toMatchObject({
      type: "compaction_summary",
      encrypted_content: "relay-opaque",
    });
    expect(harness.notifications).toEqual([]);
  });

  it("feeds a previous native window and its live tail into repeated compaction", async () => {
    const user = userEntry("user-1", "Remember BLUE-42.");
    const priorDetails: NativeCodexCompactionDetails = {
      kind: "sub2api-codex-native-compaction",
      version: 1,
      provider: relay.provider,
      api: "openai-codex-responses",
      model: model.id,
      responsesUrl: relay.responsesUrl,
      compactedWindow: compactResponse("opaque-1", "compaction_summary").output,
      compactResponseId: "first",
      createdAt: new Date().toISOString(),
    };
    const prior = compactionEntry("compact-1", user.id, user.id, priorDetails);
    const tail = userEntry("user-2", "New fact GREEN-7.", prior.id);
    const branch = [user, prior, tail];
    const harness = createHarness(branch);
    let requestBody: any;
    vi.stubGlobal("fetch", async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json(compactResponse("opaque-2", "compaction_summary"));
    });

    const result = await harness.handlers.get("session_before_compact")!(
      compactEvent(branch),
      harness.context,
    );

    expect(requestBody.input.slice(0, 2)).toEqual(priorDetails.compactedWindow);
    expect(JSON.stringify(requestBody.input)).toContain("New fact GREEN-7.");
    expect(
      requestBody.input.filter((item: any) => item.type === "compaction_summary"),
    ).toHaveLength(1);
    expect(result.compaction.details.compactedWindow.at(-1)).toMatchObject({
      type: "compaction_summary",
      encrypted_content: "opaque-2",
    });
  });

  it("falls back before the first checkpoint but cancels if an existing native checkpoint cannot be replaced", async () => {
    const user = userEntry("user-1", "hello");
    const firstHarness = createHarness([user]);
    vi.stubGlobal("fetch", async () => new Response("unsupported", { status: 404 }));

    const firstResult = await firstHarness.handlers.get("session_before_compact")!(
      compactEvent([user]),
      firstHarness.context,
    );
    expect(firstResult).toBeUndefined();
    expect(firstHarness.notifications.at(-1)).toMatchObject({ level: "warning" });

    const details: NativeCodexCompactionDetails = {
      kind: "sub2api-codex-native-compaction",
      version: 1,
      provider: relay.provider,
      api: "openai-codex-responses",
      model: model.id,
      responsesUrl: relay.responsesUrl,
      compactedWindow: compactResponse("opaque-1").output,
      createdAt: new Date().toISOString(),
    };
    const checkpoint = compactionEntry("compact-1", user.id, user.id, details);
    const branch = [user, checkpoint];
    const repeatedHarness = createHarness(branch);
    const repeatedResult = await repeatedHarness.handlers.get("session_before_compact")!(
      compactEvent(branch),
      repeatedHarness.context,
    );
    expect(repeatedResult).toEqual({ cancel: true });
    expect(repeatedHarness.notifications.at(-1)).toMatchObject({ level: "error" });
  });

  it("cancels when local tail serialization fails after a native checkpoint", async () => {
    const user = userEntry("user-1", "hello");
    const details: NativeCodexCompactionDetails = {
      kind: "sub2api-codex-native-compaction",
      version: 1,
      provider: relay.provider,
      api: "openai-codex-responses",
      model: model.id,
      responsesUrl: relay.responsesUrl,
      compactedWindow: compactResponse("opaque-1").output,
      createdAt: new Date().toISOString(),
    };
    const checkpoint = compactionEntry("compact-1", user.id, user.id, details);
    const malformedTail = {
      type: "message",
      id: "assistant-malformed",
      parentId: checkpoint.id,
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "", thinkingSignature: "not-json-reasoning" }],
        api: "openai-codex-responses",
        provider: relay.provider,
        model: model.id,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as SessionEntry;
    const branch = [user, checkpoint, malformedTail];
    const harness = createHarness(branch);
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await harness.handlers.get("session_before_compact")!(
      compactEvent(branch),
      harness.context,
    );

    expect(result).toEqual({ cancel: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.notifications.at(-1)).toMatchObject({ level: "error" });
  });

  it("rejects a malformed compacted output window before persisting it", async () => {
    const user = userEntry("user-1", "hello");
    const harness = createHarness([user]);
    vi.stubGlobal("fetch", async () =>
      Response.json({
        ...compactResponse("opaque"),
        output: [
          { id: "bad-user", type: "message", status: "completed", role: "user" },
          { id: "cmp-item", type: "compaction", encrypted_content: "opaque" },
        ],
      }),
    );

    const result = await harness.handlers.get("session_before_compact")!(
      compactEvent([user]),
      harness.context,
    );

    expect(result).toBeUndefined();
    expect(harness.notifications.at(-1)).toMatchObject({ level: "warning" });
  });

  it("leaves unsupported APIs and mismatched provider payloads untouched", async () => {
    const user = userEntry("user-1", "hello");
    const harness = createHarness([user]);
    const otherContext = {
      ...harness.context,
      model: { ...model, api: "openai-responses" },
    };

    expect(
      await harness.handlers.get("session_before_compact")!(compactEvent([user]), otherContext),
    ).toBeUndefined();
    expect(
      harness.handlers.get("before_provider_request")!(
        { payload: { model: "other-model", input: [] } },
        harness.context,
      ),
    ).toBeUndefined();
  });
});
