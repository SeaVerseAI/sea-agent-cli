# Capability Formats

These formats come from `~/Desktop/sea_art/agent-gateway` models and services. `agentctl` passes files through to the gateway; it does not reshape payloads beyond JSON/YAML parsing.

## Which Format To Use

Prefer concise register payloads for normal agent work:

- `node dist/index.js tool register -f file.json` -> `ToolRegisterRequest`
- `node dist/index.js skill register -f file.json` -> `SkillRegisterRequest`
- `node dist/index.js agent register -f file.json` -> `AgentRegisterRequest`

Use lower-level create payloads when the user needs full registry control:

- `node dist/index.js tool create -f file.json` -> `ToolCreateRequest`
- `node dist/index.js agent create -f file.json` -> `AgentCreateRequest`

The current `agentctl` CLI does not expose `skill create`, version create, publish, lifecycle, update, or delete commands even though `agent-gateway` has HTTP handlers for some of them.

## Common Values

Stable identifiers:

- Tool runtime id: normally `provider:name:version`; builtin tools often use a stable alias such as `seaart:generate_image`.
- Tool key created by `tool register`: `provider:name`.
- Skill id: normally `name:version`.
- Agent id/key: normally `name:version`.
- Names should be stable `snake_case`.

Statuses:

- Capability status: `draft`, `active`, `deprecated`, `disabled`, `deleted`.
- Version lifecycle: `draft`, `active`, `deprecated`, `disabled`.
- In register payloads, `enabled: true` creates active capability and active default version. `enabled: false` or omitted creates draft records.

JSON object fields must contain valid objects when present. Use `{}` for empty `metadata`, `config`, `permissions`, `auth`, or `model` values, and `[]` for empty arrays.

Do not put real secrets in payloads. For auth, use a reference such as:

```json
{"type": "bearer", "config_ref": "secret://tool/demo"}
```

## Tool Register

Use with:

```bash
node dist/index.js tool register -f <payload.json>
```

Fields:

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
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  },
  "auth": {"type": "none"},
  "config": {"timeout_ms": 10000},
  "tags": [],
  "enabled": false,
  "owner_id": "provider",
  "created_by": "provider"
}
```

Important rules:

- `name` and `description` are required.
- `provider` defaults to `internal`; `version` defaults to `v1`; `category` defaults to `general`.
- `id` defaults to `provider:name:version`.
- `method` defaults to `POST`; timeout defaults to `10000` ms. If `config.timeout` is less than `10000`, it is treated as seconds and multiplied by `1000`; `config.timeout_ms` is already milliseconds.
- `parameters` becomes `openai_schema.function.parameters`, so it must be a JSON Schema object.
- Normal remote tools use `transport` `http`, `grpc`, `queue`, or `custom` and must provide `endpoint`.
- `transport: "builtin"` creates a local embedded custom tool. Put `{"type":"builtin","name":"provider:tool_name","function":"provider.tool_name"}` in `config`.
- `transport: "mcp"` creates a remote custom MCP tool and does not require `endpoint`. Put MCP metadata in `config`.

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

## Tool Create

Use with:

```bash
node dist/index.js tool create -f <payload.json>
```

Fields:

```json
{
  "tool_key": "provider:tool_name",
  "provider": "provider",
  "name": "tool_name",
  "slug": "tool_name",
  "category": "general",
  "description": "What the tool does.",
  "source_kind": "external",
  "owner_id": "provider",
  "status": "draft",
  "metadata": {},
  "tags": [],
  "created_by": "provider",
  "initial_version": {
    "version": "v1",
    "runtime_id": "provider:tool_name:v1",
    "is_default": true,
    "lifecycle_status": "draft",
    "openai_schema": {
      "type": "function",
      "function": {
        "name": "tool_name",
        "description": "What the tool does.",
        "parameters": {"type": "object", "properties": {}}
      }
    },
    "execution_mode": "remote",
    "transport": "http",
    "method": "POST",
    "endpoint": "https://tool.example.com/invoke",
    "auth_type": "none",
    "auth_config_ref": "",
    "auth_config": {},
    "timeout_ms": 10000,
    "metadata": {},
    "checksum": "provider:tool_name:v1",
    "changelog": "Initial version.",
    "created_by": "provider"
  }
}
```

Required after defaults: `tool_key`, `provider`, `name`, `slug`, `category`, `description`, valid `source_kind`, `owner_id`, valid `status`, `metadata`, and `created_by`. If `initial_version` is present it also needs `version`, `created_by`, valid lifecycle, valid execution mode, valid transport, valid auth type, valid OpenAI tool schema, valid `metadata`, valid `auth_config`, and non-empty `checksum`.

Within the same tool, `openai_schema.function.name` must remain stable across versions.

## Skill Register

Use with:

```bash
node dist/index.js skill register -f <payload.json>
```

Fields:

```json
{
  "id": "skill_name:v1",
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
  "enabled": false,
  "owner_id": "provider",
  "created_by": "provider"
}
```

Important rules:

- `name`, `description`, and `instruction` are required.
- `version` defaults to `v1`; `provider` defaults to `internal`; `display_name` defaults to `name`; `category` defaults to `general`; `id` defaults to `name:version`.
- `instruction` should include scope, input expectations, tool-use strategy, output format, error handling, and limits.
- `config` is only recommended runtime configuration; Agent explicit config can override it.
- `required_tools` and `optional_tools` must be arrays when present.
- A string tool ref is treated as `{ "type": "http", "ref": "<value>" }`.
- Object refs use `{"type":"http|builtin|mcp","ref":"...","server":"..."}`. `server` is required for `type: "mcp"`.

Tool ref examples:

```json
{
  "required_tools": [
    "web-tools-mcp:web_fetch:v1",
    {"type": "builtin", "ref": "seaart:generate_image"},
    {"type": "mcp", "ref": "filesystem:read_file", "server": "mcp-filesystem"}
  ],
  "optional_tools": []
}
```

## Skill Create

`agent-gateway` supports `POST /v1/skills`, but current `agentctl` has no `skill create` command. Use direct HTTP only if the user explicitly asks.

Fields:

```json
{
  "skill_key": "skill_name",
  "display_name": "Skill Name",
  "name": "skill_name",
  "slug": "skill_name",
  "provider": "provider",
  "category": "general",
  "description": "What the skill helps with.",
  "source_kind": "external",
  "owner_id": "provider",
  "status": "draft",
  "metadata": {},
  "tags": [],
  "created_by": "provider",
  "initial_version": {
    "version": "v1",
    "is_default": true,
    "lifecycle_status": "draft",
    "bundle_uri": "",
    "manifest": {
      "id": "skill_name:v1",
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
    "metadata": {},
    "checksum": "skill_name:v1",
    "changelog": "Initial version.",
    "created_by": "provider"
  }
}
```

Required after defaults: `skill_key`, `provider`, `name`, `slug`, `category`, `description`, valid `source_kind`, `owner_id`, valid `status`, valid `metadata`, and `created_by`. If `initial_version` is present it also needs `version`, valid lifecycle, valid JSON object `manifest`, JSON array `dependencies`, JSON object `metadata`, non-empty `checksum`, and a parseable manifest with non-empty `manifest.name` and `manifest.instruction`.

If `manifest.files`, `manifest.bundle_files`, or `manifest.bundle.files` are present, they must include `entry_file`. If no files are declared, non-empty `instruction` is enough.

## Agent Register

Use with:

```bash
node dist/index.js agent register -f <payload.json>
```

Fields:

```json
{
  "id": "agent_name:v1",
  "name": "agent_name",
  "version": "v1",
  "display_name": "Agent Name",
  "description": "What the agent does.",
  "category": "agent",
  "model": {
    "default": "gpt-4o",
    "allowed": ["gpt-4o"]
  },
  "system_prompt": "Base system prompt.",
  "skills": ["skill_name:v1"],
  "config": {
    "temperature": 0.2,
    "max_turns": 20,
    "timeout": 600
  },
  "permissions": {},
  "tags": [],
  "public": true,
  "enabled": false,
  "owner_id": "internal",
  "created_by": "internal"
}
```

Important rules:

- `name`, `description`, `category`, `owner_id`, and `created_by` are required after defaults.
- `version` defaults to `v1`; `id` defaults to `name:version`; `display_name` defaults to `name`; `owner_id` defaults to `internal`; `created_by` defaults to owner.
- `model`, `config`, and `permissions` default to `{}`.
- `skills` must contain non-empty refs and every referenced skill must resolve to active Skill metadata and an active Skill version. Create/register required skills first and use `enabled: true` if the agent should bind them immediately.
- `enabled: true` creates an active agent; omitted/false creates draft.

## Agent Create

Use with:

```bash
node dist/index.js agent create -f <payload.json>
```

Fields:

```json
{
  "agent_key": "agent_name:v1",
  "category": "agent",
  "display_name": "Agent Name",
  "name": "agent_name",
  "description": "What the agent does.",
  "owner_id": "internal",
  "status": "draft",
  "metadata": {},
  "model_config": {
    "default": "gpt-4o",
    "allowed": ["gpt-4o"]
  },
  "system_prompt": "Base system prompt.",
  "agent_config": {
    "temperature": 0.2,
    "max_turns": 20,
    "timeout": 600
  },
  "skills": ["skill_name:v1"],
  "permissions": {},
  "tags": [],
  "public": true,
  "created_by": "internal"
}
```

Required after defaults: `agent_key`, valid non-empty `category`, `name`, `description`, `owner_id`, `created_by`, valid `status`, valid object `metadata`, valid object `model_config`, valid object `agent_config`, valid object `permissions`, and non-empty skill refs.

Like `agent register`, every skill ref must resolve to active Skill metadata and active Skill version.

## Verification

After mutations, verify with:

```bash
node dist/index.js tool find --provider <provider> --status active
node dist/index.js tool resolve <tool-id-or-key>
node dist/index.js skill list --provider <provider> --status active
node dist/index.js agent list --search <agent_name>
node dist/index.js agent capabilities <agent-id-or-key>
node dist/index.js chat run <agent-id-or-key> "Test message"
```
