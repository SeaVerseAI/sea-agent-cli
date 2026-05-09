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
seaagent config get
```

The API key is sent as:

```http
Authorization: Bearer sa-xxxxxxxx
```

## Usage

```bash
seaagent system health
seaagent catalog list --capability-type skill --status active

seaagent tool register -f examples/tool-web-fetch.json
seaagent tool find --provider web-tools-mcp --status active
seaagent tool get <tool-id>
seaagent tool update <tool-id> -f tool-update.json
seaagent tool delete <tool-id> --operator-id web-tools-mcp

seaagent skill register -f examples/skill-web.json
seaagent skill list --status active
seaagent skill get <skill-id>
seaagent skill update <skill-id> -f skill-update.json
seaagent skill delete <skill-id> --operator-id web-tools-mcp

seaagent agent register -f examples/agent-web.json
seaagent agent update <agent-id> -f agent-update.json
seaagent agent delete <agent-id> --operator-id web-tools-mcp
seaagent agent list
seaagent agent capabilities web_assistant:v1

seaagent chat run web_assistant:v1 "Search recent AI news"
seaagent chat run --ws web_assistant:v1 "Search recent AI news"
seaagent chat run --agent-config-file examples/runtime-agent-config.json "Fetch https://example.com"
seaagent chat get <chat-id>
seaagent chat events <chat-id>
seaagent chat stream <chat-id>
seaagent chat stream --ws <chat-id>
seaagent chat cancel <chat-id>
```
