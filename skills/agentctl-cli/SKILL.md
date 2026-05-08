---
name: agentctl-cli
description: "Use this skill when working with the local agentctl CLI for SeaArt agent-gateway: configuring endpoints and API keys, registering or creating tools, skills, and agents from JSON/YAML payloads, listing or resolving catalog entries, and running chat completions through the gateway."
---

# Agentctl CLI

## Scope

Use this skill when a task involves the local `agentctl` project or the SeaArt `agent-gateway` CLI workflow. The CLI wraps the gateway HTTP API and is intended for registration, discovery, capability inspection, and chat testing.

The repository is usually at `~/Desktop/sea_art/agentctl`. The related gateway service is usually at `~/Desktop/sea_art/agent-gateway`.

## First Checks

1. Work from the `agentctl` repo unless the user points elsewhere.
2. Check whether the CLI is built:
   ```bash
   npm run build
   ```
3. Prefer the built CLI for realistic behavior:
   ```bash
   node dist/index.js --help
   ```
   If local development behavior is needed, use:
   ```bash
   npm run dev -- --help
   ```
4. Inspect config before gateway operations:
   ```bash
   node dist/index.js config get
   node dist/index.js config path
   ```

## Configuration

`agentctl` stores config at `~/.agentctl/config.yaml`.

Set the gateway endpoint:
```bash
node dist/index.js config set endpoint http://127.0.0.1:8080
```

Set the API key when required:
```bash
node dist/index.js config set api-key sa-xxxxxxxx
```

The API key is sent as `Authorization: Bearer <api-key>`. Do not print or commit real API keys. `config get` masks stored API keys.

For request debugging, prefix commands with:
```bash
AGENTCTL_DEBUG=1 node dist/index.js ...
```

## Payload Files

Registration and creation commands read JSON or YAML payloads with `-f/--file`. JSON is parsed for every path except `.yaml` and `.yml`, which are parsed as YAML.

When creating or modifying payloads for `tool register`, `tool create`, `skill register`, `agent register`, or `agent create`, read [Capability Formats](references/capability-formats.md). It captures the current `agent-gateway` request structs, defaults, validation rules, and examples for Tool, Skill, and Agent definitions.

Use the repo examples as schemas and starting points:

- `examples/tool-web-fetch.json`: tool registration payload
- `examples/skill-web.json`: skill registration payload
- `examples/agent-web.json`: agent registration payload
- `examples/agent-create-web.json`: agent creation payload
- `examples/runtime-agent-config.json`: inline runtime chat config

Create task-specific payload files instead of editing shared examples unless the user asks to change the examples.

## Commands

Config:
```bash
node dist/index.js config set endpoint <url>
node dist/index.js config set api-key <key>
node dist/index.js config get
node dist/index.js config path
```

Tools:
```bash
node dist/index.js tool register -f <payload.json|yaml>
node dist/index.js tool create -f <payload.json|yaml>
node dist/index.js tool list [--search <value>] [--status <value>] [--source-kind <value>] [--owner-id <value>] [--provider <value>] [--category <value>] [--limit <n>] [--offset <n>]
node dist/index.js tool find [same filters as list]
node dist/index.js tool get <tool-id>
node dist/index.js tool resolve <tool-id> [--version <value>] [--version-id <value>]
```

Skills:
```bash
node dist/index.js skill register -f <payload.json|yaml>
node dist/index.js skill tool-register -f <payload.json|yaml>
node dist/index.js skill list [--search <value>] [--status <value>] [--provider <value>] [--category <value>] [--limit <n>] [--offset <n>]
```

Agents:
```bash
node dist/index.js agent register -f <payload.json|yaml>
node dist/index.js agent create -f <payload.json|yaml>
node dist/index.js agent list [--search <value>] [--status <value>] [--owner-id <value>] [--category <value>] [--limit <n>] [--offset <n>]
node dist/index.js agent capabilities <agent-id>
```

Chat:
```bash
node dist/index.js chat run <agent-id> "<message>"
node dist/index.js chat run --agent-config-file <runtime-config.json|yaml> "<message>"
node dist/index.js chat run --no-stream <agent-id> "<message>"
node dist/index.js chat get <chat-id>
node dist/index.js chat events <chat-id> [--after-seq <n>] [--limit <n>]
node dist/index.js chat cancel <chat-id>
```

## Common Workflows

Register and test a tool-backed agent:
```bash
node dist/index.js tool register -f examples/tool-web-fetch.json
node dist/index.js tool find --provider web-tools-mcp --status active
node dist/index.js skill register -f examples/skill-web.json
node dist/index.js skill list --status active
node dist/index.js agent register -f examples/agent-web.json
node dist/index.js agent capabilities web_assistant:v1
node dist/index.js chat run web_assistant:v1 "Fetch https://example.com"
```

Create an agent through the newer create endpoint:
```bash
node dist/index.js agent create -f examples/agent-create-web.json
node dist/index.js agent list --search web_assistant
```

Run with inline runtime config:
```bash
node dist/index.js chat run --agent-config-file examples/runtime-agent-config.json "Fetch https://example.com"
```

Generate a new capability payload:

1. Read [Capability Formats](references/capability-formats.md).
2. Choose the endpoint shape:
   - Prefer `register` commands for concise Tool, Skill, and Agent setup.
   - Use `create` commands when the user needs the lower-level registry shape with explicit metadata, status, version lifecycle, or immutable version payloads.
3. Write the payload as task-specific JSON/YAML.
4. Build, register/create, then verify with `list`, `get`, `resolve`, or `capabilities`.

## Gateway API Mapping

Use this mapping when comparing CLI behavior with `agent-gateway` handlers:

- `tool register` -> `POST /v1/tools/register`
- `tool create` -> `POST /v1/tools`
- `tool list/find` -> `GET /v1/tools`
- `tool get` -> `GET /v1/tools/{tool-id}`
- `tool resolve` -> `GET /v1/tools/{tool-id}/resolve`
- `skill register` -> `POST /v1/skills/register`
- `skill tool-register` -> `POST /v1/tools/register`
- `skill list` -> `GET /v1/catalog?capability_type=skill`
- `agent register` -> `POST /v1/agents/register`
- `agent create` -> `POST /v1/agents`
- `agent list` -> `GET /v1/agents`
- `agent capabilities` -> `GET /v1/agents/{agent-id}/capabilities`
- `chat run` -> `POST /v1/chat/completions`
- `chat get` -> `GET /v1/chats/{chat-id}`
- `chat events` -> `GET /v1/chats/{chat-id}/events`
- `chat cancel` -> `POST /v1/chats/{chat-id}/cancel`

## Safety Notes

- Do not expose real API keys in logs, commits, or final answers.
- Confirm the endpoint before mutating gateway state.
- Use `list`, `find`, `get`, and `capabilities` to verify registration results.
- Treat `register`, `create`, and `cancel` as gateway-mutating operations.
- If a command fails with `endpoint is not configured`, set `config endpoint` first.
- If a command returns `expected JSON response`, inspect the endpoint path and gateway process; the CLI expected JSON but received text or HTML.
