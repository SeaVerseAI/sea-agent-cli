# Capability Formats

These formats come from `~/Desktop/sea_art/agent-gateway` models and services. `seaagent` passes files through to the gateway; it does not reshape payloads beyond JSON/YAML parsing.

## Current API Shape

The gateway now keeps Tool and Skill as single current-state records, like Agent. There are no public version create, publish, or lifecycle endpoints.

Create/register uses only `/register`:

- `tool register` -> `POST /v1/tools/register`
- `skill register` -> `POST /v1/skills/register`
- `agent register` -> `POST /v1/agents/register`
- `hook register` -> `POST /v1/hooks/register`

Maintenance endpoints:

- `tool update <id> -f file` -> `PUT /v1/tools/{id}`
- `tool delete <id>` -> `DELETE /v1/tools/{id}`
- `skill update <id> -f file` -> `PUT /v1/skills/{id}`
- `skill delete <id>` -> `DELETE /v1/skills/{id}`
- `agent update <id> -f file` -> `PUT /v1/agents/{id}`
- `agent delete <id>` -> `DELETE /v1/agents/{id}`
- `hook update <id> -f file` -> `PUT /v1/hooks/{id}`
- `hook delete <id>` -> `DELETE /v1/hooks/{id}`

Discovery and runtime endpoints:

- `catalog list` -> `GET /v1/catalog`
- `tool list/get/resolve` -> `GET /v1/tools`, `GET /v1/tools/{id}`, `GET /v1/tools/{id}/resolve`
- `skill list/get` -> `GET /v1/skills`, `GET /v1/skills/{id}`
- `agent list/capabilities` -> `GET /v1/agents`, `GET /v1/agents/{id}/capabilities`
- `hook list/get` -> `GET /v1/hooks`, `GET /v1/hooks/{id}`
- `chat run/get/events/stream/cancel` -> `/v1/chat/completions`, `/v1/chats/...`
- `sandbox create/get/events/stream/logs/files/read/archive/command/refresh/resume/delete` -> `/v1/sandbox/runs/...`
- `game ...` -> legacy equivalents on `/v1/game/runs/...`

## Payload Shape Switching

`/register` is the only public creation endpoint, but it accepts concise register payloads and lower-level current-state payloads.

Tool register switching:

- Concise register shape if none of these fields are present: `openai_schema`, `runtime_id`.
- Low-level `ToolCreateRequest` shape if `openai_schema` or `runtime_id` is present.
- Do not send removed `tool_key` fields; agent-gateway returns an immutable UUID `id`.

Tool update switching:

- Concise register update shape if none of these fields are present: `metadata`, `openai_schema`, `runtime_id`.
- Low-level `ToolUpdateRequest` shape if any of those fields is present.

Skill register switching:

- Concise register shape if `manifest` is absent.
- Low-level `SkillCreateRequest` shape if `manifest` is present.
- Do not send removed `skill_key` fields; agent-gateway returns an immutable UUID `id`.

Skill update switching:

- Concise register update shape if `manifest` is absent.
- Low-level `SkillUpdateRequest` shape if `manifest` is present.

Agent register switching:

- Concise register shape if none of these fields are present: `model_config`, `agent_config`.
- Low-level `AgentCreateRequest` shape if `model_config` or `agent_config` is present.
- Do not send removed `agent_key` fields; agent-gateway returns an immutable UUID `id`.
- `agent update` always uses low-level `AgentUpdateRequest`.

## Common Values

Stable identifiers:

- Tool resource id: gateway-generated UUID.
- Tool runtime id: normally `provider:name:version`; builtin tools may still use a stable alias such as `seaart:generate_image`.
- Skill resource id: gateway-generated UUID.
- Skill registry refs and Skill manifest `id` use the gateway UUID; user-provided manifest IDs are overwritten on persistence.
- Agent resource id: gateway-generated UUID.
- Names should be stable `snake_case`.
- Registry identity is always the gateway UUID. Do not send removed `tool_key`, `skill_key`, or `agent_key` fields; keep `provider`, `name`, and `version` canonical for display/runtime metadata. Do not keep recovery/import suffixes such as `_restored`, `_backup`, `_copy`, timestamps, or random migration markers in `id` or `name`.

Statuses:

- Capability status: `draft`, `active`, `deprecated`, `disabled`, `deleted`.
- Concise register payloads create active capabilities by default. `enabled` is kept only for payload compatibility and no longer turns registration into draft.
- Tool and Skill `public` is a legacy compatibility field while gateway schema slimming is in progress. Prefer omitting it in new payloads when the target gateway accepts the slim shape.

List pagination:

- `limit` defaults to `20` when omitted, `<= 0`, or `> 100`.
- `offset` defaults to `0` when omitted or negative.
- `catalog list` also caps the internal fetch window at `200`, then applies the normalized page size.

Resource and runtime enums:

- Agent `category`: `fabric`, `seaactor`. This is a gateway Scheduler resource class, not a display category.
- Skill `metadata` is reserved by the gateway and stored as `{}`; do not put migration notes, display data, or runtime config in `skills.metadata`.
- Tool `execution_mode`: `local`, `remote`.
- Tool `transport`: `http`, `grpc`, `queue`, `custom`. Concise payloads also accept compatibility values `builtin` and `mcp`, which are adapted into runtime metadata.
- Tool `response_mode`: `json`, `sse`.
- Tool `auth.type` / low-level `auth_type`: `none`, `api_key`, `bearer`, `oauth2`, `custom`.

JSON object fields must contain valid objects when present. Use `{}` for empty `metadata`, `config`, `auth`, or `model` values, and `[]` for empty arrays.

Do not put real secrets in payloads. For auth, use a reference such as:

```json
{"type": "bearer", "config_ref": "secret://tool/demo"}
```

Schema-slimming guidance:

- Do not add removed or display-only Agent fields to gateway payloads: `display_name`, `description`, `tags`, `permissions`, and `public`.
- Agent `category` must stay in gateway because it drives resource scheduling.
- Do not add removed `tool_key`, `skill_key`, or `agent_key` fields to register payloads.
- Prefer `provider` over owner-like fields for Tool and Skill identity. `owner_id` is being removed from Tool and Skill flows.
- Avoid Tool metadata that only serves catalog display in gateway payloads: `slug`, `category`, `description`, `tags`, and `checksum`.
- Do not send Skill metadata in gateway payloads; the gateway stores `skills.metadata` as `{}`. Keep runtime config in `manifest.config` and display data in server/catalog layers.
- If a deployed gateway still requires an old field, keep it only in a compatibility payload and do not rely on it in Agent Worker runtime behavior.

## Tool Concise Register

Use with:

```bash
seaagent tool register -f <payload.json>
```

Also usable with `tool update <id> -f file` if the payload does not include low-level trigger fields.

```json
{
  "provider": "provider",
  "name": "tool_name",
  "version": "v1",
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
  "public": false,
  "enabled": true,
  "created_by": "provider",
  "updated_by": "provider"
}
```

Rules:

- `name` and `description` are required.
- `provider` defaults to `internal`; `version` defaults to `v1`.
- Gateway generates concise-register `runtime_id` from canonical `provider:name:version` when `id` is not supplied.
- `method` defaults to `POST`; use normal HTTP verbs such as `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` for HTTP tools.
- Timeout defaults to `10000` ms. `config.timeout_ms` is milliseconds; `config.timeout` below `10000` is treated as seconds.
- `response_mode` defaults to `json`; allowed values are `json` and `sse`.
- `poll_interval` and `poll_timeout` are seconds. Use positive values only; omit polling fields for synchronous tools.
- Polling fields are stored in `tools.metadata` and forwarded into runtime `agent.tools[]`.
- `parameters` becomes `openai_schema.function.parameters`.
- Remote tools use `transport` `http`, `grpc`, `queue`, or `custom` and must provide `endpoint`.
- `transport: "builtin"` creates local embedded current-state tool metadata. Put `{"type":"builtin","name":"provider:tool_name","function":"provider.tool_name"}` in `config`.
- `transport: "mcp"` creates remote custom MCP metadata and does not require `endpoint`. Put MCP metadata in `config`.
- Do not send removed `tool_key` fields on `/v1/tools/register`.
- Do not send `slug`, `category`, `tags`, `checksum`, or `owner_id` in new Tool payloads.

Builtin example:

```json
{
  "id": "seaart:generate_image",
  "provider": "seaart",
  "name": "generate_image",
  "version": "v1",
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
  "enabled": true,
  "created_by": "seaart"
}
```

## Tool Low-Level Current State

Use with `tool register` to create if the payload includes low-level trigger fields, or with `tool update`. Do not include removed `tool_key` fields.

```json
{
  "provider": "provider",
  "name": "tool_name",
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
  "changelog": "Current config.",
  "public": false,
  "status": "active",
  "metadata": {},
  "created_by": "provider",
  "updated_by": "provider"
}
```

Create requires `created_by`; update requires `updated_by`. The OpenAI function name must stay stable when updating the same tool. Low-level `status` accepts `draft`, `active`, `deprecated`, `disabled`, or `deleted`; use `active` for tools that agents may bind.

## Skill Concise Register

Use with:

```bash
seaagent skill register -f <payload.json>
```

Also usable with `skill update <id> -f file` if the payload does not include low-level trigger fields.

```json
{
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
  "public": false,
  "enabled": true
}
```

Rules:

- `name`, `description`, and `instruction` are required.
- `version` defaults to `v1`; `provider` defaults to `internal`; `display_name` defaults to `name`; `category` defaults to `general`; gateway returns a UUID `id` from `provider:name:version`.
- The gateway builds current `skills.manifest` from this payload.
- `display_name`, `category`, `tags`, and `public` are compatibility/display fields. Prefer omitting them in new slim payloads when the target gateway supports it; store display metadata in server instead.
- `required_tools` and `optional_tools` must be arrays when present.
- A string tool ref becomes `{ "type": "http", "ref": "<value>" }`.
- Object refs use `{"type":"builtin|http|http_batch|mcp","ref":"...","server":"..."}`. `server` is required for `type: "mcp"`.
- Do not send removed `skill_key` fields on `/v1/skills/register`.
- Do not send `slug`, `entry_file`, `dependencies`, `bundle_uri`, `checksum`, or `owner_id` in new Skill payloads.

Tool refs should match the gateway resolver:

- Prefer the exact tool `runtime_id` from `seaagent tool resolve <tool-id>`.
- Current resolver accepts registered Tool UUIDs for `http`, `http_batch`, and registered `builtin` refs.
- Builtin tools may intentionally use stable aliases such as `seaart:generate_image`.
- For SeaArt builtin media tools registered in the gateway, use the active Tool UUID in skill manifests. Runtime-local `builtin` refs can still use their builtin identifier when no registry Tool is required.

## Skill Low-Level Current State

Use with `skill register` to create if the payload includes low-level trigger fields, or with `skill update`. Do not include removed `skill_key` fields.

```json
{
  "name": "skill_name",
  "provider": "provider",
  "description": "What the skill helps with.",
  "manifest": {
    "id": "11111111-1111-4111-8111-111111111111",
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
  "public": false,
  "status": "active"
}
```

Create and update use the provider bound by the gateway request identity. `manifest.name` and `manifest.instruction` must be non-empty. Skill metadata is stored as `{}`. Low-level `status` accepts `draft`, `active`, `deprecated`, `disabled`, or `deleted`.

## Agent Concise Register

Use with:

```bash
seaagent agent register -f <payload.json>
```

```json
{
  "name": "agent_name",
  "version": "v1",
  "category": "fabric",
  "model": {
    "default": "gpt-5.1-chat",
    "allowed": ["gpt-5.1-chat", "gpt-4.1-mini", "gpt-4o"]
  },
  "system_prompt": "Base system prompt.",
  "skills": ["11111111-1111-4111-8111-111111111111"],
  "config": {
    "temperature": 0.2,
    "max_turns": 20,
    "timeout": 600
  },
  "enabled": true,
  "owner_id": "internal",
  "created_by": "internal"
}
```

Rules:

- `name`, `category`, `owner_id`, and `created_by` are required after defaults on current gateway deployments.
- `category` is required because it maps gateway runs to Scheduler resource pools. Allowed values are `fabric` and `seaactor`; use `fabric` for standard runnable agents and `seaactor` only when that scheduler class is explicitly required.
- `version` defaults to `v1`; `owner_id` defaults to `internal`; gateway returns a UUID `id`.
- Do not send removed `agent_key` fields for new concise agent registrations. Reject or normalize names like `react_game_generator_agent_013919`; use canonical `name: "react_game_generator_agent"` plus an intentional `owner_id` and `version`.
- `model` and `config` default to `{}`.
- `skills` must contain non-empty Skill UUIDs and every referenced skill must resolve to active Skill current state visible to the agent owner. Private Skill refs owned by another production line are rejected.
- Agent register creates an active agent by default. `enabled` is kept only for payload compatibility.
- To mark a registered agent as a sandbox agent, add `config.runtime.sandbox`. The presence of `sandbox` is the type marker; do not add `enabled`.
- For sandbox agents, set `config.runtime.sandbox.sandbox_template` to `react-game` or `react-web`.
- Do not send Agent `display_name`, `description`, `tags`, `permissions`, or `public`; those are removed or server-owned display fields after slimming.

Sandbox concise-register config example:

```json
{
  "temperature": 0.2,
  "max_turns": 100,
  "timeout": 1800,
  "runtime": {
    "sandbox": {
      "sandbox_template": "react-game"
    }
  }
}
```

## Agent Low-Level Current State

Use with `agent register` to create if the payload includes low-level trigger fields, or with `agent update`. Do not include removed `agent_key` fields.

```json
{
  "category": "fabric",
  "name": "agent_name",
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
  "skills": ["11111111-1111-4111-8111-111111111111"],
  "created_by": "internal",
  "updated_by": "internal"
}
```

Create requires `created_by`; update requires `updated_by`. Every skill ref must resolve to active Skill current state. Low-level `status` accepts `draft`, `active`, `deprecated`, `disabled`, or `deleted`; an Agent must be `active` to run through chat. `category` must remain `fabric` or `seaactor`.

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
        "sandbox_template": "react-game",
        "wait_ready": true,
        "preview_port": 3000,
        "workspace_root": "/agent-workspace",
        "ready_timeout_seconds": 240
      }
    }
  }
}
```

`runtime.sandbox` is a type marker. Do not use `runtime.sandbox.enabled`; sandbox behavior is selected by the presence of the object. Allowed `runtime.sandbox.sandbox_template` values are `react-game` and `react-web`.

## Hook Register

Hook commands use the CLI configured API key as `Authorization: Bearer <api-key>`. Payload files do not include `api_key`; the gateway stores only a hash of the header key and limits hook management to that key.

Use with:

```bash
seaagent hook register -f <payload.json>
seaagent hook update <hook-id> -f <payload.json>
```

```json
{
  "name": "production-line-hook",
  "endpoint": "https://example.com/agent-hook",
  "description": "Receives Agent Worker events for the configured API key.",
  "metadata": {}
}
```

Rules:

- `name` and `endpoint` are required.
- `endpoint` must be an absolute `http` or `https` URL.
- Hook calls use fixed `POST`; do not include `method`.
- All events are sent to the hook endpoint; the hook service filters by payload `event_id`.
- Do not put API keys or secrets in the payload.

## Chat Payloads

`chat run` builds a `ChatCompletionRequest`:

```json
{
  "agent_id": "owner_id:agent_name:v1",
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
- For sandbox agents, chat streams can include `chat.sandbox.creating`, `chat.sandbox.ready`, and `chat.sandbox.failed`. The `sandbox_run_id` / `game_run_id` from those events is the run id for `/v1/sandbox/runs/{runID}` APIs; `/v1/game/runs/{runID}` remains a legacy route.

## Verification

After mutations, verify with:

```bash
seaagent tool find --provider <provider> --status active
seaagent tool resolve <tool-id>
seaagent skill list --provider <provider> --status active
seaagent agent list --search <agent_name>
seaagent agent capabilities <agent-id>
seaagent chat run --no-stream <agent-id> "请用一句话说明你能做什么，不要调用任何工具。"
seaagent chat run <agent-id> "Test message"
seaagent chat run --ws <agent-id> "Test message"
```
