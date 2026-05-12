# Agent 返回协议

本文档整理 `agent-gateway` 当前对外暴露的 Agent Chat 返回协议，以及 `seaagent` CLI 对这些返回的处理方式。

## 适用范围

这里的“返回协议”指 Agent Chat 接口返回给调用方的协议，包括：

- `POST /v1/chat/completions` 的非流式 JSON 返回。
- `POST /v1/chat/completions` 的 SSE 流式返回。
- `GET /v1/chat/completions/ws` 和 `GET /v1/chats/{chat-id}/ws` 的 WebSocket 返回。
- `GET /v1/chats/{chat-id}`、`GET /v1/chats/{chat-id}/events`、`GET /v1/chats/{chat-id}/stream` 的历史查询和回放返回。

不包含 Tool 自身的 `response_mode` 协议。`response_mode` 是 Tool 调用返回解析方式，不是 Agent 最终回复协议。

## 请求结构

`chat run` 会组装为 `ChatCompletionRequest`：

```json
{
  "request_id": "optional-request-id",
  "agent_id": "agent_name:v1",
  "category": "fabric",
  "agent_config": {},
  "messages": [
    {
      "role": "user",
      "content": "hello"
    }
  ],
  "stream": true,
  "metadata": {}
}
```

字段说明：

- `agent_id`：已注册 Agent 的 ID 或 key。
- `agent_config`：内联运行时 Agent 配置。不能和 `agent_id` 同时使用。
- `messages`：对话消息数组。
- `stream`：是否流式返回。缺省时按流式处理。
- `category`：调度类别，当前有效值为 `fabric` 或 `seaactor`。
- `metadata`：透传上下文，例如 `session_id`、`user_id`、`api_key` 等。

## 非流式返回

当 `stream: false` 时，接口返回 `ChatCompletionResponse`：

```json
{
  "run_id": "run_xxx",
  "status": "completed",
  "response": {
    "content": "agent final answer"
  },
  "finish_reason": "stop",
  "error_code": "",
  "error_message": ""
}
```

字段说明：

- `run_id`：本次 Agent 运行 ID。
- `status`：运行状态，取值为 `queued`、`running`、`completed`、`failed`、`cancelled`。
- `response`：最终响应事件中的 `data` 内容。来源于缓存事件里的 `chat.response` 或 `response.completed`。
- `finish_reason`：完成原因。
- `error_code`：失败时的错误码。
- `error_message`：失败时的错误信息。

失败示例：

```json
{
  "run_id": "run_xxx",
  "status": "failed",
  "error_code": "agent_error",
  "error_message": "agent execution failed"
}
```

## SSE 流式返回

流式 HTTP 返回使用标准 SSE block：

```text
event: response.output_text.delta
data: {"delta":"hello"}

event: response.output_text.delta
data: {"delta":" world"}

event: response.completed
data: {"content":"hello world"}
```

当前 CLI 会识别以下文本增量事件：

- `response.text.delta`：读取 `data.delta`。
- `response.output_text.delta`：读取 `data.delta`。
- `chat.response`：依次读取 `data.content`、`data.text`、`data.delta`。
- `message.delta`：依次读取 `data.content`、`data.text`、`data.delta`。

终态事件：

- `chat.response`：可作为最终响应事件。
- `response.completed`：可作为最终响应事件。
- `chat.failed`：运行失败。
- `chat.cancelled`：运行取消。

Sandbox Agent 事件：

- `chat.sandbox.creating`：gateway 已根据 `agent_config.runtime.sandbox` 创建 sandbox run，事件中会带 `sandbox_run_id` / `game_run_id`。
- `chat.sandbox.ready`：sandbox 已可用，事件中会带 `sandbox_run_id`、`workspace_root`、`preview_url`、`preview_port` 等字段。
- `chat.sandbox.failed`：sandbox 创建或就绪失败，事件中会带 `error_code` / `error_message`。

`runtime.sandbox` 是 Agent 的运行类型标记，不使用 `enabled` 字段；对象存在即表示该 Agent 需要自动拉起 sandbox。普通 Agent 不配置 `runtime.sandbox`。

## WebSocket 返回

WebSocket 返回每条消息是 JSON：

```json
{
  "event": "response.output_text.delta",
  "data": {
    "delta": "hello"
  }
}
```

错误消息格式：

```json
{
  "event": "error",
  "code": "agent_error",
  "error": "agent execution failed"
}
```

CLI 收到 `event: "error"` 时会抛出错误；其他事件按 SSE 相同的文本提取规则渲染。

## 历史查询和回放

### 查询运行状态

`GET /v1/chats/{chat-id}` 返回 `ChatMeta`：

```json
{
  "run_id": "run_xxx",
  "category": "fabric",
  "status": "completed",
  "last_seq": 12,
  "finish_reason": "stop",
  "request_id": "optional-request-id",
  "created_at": 1770000000,
  "updated_at": 1770000001,
  "error_code": "",
  "error_message": ""
}
```

### 查询事件列表

`GET /v1/chats/{chat-id}/events` 返回事件记录：

```json
{
  "run_id": "run_xxx",
  "status": "completed",
  "last_seq": 12,
  "items": [
    {
      "run_id": "run_xxx",
      "seq": 1,
      "raw_sse": "event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n",
      "source": "proxy",
      "ts": 1770000000
    }
  ]
}
```

### 回放流

`GET /v1/chats/{chat-id}/stream` 按 SSE 格式回放历史事件。

`GET /v1/chats/{chat-id}/ws?after_seq=...` 按 WebSocket JSON 消息格式回放历史事件。

## CLI 行为

`seaagent chat run` 默认流式：

```bash
seaagent chat run <agent-id> "hello"
```

默认流式模式下，CLI 只把文本增量写到 stdout，不显示完整事件 envelope。

CLI 会记录流式事件里的 `run_id` 和 SSE/WebSocket 事件序号。连接异常结束且运行还没有进入终态时，CLI 默认无限自动重连，并通过 `GET /v1/chats/{chat-id}/stream?after_seq=...` 或 WebSocket 续传，不会重新创建 Agent 任务。可用 `--stream-retries <n>` 限制次数，`--stream-retries 0` 表示不自动续流。

```bash
seaagent chat run <agent-id> "long task"
seaagent chat stream <chat-id> --after-seq 12
```

非流式模式：

```bash
seaagent chat run --no-stream <agent-id> "hello"
```

非流式模式下，CLI 打印完整 JSON `ChatCompletionResponse`。

WebSocket 模式：

```bash
seaagent chat run --ws <agent-id> "hello"
```

WebSocket 模式下，CLI 发送同一份 `ChatCompletionRequest` 作为首条 WebSocket 消息，然后按事件流渲染文本。

## Agent 最终内容格式

当前 Agent 最终内容本身没有独立的结构化 schema 字段，例如没有 `output_schema` 或 `response_schema`。

如果业务需要稳定的最终答案格式，应通过 Agent `system_prompt` 或 Skill `instruction` 约束，例如要求最终只返回 JSON：

```json
{
  "status": "success",
  "final_video_url": "https://example.com/final.mp4",
  "assets": [],
  "notes": ""
}
```

这种格式约束属于提示词协议，gateway 当前不会自动校验。

## 代码位置

- CLI chat 命令和流式渲染：`src/commands/chat.ts`
- Chat 请求和返回模型：`agent-gateway/internal/models/chat.go`
- Chat 响应缓存和终态提取：`agent-gateway/internal/services/chat_service.go`
- CLI chat payload 说明：`skills/seaagent-cli/references/capability-formats.md`
