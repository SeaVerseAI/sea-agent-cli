# seaagent

npm CLI for `agent-gateway`.

## Install

```bash
npm install
npm run build
npm link
```

## Configure

```bash
seaagent config set endpoint http://127.0.0.1:8080
seaagent config set api-key sa-xxxxxxxx
seaagent config set user-id production-line-123
seaagent config get
```

`endpoint` can be either the gateway base URL or a URL that already includes
`/agent-v2`. When `/agent-v2` is missing, the CLI adds it automatically before
sending requests.

The API key and production-line identity are sent as:

```http
Authorization: Bearer sa-xxxxxxxx
X-User-ID: production-line-123
```

## Usage

```bash
seaagent system health
seaagent catalog list --capability-type skill --status active

seaagent tool register -f examples/tool-web-fetch.json
seaagent tool find --provider web-tools-mcp --status active
seaagent tool get <tool-id>
seaagent tool update <tool-id> -f tool-update.json
seaagent tool delete <tool-id>

seaagent skill register -f examples/skill-web.json
seaagent skill list --status active
seaagent skill get <skill-id>
seaagent skill update <skill-id> -f skill-update.json
seaagent skill delete <skill-id>

seaagent agent register -f examples/agent-web.json
seaagent agent register -f examples/agent-sandbox.json
seaagent agent update <agent-id> -f agent-update.json
seaagent agent delete <agent-id>
seaagent agent list
seaagent agent capabilities 33333333-3333-4333-8333-333333333333

seaagent hook register -f examples/hook.json
seaagent hook list
seaagent hook get <hook-id>
seaagent hook update <hook-id> -f hook-update.json
seaagent hook delete <hook-id>

seaagent chat run 33333333-3333-4333-8333-333333333333 "Search recent AI news"
seaagent chat run --ws 33333333-3333-4333-8333-333333333333 "Search recent AI news"
seaagent chat run --stream-retries 5 33333333-3333-4333-8333-333333333333 "Limit reconnect attempts"
seaagent chat run --agent-config-file examples/runtime-agent-config.json "Fetch https://example.com"
seaagent chat run --agent-config-file examples/runtime-agent-sandbox-config.json "Create a small React game"
seaagent sandbox get <sandbox-run-id>
seaagent sandbox events <sandbox-run-id>
seaagent sandbox stream <sandbox-run-id>
seaagent sandbox logs <sandbox-run-id>
seaagent sandbox files <sandbox-run-id> --path /agent-workspace
seaagent sandbox read <sandbox-run-id> --path /agent-workspace/package.json
seaagent sandbox archive <sandbox-run-id> --path /agent-workspace -o workspace.tgz
seaagent sandbox command <sandbox-run-id> -c "pwd && ls"
seaagent sandbox refresh <sandbox-run-id>
seaagent sandbox resume <sandbox-run-id>
seaagent chat get <chat-id>
seaagent chat events <chat-id>
seaagent chat stream <chat-id> --after-seq 12
seaagent chat stream --ws <chat-id>
seaagent chat cancel <chat-id>
```

`seaagent game ...` remains as a legacy alias for deployments and scripts that still use `/v1/game/runs`.
