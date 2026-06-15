# seaagent

> Beta: CLI behavior follows the current `agent-gateway` API and may change with gateway releases.

`seaagent` is the npm CLI for `agent-gateway` registration, discovery, chat, hooks, and sandbox-run workflows.

## Available Workflows

| Workflow | Commands | What it does |
| --- | --- | --- |
| Self maintenance | `seaagent self ...` | Check CLI updates, update the CLI, verify local support files, and install the bundled Codex skill |
| Configuration | `seaagent config ...` | Store endpoint, API key, and production-line user ID in `~/.seaagent/config.yaml` |
| System and catalog | `seaagent system ...`, `seaagent catalog ...` | Check gateway health, metrics, and reusable capabilities |
| Tools | `seaagent tool ...` | Register, list, inspect, resolve, update, and delete executable tools |
| Skills | `seaagent skill ...` | Register, list, inspect, update, and delete agent-facing instructions plus tool bindings |
| Agents | `seaagent agent ...` | Register, list, inspect, update, delete, and verify runnable agents |
| Chat | `seaagent chat ...` | Run registered or inline agents, stream responses, replay events, and cancel runs |
| Hooks | `seaagent hook ...` | Register and manage worker event hook endpoints for the configured API key |
| Sandbox runs | `seaagent sandbox ...` | Create, inspect, stream, and operate remote sandbox workspaces |
| Legacy sandbox alias | `seaagent game ...` | Compatibility alias for deployments that still use `/v1/game/runs` |

## How It Works

1. `seaagent` reads connection settings from `~/.seaagent/config.yaml`.
2. `endpoint` may be the gateway base URL or a URL that already includes `/agent-v2`; the CLI appends `/agent-v2` when needed.
3. Requests send `Authorization: Bearer <api-key>` and `X-User-ID: <user-id>` when configured.
4. Registry writes use `user-id` for owner/operator-sensitive gateway behavior.
5. Chat defaults to SSE streaming, can switch to WebSocket with `--ws`, and can replay stored events by chat ID.
6. Sandbox commands manage remote workspace runs created directly or by agents with `runtime.sandbox`.

## Quick Start

Install from GitHub:

```bash
npm install -g git+https://github.com/SeaArt-Infra/sea-agent-cli.git
```

For local development:

```bash
npm install
npm run build
npm link
```

Configure a gateway and check connectivity:

```bash
seaagent config set endpoint http://127.0.0.1:8080
seaagent config set api-key sa-xxxxxxxx
seaagent config set user-id production-line-123
seaagent config get
seaagent system health
```

Discover and run:

```bash
seaagent catalog list --capability-type skill --status active
seaagent tool list --search web --status active
seaagent agent list --status active
seaagent chat run <agent-id> "hello"
```

## Configuration

The CLI stores config in `~/.seaagent/config.yaml`:

```bash
seaagent config set endpoint http://127.0.0.1:8080
seaagent config set api-key sa-xxxxxxxx
seaagent config set user-id production-line-123
seaagent config get
seaagent config path
```

Credentials are sent as:

```http
Authorization: Bearer sa-xxxxxxxx
X-User-ID: production-line-123
```

Set `SEAAGENT_DEBUG=1` to print HTTP and WebSocket requests:

```bash
SEAAGENT_DEBUG=1 seaagent system health
```

The CLI checks GitHub for package updates at most once per day and checks the bundled `seaagent-cli` Codex skill against `~/.codex/skills/seaagent-cli` at most every 2 hours. Notices are printed to stderr only.

```bash
seaagent self check-update
seaagent self update
seaagent self check
seaagent self update-skill
```

## Discovery

Use catalog and list commands before creating new resources:

```bash
seaagent catalog list --capability-type skill --status active
seaagent tool list --search image --status active --limit 50
seaagent skill list --search media --status active
seaagent agent list --category fabric --status active
```

Common list filters:

| Resource | Filters |
| --- | --- |
| Catalog | `--capability-type`, `--search`, `--status`, `--public`, `--provider`, `--limit`, `--offset` |
| Tools | `--search`, `--status`, `--public`, `--provider`, `--limit`, `--offset` |
| Skills | `--search`, `--status`, `--public`, `--provider`, `--limit`, `--offset` |
| Agents | `--search`, `--status`, `--owner-id`, `--category`, `--limit`, `--offset` |
| Hooks | `--search`, `--limit`, `--offset` |

List commands print compact tables. `get`, `register`, `update`, and action commands print JSON.

## Register Resources

Commands with `-f/--file` read JSON or YAML payload files. Use the examples as starting points:

| File | Purpose |
| --- | --- |
| `examples/tool-web-fetch.json` | Tool register payload |
| `examples/skill-web.json` | Skill register payload |
| `examples/agent-web.json` | Agent register payload |
| `examples/agent-sandbox.json` | Registered sandbox agent payload |
| `examples/hook.json` | Hook endpoint payload |
| `examples/runtime-agent-config.json` | Inline runtime chat config |
| `examples/runtime-agent-sandbox-config.json` | Inline runtime chat config that creates a sandbox |
| `examples/chat-multimodal.json` | OpenAI-style multimodal chat messages |

Work bottom-up when building capabilities:

```bash
seaagent tool register -f examples/tool-web-fetch.json
seaagent tool resolve <tool-id>
seaagent skill register -f examples/skill-web.json
seaagent agent register -f examples/agent-web.json
seaagent agent capabilities <agent-id>
```

Resource IDs are immutable UUIDs generated by `agent-gateway`. Use returned UUIDs in later `get`, `update`, `delete`, `resolve`, `capabilities`, skill bindings, and chat commands.

Tool notes:

- Use `tool resolve` before binding a tool into a skill; it shows normalized runtime metadata.
- `service_name` is a top-level Tool field beside `name`; if omitted, the gateway derives it from the endpoint host.
- Do not send `inject_user_credentials` in user-facing payloads; the gateway manages it.

Skill notes:

- Skills are agent-facing instructions plus tool bindings.
- Prefer immutable Tool UUID refs for registered tools.
- `skill tool-register` is a convenience alias for `tool register`.

Agent notes:

- `category` should be `fabric` or `seaactor`.
- Do not send `agent_key` for new registrations; the gateway returns an immutable UUID.
- Use `agent capabilities <agent-id>` after agent or skill changes to verify resolved bindings.

Hook notes:

- Hook commands use the configured API key as `Authorization: Bearer <api-key>`.
- Hook payloads do not include `api_key`.
- Worker calls hook endpoints with fixed `POST`; hook services should filter events by payload `event_id` when needed.

## Chat

Run a registered agent:

```bash
seaagent chat run <agent-id> "Search recent AI news"
seaagent chat run --ws <agent-id> "Stream over WebSocket"
seaagent chat run --stream-retries 5 <agent-id> "Limit reconnect attempts"
seaagent chat run --no-stream <agent-id> "Return raw JSON"
```

Run with inline runtime config:

```bash
seaagent chat run --agent-config-file examples/runtime-agent-config.json "Fetch https://example.com"
seaagent chat run --agent-config-file examples/runtime-agent-sandbox-config.json "Create a small React game"
```

Send a complete messages array or payload file:

```bash
seaagent chat run --messages-file examples/chat-multimodal.json <agent-id>
```

Inspect and replay existing chats:

```bash
seaagent chat get <chat-id>
seaagent chat events <chat-id> --after-seq 12 --limit 1000
seaagent chat stream <chat-id> --after-seq 12
seaagent chat stream --ws <chat-id> --after-seq 12
seaagent chat cancel <chat-id>
```

Streaming writes assistant text to stdout. The CLI prints `run_id`, progress/tool status, and terminal usage to stderr when available. `--no-stream` prints gateway JSON and enriches stored success or failure details when chat events are available.

For the chat response protocol, see [docs/agent-response-protocol.md](docs/agent-response-protocol.md).

## Sandbox Runs

Create and manage remote workspaces with the `sandbox` command:

```bash
seaagent sandbox create --prompt "Create a small React game" --sandbox-template react-game --preview-port 3000
seaagent sandbox get <sandbox-run-id>
seaagent sandbox events <sandbox-run-id> --after-seq 0 --limit 100
seaagent sandbox stream <sandbox-run-id> --after-seq 0
seaagent sandbox logs <sandbox-run-id> --limit 100
seaagent sandbox files <sandbox-run-id> --path /agent-workspace
seaagent sandbox read <sandbox-run-id> --path /agent-workspace/package.json
seaagent sandbox archive <sandbox-run-id> --path /agent-workspace -o workspace.tgz
seaagent sandbox command <sandbox-run-id> -c "npm test" --cwd /agent-workspace --timeout 120
seaagent sandbox refresh <sandbox-run-id>
seaagent sandbox resume <sandbox-run-id>
seaagent sandbox delete <sandbox-run-id>
```

`seaagent game ...` remains as a legacy alias for deployments and scripts that still use `/v1/game/runs`.

## Command Reference

| Area | Commands |
| --- | --- |
| Self | `check-update`, `update`, `check`, `update-skill` |
| Config | `set endpoint`, `set api-key`, `set user-id`, `get`, `path` |
| System | `health`, `metrics` |
| Catalog | `list` |
| Tools | `register`, `list`, `find`, `get`, `update`, `resolve`, `delete` |
| Skills | `register`, `tool-register`, `list`, `get`, `update`, `delete` |
| Agents | `register`, `list`, `get`, `update`, `capabilities`, `delete` |
| Hooks | `register`, `list`, `get`, `update`, `delete` |
| Chat | `run`, `get`, `events`, `stream`, `cancel` |
| Sandbox | `create`, `get`, `events`, `stream`, `logs`, `files`, `read`, `archive`, `command`, `refresh`, `resume`, `delete` |

Use command-level help for exact flags:

```bash
seaagent <command> --help
seaagent <command> <subcommand> --help
```

## Next Steps

- Use `examples/` payloads as templates for registry and chat workflows.
- Use `seaagent tool resolve` before adding a Tool UUID to a Skill.
- Use `seaagent agent capabilities` after Agent or Skill changes.
- Read [docs/agent-response-protocol.md](docs/agent-response-protocol.md) when integrating with chat JSON, SSE, WebSocket, or replay output.
