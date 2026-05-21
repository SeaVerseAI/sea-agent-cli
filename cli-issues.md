# CLI 新人评审问题清单

记录基于“完全新人”视角使用 `seaagent` CLI 创建/验证 Agent 时暴露的问题。

最近一次评审：`weather-agent` 场景，2026-05-21。

## 评审方法

- sub agent 只允许使用 `seaagent` CLI、help、README/examples 和只读查询命令。
- sub agent 不读源码、不改代码，不执行 register/update/delete 等网关写操作。
- 主 agent 审查 sub agent 命令过程，并在必要时复测已有 Agent 的 chat 效果。

## Weather Agent 评审摘要

只读发现到已有资源：

- tool: `e6b281b2-9f7e-4e2f-9661-b2b9dbd3e512` (`weather_lookup`)
- skill: `08c90395-4024-4e6e-8dce-d9bc72d6c2ce` (`weather_skill`)
- agent: `c1bb1c13-f721-4948-92bb-8c0bbc532000` (`weather_assistant`)

主 agent 复测：

```bash
seaagent chat run --no-stream c1bb1c13-f721-4948-92bb-8c0bbc532000 "What's the current weather in Shanghai?"
```

结果：

- `chat run --no-stream` 返回 `status: failed`，原始响应没有错误详情。
- `chat events` 中可见真实失败原因为 `response.failed`:
  `[Errno -2] Name or service not known`
- 这说明 Agent/工具运行环境存在网络解析失败，同时 CLI 在非流式失败场景里没有把事件中的错误补回 JSON。

## 待修复 / 待验证

### 1. 网络错误裸输出，缺少诊断提示

**严重度**：高

**来源**

weather 评审中多次出现：

```text
getaddrinfo ENOTFOUND openresty-gateway.gpu-service.dev.seaart.dev
```

用户只能看到底层 DNS 错误，不知道当前请求的 endpoint、是否应该重试、是否该检查 config 或 health。

**期望**

网络请求失败时，CLI 应补充：

- 请求方法和目标 endpoint/path
- 建议运行 `seaagent config get`
- 建议运行 `seaagent system health`
- 明确“可重试”

**状态**

`fixed pending verification`：`src/lib/client.ts` 已为 HTTP 请求失败追加诊断提示。

### 2. `chat run --no-stream` 失败时不包含事件错误详情

**严重度**：高

**来源**

weather agent 复测返回：

```json
{
  "data": {
    "run_id": "run_d877m2te878c73c8v16g",
    "status": "failed"
  }
}
```

但 `chat events` 里有：

```json
{
  "event": "response.failed",
  "response": {
    "error": {
      "message": "[Errno -2] Name or service not known",
      "type": "server_error"
    }
  }
}
```

**期望**

`--no-stream` enrichment 不只拼接成功文本，也要在失败时把 `response.failed` / `chat.failed` 的错误补到：

- `response.error`
- `error_message`
- `error_code`（如果有）

**状态**

`fixed pending verification`：`src/commands/chat.ts` 已解析嵌套 `response.error` 并补回非流式 JSON。

### 3. 缺少 task-oriented Agent 创建示例

**严重度**：中

**来源**

sub agent 找到的 examples 都是 web/sandbox。新人要创建 weather agent 时，需要自己从 web 示例类推：

- 如何先搜索已有 tool/skill
- 如何复用已有 skill UUID 创建 agent
- 最小 agent payload 需要哪些字段

**期望**

至少补一个“复用已有 skill 创建 agent”的流程，weather/currency 这类 utility agent 都可以。

**状态**

`partially fixed`：`agent register --help` 已补最小 payload 和复用 skill UUID 提示。仍建议后续补 README task-oriented workflow。

### 4. `agent --help` 顶层不展示 list 常用过滤项

**严重度**：中

**来源**

sub agent 使用了 `agent list --search weather`，但这是从其它命令类推出来的；`seaagent agent --help` 顶层原本没有直接展示 `--search / --status / --owner-id / --category`。

**期望**

顶层 `agent --help` 直接展示常用 list filters，降低发现成本。

**状态**

`fixed pending verification`：`src/commands/agent.ts` 已在顶层 help 增加 Common list filters。

### 5. `config get` 不显示 `userId` 缺失风险

**严重度**：中

**来源**

sub agent 看到 `config get` 没有 `userId`，但不知道 register/update/delete 会不会受影响。

**期望**

`config get` 应显式显示 `userId: null`，并提示 registry ownership-sensitive 操作可能使用 gateway 默认归属。

**状态**

`fixed pending verification`：`src/commands/config.ts` 已输出 `userId: null` 和 warnings。

### 6. list 表格对嵌套字段折叠为 `[Object]`

**严重度**：中

**来源**

`tool list`、`skill list`、`agent list` 使用 console.table 时，`openai_schema`、`manifest`、`metadata`、`agent_config` 等字段显示为 `[Object]`。

**影响**

新人需要额外 `get` 才能看 tool 参数、skill 绑定和 agent 配置。

**可能修复**

- 增加通用 `--json` 输出模式。
- 或 list 表格只展示最重要的摘要字段，例如 tool required params、skill required tool ids、agent skill ids。

**状态**

`todo`

### 7. `tool resolve` 与 `tool get` 边界仍不够清楚

**严重度**：低

**来源**

sub agent 认为两者输出高度接近，不清楚什么时候必须 resolve。

**当前说明**

`tool resolve --help` 已写：

> Use resolve before binding a tool into a skill. It prints the normalized runtime metadata that Agent Worker receives.

**状态**

`watch`：暂不改代码；后续如多次评审仍困惑，再补 README workflow。

### 8. 缺少明确的 smoke-test 工作流

**严重度**：低

**来源**

sub agent 不确定 `chat run` 是否算“只读验证”，因为它会创建 chat run。

**说明**

Chat run 本质会创建 run 记录，但不是 registry mutation；可作为 smoke test。需要在评审协议和 README 里说明。

**状态**

`todo`

## 已修复 / 已缓解

### A. `agent` 命令缺少 `get`

原问题：`tool get` 和 `skill get` 存在，但 `agent get` 缺失。

状态：`fixed`

- CLI 已增加 `seaagent agent get <agent-id>`
- agent-gateway 已增加 `GET /v1/agents/:agentID`
- agent-sdk-go/js、skill-hub、web 文档已同步

### B. `chat events` 默认 `--limit 100` 会静默截断

状态：`fixed`

- 默认 limit 已调整为 `1000`
- 刚好返回 `--limit` 条时会提示继续分页

### C. `chat run --no-stream` 成功场景不含 Agent 实际回复

状态：`fixed`

- `--no-stream` 会读取 stored events 并把文本增量补到 `response.message.content`
- 本轮新增失败场景补错见上文第 2 项

### D. `register` 400 报错对字段问题提示不足

状态：`partially fixed`

- `src/lib/client.ts` 已展开 `message/detail/details/errors`
- register 400 泛化错误会提示查看对应 examples
- 尚未做完整本地 schema 预校验

### E. `provider` 字段被网关规范化为 UUID 没说明

状态：`fixed`

- `tool register` / `skill register` help 已补说明
- 注册返回中发现 provider 变化时，CLI 会向 stderr 输出 info
