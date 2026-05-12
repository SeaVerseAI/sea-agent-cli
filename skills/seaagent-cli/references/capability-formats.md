# Capability Formats

These formats come from `~/Desktop/sea_art/agent-gateway` models and services. `seaagent` passes files through to the gateway; it does not reshape payloads beyond JSON/YAML parsing.

## Current API Shape

The gateway now keeps Tool and Skill as single current-state records, like Agent. There are no public version create, publish, or lifecycle endpoints.

Create/register uses only `/register`:

- `tool register` -> `POST /v1/tools/register`
- `skill register` -> `POST /v1/skills/register`
- `agent register` -> `POST /v1/agents/register`

Maintenance endpoints:

- `tool update <id> -f file` -> `PUT /v1/tools/{id}`
- `tool delete <id> --operator-id <id>` -> `DELETE /v1/tools/{id}?operator_id=...`
- `skill update <id> -f file` -> `PUT /v1/skills/{id}`
- `skill delete <id> --operator-id <id>` -> `DELETE /v1/skills/{id}?operator_id=...`
- `agent update <id> -f file` -> `PUT /v1/agents/{id}`
- `agent delete <id> --operator-id <id>` -> `DELETE /v1/agents/{id}?operator_id=...`

Discovery and runtime endpoints:

- `catalog list` -> `GET /v1/catalog`
- `tool list/get/resolve` -> `GET /v1/tools`, `GET /v1/tools/{id}`, `GET /v1/tools/{id}/resolve`
- `skill list/get` -> `GET /v1/skills`, `GET /v1/skills/{id}`
- `agent list/capabilities` -> `GET /v1/agents`, `GET /v1/agents/{id}/capabilities`
- `chat run/get/events/stream/cancel` -> `/v1/chat/completions`, `/v1/chats/...`
- `game create/get/events/logs/command/refresh/delete` -> `/v1/game/runs/...`

## Payload Shape Switching

`/register` is the only public creation endpoint, but it accepts concise register payloads and lower-level current-state payloads.

Tool register switching:

- Concise register shape if none of these fields are present: `tool_key`, `source_kind`, `openai_schema`, `runtime_id`.
- Low-level `ToolCreateRequest` shape if any of those fields is present.

Tool update switching:

- Concise register update shape if none of these fields are present: `tool_key`, `source_kind`, `metadata`, `openai_schema`, `runtime_id`, `slug`.
- Low-level `ToolUpdateRequest` shape if any of those fields is present.

Skill register switching:

- Concise register shape if none of these fields are present: `skill_key`, `source_kind`, `manifest`.
- Low-level `SkillCreateRequest` shape if any of those fields is present.

Skill update switching:

- Concise register update shape if none of these fields are present: `skill_key`, `source_kind`, `metadata`, `manifest`, `slug`.
- Low-level `SkillUpdateRequest` shape if any of those fields is present.

Agent register switching:

- Concise register shape if none of these fields are present: `agent_key`, `model_config`, `agent_config`.
- Low-level `AgentCreateRequest` shape if any of those fields is present.
- `agent update` always uses low-level `AgentUpdateRequest`.

## Common Values

Stable identifiers:

- Tool key from concise register: `provider:name:version`.
- Tool runtime id: normally `provider:name:version`; builtin tools may still use a stable alias such as `seaart:generate_image`.
- Skill key from concise register: `provider:name:version`.
- Skill id/ref: normally `provider:name:version`, but runtime resolution also accepts current `skill_key` / `name`.
- Agent id/key: normally `name:version`.
- Names should be stable `snake_case`.

Statuses:

- Capability status: `draft`, `active`, `deprecated`, `disabled`, `deleted`.
- Concise register payloads create active capabilities by default. `enabled` is kept only for payload compatibility and no longer turns registration into draft.

JSON object fields must contain valid objects when present. Use `{}` for empty `metadata`, `config`, `permissions`, `auth`, or `model` values, and `[]` for empty arrays.

Do not put real secrets in payloads. For auth, use a reference such as:

```json
{"type": "bearer", "config_ref": "secret://tool/demo"}
```

## Tool Concise Register

Use with:

```bash
seaagent tool register -f <payload.json>
```

Also usable with `tool update <id> -f file` if the payload does not include low-level trigger fields.

```json
{
  "id": "provider:tool_name:v1",
  "provider": "provider",
  "name": "tool_name",
  "version": "v1",
  "category": "general",
  "transport": "http",
  "description": "What the tool does.",
  "endpoint": "https://tool.example.com/invoke",
  "method": "POST",
  "response_mode": "json",
  "poll_field": "task_id",
  "poll_endpoint": "https://tool.example.com/tasks/{{task_id}}",
  "poll_interval": 5.0,
  "poll_timeout": 600.0,
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  },
  "auth": {"type": "none"},
  "config": {"timeout_ms": 10000},
  "tags": [],
  "enabled": true,
  "owner_id": "provider",
  "created_by": "provider",
  "updated_by": "provider"
}
```

Rules:

- `name` and `description` are required.
- `provider` defaults to `internal`; `version` defaults to `v1`; `category` defaults to `general`.
- `id` defaults to `provider:name:version` and becomes current `runtime_id`; `tool_key` also defaults to `provider:name:version`.
- `method` defaults to `POST`.
- Timeout defaults to `10000` ms. `config.timeout_ms` is milliseconds; `config.timeout` below `10000` is treated as seconds.
- `response_mode` defaults to `json`; allowed values are `json` and `sse`.
- Polling fields are stored in `tools.metadata` and forwarded into runtime `agent.tools[]`.
- `parameters` becomes `openai_schema.function.parameters`.
- Remote tools use `transport` `http`, `grpc`, `queue`, or `custom` and must provide `endpoint`.
- `transport: "builtin"` creates local embedded current-state tool metadata. Put `{"type":"builtin","name":"provider:tool_name","function":"provider.tool_name"}` in `config`.
- `transport: "mcp"` creates remote custom MCP metadata and does not require `endpoint`. Put MCP metadata in `config`.

Builtin example:

```json
{
  "id": "seaart:generate_image",
  "provider": "seaart",
  "name": "generate_image",
  "version": "v1",
  "category": "media",
  "transport": "builtin",
  "description": "SeaArt image generation.",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt": {"type": "string", "description": "Image prompt."}
    },
    "required": ["prompt"]
  },
  "config": {
    "type": "builtin",
    "name": "seaart:generate_image",
    "function": "seaart.generate_image",
    "timeout_ms": 300000
  },
  "tags": ["seaart", "image", "builtin"],
  "enabled": true,
  "owner_id": "seaart",
  "created_by": "seaart"
}
```

## Tool Low-Level Current State

Use with `tool register` to create if the payload includes low-level trigger fields, or with `tool update`.

```json
{
  "tool_key": "provider:tool_name:v1",
  "provider": "provider",
  "name": "tool_name",
  "slug": "provider-tool-name-v1",
  "category": "general",
  "description": "What the tool does.",
  "source_kind": "external",
  "runtime_id": "provider:tool_name:v1",
  "openai_schema": {
    "type": "function",
    "function": {
      "name": "tool_name",
      "description": "What the tool does.",
      "parameters": {"type": "object", "properties": {}, "required": []}
    }
  },
  "execution_mode": "remote",
  "transport": "http",
  "method": "POST",
  "endpoint": "https://tool.example.com/invoke",
  "response_mode": "json",
  "auth_type": "none",
  "auth_config": {},
  "timeout_ms": 10000,
  "checksum": "provider:tool_name:v1",
  "changelog": "Current config.",
  "owner_id": "provider",
  "status": "active",
  "metadata": {},
  "tags": [],
  "created_by": "provider",
  "updated_by": "provider"
}
```

Create requires `created_by`; update requires `updated_by`. The OpenAI function name must stay stable when updating the same tool.

## Skill Concise Register

Use with:

```bash
seaagent skill register -f <payload.json>
```

Also usable with `skill update <id> -f file` if the payload does not include low-level trigger fields.

```json
{
  "id": "provider:skill_name:v1",
  "name": "skill_name",
  "version": "v1",
  "display_name": "Skill Name",
  "description": "What the skill helps with.",
  "category": "general",
  "provider": "provider",
  "required_tools": [],
  "optional_tools": [],
  "instruction": "Detailed operating instructions for the agent.",
  "config": {
    "model": "gpt-4o",
    "temperature": 0.2,
    "max_turns": 20,
    "timeout": 600
  },
  "triggers": {
    "keywords": ["keyword"],
    "intent": "intent_name"
  },
  "tags": [],
  "enabled": true,
  "owner_id": "provider",
  "created_by": "provider",
  "updated_by": "provider"
}
```

Rules:

- `name`, `description`, and `instruction` are required.
- `version` defaults to `v1`; `provider` defaults to `internal`; `display_name` defaults to `name`; `category` defaults to `general`; `id` and `skill_key` default to `provider:name:version`.
- The gateway builds current `skills.manifest` from this payload.
- `required_tools` and `optional_tools` must be arrays when present.
- A string tool ref becomes `{ "type": "http", "ref": "<value>" }`.
- Object refs use `{"type":"builtin|http|http_batch|mcp","ref":"...","server":"..."}`. `server` is required for `type: "mcp"`.

Tool refs should match the gateway resolver:

- Prefer the exact tool `runtime_id` from `seaagent tool resolve <tool-id>`.
- Current resolver accepts exact `runtime_id` / `tool_key` and also `provider:name` as a compatibility lookup.
- Builtin tools may intentionally use stable aliases such as `seaart:generate_image`.
- For SeaArt builtin media tools, prefer the full active `tool_key` in skill manifests, for example `seaart:generate_image:v1`, `seaart:generate_video:v1`, `seaart:get_task_status:v1`, `seaart:list_models:v1`, and `seaart:get_model_skill:v1`. This matches existing working media-generation registrations and avoids ambiguity between runtime aliases and versioned tool records.

## Skill Low-Level Current State

Use with `skill register` to create if the payload includes low-level trigger fields, or with `skill update`.

```json
{
  "skill_key": "provider:skill_name:v1",
  "display_name": "Skill Name",
  "name": "skill_name",
  "slug": "provider-skill-name-v1",
  "provider": "provider",
  "category": "general",
  "description": "What the skill helps with.",
  "source_kind": "external",
  "bundle_uri": "",
  "manifest": {
    "id": "provider:skill_name:v1",
    "name": "skill_name",
    "version": "v1",
    "display_name": "Skill Name",
    "description": "What the skill helps with.",
    "category": "general",
    "provider": "provider",
    "required_tools": [],
    "optional_tools": [],
    "instruction": "Detailed operating instructions for the agent.",
    "config": {},
    "triggers": {},
    "tags": []
  },
  "entry_file": "SKILL.md",
  "dependencies": [],
  "checksum": "provider:skill_name:v1",
  "changelog": "Current manifest.",
  "owner_id": "provider",
  "status": "active",
  "metadata": {},
  "tags": [],
  "created_by": "provider",
  "updated_by": "provider"
}
```

Create requires `created_by`; update requires `updated_by`. `manifest.name` and `manifest.instruction` must be non-empty. If manifest file lists are present, they must include `entry_file`.

## Agent Concise Register

Use with:

```bash
seaagent agent register -f <payload.json>
```

```json
{
  "id": "agent_name:v1",
  "name": "agent_name",
  "version": "v1",
  "display_name": "Agent Name",
  "description": "What the agent does.",
  "category": "fabric",
  "model": {
    "default": "gpt-5.1-chat",
    "allowed": ["gpt-5.1-chat", "gpt-4.1-mini", "gpt-4o"]
  },
  "system_prompt": "Base system prompt.",
  "skills": ["provider:skill_name:v1"],
  "config": {
    "temperature": 0.2,
    "max_turns": 20,
    "timeout": 600
  },
  "permissions": {},
  "tags": [],
  "public": true,
  "enabled": true,
  "owner_id": "internal",
  "created_by": "internal"
}
```

Rules:

- `name`, `description`, `category`, `owner_id`, and `created_by` are required after defaults.
- Current SeaArt gateway deployments may reject arbitrary categories; use `fabric` for standard runnable agents and `seaactor` only when that category is explicitly required.
- `version` defaults to `v1`; `id` defaults to `name:version`; `display_name` defaults to `name`; `owner_id` defaults to `internal`.
- `model`, `config`, and `permissions` default to `{}`.
- `skills` must contain non-empty refs and every referenced skill must resolve to active Skill current state.
- Agent register creates an active agent by default. `enabled` is kept only for payload compatibility.
- To mark a registered agent as a sandbox agent, add `config.runtime.sandbox`. The presence of `sandbox` is the type marker; do not add `enabled`.

Sandbox concise-register config example:

```json
{
  "temperature": 0.2,
  "max_turns": 100,
  "timeout": 1800,
  "runtime": {
    "sandbox": {}
  }
}
```

## Agent Low-Level Current State

Use with `agent register` to create if the payload includes low-level trigger fields, or with `agent update`.

```json
{
  "agent_key": "agent_name:v1",
  "category": "fabric",
  "display_name": "Agent Name",
  "name": "agent_name",
  "description": "What the agent does.",
  "owner_id": "internal",
  "status": "active",
  "metadata": {},
  "model_config": {
    "default": "gpt-5.1-chat",
    "allowed": ["gpt-5.1-chat", "gpt-4.1-mini", "gpt-4o"]
  },
  "system_prompt": "Base system prompt.",
  "agent_config": {
    "temperature": 0.2,
    "max_turns": 20,
    "timeout": 600
  },
  "skills": ["provider:skill_name:v1"],
  "permissions": {},
  "tags": [],
  "public": true,
  "created_by": "internal",
  "updated_by": "internal"
}
```

Create requires `created_by`; update requires `updated_by`. Every skill ref must resolve to active Skill current state.

Use the low-level update shape to fix runnable-agent issues after registration. If a no-tool chat smoke test returns a proxy timeout, first verify/update `category: "fabric"` and a known-good `model_config` before investigating tool behavior.

To mark a low-level agent as a sandbox agent, add `agent_config.runtime.sandbox`. If this object is absent, the agent is treated as a normal non-sandbox agent.

```json
{
  "agent_config": {
    "temperature": 0.2,
    "max_turns": 100,
    "timeout": 1800,
    "runtime": {
      "sandbox": {
        "template_id": "tpl-custom",
        "wait_ready": true,
        "preview_port": 3000,
        "workspace_root": "/agent-workspace",
        "ready_timeout_seconds": 240
      }
    }
  }
}
```

`runtime.sandbox` is a type marker. Do not use `runtime.sandbox.enabled`; sandbox behavior is selected by the presence of the object.

## Chat Payloads

`chat run` builds a `ChatCompletionRequest`:

```json
{
  "agent_id": "agent_name:v1",
  "agent_config": {},
  "messages": [{"role": "user", "content": "hello"}],
  "stream": true,
  "metadata": {}
}
```

- Positional `<agent-id>` sets `agent_id`.
- `--agent-config-file` sets `agent_config` and allows running with inline runtime config instead of an agent id.
- `--no-stream` sets `stream: false`; otherwise streaming is enabled.
- `--ws` keeps streaming enabled and uses `GET /v1/chat/completions/ws`; the CLI sends the `ChatCompletionRequest` JSON as the first WebSocket message.
- `chat stream --ws <chat-id>` uses `GET /v1/chats/{chat-id}/ws?after_seq=...` to replay an existing run over WebSocket.
- API key from CLI config is also injected by gateway into chat metadata when present.
- For sandbox agents, chat streams can include `chat.sandbox.creating`, `chat.sandbox.ready`, and `chat.sandbox.failed`. The `sandbox_run_id` / `game_run_id` from those events is the run id for `/v1/game/runs/{runID}` APIs.

## Verification

After mutations, verify with:

```bash
seaagent tool find --provider <provider> --status active
seaagent tool resolve <tool-id-or-key>
seaagent skill list --provider <provider> --status active
seaagent agent list --search <agent_name>
seaagent agent capabilities <agent-id-or-key>
seaagent chat run --no-stream <agent-id-or-key> "请用一句话说明你能做什么，不要调用任何工具。"
seaagent chat run <agent-id-or-key> "Test message"
seaagent chat run --ws <agent-id-or-key> "Test message"
```
