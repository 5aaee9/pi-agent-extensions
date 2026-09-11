import { RESPONSES_SERVER_TOOL_API, SERVER_TOOL_GROUPS } from "./types.ts";
import type {
  RelayServerTools,
  ServerToolDefinition,
  ServerToolGroup,
  SupportedApi,
} from "./types.ts";
import { asRecord, hasControlCharacters } from "./util.ts";

const UNSUPPORTED_RESPONSES_SERVER_TOOL_TYPE: Record<string, true> = {
  apply_patch: true,
  computer: true,
  computer_use: true,
  computer_use_preview: true,
  custom: true,
  function: true,
  image_generation: true,
  local_shell: true,
  namespace: true,
};
const UNSUPPORTED_ANTHROPIC_SERVER_TOOL_PREFIXES = [
  "bash_",
  "computer_",
  "memory_",
  "text_editor_",
];

function serverToolLabel(provider: string, group: ServerToolGroup, index: number) {
  return `provider ${provider} serverTools.${group}[${index}]`;
}

function validateResponsesServerTool(
  provider: string,
  index: number,
  tool: ServerToolDefinition,
  type: string,
) {
  const label = serverToolLabel(provider, "responses", index);
  if (UNSUPPORTED_RESPONSES_SERVER_TOOL_TYPE[type] === true) {
    throw new Error(
      `${label} type ${JSON.stringify(type)} requires client-side handling or returns output Pi cannot retain`,
    );
  }

  if (type === "file_search") {
    if (
      !Array.isArray(tool.vector_store_ids) ||
      tool.vector_store_ids.length === 0 ||
      tool.vector_store_ids.some((id) => typeof id !== "string" || !id.trim())
    ) {
      throw new Error(`${label} file_search requires non-empty vector_store_ids`);
    }
  }

  if (type === "code_interpreter") {
    const container = tool.container;
    const autoContainer = asRecord(container);
    if (!((typeof container === "string" && container.trim()) || autoContainer?.type === "auto")) {
      throw new Error(`${label} code_interpreter requires a container ID or { "type": "auto" }`);
    }
  }

  if (type === "shell") {
    const environment = asRecord(tool.environment);
    if (
      !environment ||
      (environment.type !== "container_auto" && environment.type !== "container_reference")
    ) {
      throw new Error(`${label} shell requires a hosted container environment`);
    }
    if (
      environment.type === "container_reference" &&
      (typeof environment.container_id !== "string" || !environment.container_id.trim())
    ) {
      throw new Error(`${label} shell container_reference requires container_id`);
    }
  }

  if (type === "mcp") {
    if (typeof tool.server_label !== "string" || !tool.server_label.trim()) {
      throw new Error(`${label} mcp requires server_label`);
    }
    if (
      !(
        (typeof tool.server_url === "string" && tool.server_url.trim()) ||
        (typeof tool.connector_id === "string" && tool.connector_id.trim())
      )
    ) {
      throw new Error(`${label} mcp requires server_url or connector_id`);
    }
    if (tool.require_approval !== "never") {
      throw new Error(`${label} mcp requires require_approval "never"; Pi cannot approve calls`);
    }
  }

  if (type === "tool_search" && tool.execution !== "server") {
    throw new Error(`${label} tool_search requires execution "server"`);
  }
}

function validateAnthropicServerTool(
  provider: string,
  index: number,
  tool: ServerToolDefinition,
  type: string,
) {
  const label = serverToolLabel(provider, "anthropic", index);
  if (UNSUPPORTED_ANTHROPIC_SERVER_TOOL_PREFIXES.some((prefix) => type.startsWith(prefix))) {
    throw new Error(
      `${label} type ${JSON.stringify(type)} requires client-side handling and is not a server tool`,
    );
  }

  const expectedName = type.startsWith("web_search_")
    ? "web_search"
    : type.startsWith("web_fetch_")
      ? "web_fetch"
      : type.startsWith("code_execution_")
        ? "code_execution"
        : type.startsWith("tool_search_tool_regex")
          ? "tool_search_tool_regex"
          : type.startsWith("tool_search_tool_bm25")
            ? "tool_search_tool_bm25"
            : undefined;
  if (expectedName && tool.name !== expectedName) {
    throw new Error(`${label} type ${JSON.stringify(type)} requires name ${expectedName}`);
  }
}

function parseServerToolList(
  provider: string,
  group: ServerToolGroup,
  value: unknown,
): ServerToolDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`provider ${provider} serverTools.${group} must be an array`);
  }

  return value.map((candidate, index) => {
    const tool = asRecord(candidate);
    const label = serverToolLabel(provider, group, index);
    if (!tool) throw new Error(`${label} must be an object`);
    if (
      typeof tool.type !== "string" ||
      !tool.type.trim() ||
      tool.type !== tool.type.trim() ||
      tool.type.length > 128 ||
      hasControlCharacters(tool.type)
    ) {
      throw new Error(`${label} must have a valid non-empty type`);
    }

    if (group === "responses") {
      validateResponsesServerTool(provider, index, tool, tool.type);
    } else {
      validateAnthropicServerTool(provider, index, tool, tool.type);
    }
    return structuredClone(tool);
  });
}

export function parseServerTools(provider: string, value: unknown): RelayServerTools | undefined {
  if (value === undefined) return undefined;
  const config = asRecord(value);
  if (!config) throw new Error(`provider ${provider} serverTools must be an object`);

  const unknownGroup = Object.keys(config).find(
    (group) => !SERVER_TOOL_GROUPS.includes(group as ServerToolGroup),
  );
  if (unknownGroup !== undefined) {
    throw new Error(
      `provider ${provider} has unsupported serverTools group ${JSON.stringify(unknownGroup)}; expected responses or anthropic`,
    );
  }

  const serverTools = {
    responses: parseServerToolList(provider, "responses", config.responses),
    anthropic: parseServerToolList(provider, "anthropic", config.anthropic),
  };
  return serverTools.responses.length > 0 || serverTools.anthropic.length > 0
    ? serverTools
    : undefined;
}

export function validateServerToolsForApi(
  provider: string,
  api: SupportedApi | undefined,
  serverTools: RelayServerTools | undefined,
) {
  if (!api || !serverTools) return;
  if (RESPONSES_SERVER_TOOL_API[api] === true && serverTools.anthropic.length > 0) {
    throw new Error(`provider ${provider} cannot use serverTools.anthropic with api ${api}`);
  }
  if (api === "anthropic-messages" && serverTools.responses.length > 0) {
    throw new Error(`provider ${provider} cannot use serverTools.responses with api ${api}`);
  }
  if (api === "openai-completions") {
    throw new Error(`provider ${provider} cannot use serverTools with api openai-completions`);
  }
}
