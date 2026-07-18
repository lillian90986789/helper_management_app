// E2E 测试：模拟 Claude 客户端连接 /mcp/<token>，走完整条菜谱→采购链路
import crypto from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// 与服务端相同的签名逻辑（AUTH_SECRET=testsecret，uid=1 为种子雇主）
const secret = process.env.AUTH_SECRET || 'testsecret';
const token = '1.' + crypto.createHmac('sha256', secret).update('1').digest('hex');

const client = new Client({ name: 'test', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:8080/mcp/${token}`)));

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };
const parse = (r) => JSON.parse(r.content[0].text);

// 1. 工具列表
const tools = (await client.listTools()).tools.map((t) => t.name);
check(`listTools 返回 12 个工具 (${tools.length})`, tools.length === 12);

// 2. 列菜谱（种子有 3 个）
const recipes = parse(await client.callTool({ name: 'list_recipes', arguments: {} }));
check(`list_recipes 返回种子菜谱 (${recipes.length})`, recipes.length === 3);

// 3. 新建宝宝菜谱（真实用例：番茄茄子牛肉烩饭）
const created = parse(await client.callTool({ name: 'create_recipe', arguments: {
  name: '番茄茄子牛肉烩饭', name_en: 'Tomato, Eggplant & Beef Rice Bowl', recipe_type: 'baby',
  duration: 30, difficulty: 'normal', suitable_age: '12月+', cover_image: '🍅',
  ingredients: [
    { name: '牛肉末', name_en: 'Minced beef', quantity: '100', unit: '克' },
    { name: '番茄', name_en: 'Tomato', quantity: '1', unit: '个' },
    { name: '茄子', name_en: 'Eggplant', quantity: '0.25', unit: '根' },
    { name: '熟米饭', name_en: 'Cooked rice', quantity: '1', unit: '碗' },
  ],
  steps: [
    { instruction: '牛肉末用姜擦拭，加淀粉和油腌10分钟，炒至刚熟盛出', instruction_en: 'Rub beef with ginger, marinate 10 mins, stir-fry until just cooked', duration: 15, image_url: '/uploads/recipe_demo.jpg' },
    { instruction: '番茄丁炒软出汁，加入蒸好的茄子拌匀', instruction_en: 'Cook tomato until soft, add steamed eggplant', duration: 10 },
    { instruction: '牛肉回锅，水淀粉勾芡小火5分钟，浇在米饭上', instruction_en: 'Return beef, thicken, simmer 5 mins, serve over rice', duration: 5 },
  ],
} }));
check(`create_recipe 创建成功 id=${created.recipe_id}`, created.recipe_id > 0 && created.ingredients.length === 4);

// 4. 详情读取
const detail = parse(await client.callTool({ name: 'get_recipe', arguments: { recipe_id: created.recipe_id } }));
check('get_recipe 步骤完整', detail.steps.length === 3 && detail.name_en.includes('Beef'));
check('步骤配图 image_url 落库并返回', detail.steps[0].image_url === '/uploads/recipe_demo.jpg' && !detail.steps[1].image_url);

// 上传接口：1x1 PNG，kind=recipe 前缀
const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const up = await fetch('http://127.0.0.1:8080/api/upload-avatar', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
  body: JSON.stringify({ image_base64: png1x1, media_type: 'image/png', kind: 'recipe' }) }).then((r) => r.json());
check(`上传接口 kind 前缀生效 (${up.url})`, /^\/uploads\/recipe_\d+/.test(up.url || ''));
const served = await fetch('http://127.0.0.1:8080' + up.url);
check('上传的图片可通过 /uploads 访问', served.ok);

// MCP upload_image 工具：base64 直传
const mcpUp = parse(await client.callTool({ name: 'upload_image', arguments: { image_base64: png1x1, media_type: 'image/png' } }));
check(`MCP upload_image base64 上传 (${mcpUp.url})`, /^\/uploads\/recipe_\d+/.test(mcpUp.url || ''));
// MCP upload_image 工具：source_url 抓取（用刚上传的图自举，不依赖外网）
const mcpFetch = parse(await client.callTool({ name: 'upload_image', arguments: { source_url: 'http://127.0.0.1:8080' + mcpUp.url } }));
check(`MCP upload_image source_url 抓取 (${mcpFetch.url})`, /^\/uploads\/recipe_\d+/.test(mcpFetch.url || ''));

// 5. 修改
const updated = parse(await client.callTool({ name: 'update_recipe', arguments: { recipe_id: created.recipe_id, notes: '1岁以上可加少量低钠酱油' } }));
check('update_recipe 备注生效', updated.notes.includes('低钠'));

// 6. 一键生成采购清单
const list = parse(await client.callTool({ name: 'recipe_to_shopping', arguments: { recipe_id: created.recipe_id } }));
check(`recipe_to_shopping 生成 ${list.items?.length ?? 0} 项`, (list.items?.length ?? 0) === 4);

// 7. 追加采购项
const item = parse(await client.callTool({ name: 'add_shopping_item', arguments: { shopping_list_id: list.shopping_list_id, name: '低钠酱油', name_en: 'Low-sodium soy sauce', secondary_category: '调味品' } }));
check('add_shopping_item 分类正确', item.secondary_category === '调味品');

// 8. 安排到今日菜单 + 查看
await client.callTool({ name: 'recipe_to_meal', arguments: { recipe_id: created.recipe_id, meal_type: 'dinner' } });
const meals = parse(await client.callTool({ name: 'get_today_meals', arguments: {} }));
check('recipe_to_meal + get_today_meals 闭环', meals.some((m) => m.recipe?.recipe_id === created.recipe_id && m.meal_type === 'dinner'));

// 9. 无效 token 被拒
const badClient = new Client({ name: 'bad', version: '1.0.0' });
let rejected = false;
try {
  await badClient.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8080/mcp/1.deadbeef')));
  await badClient.callTool({ name: 'list_recipes', arguments: {} });
} catch { rejected = true; }
if (!rejected) { // 连接可能成功但调用返回 401 错误内容
  const r = await badClient.callTool({ name: 'list_recipes', arguments: {} }).catch(() => ({ isError: true }));
  rejected = r.isError || (r.content?.[0]?.text || '').includes('401');
}
check('无效 token 无法读取数据', rejected);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
