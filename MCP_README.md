# HomeFlow MCP Server

把现有 REST API 以 [MCP](https://modelcontextprotocol.io) 工具形式暴露，让 Claude 等 LLM 客户端可以直接读写菜谱、采购清单和菜单。

## 设计

- **零业务逻辑重复**：`server/mcp.js` 中每个 tool 只是把调用转发到本机 `/api/*`，认证、订阅门控、家庭数据隔离全部走现有中间件。
- **无状态 Streamable HTTP**：挂载在现有 Express app 的 `ALL /mcp/:token`，每个请求独立建 server 实例，无 session 状态，不影响横向扩展。
- **认证复用现有 token**：URL 形如 `https://your-domain/mcp/<X-Auth-Token>`，token 即登录签发的 `userId.HMAC` 签名令牌。无效 token 会被 API 层 401 拒绝（已有测试覆盖）。

## 暴露的工具（11 个）

| Tool | 转发端点 |
|---|---|
| list_recipes / get_recipe | GET /recipes, /recipes/:id |
| create_recipe / update_recipe | POST/PATCH /recipes |
| recipe_to_shopping | POST /recipes/:id/to-shopping |
| recipe_to_meal / get_today_meals | POST /recipes/:id/to-meal, GET /meals |
| list_shopping_lists / get_shopping_list | GET /shopping, /shopping/:id |
| create_shopping_list / add_shopping_item | POST /shopping, /shopping/:id/items |

## 测试

```bash
AUTH_SECRET=testsecret SEED_DEMO=1 PORT=8080 node server/index.js &
node test_mcp.mjs   # 9 项 E2E：全链路 + 无效 token 拒绝
```

## 用户接入（Claude.ai）

1. 登录 HomeFlow 网页版，从浏览器 localStorage 取出 token（或后续加一个"复制我的连接地址"入口，拼接 `/mcp/<token>` 即可）。
2. Claude.ai → Settings → Connectors → Add custom connector，填入 `https://helpermanagement.xyz/mcp/<token>`。

## 注意事项 / 后续可选

- token 无过期机制（现状如此，非本 PR 引入），泄露 URL 即泄露账号访问权，建议提示用户妥善保管；如需撤销，可考虑加 token 版本号或轮换 AUTH_SECRET（会登出所有人）。
- 更正式的做法是实现 MCP 标准 OAuth 流程，体验与 Notion 官方连接器一致，工作量另计。
- 依赖新增：`@modelcontextprotocol/sdk`、`zod`。
