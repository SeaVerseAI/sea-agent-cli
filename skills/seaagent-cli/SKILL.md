---
name: seaagent-cli
description: "Use this skill when working with the local seaagent CLI for SeaArt agent-gateway: configuring endpoints and API keys, registering/updating/deleting tools, skills, and agents, listing catalog entries, resolving runtime configs, and running or inspecting chats."
---

# Seaagent CLI

## Scope

Use this skill when a task involves the local `seaagent` CLI project or the SeaArt `agent-gateway` CLI workflow. The CLI mirrors the current gateway HTTP API and is intended for registration, discovery, capability inspection, lifecycle maintenance, and chat testing.

Repositories:

- CLI: `~/Desktop/sea_art/agentctl`
- Gateway: `~/Desktop/sea_art/agent-gateway`

## First Checks

1. Work from `~/Desktop/sea_art/agentctl` unless the user points elsewhere.
2. Build after CLI code changes:
   ```bash
   npm run build
   ```
3. Prefer the built CLI for realistic behavior:
   ```bash
   seaagent --help
   ```
4. Inspect config before gateway operations:
   ```bash
   seaagent config get
   seaagent config path
   ```

## Configuration

`seaagent` stores config at `~/.seaagent/config.yaml`.

```bash
seaagent config set endpoint http://127.0.0.1:8080
seaagent config set api-key sa-xxxxxxxx
seaagent config get
```

The API key is sent as `Authorization: Bearer <api-key>`. Do not print or commit real API keys. `config get` masks stored API keys.

For request debugging:

```bash
SEAAGENT_DEBUG=1 seaagent ...
```

## Payload Files

Commands with `-f/--file` read JSON or YAML. JSON is parsed for every path except `.yaml` and `.yml`.

For payload fields, defaults, and examples, read [Capability Formats](references/capability-formats.md).
That reference is the source of truth for allowed enum values, pagination bounds, required fields, and fields that are deprecated by the gateway schema-slimming work.

Use the repo examples as starting points:

- `examples/tool-web-fetch.json`: tool register payload
- `examples/skill-web.json`: skill register payload
- `examples/agent-web.json`: agent register payload
- `examples/agent-sandbox.json`: low-level sandbox agent payload using `agent_config.runtime.sandbox`
- `examples/hook.json`: hook endpoint payload for the configured API key
- `examples/runtime-agent-config.json`: inline runtime chat config
- `examples/runtime-agent-sandbox-config.json`: inline runtime chat config that asks gateway to create a sandbox

Create task-specific payload files instead of editing shared examples unless the user asks to change examples.

For media-generation agents, also check the existing SeaArt tool registry before creating new capabilities:

```bash
seaagent tool list --search image --status active
seaagent tool list --search video --status active
seaagent tool list --search task --status active
seaagent skill list --search media --status active
```

Prefer reusing active tools by their immutable Tool UUID. In skill manifests, registered Tool refs must use Tool UUIDs; `builtin` and `mcp` refs may still use their runtime-local identifiers.

## Commands

Command argument conventions:

- `<tool-id>`, `<skill-id>`, and `<agent-id>` must be the immutable UUID returned by the gateway.
- `--status` accepts `draft`, `active`, `deprecated`, `disabled`, or `deleted`; use `active` for normal discovery.
- `--limit` is bounded by the gateway to `1..100`; values outside that range default to `20`.
- `--offset` must be `0` or greater; negative values are normalized to `0`.
- Tool/Skill `--public` and Skill `--source-kind` are legacy filters while schema slimming is in progress; avoid relying on them for new automation unless the target gateway still exposes those columns.
- Agent `category` is not a display taxonomy. It is the resource scheduling class used by gateway to map runs to Scheduler pools.

System:

```bash
seaagent system health
seaagent system metrics
```

Config:

```bash
seaagent config set endpoint <url>
seaagent config set api-key <key>
seaagent config get
seaagent config path
```

Catalog:

```bash
seaagent catalog list [--capability-type tool|skill] [--search <value>] [--status <value>] [--source-kind <value>] [--public true|false] [--provider <value>] [--limit <n>] [--offset <n>]
```

Tools:

```bash
seaagent tool register -f <payload.json|yaml>
seaagent tool list [--search <value>] [--status <value>] [--public true|false] [--provider <value>] [--limit <n>] [--offset <n>]
seaagent tool find [same filters as list]
seaagent tool get <tool-id>
seaagent tool update <tool-id> -f <payload.json|yaml>
seaagent tool delete <tool-id>
seaagent tool resolve <tool-id>
```

Use `tool resolve` before referencing a tool from a skill; it shows the runtime id and normalized execution metadata that Agent Worker will receive. Register/update payloads should describe runtime behavior, not server-side display metadata. Keep `description` focused on the OpenAI function behavior until gateway stops storing display descriptions.

Skills:

```bash
seaagent skill register -f <payload.json|yaml>
seaagent skill tool-register -f <payload.json|yaml>
seaagent skill list [--search <value>] [--status <value>] [--source-kind <value>] [--public true|false] [--provider <value>] [--limit <n>] [--offset <n>]
seaagent skill get <skill-id>
seaagent skill update <skill-id> -f <payload.json|yaml>
seaagent skill delete <skill-id>
```

Use `skill register` for agent-facing operating instructions and tool bindings. Keep display-only fields such as `display_name`, `category`, and `tags` out of new payloads where the target gateway accepts the slim shape; those fields belong in server/catalog metadata after the migration. `skill tool-register` is only a convenience alias for tool registration.

Agents:

```bash
seaagent agent register -f <payload.json|yaml>
seaagent agent list [--search <value>] [--status <value>] [--owner-id <value>] [--category <value>] [--limit <n>] [--offset <n>]
seaagent agent update <agent-id> -f <payload.json|yaml>
seaagent agent delete <agent-id>
seaagent agent capabilities <agent-id>
```

Use `agent capabilities` after any agent or skill mutation. Agent `category` must be `fabric` or `seaactor`; `fabric` maps to the normal Fabric scheduler pool and `seaactor` maps to the SeaActor pool. Do not add display-only agent metadata such as `display_name`, `description`, `tags`, `permissions`, or `public`; agent records are treated as public and those fields are removed or owned by server after slimming.

Agent resource IDs are immutable UUIDs generated by agent-gateway. Do not send `agent_key`; normalize recovery/import suffixes such as `_restored`, `_backup`, `_copy`, timestamps, or random migration markers into a clean `name` before registering.

Hooks:

```bash
seaagent hook register -f <payload.json|yaml>
seaagent hook list [--search <value>] [--limit <n>] [--offset <n>]
seaagent hook get <hook-id>
seaagent hook update <hook-id> -f <payload.json|yaml>
seaagent hook delete <hook-id>
```

Hook commands use the configured API key as `Authorization: Bearer <api-key>`. Hook payload files do not include `api_key`; the gateway stores only a hash of the header key. The worker receives the hook endpoint in `agent.hooks[]`, calls it with fixed `POST`, and sends all events so the hook service can filter by payload `event_id`.

Chat:

```bash
seaagent chat run <agent-id> "<message>"
seaagent chat run --ws <agent-id> "<message>"
seaagent chat run --stream-retries 5 <agent-id> "<message with limited reconnects>"
seaagent chat run --agent-config-file <runtime-config.json|yaml> "<message>"
seaagent chat run --no-stream <agent-id> "<message>"
seaagent chat get <chat-id>
seaagent chat events <chat-id> [--after-seq <n>] [--limit <n>]
seaagent chat stream <chat-id> [--after-seq <n>]
seaagent chat stream --ws <chat-id> [--after-seq <n>]
seaagent chat cancel <chat-id>
```

Sandbox runs:

```bash
seaagent sandbox create --prompt "<prompt>" [--template-id <id>] [--sandbox-template react-game] [--preview-port 3000] [--workspace-root /agent-workspace]
seaagent sandbox get <sandbox-run-id>
seaagent sandbox events <sandbox-run-id> [--after-seq <n>] [--limit <n>]
seaagent sandbox stream <sandbox-run-id> [--after-seq <n>]
seaagent sandbox logs <sandbox-run-id> [--limit <n>]
seaagent sandbox files <sandbox-run-id> [--path /agent-workspace]
seaagent sandbox read <sandbox-run-id> --path /agent-workspace/package.json
seaagent sandbox archive <sandbox-run-id> --path /agent-workspace -o workspace.tgz
seaagent sandbox command <sandbox-run-id> -c "<shell command>" [--cwd /agent-workspace] [--timeout <seconds>] [--env KEY=value]
seaagent sandbox refresh <sandbox-run-id>
seaagent sandbox resume <sandbox-run-id>
seaagent sandbox delete <sandbox-run-id>
```

`seaagent game ...` is a legacy alias for the same run lifecycle on `/v1/game/runs`; prefer `sandbox` for new work.

## Agent Registration Workflow

Registry mutations are gated operations. Before running any `agent`, `skill`,
or `tool` register/update command, ask the user for explicit approval and wait
for a clear affirmative response. This applies to:

- `seaagent agent register`
- `seaagent agent update`
- `seaagent skill register`
- `seaagent skill update`
- `seaagent skill tool-register`
- `seaagent tool register`
- `seaagent tool update`

Show the intended endpoint, operation, resource type, resource UUID when
available, and payload file path or concise payload summary before asking.
Do not infer approval from the user's original task description.
Do not use CLI flags, environment variables, or non-interactive scripts to
bypass this approval step. On macOS, the CLI uses a desktop confirmation dialog
for registry mutations; wait for the user to approve that dialog before
continuing.

For gateway mutations, use this order:

1. Confirm `seaagent config get` points at the intended endpoint.
2. Check for an existing agent/skill with `list --search`.
3. Ask for explicit approval before each register/update mutation.
4. Register or update the required skill first, then register or update the agent.
5. Verify with `seaagent agent capabilities <agent-id>`.
6. Run a lightweight smoke test before invoking expensive tools:
   ```bash
   seaagent chat run --no-stream <agent-id> "请用一句话说明你能做什么，不要调用任何工具。"
   ```

On the current SeaArt gateway, agent `category` is constrained to `fabric` or `seaactor`. Use `fabric` for normal runnable assistants unless the user explicitly needs another category. A known-good model config for SeaArt media agents is:

```json
{
  "default": "gpt-5.1-chat",
  "allowed": ["gpt-5.1-chat", "gpt-4.1-mini", "gpt-4o"]
}
```

If a newly registered agent times out even on the no-tool smoke test, update it with the low-level `agent update` shape and set `category: "fabric"` plus the model config above, then retest before debugging tools.

### Sandbox Agents

Registered agents that must run inside a game/workspace sandbox are marked by adding `runtime.sandbox` to `agent_config` (or concise register `config`). The `sandbox` object is a type marker; do not add an `enabled` field. If `runtime.sandbox` is absent, the agent is a normal non-sandbox agent.

Minimal low-level shape:

```json
{
  "agent_config": {
    "temperature": 0.2,
    "max_turns": 100,
    "timeout": 1800,
    "runtime": {
      "sandbox": {
        "sandbox_template": "react-game"
      }
    }
  }
}
```

Optional sandbox fields:

```json
{
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
```

Allowed `sandbox_template` values are `react-game` and `react-web`.

When a sandbox agent starts a chat without existing `metadata.sandbox_run_id`, agent-gateway creates a sandbox run before dispatching the worker. Streaming output may include `chat.sandbox.creating`, `chat.sandbox.ready`, and `chat.sandbox.failed`. The resulting `sandbox_run_id` can be used with the `/v1/sandbox/runs/{runID}` APIs; `/v1/game/runs/{runID}` remains a legacy compatibility route.

## Chat Runtime Caveats

Long media-generation requests can exceed the front proxy timeout and return `504 Gateway Time-out` even after agent registration succeeds. If that happens:

- First confirm a no-tool smoke test completes; otherwise fix agent category/model config.
- Try `chat run` streaming and `chat run --ws`. The CLI automatically resumes interrupted streams from the last received event seq and does not stop locally by retry count unless `--stream-retries <n>` is set. Some deployed proxies may still reject WebSocket upgrades (`non-101 status`).
- If no `run_id`, task id, or asset URL is returned, do not claim generation succeeded. Report the gateway timeout and keep the exact prompt/settings for retry or backend log inspection.
- The CLI currently has no direct `tool invoke` command; tool execution goes through `chat run`.

## Gateway API Mapping

- `system health` -> `GET /health`
- `system metrics` -> `GET /metrics`
- `catalog list` -> `GET /v1/catalog`
- `tool register` -> `POST /v1/tools/register`
- `tool list/find` -> `GET /v1/tools`
- `tool get` -> `GET /v1/tools/{tool-id}`
- `tool update` -> `PUT /v1/tools/{tool-id}`
- `tool delete` -> `DELETE /v1/tools/{tool-id}`
- `tool resolve` -> `GET /v1/tools/{tool-id}/resolve`
- `skill register` -> `POST /v1/skills/register`
- `skill tool-register` -> `POST /v1/tools/register`
- `skill list` -> `GET /v1/skills`
- `skill get` -> `GET /v1/skills/{skill-id}`
- `skill update` -> `PUT /v1/skills/{skill-id}`
- `skill delete` -> `DELETE /v1/skills/{skill-id}`
- `agent register` -> `POST /v1/agents/register`
- `agent list` -> `GET /v1/agents`
- `agent update` -> `PUT /v1/agents/{agent-id}`
- `agent delete` -> `DELETE /v1/agents/{agent-id}`
- `agent capabilities` -> `GET /v1/agents/{agent-id}/capabilities`
- `hook register` -> `POST /v1/hooks/register`
- `hook list` -> `GET /v1/hooks`
- `hook get` -> `GET /v1/hooks/{hook-id}`
- `hook update` -> `PUT /v1/hooks/{hook-id}`
- `hook delete` -> `DELETE /v1/hooks/{hook-id}`
- `chat run` -> `POST /v1/chat/completions`
- `chat run --ws` -> `GET /v1/chat/completions/ws`; sends the `ChatCompletionRequest` JSON as the first WebSocket message
- `chat get` -> `GET /v1/chats/{chat-id}`
- `chat events` -> `GET /v1/chats/{chat-id}/events`
- `chat stream` -> `GET /v1/chats/{chat-id}/stream`
- `chat stream --ws` -> `GET /v1/chats/{chat-id}/ws?after_seq=...`
- `chat cancel` -> `POST /v1/chats/{chat-id}/cancel`
- `sandbox create` -> `POST /v1/sandbox/runs`
- `sandbox get` -> `GET /v1/sandbox/runs/{run-id}`
- `sandbox events` -> `GET /v1/sandbox/runs/{run-id}/events`
- `sandbox stream` -> `GET /v1/sandbox/runs/{run-id}/stream`
- `sandbox logs` -> `GET /v1/sandbox/runs/{run-id}/logs`
- `sandbox files` -> `GET /v1/sandbox/runs/{run-id}/files`
- `sandbox read` -> `GET /v1/sandbox/runs/{run-id}/files/content`
- `sandbox archive` -> `GET /v1/sandbox/runs/{run-id}/files/archive`
- `sandbox command` -> `POST /v1/sandbox/runs/{run-id}/commands`
- `sandbox refresh` -> `POST /v1/sandbox/runs/{run-id}/refresh`
- `sandbox resume` -> `POST /v1/sandbox/runs/{run-id}/resume`
- `sandbox delete` -> `DELETE /v1/sandbox/runs/{run-id}`
- `game ...` -> legacy equivalents on `/v1/game/runs`

## Payload Shape Switching

Tool and Skill use one exposed create endpoint, `/register`, but the gateway handler accepts two payload shapes. Resource identity is the gateway-generated UUID `id`; do not include removed `tool_key`, `skill_key`, or `agent_key` fields in payloads.

- Tool register shape: no `openai_schema` or `runtime_id`; the gateway parses `ToolRegisterRequest` and adapts it into current Tool state.
- Tool low-level shape: includes `openai_schema` or `runtime_id`; the gateway parses `ToolCreateRequest` and returns a UUID `id`.
- Skill register shape: no `source_kind` or `manifest`; the gateway parses `SkillRegisterRequest` and adapts it into current Skill state.
- Skill low-level shape: includes `source_kind` or `manifest`; the gateway parses `SkillCreateRequest` and returns a UUID `id`.
- Agent register shape: no `model_config` or `agent_config`; the gateway parses `AgentRegisterRequest`.
- Agent low-level shape: includes `model_config` or `agent_config`; the gateway parses `AgentCreateRequest` and returns a UUID `id`.

Update endpoints have similar Tool/Skill switching:

- `tool update` with a register-shape payload updates via `ToolRegisterRequest`; with `metadata`, `openai_schema`, or `runtime_id`, it updates via `ToolUpdateRequest`.
- `skill update` with a register-shape payload updates via `SkillRegisterRequest`; with `source_kind`, `metadata`, or `manifest`, it updates via `SkillUpdateRequest`.
- `agent update` only accepts the low-level `AgentUpdateRequest` shape.

## Safety Notes

- Do not expose real API keys in logs, commits, or final answers.
- Confirm the endpoint before mutating gateway state.
- Use `list`, `get`, `resolve`, and `capabilities` to verify changes.
- Treat `register`, `update`, `delete`, and `cancel` as gateway-mutating operations.
- Delete commands use the configured `user-id` as `X-User-ID`; it must match owner/creator/updater ownership checks in the gateway.
- If a command returns `expected JSON response`, inspect the endpoint path and gateway process; the CLI expected JSON but received text or HTML.
