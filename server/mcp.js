// HomeFlow MCP Server —— 把现有 REST API 以 MCP 工具形式暴露给 LLM 客户端（如 Claude）
//
// 设计原则：零业务逻辑重复。每个 MCP tool 只是把调用转发到本机的 /api/* 端点，
// 认证、订阅门控、家庭隔离全部复用现有中间件。
//
// 接入方式：URL 内嵌 token（形如 https://your-domain/mcp/<X-Auth-Token>），
// token 即现有登录签发的签名令牌（userId.HMAC，无过期）。在 Claude.ai
// 设置 → 连接器 → 添加自定义连接器，填入该 URL 即可。
// 获取 token：登录网页版后在浏览器 localStorage 中查看（key: token），
// 或让后端加一个显示 token 的入口。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT = process.env.PORT || 8080;
const API = `http://127.0.0.1:${PORT}/api`;

// 转发到本机 API；token 来自 URL 路径段
async function call(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const asResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

const ingredientShape = z.object({
  name: z.string().describe('食材名（中文）'),
  name_en: z.string().optional().describe('食材英文名'),
  quantity: z.string().optional().describe('数量，如 "1" / "200"'),
  unit: z.string().optional().describe('单位，如 个/克/根'),
  required: z.boolean().optional().describe('是否必需，默认 true'),
  substitute: z.string().optional().describe('可替代食材'),
});
const stepShape = z.object({
  instruction: z.string().describe('步骤说明（中文）'),
  instruction_en: z.string().optional().describe('步骤英文说明'),
  image_url: z.string().optional().describe('步骤配图 URL（/uploads/... 或外链）'),
  duration: z.number().optional().describe('该步骤耗时（分钟）'),
});

// 每个请求新建无状态 server（streamable HTTP stateless 模式）
function buildServer(token) {
  const server = new McpServer({ name: 'homeflow', version: '1.0.0' });

  server.registerTool('list_recipes', {
    description: '列出家庭菜谱库全部菜谱。可按类型过滤：adult(大人) / baby(宝宝) / all',
    inputSchema: { type: z.enum(['adult', 'baby', 'all']).optional() },
  }, async ({ type }) => asResult(await call(token, 'GET', `/recipes${type && type !== 'all' ? `?type=${type}` : ''}`)));

  server.registerTool('get_recipe', {
    description: '获取单个菜谱详情（含食材与步骤）',
    inputSchema: { recipe_id: z.number() },
  }, async ({ recipe_id }) => asResult(await call(token, 'GET', `/recipes/${recipe_id}`)));

  server.registerTool('create_recipe', {
    description: '新建菜谱（含双语名称、食材、步骤）。recipe_type: adult=大人, baby=宝宝；difficulty: easy/normal/hard',
    inputSchema: {
      name: z.string().describe('菜名（中文）'),
      name_en: z.string().optional().describe('菜名（英文）'),
      recipe_type: z.enum(['adult', 'baby']).optional(),
      category: z.string().optional().describe('分类，默认 家常菜'),
      cover_image: z.string().optional().describe('封面 emoji 或图片 URL，默认 🍲'),
      servings: z.number().optional(),
      duration: z.number().optional().describe('总耗时（分钟）'),
      difficulty: z.enum(['easy', 'normal', 'hard']).optional(),
      suitable_age: z.string().optional().describe('适用月龄/年龄（宝宝菜谱用）'),
      notes: z.string().optional(),
      video_url: z.string().optional().describe('视频教程链接（YouTube 等），不校验格式'),
      ingredients: z.array(ingredientShape).optional(),
      steps: z.array(stepShape).optional(),
    },
  }, async (args) => asResult(await call(token, 'POST', '/recipes', args)));

  server.registerTool('update_recipe', {
    description: '修改菜谱。传入的字段覆盖原值；ingredients/steps 传入时整组重建',
    inputSchema: {
      recipe_id: z.number(),
      name: z.string().optional(),
      name_en: z.string().optional(),
      recipe_type: z.enum(['adult', 'baby']).optional(),
      category: z.string().optional(),
      cover_image: z.string().optional(),
      servings: z.number().optional(),
      duration: z.number().optional(),
      difficulty: z.enum(['easy', 'normal', 'hard']).optional(),
      suitable_age: z.string().optional(),
      notes: z.string().optional(),
      video_url: z.string().optional().describe('视频教程链接；传空字符串可清除'),
      ingredients: z.array(ingredientShape).optional(),
      steps: z.array(stepShape).optional(),
    },
  }, async ({ recipe_id, ...rest }) => asResult(await call(token, 'PATCH', `/recipes/${recipe_id}`, rest)));

  server.registerTool('recipe_to_shopping', {
    description: '从菜谱一键生成采购清单（食材自动转为采购项并通知女佣）',
    inputSchema: { recipe_id: z.number() },
  }, async ({ recipe_id }) => asResult(await call(token, 'POST', `/recipes/${recipe_id}/to-shopping`, {})));

  server.registerTool('recipe_to_meal', {
    description: '把菜谱安排到今日菜单。meal_type: breakfast/lunch/dinner，默认 lunch',
    inputSchema: {
      recipe_id: z.number(),
      meal_type: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
      servings: z.number().optional(),
      notes: z.string().optional(),
    },
  }, async ({ recipe_id, ...rest }) => asResult(await call(token, 'POST', `/recipes/${recipe_id}/to-meal`, rest)));

  server.registerTool('get_today_meals', {
    description: '查看今日菜单（已安排的菜谱订单及状态）',
    inputSchema: {},
  }, async () => asResult(await call(token, 'GET', '/meals')));

  server.registerTool('list_shopping_lists', {
    description: '列出全部采购清单（含状态、小票信息、金额核对结果）',
    inputSchema: {},
  }, async () => asResult(await call(token, 'GET', '/shopping')));

  server.registerTool('get_shopping_list', {
    description: '获取单个采购清单详情（含全部采购项）',
    inputSchema: { shopping_list_id: z.number() },
  }, async ({ shopping_list_id }) => asResult(await call(token, 'GET', `/shopping/${shopping_list_id}`)));

  server.registerTool('create_shopping_list', {
    description: '新建采购清单（建单后用 add_shopping_item 逐项加入）',
    inputSchema: {
      title: z.string().optional().describe('清单标题，默认 采购清单'),
      budget: z.number().optional(),
      store_name: z.string().optional(),
      due_time: z.string().optional().describe('期望完成时间 ISO 字符串'),
    },
  }, async (args) => asResult(await call(token, 'POST', '/shopping', args)));

  server.registerTool('add_shopping_item', {
    description: '向采购清单添加一个采购项',
    inputSchema: {
      shopping_list_id: z.number(),
      name: z.string().describe('物品名（中文）'),
      name_en: z.string().optional(),
      quantity: z.number().optional().describe('数量，默认 1'),
      unit: z.string().optional().describe('单位，默认 件'),
      primary_category: z.string().optional().describe('一级分类，默认 食材'),
      secondary_category: z.string().optional().describe('二级分类（食材时有效），如 蔬菜/肉类/调味品'),
      estimated_price: z.number().optional(),
      notes: z.string().optional(),
    },
  }, async ({ shopping_list_id, ...rest }) => asResult(await call(token, 'POST', `/shopping/${shopping_list_id}/items`, rest)));

  return server;
}

// 挂载到现有 Express app：app.all('/mcp/:token')
export function mountMcp(app) {
  app.all('/mcp/:token', async (req, res) => {
    try {
      const server = buildServer(req.params.token);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // 无状态模式，每请求独立
        enableJsonResponse: true,
      });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: 'mcp_error', detail: String(e.message || e) });
    }
  });
  console.log('🔌 MCP server mounted at /mcp/<token>');
}
