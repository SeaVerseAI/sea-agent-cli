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
- `skill update <id> -f file` -> `PUT /v1/skills/{id}`
- `agent update <id> -f file` -> `PUT /v1/agents/{id}`
- `hook update <id> -f file` -> `PUT /v1/hooks/{id}`
- `hook delete <id>` -> `DELETE /v1/hooks/{id}`

Discovery and runtime endpoints:

- `catalog list` -> `GET /v1/catalog`
- `tool list/get/resolve` -> `GET /v1/tools`, `GET /v1/tools/{id}`, `GET /v1/tools/{id}/resolve`
- `skill list/get` -> `GET /v1/skills`, `GET /v1/skills/{id}`
- `agent list/get/capabilities` -> `GET /v1/agents`, `GET /v1/agents/{id}`, `GET /v1/agents/{id}/capabilities`
- `hook list/get` -> `GET /v1/hooks`, `GET /v1/hooks/{id}`
- `chat run/get/events/stream/cancel` -> `/v1/chat/completions`, `/v1/chats/...`
- `sandbox create/get/events/stream/logs/files/read/archive/command/refresh/resume/delete` -> `/v1/sandbox/runs/...`
- `game ...` -> legacy equivalents on `/v1/game/runs/...`

## Payload Shape Switching

`/register` is the only public creation endpoint, but it accepts concise register payloads and lower-level current-state payloads.

Tool register switching:

- Concise register shape if `openai_schema` is absent.
- Low-level `ToolCreateRequest` shape if `openai_schema` is present.
- Do not send removed `tool_key` fields; agent-gateway returns an immutable UUID `id`.

Tool update switching:

- Concise register update shape if none of these fields are present: `metadata`, `openai_schema`, `runtime_type`.
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
- Skill resource id: gateway-generated UUID.
- Skill registry refs use the gateway UUID. `skills.manifest` no longer stores duplicate `id`, `name`, `provider`, or display fields.
- Agent resource id: gateway-generated UUID.
- Names should be stable `snake_case`.
- Registry identity is always the gateway UUID. Do not send removed `tool_key`, `skill_key`, `agent_key`, or request-owned `version` fields; keep `provider` and `name` canonical for display/runtime metadata. Do not keep recovery/import suffixes such as `_restored`, `_backup`, `_copy`, timestamps, or random migration markers in `id` or `name`.

Statuses:

- Capability status: `draft`, `active`, `deprecated`, `disabled`, `deleted`.
- Concise register payloads create active capabilities by default. `enabled` is kept only for payload compatibility and no longer turns registration into draft.
- Tool and Skill `public` is a legacy compatibility field while gateway schema slimming is in progress. Prefer omitting it in new payloads when the target gateway accepts the slim shape.

List pagination:

- `limit` defaults to `20` when omitted or `<= 0`; values `> 200` are capped to `200`.
- `offset` defaults to `0` when omitted or negative.
- `catalog list` also caps the internal fetch window at `200`, then applies the normalized page size.

Resource and runtime enums:

- Agent `category`: `fabric`, `seaactor`. This is a gateway Scheduler resource class, not a display category.
- Skill `metadata` is reserved by the gateway and stored as `{}`; do not put migration notes, display data, or runtime config in `skills.metadata`.
- Tool `runtime_type`: `http`, `builtin`, `mcp`. Concise payloads still accept old `transport` compatibility values and convert them into `runtime_type`.
- Worker tool `name` comes only from the outer Tool `name`. The gateway keeps provider-like prefixes such as `seaart:create_polishing`, but removes trailing version suffixes such as `:v1`. Do not put duplicate names in `metadata.name` or `openai_schema.function.name`.
- HTTP tools keep `endpoint`, `method`, response, and polling config in runtime metadata and forward them to Agent Worker as top-level ToolSpec fields; default method is `POST`.
- Tool `response_mode`: `json`, `sse`.

JSON object fields must contain valid objects when present. Use `{}` for empty `metadata`, `config`, or `model` values, and `[]` for empty arrays.

Do not put real secrets in payloads.

Schema-slimming guidance:

- Do not add removed or display-only Agent fields to gateway payloads: `display_name`, `description`, `tags`, `permissions`, and `public`.
- Agent `category` must stay in gateway because it drives resource scheduling.
- Do not add removed `tool_key`, `skill_key`, or `agent_key` fields to register payloads.
- Prefer `provider` over owner-like fields for Tool and Skill identity. `owner_id` is being removed from Tool and Skill flows.
- Avoid Tool metadata that only serves catalog display in gateway payloads: `slug`, `category`, `description`, `tags`, and `checksum`.
- Do not send Tool metadata fields that duplicate outer/current-state data or are not forwarded to Worker: `type`, `name`, `function`, `timeout_ms`, `response_content_type`, `request_headers`, `schema_contract`. Use outer `runtime_type`, not `metadata.type`.
- Do not send Skill or Agent metadata in gateway payloads; the gateway stores both as `{}`. Keep Skill runtime config in `manifest.config`, Agent runtime config in `config`/`agent_config`, and display data in server/catalog layers.
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
  "runtime_type": "http",
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
  "config": {},
  "public": false,
  "enabled": true
}
```

Rules:

- `name` and `description` are required.
- Tool register and update require a production-line API key. OpenResty checks Redis `flag == 1` and forwards `X-Flag`; agent-gateway rejects Tool writes unless `X-Flag: 1`.
- `provider` defaults to `internal`; the gateway assigns response `version` starting at `v1`.
- The gateway may normalize `provider` to an internal provider UUID; use the returned provider value for later `--provider` filters.
- `runtime_type` defaults to `http` when `endpoint` is present, otherwise to `builtin`; `method` defaults to `POST` and is forwarded to Agent Worker.
- Timeout defaults to `10000` ms. Concise input still accepts `config.timeout_ms` or `config.timeout` for compatibility, converts it to the outer `timeout_ms`, and removes it from stored metadata.
- `response_mode` defaults to `json`; allowed values are `json` and `sse`.
- `poll_interval` and `poll_timeout` are seconds. Use positive values only; omit polling fields for synchronous tools and non-HTTP tools.
- HTTP runtime fields are stored in `tools.metadata` and forwarded into runtime `agent.tools[]`; `endpoint` may be provided in register/update payloads, is stored as `metadata.endpoint`, and is sent to Worker as top-level `endpoint`.
- `name` is the Worker tool name; keep provider-like prefixes when they are part of the worker name, but do not include a trailing version suffix such as `:v1`. `parameters` becomes `openai_schema.function.parameters`; `openai_schema.function.name` is omitted.
- `runtime_type: "http"` tools must provide `endpoint`.
- `runtime_type: "builtin"` does not need runtime metadata. Keep `config` empty unless compatibility with an older gateway requires it; do not put duplicate `type`, `name`, `function`, or polling fields there.
- `runtime_type: "mcp"` creates MCP metadata and does not require `endpoint`. Put MCP metadata in `config`.
- Do not send removed `tool_key` fields on `/v1/tools/register`.
- Do not send `slug`, `category`, `tags`, `checksum`, or `owner_id` in new Tool payloads.

Builtin example:

```json
{
  "provider": "seaart",
  "name": "generate_image",
  "runtime_type": "builtin",
  "description": "SeaArt image generation.",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt": {"type": "string", "description": "Image prompt."}
    },
    "required": ["prompt"]
  },
  "config": {},
  "enabled": true
}
```

## Tool Low-Level Current State

Use with `tool register` to create if the payload includes low-level trigger fields, or with `tool update`. Do not include removed `tool_key` fields.

```json
{
  "provider": "provider",
  "name": "tool_name",
  "openai_schema": {
    "type": "function",
    "function": {
      "description": "What the tool does.",
      "parameters": {"type": "object", "properties": {}, "required": []}
    }
  },
  "runtime_type": "http",
  "method": "POST",
  "response_mode": "json",
  "timeout_ms": 10000,
  "public": false,
  "status": "active",
  "metadata": {
    "endpoint": "https://tool.example.com/invoke"
  }
}
```

The outer Tool `name` is the stable Worker tool name. Low-level `status` accepts `draft`, `active`, `deprecated`, `disabled`, or `deleted`; use `active` for tools that agents may bind.

## Skill Concise Register

Use with:

```bash
seaagent skill register -f <payload.json>
```

Also usable with `skill update <id> -f file` if the payload does not include low-level trigger fields.

```json
{
  "name": "skill_name",
  "description": "What the skill helps with.",
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
  "public": false,
  "enabled": true
}
```

Rules:

- `name`, `description`, and `instruction` are required.
- `provider` defaults to `internal`; gateway returns a UUID `id`.
- The gateway may normalize `provider` to an internal provider UUID; use the returned provider value for later `--provider` filters.
- The gateway builds current `skills.manifest` only from `instruction`, `config`, `required_tools`, and `optional_tools`.
- Do not send manifest/display fields that duplicate outer Skill data or server-owned display data: `id`, `name`, `version`, `display_name`, `description`, `category`, `provider`, `tags`, and `triggers`.
- `required_tools` and `optional_tools` must be arrays when present.
- A string tool ref becomes `{ "type": "http", "ref": "<value>" }`.
- Object refs use `{"type":"builtin|http|http_batch|mcp","ref":"...","server":"..."}`. `server` is required for `type: "mcp"`.
- Do not send removed `skill_key` fields on `/v1/skills/register`.
- Do not send `slug`, `entry_file`, `dependencies`, `bundle_uri`, `checksum`, or `owner_id` in new Skill payloads.

Tool refs should match the gateway resolver:

- Use registered Tool UUIDs for `http`, `http_batch`, and registered `builtin` refs.
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
    "required_tools": [],
    "optional_tools": [],
    "instruction": "Detailed operating instructions for the agent.",
    "config": {}
  },
  "public": false,
  "status": "active"
}
```

Create and update use outer Skill fields for identity and display. `manifest.instruction` must be non-empty. Skill metadata is stored as `{}`. Low-level `status` accepts `draft`, `active`, `deprecated`, `disabled`, or `deleted`.

## Agent Concise Register

Use with:

```bash
seaagent agent register -f <payload.json>
```

```json
{
  "name": "agent_name",
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
  "owner_id": "internal"
}
```

Rules:

- `name`, `category`, and `owner_id` are required after defaults on current gateway deployments.
- `category` is required because it maps gateway runs to Scheduler resource pools. Allowed values are `fabric` and `seaactor`; use `fabric` for standard runnable agents and `seaactor` only when that scheduler class is explicitly required.
- `owner_id` defaults to `internal`; gateway returns a UUID `id` and response `version` starting at `v1`.
- Do not send removed `agent_key` fields for new concise agent registrations. Reject or normalize names like `react_game_generator_agent_013919`; use canonical `name: "react_game_generator_agent"` plus an intentional `owner_id`.
- `model` and `config` default to `{}`. Agent `metadata` is ignored and stored as `{}`; use `config` for runtime settings.
- Gateway normalizes `model.default` and `model.allowed` by removing provider or routing prefixes before storage. For example, `vertex_ai/gemini-3-flash-preview`, `openai/gpt-4o`, and `gpt/gpt-4.1-mini` are stored as `gemini-3-flash-preview`, `gpt-4o`, and `gpt-4.1-mini`.
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
  "skills": ["11111111-1111-4111-8111-111111111111"]
}
```

Agent `metadata` is stored as `{}`. Every skill ref must resolve to active Skill current state. Low-level `status` accepts `draft`, `active`, `deprecated`, `disabled`, or `deleted`; an Agent must be `active` to run through chat. `category` must remain `fabric` or `seaactor`.

Gateway normalizes `model_config.default` and `model_config.allowed` by removing provider or routing prefixes before storage. For example, `vertex_ai/gemini-3-flash-preview`, `openai/gpt-4o`, and `gpt/gpt-4.1-mini` are stored as `gemini-3-flash-preview`, `gpt-4o`, and `gpt-4.1-mini`.

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
- `--no-stream` sets `stream: false`; when stored events are available, CLI enriches the JSON response with `response.message.content`.
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
seaagent agent get <agent-id>
seaagent agent capabilities <agent-id>
seaagent chat run --no-stream <agent-id> "请用一句话说明你能做什么，不要调用任何工具。"
seaagent chat run <agent-id> "Test message"
seaagent chat run --ws <agent-id> "Test message"
```
