# @indexyz/pi-custom-provider

一个通用的 [pi](https://github.com/earendil-works/pi-mono) provider 扩展，支持：

- OpenAI Chat Compatible（`openai-completions`）
- Anthropic Messages（`anthropic-messages`）
- OpenAI Responses（`openai-responses`）
- 从上游 `/models` 拉取模型列表
- 从 [models.dev](https://models.dev/) 补全价格、上下文窗口、输出上限、模态和 reasoning/thinking 元数据
- 缓存上游模型列表和 models.dev 元数据到 `~/.pi/agent/custom-provider-models.json`
- 根据上游或 models.dev 返回的 reasoning/thinking 能力映射 pi 的思考等级

## 安装

```bash
pi install npm:@indexyz/pi-custom-provider
```

本地试用：

```bash
pi -e ./pi-custom-provider/index.ts
```

## 配置

创建 `~/.pi/agent/custom-provider.json`。推荐使用 `providers` 包裹 provider，也兼容直接以 provider 名称作为顶层 key：

```json
{
  "providers": {
    "my-openai": {
      "baseURL": "https://api.example.com/v1",
      "apiKey": "$MY_OPENAI_KEY",
      "api": "openai-completions",
      "cache": { "ttlSeconds": 3600 }
    },
    "my-anthropic": {
      "baseURL": "https://anthropic.example.com",
      "apiKey": "sk-ant-...",
      "api": "anthropic-messages",
      "modelsURL": "https://anthropic.example.com/v1/models"
    },
    "my-responses": {
      "baseURL": "https://responses.example.com/v1",
      "apiKey": "sk-...",
      "api": "openai-responses"
    }
  }
}
```

`baseURL` 支持带或不带 `/v1`。Chat/Responses provider 会使用 `/v1`，Anthropic provider 会去掉末尾 `/v1`，以适配 pi 原生 API 实现。`modelsURL` 可用于上游不使用标准 `/v1/models` 的服务。

API 也接受以下别名：`openai-chat-compatible`、`chat-completions`、`anthropic`、`responses`。未填写 `api` 时默认为 `openai-completions`。

认证支持：

- `apiKey`、`api_key` 或 `token`
- `$ENV_NAME` / `${ENV_NAME}` 环境变量引用
- `headers` 自定义请求头
- Anthropic discovery 默认发送 `x-api-key`；如网关要求其他认证，可用 `headers` 覆盖或设置 `authHeader: "authorization"`

## 模型元数据

上游返回的模型对象可以提供这些字段（camelCase 和 snake_case 均支持）：

- `id` / `slug` / `model_id`
- `name` / `display_name`
- `context_window`、`context_length`、`max_context_tokens`
- `max_tokens`、`max_output_tokens`、`max_completion_tokens`
- `input_modalities`（包含 `image` 时启用图像输入）
- `reasoning`、`thinking`、`supports_reasoning`、`capabilities.reasoning`
- `supported_reasoning_levels` / `supportedThinkingLevels`
- `supported_parameters` 中的 `reasoning_effort`、`thinking` 等能力标记

如果上游明确提供思考等级，扩展会生成 `thinkingLevelMap`，对不支持的等级写入 `null`，避免 pi 发出上游不接受的 effort。`ultra` 会映射到 pi 的 `max`。如果上游没有能力信息，扩展不会依据模型名称猜测 reasoning；可以使用 `modelOverrides` 补充或修正：

```json
{
  "providers": {
    "gateway": {
      "baseURL": "http://localhost:8000/v1",
      "api": "openai-completions",
      "modelOverrides": {
        "deepseek-r1": {
          "reasoning": true,
          "thinkingLevelMap": {
            "off": null,
            "low": "low",
            "medium": "medium",
            "high": "high"
          },
          "compat": {
            "thinkingFormat": "deepseek",
            "supportsReasoningEffort": true
          }
        }
      }
    }
  }
}
```

`modelOverrides` 的 key 是上游模型 ID，可覆盖 `name`、`reasoning`、`thinkingLevelMap`、`input`、`contextWindow`、`maxTokens`、`cost` 和 `compat`。

### models.dev 补全

默认会查询并缓存 `https://models.dev/api.json` 和 `https://models.dev/models.json`。上游模型对象的字段优先，models.dev 只补充缺失字段；两份 models.dev 数据也会合并，优先使用带 provider 的价格数据。

查询 models.dev 时会自动处理常见模型变体：

- `deepseek/deepseek-flash` 会按 provider `deepseek` 和模型 `deepseek-flash` 查找
- `glm-5.3-max`、`model-high` 等思考 effort 后缀会先移除再查找基础模型

provider 名称无法自动匹配时，可以指定 models.dev provider：

```json
{
  "providers": {
    "gateway": {
      "baseURL": "https://gateway.example.com/v1",
      "api": "openai-responses",
      "modelsDevProvider": "openrouter"
    }
  }
}
```

设置顶层 `"modelsDev": false` 可关闭补全；也可以配置 `apiURL`、`modelsURL` 和独立缓存 TTL。provider 设置 `"modelsDev": false` 时只使用上游元数据。

## 缓存和刷新

默认缓存有效期为 1 小时。网络请求失败时，只要存在对应 provider 的缓存，就继续使用过期缓存，避免临时网络故障导致模型消失。缓存只包含模型元数据，不包含 API key。

```json
{
  "cache": {
    "ttlSeconds": 1800,
    "file": "custom-provider-models.json"
  },
  "providers": {
    "gateway": {
      "baseURL": "https://gateway.example.com/v1",
      "api": "openai-responses",
      "cache": { "enabled": true }
    }
  }
}
```

`cache: false` 可对单个 provider 禁用缓存；也可以使用 `/refresh-custom-provider-models` 强制重新拉取所有 provider 的模型列表。缓存文件路径可以是绝对路径，也可以是相对于 `PI_CODING_AGENT_DIR` 的路径。

## 开发

```bash
npm install
npm run check
npm run pack:custom-provider
```

## License

MIT
