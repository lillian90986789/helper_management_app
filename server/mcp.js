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

// 解析视频标题：YouTube 走 oEmbed（无需 key），其他站点抓页面 og:title / <title>
const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
async function fetchVideoTitle(url) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('仅支持 http(s) 链接');
  const yt = url.match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + yt[1])}&format=json`,
      { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`视频不存在或不可访问 (HTTP ${r.status})`);
    const j = await r.json();
    return { title: j.title, author: j.author_name, provider: 'YouTube' };
  }
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`页面不可访问 (HTTP ${r.status})`);
  const html = (await r.text()).slice(0, 200000);
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const title = og?.[1] || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (!title) throw new Error('无法从页面解析标题');
  return { title: decodeEntities(title.trim()), provider: new URL(url).hostname };
}

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

// 解析任务的执行人/区域：名字模糊匹配；区域不存在则自动创建；不填走默认（女佣 + 第一个区域）
async function resolveTask(token, assignee_name, area_name) {
  const boot = await call(token, 'GET', '/bootstrap');
  const match = (list, kw, field) => kw ? list.find((x) => (x[field] || '').toLowerCase().includes(kw.toLowerCase())) : null;
  const assignee = match(boot.users, assignee_name, 'name') || boot.users.find((u) => u.role === 'maid') || boot.users[0];
  let area = match(boot.areas, area_name, 'name');
  if (!area && area_name) area = await call(token, 'POST', '/areas', { name: area_name });
  if (!area) area = boot.areas[0];
  if (!assignee) throw new Error('家庭内没有可指派的成员');
  if (!area) throw new Error('家庭内没有区域');
  return { assignee_id: assignee.user_id, area_id: area.area_id };
}

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
      name: z.string().optional().describe('菜名（中文）；不填且提供 video_url 时自动用视频标题'),
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
  }, async (args) => {
    if (!args.name?.trim() && args.video_url) args.name = (await fetchVideoTitle(args.video_url)).title;
    return asResult(await call(token, 'POST', '/recipes', args));
  });

  server.registerTool('get_video_title', {
    description: '获取视频链接的标题（YouTube 走官方 oEmbed，其他站点解析页面 og:title/<title>）。可用于给菜谱起名',
    inputSchema: { url: z.string().describe('视频页面 http(s) URL') },
  }, async ({ url }) => asResult(await fetchVideoTitle(url)));

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
    description: '把菜谱安排到菜单。meal_type: breakfast/lunch/dinner，默认 lunch；meal_date 任意日期（可提前排下周菜单），不填为今天',
    inputSchema: {
      recipe_id: z.number(),
      meal_type: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
      meal_date: z.string().optional().describe('用餐日期 YYYY-MM-DD，任意日期（如下周），默认今天'),
      servings: z.number().optional(),
      notes: z.string().optional(),
    },
  }, async ({ recipe_id, ...rest }) => asResult(await call(token, 'POST', `/recipes/${recipe_id}/to-meal`, rest)));

  server.registerTool('get_today_meals', {
    description: '查看今日菜单（已安排的菜谱订单及状态）',
    inputSchema: {},
  }, async () => asResult(await call(token, 'GET', '/meals')));

  server.registerTool('get_week_meals', {
    description: '查看某一周的菜单（周一~周日每天的早/午/晚菜品及状态）。week_offset: 0=本周（默认），1=下周，-1=上周',
    inputSchema: { week_offset: z.number().optional().describe('周偏移量，0=本周，1=下周，-1=上周') },
  }, async ({ week_offset }) => asResult(await call(token, 'GET', `/meals/week${week_offset ? `?offset=${week_offset}` : ''}`)));

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
      list_type: z.enum(['family', 'maid']).optional().describe('清单类型：family=家庭采购（默认），maid=女佣食材'),
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

  server.registerTool('create_task', {
    description: '创建一次性临时任务（如"擦阳台玻璃"）。执行人/区域可用名字指定；不填则默认女佣 + 第一个区域。' +
      'priority: normal/important/urgent；require_photo 要求完成时拍照',
    inputSchema: {
      task_name: z.string().describe('任务名（中文）'),
      task_name_en: z.string().optional().describe('任务英文名'),
      description: z.string().optional().describe('任务说明'),
      task_date: z.string().optional().describe('执行日期 YYYY-MM-DD，默认今天'),
      assignee_name: z.string().optional().describe('执行人名字（模糊匹配家庭成员），默认女佣'),
      area_name: z.string().optional().describe('区域名字（模糊匹配，不存在则自动创建），默认第一个区域'),
      priority: z.enum(['normal', 'important', 'urgent']).optional(),
      estimated_duration: z.number().optional().describe('预计时长（分钟），默认 30'),
      require_photo: z.boolean().optional(),
      photo_check_rule: z.string().optional().describe('AI 照片检查规则：女佣提交完成照片时自动按此检查，违反则通知雇主。如"洗衣机洗的衣服里不能有内衣内裤"'),
    },
  }, async ({ assignee_name, area_name, ...rest }) => {
    const { assignee_id, area_id } = await resolveTask(token, assignee_name, area_name);
    return asResult(await call(token, 'POST', '/daily', { ...rest, assignee_id, area_id }));
  });

  server.registerTool('update_task', {
    description: '修改临时任务（名称/说明/日期/执行人/区域/优先级/时长/是否拍照）。只传要改的字段',
    inputSchema: {
      daily_task_id: z.number(),
      task_name: z.string().optional(),
      task_name_en: z.string().optional(),
      description: z.string().optional(),
      task_date: z.string().optional().describe('执行日期 YYYY-MM-DD'),
      assignee_name: z.string().optional().describe('执行人名字（模糊匹配）'),
      area_name: z.string().optional().describe('区域名字（模糊匹配，不存在则自动创建）'),
      priority: z.enum(['normal', 'important', 'urgent']).optional(),
      estimated_duration: z.number().optional(),
      require_photo: z.boolean().optional(),
      photo_check_rule: z.string().optional().describe('AI 照片检查规则；传空字符串可清除'),
    },
  }, async ({ daily_task_id, assignee_name, area_name, ...rest }) => {
    const body = { ...rest };
    if (assignee_name || area_name) {
      const r = await resolveTask(token, assignee_name, area_name);
      if (assignee_name) body.assignee_id = r.assignee_id;
      if (area_name) body.area_id = r.area_id;
    }
    return asResult(await call(token, 'PATCH', `/daily/${daily_task_id}`, body));
  });

  server.registerTool('get_tasks', {
    description: '查看某天的任务清单（含状态、执行人）。date 不填为今天',
    inputSchema: { date: z.string().optional().describe('日期 YYYY-MM-DD，默认今天') },
  }, async ({ date }) => asResult(await call(token, 'GET', `/daily${date ? `?date=${date}` : ''}`)));

  server.registerTool('upload_image', {
    description: '上传图片到应用，返回 /uploads/... 地址，可用作菜谱封面(cover_image)或步骤配图(steps[].image_url)。' +
      '二选一：source_url（服务器抓取该 http(s) 图片，推荐）或 image_base64（小图直传）',
    inputSchema: {
      source_url: z.string().optional().describe('图片外链 http(s) URL，服务器抓取后存储'),
      image_base64: z.string().optional().describe('图片 base64（不含 data: 前缀亦可）'),
      media_type: z.string().optional().describe('MIME 类型，如 image/jpeg，source_url 模式自动识别'),
      kind: z.string().optional().describe('文件名前缀，默认 recipe'),
    },
  }, async ({ source_url, image_base64, media_type, kind }) => {
    if (!image_base64 && !source_url) throw new Error('source_url 与 image_base64 至少提供一个');
    if (source_url) {
      if (!/^https?:\/\//i.test(source_url)) throw new Error('source_url 仅支持 http(s)');
      const r = await fetch(source_url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`抓取失败 HTTP ${r.status}`);
      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) throw new Error(`不是图片（content-type: ${ct.slice(0, 60)}）`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) throw new Error('图片超过 8MB');
      image_base64 = buf.toString('base64');
      media_type = ct.split(';')[0];
    }
    return asResult(await call(token, 'POST', '/upload-avatar', { image_base64, media_type, kind: kind || 'recipe' }));
  });

  return server;
}

// 挂载到现有 Express app：app.all('/mcp/:token')
export function mountMcp(app) {
  app.all('/mcp/:token', async (req, res) => {
    // 无状态模式不提供独立 SSE 流与会话：按 MCP 规范对 GET/DELETE 返回 405，
    // 否则 SDK 会挂起 GET 请求不响应，导致 Claude.ai 连接器探测超时报"无法连接"
    if (req.method === 'GET' || req.method === 'DELETE') {
      return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    }
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
