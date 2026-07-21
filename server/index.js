import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import crypto from 'crypto';
import db from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '15mb' }));

// 演示数据只在显式开启时灌入（SEED_DEMO=1）。生产环境保持空库：
// 每个雇主注册后拥有自己独立、初始为空的家庭。
if (process.env.SEED_DEMO === '1' && db.prepare('SELECT COUNT(*) c FROM Family').get().c === 0) {
  console.log('SEED_DEMO=1 且数据库为空，写入演示种子数据...');
  await import('./seed.js');
}

const api = express.Router();

// ===== 多租户：识别当前登录用户所属的家庭 =====
// 前端每个请求带 X-User-Id 头；据此解析该用户所在家庭，做数据隔离。
api.use((req, res, next) => {
  // 只信任签名令牌（X-Auth-Token / Authorization: Bearer），不再相信明文 X-User-Id
  const raw = req.headers['x-auth-token'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const uid = verifyToken(raw);
  if (uid) {
    const fm = db.prepare("SELECT family_id FROM FamilyMember WHERE user_id=? AND status='active' ORDER BY family_member_id LIMIT 1").get(uid);
    if (fm) {
      req.userId = uid; req.familyId = fm.family_id;
      // 记录最后活跃时间（雇主+女佣通用，1 小时节流，供 3 个月不活跃清理用）
      db.prepare("UPDATE User SET last_login_at=datetime('now','localtime') WHERE user_id=? AND (last_login_at IS NULL OR last_login_at < datetime('now','localtime','-1 hour'))").run(uid);
    }
  }
  // 管理后台走独立的管理员密钥鉴权（adminGuard），此处放行家庭登录校验
  const p = req.path;
  if (p.startsWith('/admin/')) return next();
  // 公共端点无需登录：运行配置、各类登录/注册、女佣凭邀请码加入
  const isPublic = p === '/config' || p === '/join' || p.startsWith('/auth/');
  if (isPublic || req.method === 'OPTIONS') return next();
  if (!req.familyId) return res.status(401).json({ error: 'auth_required' });
  // 订阅到期锁定：业务接口返回 402；订阅/账号相关端点不拦截
  if (SUBSCRIPTION_GATED.some((g) => p.startsWith(g))) {
    const sv = subView(req.familyId);
    if (sv.access_status === 'LOCKED')
      return res.status(402).json({ code: 'SUBSCRIPTION_REQUIRED', message: 'Your family subscription has expired.', subscription_status: sv.status, payment_required: true });
  }
  next();
});
// 当前家庭（按登录用户）。未登录时的受保护端点已被上面拦截，这里必有 familyId。
const curFamily = (req) => db.prepare('SELECT * FROM Family WHERE family_id=?').get(req.familyId);
const famId = (req) => req.familyId;
// 校验某行（含 family_id 字段）属于当前登录家庭，防止跨家庭按 id 访问
const owns = (req, row) => !!row && row.family_id === req.familyId;
// 采购商品无 family_id，经其所属清单校验归属
const ownsItem = (req, itemId) => {
  const row = db.prepare('SELECT sl.family_id FROM ShoppingItem si JOIN ShoppingList sl ON sl.shopping_list_id=si.shopping_list_id WHERE si.shopping_item_id=?').get(itemId);
  return owns(req, row);
};
// 解析 helper_id：仅接受本家庭内的成员，否则回退默认女佣，防止用他家 id 越权读写
const resolveHelperId = (req, raw) => {
  if (raw) {
    const ok = db.prepare("SELECT 1 FROM FamilyMember WHERE user_id=? AND family_id=? AND status='active'").get(+raw, req.familyId);
    if (ok) return +raw;
  }
  return defaultHelperId(req.familyId);
};

// ===== 用户订阅与收费 =====
// 套餐定义（价格可在管理后台修改，存 AppConfig：price_monthly / price_yearly）
const PLAN_DEFS = {
  monthly: { plan_id: 'monthly', name: 'Monthly Subscription', name_zh: '月度订阅', currency: 'SGD', period: 'MONTH', months: 1, default_price: 5.99 },
  yearly:  { plan_id: 'yearly',  name: 'Yearly Subscription',  name_zh: '年度订阅', currency: 'SGD', period: 'YEAR', months: 12, default_price: 59.99 },
};
const planOrig = (id) => {
  const d = PLAN_DEFS[id]; if (!d) return 0;
  const c = getConfig('orig_' + id);
  const p = c != null && c !== '' ? +c : d.default_price;
  return (p >= 0 && isFinite(p)) ? p : d.default_price;
};
const planDiscount = (id) => {   // 折扣百分比（% off），0=无折扣
  const c = getConfig('disc_' + id);
  const p = c != null && c !== '' ? +c : 0;
  return (p >= 0 && p <= 100 && isFinite(p)) ? p : 0;
};
const planPrice = (id) => +(planOrig(id) * (1 - planDiscount(id) / 100)).toFixed(2);   // 实收价（折后）
const plan = (id) => { const d = PLAN_DEFS[id]; return d ? { ...d, original_price: planOrig(id), discount_percent: planDiscount(id), price: planPrice(id) } : null; };
const PLANS = new Proxy({}, { get: (_, k) => plan(k) });   // 兼容 PLANS[id] 写法，价格实时取
// 当地时区（默认新加坡）。db.js 已设 process.env.TZ；这里再兜底一次，确保 new Date()/localStamp 一致。
process.env.TZ = process.env.TZ || 'Asia/Singapore';
// 生成"当地墙钟时间"字符串 YYYY-MM-DD HH:MM:SS（与 SQLite datetime('now','localtime') 同格式，便于比较与显示）
const localStamp = (d = new Date()) => d.toLocaleString('sv-SE');
// 加自然月（末日对齐：1/31 + 1月 → 2/28）
function addMonths(date, n) {
  const d = new Date(date); const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d;
}
const getConfig = (k) => { const r = db.prepare('SELECT config_value FROM AppConfig WHERE config_key=?').get(k); return r ? r.config_value : null; };
const setConfig = (k, v) => db.prepare(`INSERT INTO AppConfig (config_key,config_value,updated_at) VALUES (?,?,datetime('now','localtime'))
  ON CONFLICT(config_key) DO UPDATE SET config_value=excluded.config_value, updated_at=datetime('now','localtime')`).run(k, String(v ?? ''));
// ===== 机器翻译（Google Translate，按需 + 缓存；未配 Key 则回退原文）=====
const LANGS = ['zh', 'en', 'id', 'my'];
const reqLang = (req) => { const l = req.headers['x-lang']; return LANGS.includes(l) ? l : 'zh'; };
const translateEnabled = () => !!process.env.GOOGLE_TRANSLATE_API_KEY;
const hasCJK = (s) => typeof s === 'string' && /[一-鿿]/.test(s);
const trCacheGet = (lang, text) => { const r = db.prepare('SELECT translated_text FROM Translation WHERE target_lang=? AND source_text=?').get(lang, text); return r ? r.translated_text : null; };
const trCacheSet = (lang, text, val) => { try { db.prepare('INSERT OR REPLACE INTO Translation (target_lang, source_text, translated_text) VALUES (?,?,?)').run(lang, text, val); } catch {} };
async function googleTranslate(texts, target) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  const r = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + key, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: texts, target, source: 'zh-CN', format: 'text' }),
  });
  const d = await r.json();
  if (!r.ok || !d.data) throw new Error('translate_failed');
  return d.data.translations.map((x) => x.translatedText);
}
// 批量翻译一组中文串到 lang，返回取值函数 f(text)->译文（未含中文/失败则回退原文）
async function trMany(texts, lang) {
  const passthrough = (t) => t;
  if (lang === 'zh') return passthrough;
  const uniq = [...new Set(texts.filter(hasCJK))];
  if (uniq.length === 0) return passthrough;
  const out = {}; const need = [];
  for (const t of uniq) { const c = trCacheGet(lang, t); if (c != null) out[t] = c; else need.push(t); }
  if (need.length && translateEnabled()) {
    try {
      // Google 缅甸语码为 'my'、印尼 'id'、英文 'en'
      const results = await googleTranslate(need, lang);
      need.forEach((t, i) => { out[t] = results[i]; trCacheSet(lang, t, results[i]); });
    } catch (e) { /* 失败：保留原文 */ }
  }
  return (t) => (hasCJK(t) && out[t]) || t;
}
// 本地化女佣端展示字段：把中文字段翻译后放进对应 _en 字段（前端 pick 消费）；description 直接替换
async function localizeTasks(req, tasks) {
  const lang = reqLang(req); if (lang === 'zh' || !Array.isArray(tasks)) return tasks;
  const pool = [];
  for (const t of tasks) { pool.push(t.title, t.description); (t.checklist || []).forEach((c) => pool.push(c.title)); }
  const f = await trMany(pool, lang);
  for (const t of tasks) {
    if (hasCJK(t.title)) t.title_en = f(t.title);
    if (hasCJK(t.description)) t.description = f(t.description);
    (t.checklist || []).forEach((c) => { if (hasCJK(c.title)) c.title_en = f(c.title); });
  }
  return tasks;
}
async function localizeRecipes(req, recipes) {
  const lang = reqLang(req); if (lang === 'zh') return recipes;
  const list = Array.isArray(recipes) ? recipes : [recipes];
  const pool = [];
  for (const r of list) { if (!r) continue; pool.push(r.name); (r.ingredients || []).forEach((i) => pool.push(i.name)); (r.steps || []).forEach((s) => pool.push(s.instruction)); }
  const f = await trMany(pool, lang);
  for (const r of list) {
    if (!r) continue;
    if (hasCJK(r.name)) r.name_en = f(r.name);
    (r.ingredients || []).forEach((i) => { if (hasCJK(i.name)) i.name_en = f(i.name); });
    (r.steps || []).forEach((s) => { if (hasCJK(s.instruction)) s.instruction_en = f(s.instruction); });
  }
  return recipes;
}
async function localizeLists(req, lists) {
  const lang = reqLang(req); if (lang === 'zh') return lists;
  const arr = Array.isArray(lists) ? lists : [lists];
  const pool = [];
  for (const l of arr) { if (!l) continue; (l.items || []).forEach((i) => pool.push(i.name)); }
  const f = await trMany(pool, lang);
  for (const l of arr) { if (!l) continue; (l.items || []).forEach((i) => { if (hasCJK(i.name)) i.name_en = f(i.name); }); }
  return lists;
}

// ===== 登录令牌（HMAC 签名，防止伪造 X-User-Id 冒充他人）=====
let _authSecret = null;
function authSecret() {
  if (_authSecret) return _authSecret;
  _authSecret = process.env.AUTH_SECRET || getConfig('auth_secret');
  if (!_authSecret) { _authSecret = crypto.randomBytes(32).toString('hex'); setConfig('auth_secret', _authSecret); }
  return _authSecret;
}
function signToken(userId) {
  const p = String(userId);
  return p + '.' + crypto.createHmac('sha256', authSecret()).update(p).digest('hex');
}
function verifyToken(token) {
  if (!token || typeof token !== 'string') return 0;
  const i = token.indexOf('.'); if (i < 0) return 0;
  const p = token.slice(0, i), sig = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', authSecret()).update(p).digest('hex');
  if (sig.length !== expect.length) return 0;
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return 0; } catch { return 0; }
  const uid = +p; return Number.isInteger(uid) && uid > 0 ? uid : 0;
}
// 无订阅记录则新建 1 个自然月免费试用（注册时/存量家庭首次访问时）
function ensureSubscription(familyId) {
  let s = db.prepare('SELECT * FROM FamilySubscription WHERE family_id=?').get(familyId);
  if (!s) {
    const now = new Date();
    db.prepare(`INSERT INTO FamilySubscription (family_id, plan_id, status, trial_start_at, trial_end_at, access_status, updated_at)
      VALUES (?, 'trial', 'TRIAL_ACTIVE', ?, ?, 'ACTIVE', datetime('now','localtime'))`).run(familyId, now.toISOString(), addMonths(now, 1).toISOString());
    s = db.prepare('SELECT * FROM FamilySubscription WHERE family_id=?').get(familyId);
  }
  return s;
}
// 计算订阅视图（状态/有效期/剩余天数/access），并回写状态便于后台过滤
function subView(familyId) {
  const s = ensureSubscription(familyId);
  const now = new Date();
  const times = [s.trial_end_at, s.current_period_end_at].filter(Boolean).map((x) => new Date(x).getTime());
  const paid = !!s.current_period_end_at;
  const expire = new Date(times.length ? Math.max(...times) : now.getTime());
  const active = now.getTime() < expire.getTime();
  const daysLeft = Math.max(0, Math.ceil((expire.getTime() - now.getTime()) / 86400000));
  let status;
  if (!active) status = 'EXPIRED';
  else if (paid) status = (s.plan_id === 'yearly' ? daysLeft <= 30 : daysLeft <= 3) ? 'EXPIRING_SOON' : 'ACTIVE';
  else status = 'TRIAL_ACTIVE';
  const access_status = active ? 'ACTIVE' : 'LOCKED';
  if (s.status !== status || s.access_status !== access_status)
    db.prepare("UPDATE FamilySubscription SET status=?, access_status=?, updated_at=datetime('now','localtime') WHERE family_id=?").run(status, access_status, familyId);
  return { subscription_id: s.subscription_id, family_id: familyId, plan_id: s.plan_id, is_trial: !paid,
    status, access_status, trial_start_at: s.trial_start_at, trial_end_at: s.trial_end_at,
    current_period_start_at: s.current_period_start_at, current_period_end_at: s.current_period_end_at,
    expire_at: expire.toISOString(), remaining_days: daysLeft, active };
}
// 开通/续期（幂等；据规则计算新到期：仍有效则叠加，否则从现在起算）
function activateSubscription(order, opts = {}) {
  const fresh = db.prepare('SELECT * FROM PaymentOrder WHERE payment_order_id=?').get(order.payment_order_id);
  if (fresh && fresh.status === 'PAID') return subView(order.family_id);   // 幂等
  const plan = PLANS[order.plan_id] || PLANS.monthly;
  const now = new Date();
  const s = ensureSubscription(order.family_id);
  const times = [s.trial_end_at, s.current_period_end_at].filter(Boolean).map((x) => new Date(x).getTime());
  const latest = times.length ? Math.max(...times) : 0;
  const base = latest > now.getTime() ? new Date(latest) : now;
  const newEnd = addMonths(base, plan.months);
  const tx = db.transaction(() => {
    db.prepare("UPDATE PaymentOrder SET status='PAID', paid_at=datetime('now','localtime'), confirmed_by=?, updated_at=datetime('now','localtime') WHERE payment_order_id=?").run(opts.by || 'super', order.payment_order_id);
    db.prepare(`UPDATE FamilySubscription SET plan_id=?, status='ACTIVE', access_status='ACTIVE',
        current_period_start_at=?, current_period_end_at=?, last_payment_order_id=?, updated_at=datetime('now','localtime') WHERE family_id=?`)
      .run(plan.plan_id, base.toISOString(), newEnd.toISOString(), order.payment_order_id, order.family_id);
    db.prepare(`INSERT INTO SubscriptionHistory (family_id, old_status, new_status, old_expire_at, new_expire_at, plan_id, reason, payment_order_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(order.family_id, s.status, 'ACTIVE', latest ? new Date(latest).toISOString() : null, newEnd.toISOString(), plan.plan_id, opts.reason || 'payment_confirmed', order.payment_order_id);
    notify(order.family_id, 'subscription', '订阅已开通', `${plan.name_zh}已开通，有效期至 ${newEnd.toISOString().slice(0, 10)}`, 'subscription', order.payment_order_id, 'employer');
    notify(order.family_id, 'subscription', '家庭订阅已恢复', '现在可以继续使用任务、菜谱和采购功能', 'subscription', order.payment_order_id, 'maid');
  });
  tx();
  return subView(order.family_id);
}
// 到期锁定：这些业务前缀在 LOCKED 时返回 402
const SUBSCRIPTION_GATED = ['/daily', '/week', '/month', '/stats', '/templates', '/recipes', '/meals', '/shopping', '/items', '/rest-days', '/expense', '/categories', '/checklist', '/dashboard'];
// 管理员鉴权（MVP：单超级管理员密钥 ADMIN_KEY）
const adminGuard = (req, res, next) => {
  const key = process.env.ADMIN_KEY;
  if (!key) return res.status(403).json({ error: 'admin_disabled' });
  if ((req.headers['x-admin-key'] || '') !== key) return res.status(401).json({ error: 'bad_admin_key' });
  next();
};
const audit = (req, action, t = {}) => db.prepare(`INSERT INTO AdminAuditLog (admin_id, action_type, target_user_id, target_family_id, target_payment_order_id, old_value, new_value, reason, ip_address)
  VALUES ('super', ?,?,?,?,?,?,?,?)`).run(action, t.user_id ?? null, t.family_id ?? null, t.order_id ?? null, t.old ?? null, t.new ?? null, t.reason ?? null, req.ip || '');
const familyPaid = (fid) => db.prepare("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM PaymentOrder WHERE family_id=? AND status='PAID'").get(fid);
const userPaid = (uid) => db.prepare("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM PaymentOrder WHERE payer_user_id=? AND status='PAID'").get(uid);
const maskPhone = (p) => (p ? String(p).replace(/.(?=.{4})/g, '*') : '');
const maskEmail = (e) => { if (!e) return ''; const [a, b] = String(e).split('@'); return a.slice(0, 3) + '****@' + (b || ''); };
// 新建一个独立且初始为空的家庭（含默认区域，但无任务/菜单/采购）
function createEmptyFamily(familyName) {
  const code = 'HOME-' + Math.floor(1000 + Math.random() * 9000);
  const fid = db.prepare("INSERT INTO Family (family_name, invite_code, default_language, status) VALUES (?,?, 'zh', 'active')")
    .run((familyName || '').trim() || '我的家庭', code).lastInsertRowid;
  DEFAULT_AREAS.slice(0, 6).forEach(([n, en, ic], i) =>
    db.prepare("INSERT INTO Area (family_id,name,name_en,icon,sort_order,status) VALUES (?,?,?,?,?, 'active')").run(fid, n, en, ic, i));
  return db.prepare('SELECT * FROM Family WHERE family_id=?').get(fid);
}

// ---- 辅助 ----
const log = (taskId, actorId, action, from, to) =>
  db.prepare(`INSERT INTO TaskLog (task_id,actor_id,action,from_status,to_status) VALUES (?,?,?,?,?)`).run(taskId, actorId, action, from, to);
// toUserId 非空时只有该用户能看到（如休息日只通知对应女佣）；为空则按 toRole 群发
const notify = (familyId,type,title,content,refType,refId,toRole,toUserId=null) =>
  db.prepare(`INSERT INTO Notification (family_id,type,title,content,ref_type,ref_id,to_role,to_user_id) VALUES (?,?,?,?,?,?,?,?)`).run(familyId,type,title,content,refType,refId,toRole,toUserId);

// 前端可读的运行时配置（是否启用 Google 登录）
api.get('/config', (req, res) => res.json({ google_client_id: process.env.GOOGLE_CLIENT_ID || null }));

// Google（Gmail）登录：验证 ID Token → 以雇主身份登录到现有家庭
api.post('/auth/google', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'google_not_configured' });
  const credential = req.body.credential;
  if (!credential) return res.status(400).json({ error: 'credential_required' });
  // 用 Google tokeninfo 端点验证 ID Token（自托管低频场景足够）
  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    info = await r.json();
  } catch (e) { return res.status(502).json({ error: 'verify_failed' }); }
  if (info.aud !== clientId) return res.status(401).json({ error: 'aud_mismatch' });
  if (String(info.email_verified) !== 'true') return res.status(401).json({ error: 'email_unverified' });
  const email = normEmail(info.email);
  // 查找/创建该 Google 雇主用户；新用户 → 新建独立空家庭，老用户 → 用其所属家庭
  let u = db.prepare("SELECT * FROM User WHERE email=? AND role='employer'").get(email);
  let family;
  let isNew = false;
  if (!u) {
    isNew = true;
    family = createEmptyFamily((info.name || email.split('@')[0]) + ' 的家');
    const uid = db.prepare(`INSERT INTO User (name, avatar, email, role, login_method, preferred_language, account_status, registration_status, updated_at, last_login_at)
      VALUES (?,?,?, 'employer', 'google', 'zh', 'active', 'COMPLETED', datetime('now','localtime'), datetime('now','localtime'))`)
      .run(info.name || email.split('@')[0], '👤', email).lastInsertRowid;
    db.prepare("INSERT INTO FamilyMember (family_id, user_id, role, permissions, status) VALUES (?,?,?,?,?)")
      .run(family.family_id, uid, 'employer', 'owner', 'active');
    u = db.prepare('SELECT * FROM User WHERE user_id=?').get(uid);
  } else {
    db.prepare("UPDATE User SET name=COALESCE(NULLIF(name,''), ?), login_method='google', last_login_at=datetime('now','localtime') WHERE user_id=?")
      .run(info.name || null, u.user_id);
    u = db.prepare('SELECT * FROM User WHERE user_id=?').get(u.user_id);
    const fm = db.prepare("SELECT family_id FROM FamilyMember WHERE user_id=? AND status='active' ORDER BY family_member_id LIMIT 1").get(u.user_id);
    family = fm ? db.prepare('SELECT * FROM Family WHERE family_id=?').get(fm.family_id) : createEmptyFamily((u.name || 'My') + ' 的家');
    if (!fm) db.prepare("INSERT INTO FamilyMember (family_id, user_id, role, permissions, status) VALUES (?,?,?,?,?)").run(family.family_id, u.user_id, 'employer', 'owner', 'active');
  }
  res.json({ ok: true, token: signToken(u.user_id), is_new: isNew, user: { user_id: u.user_id, name: u.name, avatar: u.avatar, email },
    family: { family_id: family.family_id, family_name: family.family_name } });
});
// 老用户绑定 Gmail：已登录用户把自己的 Google 邮箱绑到当前账号，之后可用 Google 一键登录进原家庭
api.post('/auth/google/bind', async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: 'auth_required' });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'google_not_configured' });
  const credential = req.body.credential;
  if (!credential) return res.status(400).json({ error: 'credential_required' });
  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    info = await r.json();
  } catch (e) { return res.status(502).json({ error: 'verify_failed' }); }
  if (info.aud !== clientId) return res.status(401).json({ error: 'aud_mismatch' });
  if (String(info.email_verified) !== 'true') return res.status(401).json({ error: 'email_unverified' });
  const email = normEmail(info.email);
  // 该 Gmail 若已绑到别的账号则拒绝，避免两个账号抢同一邮箱
  const taken = db.prepare('SELECT user_id FROM User WHERE email=? AND user_id<>?').get(email, req.userId);
  if (taken) return res.status(409).json({ error: 'email_taken' });
  db.prepare("UPDATE User SET email=?, login_method='google', updated_at=datetime('now','localtime') WHERE user_id=?").run(email, req.userId);
  res.json({ ok: true, email });
});

// 女佣用 Google 凭邀请码加入家庭：以 Gmail 作女佣唯一标识，避免每次加入都新建账号。
// 复用规则：① 该 Gmail 已有女佣账号 → 直接复用（跨设备/重进都同一人，杜绝重复号）；
//          ② 否则若本家庭已有「无邮箱的女佣号」（此前用邀请码建的，雇主的任务/休息日就绑在它上面）→ 认领它并写入邮箱，
//             让雇主已设的任务/休息日立刻对得上；③ 都没有才新建。
api.post('/auth/google/join', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'google_not_configured' });
  const { credential, invite_code, preferred_language } = req.body;
  if (!credential) return res.status(400).json({ error: 'credential_required' });
  if (!invite_code) return res.status(400).json({ error: 'invite_code_required' });
  const family = db.prepare('SELECT * FROM Family WHERE invite_code = ?').get(String(invite_code).trim().toUpperCase());
  if (!family) return res.status(404).json({ error: 'invalid_code' });
  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    info = await r.json();
  } catch (e) { return res.status(502).json({ error: 'verify_failed' }); }
  if (info.aud !== clientId) return res.status(401).json({ error: 'aud_mismatch' });
  if (String(info.email_verified) !== 'true') return res.status(401).json({ error: 'email_unverified' });
  const email = normEmail(info.email);
  const lang = preferred_language || info.locale || 'en';
  const gname = info.name || (req.body.name && String(req.body.name).trim()) || email.split('@')[0];

  const result = db.transaction(() => {
    // 该 Gmail 若已是雇主账号，禁止再作为女佣加入（一个邮箱一种身份，避免唯一索引冲突）
    const asEmployer = db.prepare("SELECT 1 FROM User WHERE email=? AND role='employer'").get(email);
    if (asEmployer) return { error: 'email_is_employer' };
    let uid;
    let isNew = false;
    const existing = db.prepare("SELECT * FROM User WHERE email=? AND role='maid'").get(email);
    if (existing) {
      uid = existing.user_id;
      db.prepare("UPDATE User SET login_method='google', preferred_language=COALESCE(preferred_language,?), account_status='active', last_login_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE user_id=?")
        .run(lang, uid);
    } else {
      // 认领本家庭内「无邮箱、默认女佣（最小 id）」的旧账号——雇主的任务/休息日正是绑在它上面
      const legacy = db.prepare("SELECT u.* FROM User u JOIN FamilyMember fm ON fm.user_id=u.user_id WHERE fm.family_id=? AND u.role='maid' AND fm.status='active' AND (u.email IS NULL OR u.email='') ORDER BY u.user_id LIMIT 1").get(family.family_id);
      if (legacy) {
        uid = legacy.user_id;
        db.prepare("UPDATE User SET email=?, login_method='google', preferred_language=COALESCE(NULLIF(preferred_language,''),?), account_status='active', last_login_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE user_id=?")
          .run(email, lang, uid);
      } else {
        isNew = true;
        const pool = AVATARS.maid;
        const avatar = pool[Math.floor(Math.random() * pool.length)];
        uid = db.prepare(`INSERT INTO User (name, avatar, email, role, login_method, preferred_language, account_status, last_login_at, updated_at)
          VALUES (?,?,?, 'maid', 'google', ?, 'active', datetime('now','localtime'), datetime('now','localtime'))`)
          .run(gname, avatar, email, lang).lastInsertRowid;
      }
    }
    // 确保该女佣在本家庭内有一条 active 成员记录（重进/曾被移除时复活，避免重复插入）
    const mem = db.prepare('SELECT * FROM FamilyMember WHERE family_id=? AND user_id=?').get(family.family_id, uid);
    if (mem) {
      if (mem.status !== 'active') db.prepare("UPDATE FamilyMember SET status='active' WHERE family_member_id=?").run(mem.family_member_id);
    } else {
      db.prepare("INSERT INTO FamilyMember (family_id, user_id, role, status) VALUES (?,?,?,?)").run(family.family_id, uid, 'maid', 'active');
    }
    return { uid, isNew };
  })();

  if (result.error) return res.status(409).json({ error: result.error });
  const u = db.prepare('SELECT user_id,name,avatar,email FROM User WHERE user_id=?').get(result.uid);
  if (result.isNew) notify(family.family_id, 'system', '女佣加入家庭', `${u.name} 通过 Google 加入`, 'member', u.user_id, 'employer');
  res.json({ token: signToken(u.user_id), user_id: u.user_id, family_id: family.family_id,
    family_name: family.family_name, name: u.name, avatar: u.avatar, email: u.email, is_new: result.isNew });
});

// 女佣已加入并绑定过 Google 后，直接用 Google 登录（无需再输邀请码）。按 email 匹配已有女佣账号。
api.post('/auth/google/maid-login', async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'google_not_configured' });
  const credential = req.body.credential;
  if (!credential) return res.status(400).json({ error: 'credential_required' });
  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return res.status(401).json({ error: 'invalid_token' });
    info = await r.json();
  } catch (e) { return res.status(502).json({ error: 'verify_failed' }); }
  if (info.aud !== clientId) return res.status(401).json({ error: 'aud_mismatch' });
  if (String(info.email_verified) !== 'true') return res.status(401).json({ error: 'email_unverified' });
  const email = normEmail(info.email);
  const u = db.prepare("SELECT * FROM User WHERE email=? AND role='maid' AND COALESCE(account_status,'active')<>'removed'").get(email);
  if (!u) return res.status(404).json({ error: 'maid_not_found' });        // 该 Gmail 还没绑定女佣账号 → 请先用邀请码加入
  const fm = db.prepare("SELECT family_id FROM FamilyMember WHERE user_id=? AND status='active' ORDER BY family_member_id LIMIT 1").get(u.user_id);
  if (!fm) return res.status(404).json({ error: 'maid_not_in_family' });   // 账号存在但已被移出家庭
  const family = db.prepare('SELECT family_id, family_name FROM Family WHERE family_id=?').get(fm.family_id);
  db.prepare("UPDATE User SET login_method='google', last_login_at=datetime('now','localtime') WHERE user_id=?").run(u.user_id);
  res.json({ token: signToken(u.user_id), user_id: u.user_id, name: u.name, avatar: u.avatar, email,
    family_id: family.family_id, family_name: family.family_name });
});

// ---- 引导/家庭/用户 ----
api.get('/bootstrap', (req, res) => {
  const family = curFamily(req);
  const users = db.prepare(`SELECT u.* FROM User u JOIN FamilyMember fm ON fm.user_id=u.user_id
    WHERE fm.family_id=? AND fm.status='active' ORDER BY fm.family_member_id`).all(family.family_id);
  const areas = db.prepare('SELECT * FROM Area WHERE family_id=?').all(family.family_id);
  res.json({ family, users, areas });
});

// 新增家庭区域（如 卫生间/卧室/宝宝区域）
api.post('/areas', (req, res) => {
  const family = curFamily(req);
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  const dup = db.prepare('SELECT * FROM Area WHERE family_id=? AND name=?').get(family.family_id, name);
  if (dup) return res.json(dup);
  const id = db.prepare('INSERT INTO Area (family_id,name,name_en,icon) VALUES (?,?,?,?)')
    .run(family.family_id, name, req.body.name_en || '', req.body.icon || '📍').lastInsertRowid;
  res.json(db.prepare('SELECT * FROM Area WHERE area_id=?').get(id));
});

// ---- 家庭成员 / 女佣账号管理 ----
const AVATARS = { maid: ['👩🏽‍🦱','👩🏻‍🦰','👱🏽‍♀️','🧑🏽'], member: ['👩🏻','👨🏻','👵🏻','🧒🏻'], employer: ['👨🏻‍💼'] };
api.get('/members', (req, res) => {
  const family = curFamily(req);
  const rows = db.prepare(`
    SELECT fm.family_member_id, fm.role, fm.status, fm.join_date,
           u.user_id, u.name, u.avatar, u.phone, u.email, u.preferred_language, u.account_status, u.gender, u.birth_date
    FROM FamilyMember fm JOIN User u ON u.user_id = fm.user_id
    WHERE fm.family_id = ? ORDER BY fm.family_member_id`).all(family.family_id);
  res.json({ invite_code: family.invite_code, family_name: family.family_name, members: rows });
});
// 雇主直接添加成员/女佣账号
api.post('/members', (req, res) => {
  const family = curFamily(req);
  const { name, role = 'maid', preferred_language = 'zh', phone = '', email = '', gender = '', birth_date = '' } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const pool = AVATARS[role] || AVATARS.maid;
  const avatar = req.body.avatar || pool[Math.floor(Math.random() * pool.length)];   // emoji 或上传图片 URL
  const uid = db.prepare(`INSERT INTO User (name, avatar, phone, email, role, preferred_language, gender, birth_date, account_status) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(name.trim(), avatar, phone, email, role, preferred_language, gender || null, birth_date || null, 'active').lastInsertRowid;
  db.prepare(`INSERT INTO FamilyMember (family_id, user_id, role, status) VALUES (?,?,?,?)`).run(family.family_id, uid, role, 'active');
  notify(family.family_id, 'system', '新成员加入', `${name} 已加入家庭`, 'member', uid, 'employer');
  res.json({ user_id: uid, name: name.trim(), avatar, role });
});
// 重新生成邀请码
api.post('/family/invite-code', (req, res) => {
  const family = curFamily(req);
  const code = 'HOME-' + Math.floor(1000 + Math.random() * 9000);
  db.prepare('UPDATE Family SET invite_code=? WHERE family_id=?').run(code, family.family_id);
  res.json({ invite_code: code });
});
// 女佣凭邀请码加入家庭（注册）
api.post('/join', (req, res) => {
  const { invite_code, name, preferred_language = 'en' } = req.body;
  const family = db.prepare('SELECT * FROM Family WHERE invite_code = ?').get(invite_code);
  if (!family) return res.status(404).json({ error: 'invalid_code' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const pool = AVATARS.maid;
  const avatar = pool[Math.floor(Math.random() * pool.length)];
  const uid = db.prepare(`INSERT INTO User (name, avatar, role, preferred_language, account_status) VALUES (?,?,?,?,?)`)
    .run(name.trim(), avatar, 'maid', preferred_language, 'active').lastInsertRowid;
  db.prepare(`INSERT INTO FamilyMember (family_id, user_id, role, status) VALUES (?,?,?,?)`).run(family.family_id, uid, 'maid', 'active');
  notify(family.family_id, 'system', '女佣加入家庭', `${name} 通过邀请码加入`, 'member', uid, 'employer');
  res.json({ token: signToken(uid), user_id: uid, family_id: family.family_id, family_name: family.family_name, name: name.trim(), avatar });
});
// 更新用户资料（姓名 / 称呼 / 头像 / 性别 / 出生日期）——雇主、女佣、家庭成员通用
api.patch('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM User WHERE user_id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  // 只能改本家庭内的成员
  const inFam = db.prepare("SELECT 1 FROM FamilyMember WHERE user_id=? AND family_id=? AND status='active'").get(u.user_id, famId(req));
  if (!inFam) return res.status(403).json({ error: 'forbidden' });
  const b = req.body;
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'name_required' });
  db.prepare(`UPDATE User SET name=COALESCE(@name,name), display_name=COALESCE(@display_name,display_name), avatar=COALESCE(@avatar,avatar),
      gender=COALESCE(@gender,gender), birth_date=COALESCE(@birth_date,birth_date), updated_at=datetime('now','localtime') WHERE user_id=@id`)
    .run({ name: b.name !== undefined ? String(b.name).trim() : null, display_name: b.display_name ?? null, avatar: b.avatar ?? null,
      gender: b.gender ?? null, birth_date: b.birth_date ?? null, id: u.user_id });
  res.json(db.prepare('SELECT user_id,name,display_name,avatar,role,preferred_language,gender,birth_date FROM User WHERE user_id=?').get(u.user_id));
});
// 上传本地图片作头像（返回可访问 URL）
api.post('/upload-avatar', (req, res) => {
  const b = req.body;
  const base64 = (b.image_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) return res.status(400).json({ error: 'image_required' });
  const mediaType = b.media_type || 'image/png';
  const ext = (mediaType.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const kind = /^[a-z]{1,12}$/.test(b.kind || '') ? b.kind : 'avatar';
  const fname = `${kind}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  try { fs.writeFileSync(join(uploadsDir, fname), Buffer.from(base64, 'base64')); }
  catch (e) { return res.status(500).json({ error: 'save_failed' }); }
  res.json({ url: `/uploads/${fname}` });
});
api.post('/members/:id/remove', (req, res) => {
  // 成员离开家庭：失去数据访问 + 同步在后台注销账号并释放 Gmail（可重新注册）
  const fm = db.prepare('SELECT * FROM FamilyMember WHERE family_member_id=?').get(req.params.id);
  if (!owns(req, fm)) return res.status(404).json({ error: 'not found' });
  if (fm.user_id === req.userId) return res.status(400).json({ error: 'cannot_remove_self' });
  db.transaction(() => {
    db.prepare('UPDATE FamilyMember SET status=? WHERE family_member_id=?').run('removed', fm.family_member_id);
    // 后台同步：账号标记 removed，释放绑定的 Gmail（email 置空），该 Gmail 之后可重新注册
    db.prepare("UPDATE User SET account_status='removed', email=NULL, updated_at=datetime('now','localtime') WHERE user_id=?").run(fm.user_id);
  })();
  res.json({ ok: true });
});

// ===== 雇主注册功能 =====
const hashPwd = (pwd) => crypto.createHash('sha256').update('homeflow$' + pwd).digest('hex');
const normEmail = (s) => String(s || '').trim().toLowerCase();
const genCode = () => String(Math.floor(100000 + Math.random() * 900000)); // 6 位
const DEFAULT_AREAS = [ // PRD 第 10 节默认区域
  ['客厅', 'Living Room', '🛋️'], ['厨房', 'Kitchen', '🍳'], ['主卧', 'Master Bedroom', '🛏️'],
  ['宝宝房', 'Baby Room', '🧸'], ['厕所', 'Bathroom', '🚿'], ['阳台', 'Balcony', '🪴'],
  ['储藏间', 'Storage', '📦'], ['餐厅', 'Dining Room', '🍽️'], ['其他', 'Other', '🏠'],
];
// PRD 第 18 节：推荐家庭任务模板
const RECOMMENDED_TEMPLATES = [
  { task_name: '每日厨房清洁', task_name_en: 'Daily Kitchen Cleaning', area: '厨房', weekdays: [1, 2, 3, 4, 5, 6, 7], estimated_duration: 30 },
  { task_name: '每日客厅整理', task_name_en: 'Daily Living Room Tidy', area: '客厅', weekdays: [1, 2, 3, 4, 5, 6, 7], estimated_duration: 25 },
  { task_name: '每日宝宝房整理', task_name_en: 'Daily Baby Room Tidy', area: '宝宝房', weekdays: [1, 2, 3, 4, 5, 6, 7], estimated_duration: 20 },
  { task_name: '每周厕所深度清洁', task_name_en: 'Weekly Deep Toilet Clean', area: '厕所', weekdays: [6], estimated_duration: 50, require_photo: 1, require_approval: 1 },
  { task_name: '每周更换床单', task_name_en: 'Weekly Bedsheet Change', area: '主卧', weekdays: [1], estimated_duration: 20 },
  { task_name: '每周清洁冰箱', task_name_en: 'Weekly Fridge Cleaning', area: '厨房', weekdays: [5], estimated_duration: 30 },
  { task_name: '每周清洁洗衣机', task_name_en: 'Weekly Washer Cleaning', area: '厨房', weekdays: [3], estimated_duration: 30 },
  { task_name: '每周采购日用品', task_name_en: 'Weekly Grocery Shopping', area: '其他', weekdays: [6], estimated_duration: 60 },
];

const draftByContact = (contact) => db.prepare('SELECT * FROM RegistrationDraft WHERE contact=?').get(contact);
function saveDraft(channel, contact, status, data) {
  const ex = draftByContact(contact);
  const json = JSON.stringify(data || {});
  if (ex) {
    db.prepare("UPDATE RegistrationDraft SET channel=?, registration_status=?, data=?, updated_at=datetime('now','localtime') WHERE contact=?")
      .run(channel, status, json, contact);
  } else {
    db.prepare('INSERT INTO RegistrationDraft (channel,contact,registration_status,data) VALUES (?,?,?,?)').run(channel, contact, status, json);
  }
  return draftByContact(contact);
}
// 已注册查重（PRD 17）
function contactTaken(channel, contact) {
  if (channel === 'phone') return !!db.prepare("SELECT 1 FROM User WHERE phone=? AND password_hash IS NOT NULL").get(contact);
  return !!db.prepare("SELECT 1 FROM User WHERE email=? AND password_hash IS NOT NULL").get(contact);
}

// 1) 发送验证码（手机/邮箱）—— 演示环境直接回传 dev_code
api.post('/auth/send-code', (req, res) => {
  const channel = req.body.channel === 'email' ? 'email' : 'phone';
  const contact = channel === 'email' ? normEmail(req.body.contact) : String(req.body.contact || '').trim();
  if (!contact) return res.status(400).json({ error: 'contact_required' });
  if (channel === 'phone' && !/^\+?\d{6,15}$/.test(contact.replace(/[\s-]/g, ''))) return res.status(400).json({ error: 'invalid_phone' });
  if (channel === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) return res.status(400).json({ error: 'invalid_email' });
  if (contactTaken(channel, contact)) return res.status(409).json({ error: 'already_registered' });
  // 限频：同一 contact 60 秒内不重复发
  const last = db.prepare('SELECT * FROM VerificationCode WHERE contact=? ORDER BY code_id DESC LIMIT 1').get(contact);
  if (last && (Date.now() - new Date(last.created_at + 'Z').getTime()) < 0) { /* noop，演示放宽 */ }
  const code = genCode();
  const ttlMin = channel === 'email' ? 10 : 5; // PRD：邮箱10分钟 / 手机5分钟
  const expires = new Date(Date.now() + ttlMin * 60000).toISOString();
  db.prepare('INSERT INTO VerificationCode (channel,contact,code,expires_at) VALUES (?,?,?,?)').run(channel, contact, code, expires);
  saveDraft(channel, contact, 'CODE_SENT', { ...(JSON.parse(draftByContact(contact)?.data || '{}')), channel, contact });
  res.json({ ok: true, expires_at: expires, ttl_seconds: ttlMin * 60, dev_code: code }); // dev_code 仅演示用
});

// 2) 校验验证码
api.post('/auth/verify-code', (req, res) => {
  const contact = req.body.channel === 'email' ? normEmail(req.body.contact) : String(req.body.contact || '').trim();
  const code = String(req.body.code || '').trim();
  const rec = db.prepare('SELECT * FROM VerificationCode WHERE contact=? ORDER BY code_id DESC LIMIT 1').get(contact);
  if (!rec) return res.status(400).json({ error: 'no_code' });
  if (rec.attempts >= 5) return res.status(429).json({ error: 'too_many_attempts' });
  if (new Date(rec.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'code_expired' });
  if (rec.code !== code) {
    db.prepare('UPDATE VerificationCode SET attempts=attempts+1 WHERE code_id=?').run(rec.code_id);
    return res.status(400).json({ error: 'code_wrong' });
  }
  db.prepare('UPDATE VerificationCode SET verified=1 WHERE code_id=?').run(rec.code_id);
  const d = draftByContact(contact);
  saveDraft(rec.channel, contact, 'CONTACT_VERIFIED', { ...(JSON.parse(d?.data || '{}')), channel: rec.channel, contact });
  res.json({ ok: true, registration_status: 'CONTACT_VERIFIED' });
});

// 3) 保存草稿（每完成一步即保存，支持中断恢复 PRD 16）
api.post('/auth/draft', (req, res) => {
  const { channel = 'phone', contact, registration_status = 'CONTACT_VERIFIED', data = {} } = req.body;
  if (!contact) return res.status(400).json({ error: 'contact_required' });
  const ex = draftByContact(contact);
  const merged = { ...(JSON.parse(ex?.data || '{}')), ...data };
  if (merged.password) delete merged.password; // 不在草稿明文保存密码
  res.json(saveDraft(channel, contact, registration_status, merged));
});
api.get('/auth/draft', (req, res) => {
  const d = draftByContact(req.query.contact);
  if (!d) return res.json(null);
  res.json({ ...d, data: JSON.parse(d.data || '{}') });
});

// 4) 提交注册：创建雇主账号 + 家庭 + 区域 + （可选）女佣邀请
api.post('/auth/register', (req, res) => {
  const b = req.body;
  const channel = b.channel === 'email' ? 'email' : 'phone';
  const contact = channel === 'email' ? normEmail(b.contact) : String(b.contact || '').trim();
  if (!contact) return res.status(400).json({ error: 'contact_required' });
  if (contactTaken(channel, contact)) return res.status(409).json({ error: 'already_registered' });
  // 密码校验（PRD 7）
  const pwd = String(b.password || '');
  const pwdOk = pwd.length >= 8 && pwd.length <= 32 && /[A-Za-z]/.test(pwd) && /\d/.test(pwd) && pwd.trim().length > 0 && pwd !== contact;
  if (!pwdOk && b.login_method !== 'apple' && b.login_method !== 'google') return res.status(400).json({ error: 'weak_password' });
  if (!b.full_name || !b.full_name.trim()) return res.status(400).json({ error: 'name_required' });
  if (!b.family_name || !b.family_name.trim()) return res.status(400).json({ error: 'family_name_required' });

  const tx = db.transaction(() => {
    // 雇主账号
    const uid = db.prepare(`INSERT INTO User
      (name, avatar, phone, phone_country_code, email, role, login_method, password_hash, display_name, gender,
       preferred_language, notification_language, country, timezone, default_currency, account_status, registration_status, updated_at)
      VALUES (@name,@avatar,@phone,@cc,@email,'employer',@lm,@pwd,@dn,@gender,@lang,@nlang,@country,@tz,@cur,'active','COMPLETED',datetime('now','localtime'))`)
      .run({ name: b.full_name.trim(), avatar: b.avatar_url || '👨🏻‍💼',
        phone: channel === 'phone' ? contact : (b.phone || null), cc: b.phone_country_code || null,
        email: channel === 'email' ? contact : (b.email ? normEmail(b.email) : null),
        lm: b.login_method || channel, pwd: pwd ? hashPwd(pwd) : null, dn: b.display_name || b.full_name.trim(),
        gender: b.gender || null, lang: b.preferred_language || 'zh', nlang: b.notification_language || b.preferred_language || 'zh',
        country: b.country || null, tz: b.timezone || null, cur: b.default_currency || 'SGD' }).lastInsertRowid;
    // 家庭
    const inviteCode = 'HOME-' + Math.floor(1000 + Math.random() * 9000);
    const fam = db.prepare(`INSERT INTO Family
      (family_name, family_avatar_url, country, city, address, timezone, default_language, helper_language, default_currency, week_start_day, invite_code, owner_user_id, creator_user_id, status, updated_at)
      VALUES (@fn,@fa,@country,@city,@addr,@tz,@dl,@hl,@cur,@ws,@code,@uid,@uid,'active',datetime('now','localtime'))`)
      .run({ fn: b.family_name.trim(), fa: b.family_avatar_url || '🏠', country: b.family_country || b.country || null,
        city: b.city || null, addr: b.address || null, tz: b.family_timezone || b.timezone || null,
        dl: b.family_language || b.preferred_language || 'zh', hl: b.helper_language || 'en',
        cur: b.family_currency || b.default_currency || 'SGD', ws: b.week_start_day || 'mon', code: inviteCode, uid }).lastInsertRowid;
    // 雇主作为家庭所有者（PRD 21）
    db.prepare(`INSERT INTO FamilyMember (family_id, user_id, role, permissions, status) VALUES (?,?,?,?,?)`)
      .run(fam, uid, 'employer', 'owner', 'active');
    // 家庭区域（PRD 10）
    const areas = Array.isArray(b.areas) && b.areas.length ? b.areas : DEFAULT_AREAS.slice(0, 6).map(([n, en, icon]) => ({ name: n, name_en: en, icon }));
    areas.forEach((a, i) => db.prepare(`INSERT INTO Area (family_id, name, name_en, icon, sort_order, status) VALUES (?,?,?,?,?, 'active')`)
      .run(fam, a.name, a.name_en || '', a.icon || '🏠', i));
    // 推荐任务模板（PRD 18，雇主选择添加后只需选执行星期）
    const areaIdByName = {};
    db.prepare('SELECT area_id,name FROM Area WHERE family_id=?').all(fam).forEach((a) => { areaIdByName[a.name] = a.area_id; });
    (b.recommended_templates || []).forEach((key) => {
      const tpl = RECOMMENDED_TEMPLATES.find((x) => x.task_name === key);
      if (!tpl) return;
      db.prepare(`INSERT INTO TaskTemplate
        (family_id,task_name,task_name_en,description,area_id,assignee_id,priority,estimated_duration,weekdays,require_photo,minimum_photo_count,require_note,require_approval,notify_employer,sort_order,status,creator_id)
        VALUES (@fam,@n,@ne,'',@area,NULL,'normal',@dur,@wd,@rp,1,0,@ra,1,0,'active',@uid)`)
        .run({ fam, n: tpl.task_name, ne: tpl.task_name_en, area: areaIdByName[tpl.area] || null, dur: tpl.estimated_duration,
          wd: JSON.stringify(tpl.weekdays), rp: tpl.require_photo ? 1 : 0, ra: tpl.require_approval ? 1 : 0, uid });
    });
    // 女佣邀请（PRD 12 / 20）
    let invitation = null;
    if (b.invite) {
      const iv = b.invite;
      const link = `https://homeflow.app/join/${inviteCode}`;
      const expires = new Date(Date.now() + 7 * 86400000).toISOString(); // 有效期 7 天
      const invId = db.prepare(`INSERT INTO FamilyInvitation
        (family_id,inviter_user_id,invitee_name,invitee_phone,invitee_email,invitee_role,invite_code,invite_link,preferred_language,status,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?, 'pending', ?)`)
        .run(fam, uid, iv.name || '', iv.phone || '', iv.email ? normEmail(iv.email) : '', 'maid', inviteCode, link, iv.preferred_language || 'en', expires).lastInsertRowid;
      invitation = db.prepare('SELECT * FROM FamilyInvitation WHERE invitation_id=?').get(invId);
    }
    // 标记草稿完成
    db.prepare("UPDATE RegistrationDraft SET registration_status='COMPLETED', user_id=?, family_id=?, updated_at=datetime('now','localtime') WHERE contact=?").run(uid, fam, contact);
    return { uid, fam, inviteCode, invitation, areaCount: areas.length };
  });

  let r;
  try { r = tx(); } catch (e) { return res.status(500).json({ error: 'register_failed', detail: String(e.message || e) }); }
  const user = db.prepare('SELECT user_id,name,display_name,avatar,role,preferred_language,default_currency FROM User WHERE user_id=?').get(r.uid);
  const family = db.prepare('SELECT * FROM Family WHERE family_id=?').get(r.fam);
  res.json({ ok: true, registration_status: 'COMPLETED', user, family, invite_code: r.inviteCode, invitation: r.invitation, area_count: r.areaCount });
});

// 推荐任务模板清单（供注册新手初始化页展示）
api.get('/auth/recommended-templates', (req, res) => res.json(RECOMMENDED_TEMPLATES));

// ===== 雇主：用户名 + 密码 注册 / 登录（凭据存 SQLite User 表）=====
api.post('/auth/employer/register', (req, res) => {
  const b = req.body;
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  const fullName = (b.full_name || '').trim() || username;
  if (!username || username.length < 3) return res.status(400).json({ error: 'username_required' });   // 用户名至少 3 位
  if (password.length < 6) return res.status(400).json({ error: 'weak_password' });                     // 密码至少 6 位
  if (db.prepare('SELECT 1 FROM User WHERE username=?').get(username)) return res.status(409).json({ error: 'username_taken' });
  const tx = db.transaction(() => {
    // 多租户：每个雇主注册 = 一个全新、独立、初始为空的家庭
    const family = createEmptyFamily((b.family_name || '').trim() || (fullName + '家'));
    const uid = db.prepare(`INSERT INTO User (name, username, password_hash, avatar, role, login_method, preferred_language, account_status, registration_status, updated_at, last_login_at)
      VALUES (?,?,?, '👨🏻‍💼', 'employer', 'password', 'zh', 'active', 'COMPLETED', datetime('now','localtime'), datetime('now','localtime'))`)
      .run(fullName, username, hashPwd(password)).lastInsertRowid;
    db.prepare("INSERT INTO FamilyMember (family_id,user_id,role,permissions,status) VALUES (?,?,?,?,?)").run(family.family_id, uid, 'employer', 'owner', 'active');
    ensureSubscription(family.family_id);   // 注册即开始 1 个月免费试用
    return { uid, family };
  });
  let r; try { r = tx(); } catch (e) { return res.status(500).json({ error: 'register_failed', detail: String(e.message || e) }); }
  const user = db.prepare('SELECT user_id,name,avatar,role,username FROM User WHERE user_id=?').get(r.uid);
  res.json({ ok: true, token: signToken(r.uid), user, family: { family_id: r.family.family_id, family_name: r.family.family_name } });
});

api.post('/auth/employer/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const u = db.prepare("SELECT * FROM User WHERE username=? AND role='employer'").get(username);
  if (!u || !u.password_hash || u.password_hash !== hashPwd(password)) return res.status(401).json({ error: 'invalid_credentials' });
  db.prepare("UPDATE User SET last_login_at=datetime('now','localtime') WHERE user_id=?").run(u.user_id);
  const fm = db.prepare("SELECT family_id FROM FamilyMember WHERE user_id=? AND status='active' ORDER BY family_member_id LIMIT 1").get(u.user_id);
  const family = fm ? db.prepare('SELECT family_id,family_name FROM Family WHERE family_id=?').get(fm.family_id) : null;
  res.json({ ok: true, token: signToken(u.user_id), user: { user_id: u.user_id, name: u.name, avatar: u.avatar, username }, family });
});

// ===== 任务清单模块（修改版）：按星期重复 =====
// ---- 日期工具 ----
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoWeekday = (d) => { const x = d.getDay(); return x === 0 ? 7 : x; }; // 1=周一 … 7=周日
const parseYmd = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
const todayYmd = () => ymd(new Date());
const mondayOf = (d) => { const x = new Date(d); const diff = isoWeekday(x) - 1; x.setDate(x.getDate() - diff); return x; };

// ---- 休息日（任务清单模块：日历 + 休息日设置） ----
// 某天该女佣是否被设为休息日（ACTIVE）
function activeRestDay(dateStr, helperId) {
  if (!helperId) return null;
  return db.prepare("SELECT * FROM HelperRestDay WHERE rest_date=? AND helper_user_id=? AND status='ACTIVE'").get(dateStr, helperId);
}
// 默认女佣（家庭内第一个 maid）
const defaultHelperId = (familyId) => {
  if (!familyId) return null;
  const u = db.prepare("SELECT u.user_id FROM User u JOIN FamilyMember fm ON fm.user_id=u.user_id WHERE fm.family_id=? AND u.role='maid' AND fm.status='active' ORDER BY u.user_id LIMIT 1").get(familyId);
  return u ? u.user_id : null;
};

// ---- 当天任务实例：按需懒生成 + 过期标记"今日未完成" ----
function ensureDailyTasks(dateStr, familyId) {
  if (!familyId) return;
  const family = db.prepare('SELECT * FROM Family WHERE family_id=?').get(familyId);
  if (!family) return;
  const wd = isoWeekday(parseYmd(dateStr));
  const templates = db.prepare("SELECT * FROM TaskTemplate WHERE family_id=? AND status='active'").all(family.family_id);
  for (const tpl of templates) {
    let days = [];
    try { days = JSON.parse(tpl.weekdays || '[]'); } catch {}
    if (!days.includes(wd)) continue;
    // 休息日当天默认不生成普通任务（第 2.2 / 6 节）
    if (activeRestDay(dateStr, tpl.assignee_id)) continue;
    const exists = db.prepare('SELECT 1 FROM DailyTask WHERE task_template_id=? AND task_date=?').get(tpl.task_template_id, dateStr);
    if (exists) continue;
    const id = db.prepare(`INSERT INTO DailyTask
      (task_template_id,family_id,task_date,weekday,assignee_id,task_name_snapshot,task_name_en_snapshot,description_snapshot,area_id,priority,estimated_duration,require_photo,minimum_photo_count,require_note,require_approval,sort_order,status)
      VALUES (@tpl,@fam,@date,@wd,@assignee,@n,@ne,@d,@area,@pri,@dur,@rp,@minp,@rn,@ra,@sort,'today_todo')`)
      .run({ tpl: tpl.task_template_id, fam: family.family_id, date: dateStr, wd, assignee: tpl.assignee_id,
        n: tpl.task_name, ne: tpl.task_name_en, d: tpl.description, area: tpl.area_id, pri: tpl.priority,
        dur: tpl.estimated_duration, rp: tpl.require_photo, minp: tpl.minimum_photo_count, rn: tpl.require_note,
        ra: tpl.require_approval, sort: tpl.sort_order }).lastInsertRowid;
    const cls = db.prepare('SELECT * FROM TaskTemplateChecklist WHERE task_template_id=? ORDER BY sort_order').all(tpl.task_template_id);
    cls.forEach((c, i) => db.prepare(`INSERT INTO DailyTaskChecklist (daily_task_id,title,title_en,required,sort_order) VALUES (?,?,?,?,?)`).run(id, c.title, c.title_en, c.required, i));
  }
  // 过去日期仍未完成 → 标记"今日未完成"（不自动顺延）
  if (dateStr < todayYmd()) {
    db.prepare("UPDATE DailyTask SET status='incomplete' WHERE task_date=? AND status IN ('today_todo','in_progress')").run(dateStr);
  }
}

function dailyWith(t) {
  t.area = t.area_id ? db.prepare('SELECT * FROM Area WHERE area_id=?').get(t.area_id) : null;
  t.assignee = t.assignee_id ? db.prepare('SELECT user_id,name,avatar,role FROM User WHERE user_id=?').get(t.assignee_id) : null;
  t.checklist = db.prepare('SELECT * FROM DailyTaskChecklist WHERE daily_task_id=? ORDER BY sort_order').all(t.daily_task_id);
  t.attachments = db.prepare('SELECT * FROM DailyTaskAttachment WHERE daily_task_id=?').all(t.daily_task_id);
  t.logs = db.prepare('SELECT l.*, u.name actor_name FROM DailyTaskLog l LEFT JOIN User u ON u.user_id=l.actor_id WHERE daily_task_id=? ORDER BY l.log_id DESC').all(t.daily_task_id);
  // 兼容前端旧字段名
  t.task_id = t.daily_task_id; t.title = t.task_name_snapshot; t.title_en = t.task_name_en_snapshot; t.description = t.description_snapshot;
  return t;
}
const dlog = (id, actor, action, from, to) => db.prepare(`INSERT INTO DailyTaskLog (daily_task_id,actor_id,action,from_status,to_status) VALUES (?,?,?,?,?)`).run(id, actor, action, from, to);

// 当天任务清单（女佣/雇主共用）
api.get('/daily', async (req, res) => {
  const date = req.query.date || todayYmd();
  ensureDailyTasks(date, famId(req));
  const rows = db.prepare("SELECT * FROM DailyTask WHERE task_date=? AND family_id=? AND status != 'canceled' ORDER BY sort_order, daily_task_id").all(date, famId(req)).map(dailyWith);
  await localizeTasks(req, rows);
  res.json({ date, tasks: rows });
});
api.get('/daily/:id', async (req, res) => {
  const t = db.prepare('SELECT * FROM DailyTask WHERE daily_task_id=?').get(req.params.id);
  if (!owns(req, t)) return res.status(404).json({ error: 'not found' });
  const one = dailyWith(t); await localizeTasks(req, [one]);
  res.json(one);
});
// 临时任务：一次性派发，不走每周重复模板，直接生成一条 DailyTask（task_template_id=NULL）
api.post('/daily', (req, res) => {
  const family = curFamily(req);
  const b = req.body;
  if (!b.task_name || !String(b.task_name).trim()) return res.status(400).json({ error: 'task_name_required' });
  if (!b.assignee_id) return res.status(400).json({ error: 'assignee_required' });
  if (!b.area_id) return res.status(400).json({ error: 'area_required' });
  const taskDate = /^\d{4}-\d{2}-\d{2}$/.test(b.task_date || '') ? b.task_date : todayYmd();
  const d = parseYmd(taskDate);
  const id = db.prepare(`INSERT INTO DailyTask
    (task_template_id,family_id,task_date,weekday,assignee_id,task_name_snapshot,task_name_en_snapshot,description_snapshot,area_id,priority,estimated_duration,require_photo,minimum_photo_count,require_note,require_approval,sort_order,status)
    VALUES (NULL,@fam,@date,@wd,@assignee,@n,@ne,@d,@area,@pri,@dur,@rp,@minp,@rn,@ra,0,'today_todo')`)
    .run({ fam: family.family_id, date: taskDate, wd: isoWeekday(d), assignee: b.assignee_id,
      n: String(b.task_name).trim(), ne: b.task_name_en || '', d: b.description || '', area: b.area_id,
      pri: ['normal','important','urgent'].includes(b.priority) ? b.priority : 'normal',
      dur: b.estimated_duration || 30, rp: b.require_photo ? 1 : 0, minp: b.minimum_photo_count || 1,
      rn: b.require_note ? 1 : 0, ra: b.require_approval ? 1 : 0 }).lastInsertRowid;
  (Array.isArray(b.reference_images) ? b.reference_images : []).forEach((url) =>
    db.prepare(`INSERT INTO DailyTaskAttachment (daily_task_id,uploader_id,file_type,file_url) VALUES (?,?, 'reference', ?)`).run(id, req.userId, url));
  notify(family.family_id, 'task', '新增临时任务：' + String(b.task_name).trim(), b.description || '', 'task', id, 'maid', b.assignee_id);
  res.json(dailyWith(db.prepare('SELECT * FROM DailyTask WHERE daily_task_id=?').get(id)));
});
// 修改临时任务（雇主编辑：名称/说明/日期/执行人/区域/优先级等；reference_images 传入时整组替换参考图）
api.patch('/daily/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM DailyTask WHERE daily_task_id=?').get(req.params.id);
  if (!owns(req, t)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  if (b.task_name !== undefined && !String(b.task_name).trim()) return res.status(400).json({ error: 'task_name_required' });
  const taskDate = /^\d{4}-\d{2}-\d{2}$/.test(b.task_date || '') ? b.task_date : null;
  db.prepare(`UPDATE DailyTask SET task_name_snapshot=COALESCE(@n,task_name_snapshot), task_name_en_snapshot=COALESCE(@ne,task_name_en_snapshot),
      description_snapshot=COALESCE(@d,description_snapshot), task_date=COALESCE(@date,task_date), weekday=COALESCE(@wd,weekday),
      assignee_id=COALESCE(@assignee,assignee_id), area_id=COALESCE(@area,area_id), priority=COALESCE(@pri,priority),
      estimated_duration=COALESCE(@dur,estimated_duration), require_photo=COALESCE(@rp,require_photo) WHERE daily_task_id=@id`)
    .run({ n: b.task_name !== undefined ? String(b.task_name).trim() : null, ne: b.task_name_en ?? null, d: b.description ?? null,
      date: taskDate, wd: taskDate ? isoWeekday(parseYmd(taskDate)) : null,
      assignee: b.assignee_id ?? null, area: b.area_id ?? null,
      pri: ['normal','important','urgent'].includes(b.priority) ? b.priority : null,
      dur: b.estimated_duration ?? null, rp: b.require_photo === undefined ? null : (b.require_photo ? 1 : 0), id: t.daily_task_id });
  if (Array.isArray(b.reference_images)) {
    db.prepare("DELETE FROM DailyTaskAttachment WHERE daily_task_id=? AND file_type='reference'").run(t.daily_task_id);
    b.reference_images.forEach((url) =>
      db.prepare(`INSERT INTO DailyTaskAttachment (daily_task_id,uploader_id,file_type,file_url) VALUES (?,?, 'reference', ?)`).run(t.daily_task_id, req.userId, url));
  }
  res.json(dailyWith(db.prepare('SELECT * FROM DailyTask WHERE daily_task_id=?').get(t.daily_task_id)));
});
api.post('/daily/:id/transition', (req, res) => {
  const t = db.prepare('SELECT * FROM DailyTask WHERE daily_task_id=?').get(req.params.id);
  if (!owns(req, t)) return res.status(404).json({ error: 'not found' });
  const { to, actor_id, action, note } = req.body;
  const now = localStamp();
  const patch = { status: to, note: note ?? t.note };
  if (to === 'in_progress' && !t.started_at) patch.started_at = now;
  if (to === 'pending_review' || (to === 'done' && !t.require_approval)) patch.submitted_at = now;
  if (to === 'done') patch.completed_at = now;
  if (to === 'returned') patch.reject_reason = note ?? null;
  db.prepare(`UPDATE DailyTask SET status=@status, note=@note,
      started_at=COALESCE(@started_at,started_at), submitted_at=COALESCE(@submitted_at,submitted_at),
      completed_at=COALESCE(@completed_at,completed_at), reject_reason=COALESCE(@reject_reason,reject_reason),
      confirmed_at=CASE WHEN @status='done' THEN @now ELSE confirmed_at END,
      reviewer_id=CASE WHEN @status IN ('done','returned') THEN @actor ELSE reviewer_id END
    WHERE daily_task_id=@id`)
    .run({ status: to, note: patch.note ?? null, started_at: patch.started_at ?? null, submitted_at: patch.submitted_at ?? null,
      completed_at: patch.completed_at ?? null, reject_reason: patch.reject_reason ?? null, now, actor: actor_id || 1, id: t.daily_task_id });
  dlog(t.daily_task_id, actor_id || 1, action || ('→' + to), t.status, to);
  const name = t.task_name_snapshot;
  if (to === 'pending_review') notify(t.family_id, 'task', '任务待确认：' + name, '女佣已完成，等待确认', 'task', t.daily_task_id, 'employer');
  if (to === 'done') notify(t.family_id, 'task', '任务已确认：' + name, '雇主已确认完成', 'task', t.daily_task_id, 'maid');
  if (to === 'returned') notify(t.family_id, 'task', '任务被退回：' + name, note || '需要重做', 'task', t.daily_task_id, 'maid');
  res.json(dailyWith(db.prepare('SELECT * FROM DailyTask WHERE daily_task_id=?').get(t.daily_task_id)));
});
api.post('/checklist/:id/toggle', (req, res) => {
  const c = db.prepare('SELECT * FROM DailyTaskChecklist WHERE checklist_id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const parent = db.prepare('SELECT family_id FROM DailyTask WHERE daily_task_id=?').get(c.daily_task_id);
  if (!owns(req, parent)) return res.status(404).json({ error: 'not found' });
  const ns = c.status === 'done' ? 'todo' : 'done';
  db.prepare('UPDATE DailyTaskChecklist SET status=? WHERE checklist_id=?').run(ns, c.checklist_id);
  res.json({ ...c, status: ns });
});
api.post('/daily/:id/attachment', (req, res) => {
  const t = db.prepare('SELECT family_id FROM DailyTask WHERE daily_task_id=?').get(req.params.id);
  if (!owns(req, t)) return res.status(404).json({ error: 'not found' });
  const { file_url, file_type, uploader_id } = req.body;
  db.prepare('INSERT INTO DailyTaskAttachment (daily_task_id,uploader_id,file_type,file_url) VALUES (?,?,?,?)').run(req.params.id, uploader_id || 2, file_type || 'image', file_url);
  res.json(db.prepare('SELECT * FROM DailyTaskAttachment WHERE daily_task_id=?').all(req.params.id));
});

// 周视图：某周 7 天的任务汇总（雇主端星期切换栏，含休息日标记）
api.get('/week', (req, res) => {
  const start = req.query.start ? parseYmd(req.query.start) : mondayOf(new Date());
  const helperId = resolveHelperId(req, req.query.helper_id);
  const mon = mondayOf(start);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const ds = ymd(d);
    ensureDailyTasks(ds, famId(req));
    const tasks = db.prepare("SELECT status FROM DailyTask WHERE task_date=? AND family_id=? AND status != 'canceled'").all(ds, famId(req));
    const done = tasks.filter((t) => t.status === 'done').length;
    const incomplete = tasks.filter((t) => t.status === 'incomplete').length;
    const pending_review = tasks.filter((t) => t.status === 'pending_review').length;
    days.push({ date: ds, weekday: i + 1, total: tasks.length, done, incomplete, pending_review,
      undone: tasks.length - done, isToday: ds === todayYmd(), isRestDay: !!activeRestDay(ds, helperId) });
  }
  res.json({ start: ymd(mon), end: days[6].date, days });
});

// ===== 休息日与任务日历（任务清单模块：日历查看 + 休息日设置） =====
const wdNameEn = (n) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][n] || '';
function restDayView(r) {
  return { ...r, weekday_name: wdName(r.weekday), weekday_name_en: wdNameEn(r.weekday) };
}

// 月视图日历：某月每天任务汇总 + 休息日标记（女佣/雇主共用）
api.get('/month', (req, res) => {
  const now = new Date();
  const year = req.query.year ? +req.query.year : now.getFullYear();
  const month = req.query.month ? +req.query.month : now.getMonth() + 1; // 1-12
  const helperId = resolveHelperId(req, req.query.helper_id);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWd = isoWeekday(new Date(year, month - 1, 1)); // 该月 1 号是周几
  const days = [];
  let mTotal = 0, mDone = 0;
  for (let dd = 1; dd <= daysInMonth; dd++) {
    const dObj = new Date(year, month - 1, dd);
    const ds = ymd(dObj);
    ensureDailyTasks(ds, famId(req));
    // 家庭级可见：日历按家庭汇总当天任务（同家庭女佣都能看到雇主设置的全部）
    const tasks = db.prepare("SELECT status FROM DailyTask WHERE task_date=? AND family_id=? AND status != 'canceled'").all(ds, famId(req));
    const done = tasks.filter((t) => t.status === 'done').length;
    const incomplete = tasks.filter((t) => t.status === 'incomplete').length;
    const pending_review = tasks.filter((t) => t.status === 'pending_review').length;
    mTotal += tasks.length; mDone += done;
    days.push({ date: ds, day: dd, weekday: isoWeekday(dObj), total: tasks.length, done, incomplete,
      pending_review, undone: tasks.length - done, isToday: ds === todayYmd(), isRestDay: !!activeRestDay(ds, helperId) });
  }
  const restList = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND year=? AND month=? AND status='ACTIVE' ORDER BY rest_date")
    .all(helperId, year, month).map(restDayView);
  res.json({ year, month, first_weekday: firstWd, days_in_month: daysInMonth, first_offset: firstWd - 1,
    days, rest_days: restList, rest_count: restList.length,
    task_total: mTotal, task_done: mDone, rate: mTotal ? Math.round((mDone / mTotal) * 100) : 0 });
});

// 列出某女佣某月休息日
api.get('/rest-days', (req, res) => {
  const now = new Date();
  const year = req.query.year ? +req.query.year : now.getFullYear();
  const month = req.query.month ? +req.query.month : now.getMonth() + 1;
  const helperId = resolveHelperId(req, req.query.helper_id);
  const rows = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND year=? AND month=? AND status='ACTIVE' ORDER BY rest_date")
    .all(helperId, year, month).map(restDayView);
  res.json({ year, month, helper_id: helperId, rest_days: rows });
});

// 女佣休息日汇总（首页卡片用）：本月休息日 + 下一个休息日 + 今天是否休息
api.get('/rest-days/summary', (req, res) => {
  const now = new Date();
  const year = req.query.year ? +req.query.year : now.getFullYear();
  const month = req.query.month ? +req.query.month : now.getMonth() + 1;
  const helperId = resolveHelperId(req, req.query.helper_id);
  const monthList = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND year=? AND month=? AND status='ACTIVE' ORDER BY rest_date")
    .all(helperId, year, month).map(restDayView);
  const today = todayYmd();
  const next = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND status='ACTIVE' AND rest_date>=? ORDER BY rest_date LIMIT 1").get(helperId, today);
  res.json({ year, month, rest_days: monthList, rest_count: monthList.length,
    next_rest_day: next ? restDayView(next) : null, today_is_rest: !!activeRestDay(today, helperId) });
});

// 设置休息日（可多选日期）。handle: 'cancel'（取消当天任务）| 'keep'（保留并标记休息日特别任务）
api.post('/rest-days', (req, res) => {
  const family = curFamily(req);
  const b = req.body;
  const helperId = resolveHelperId(req, b.helper_id);
  const dates = Array.isArray(b.dates) ? b.dates.filter(Boolean) : [];
  if (dates.length === 0) return res.status(400).json({ error: 'dates_required' });
  const handle = b.handle === 'keep' ? 'keep' : 'cancel';   // MVP：默认取消当天任务
  const notify_helper = b.notify !== false;
  const now = localStamp();
  const created = [];
  const tx = db.transaction(() => {
    for (const ds of dates) {
      const d = parseYmd(ds);
      const wd = isoWeekday(d);
      const ex = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND rest_date=?").get(helperId, ds);
      if (ex) {
        db.prepare("UPDATE HelperRestDay SET status='ACTIVE', note=?, updated_at=? , notified_at=? WHERE rest_day_id=?")
          .run(b.note || ex.note || '', now, notify_helper ? now : ex.notified_at, ex.rest_day_id);
        created.push(ex.rest_day_id);
      } else {
        const id = db.prepare(`INSERT INTO HelperRestDay (family_id,helper_user_id,rest_date,weekday,month,year,note,status,created_by,notified_at)
          VALUES (?,?,?,?,?,?,?, 'ACTIVE', ?, ?)`)
          .run(family.family_id, helperId, ds, wd, d.getMonth() + 1, d.getFullYear(), b.note || '', 1, notify_helper ? now : null).lastInsertRowid;
        created.push(id);
      }
      // 处理当天已有任务
      const dayTasks = db.prepare("SELECT * FROM DailyTask WHERE task_date=? AND assignee_id=? AND status IN ('today_todo','in_progress')").all(ds, helperId);
      if (dayTasks.length && handle === 'cancel') {
        db.prepare("UPDATE DailyTask SET status='canceled' WHERE task_date=? AND assignee_id=? AND status IN ('today_todo','in_progress')").run(ds, helperId);
      } else if (dayTasks.length && handle === 'keep') {
        db.prepare("UPDATE DailyTask SET is_rest_day_task=1 WHERE task_date=? AND assignee_id=? AND status IN ('today_todo','in_progress')").run(ds, helperId);
      }
    }
  });
  try { tx(); } catch (e) { return res.status(500).json({ error: 'rest_day_failed', detail: String(e.message || e) }); }
  if (notify_helper) {
    const msg = dates.length === 1
      ? `你的休息日已更新：${fmtCn(dates[0])}`
      : `你的休息日已更新，共 ${dates.length} 天`;
    notify(family.family_id, 'rest_day', '休息日已更新', msg, 'rest_day', created[0] || null, 'maid', helperId);
  }
  res.json({ ok: true, created_count: created.length });
});

// 取消休息日
api.delete('/rest-days/:id', (req, res) => {
  const family = curFamily(req);
  const r = db.prepare('SELECT * FROM HelperRestDay WHERE rest_day_id=?').get(req.params.id);
  if (!owns(req, r)) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE HelperRestDay SET status='CANCELED', updated_at=datetime('now','localtime') WHERE rest_day_id=?").run(r.rest_day_id);
  // 复活当天因休息日被取消的任务，使其重新生成
  db.prepare("DELETE FROM DailyTask WHERE task_date=? AND assignee_id=? AND status='canceled' AND is_rest_day_task=0").run(r.rest_date, r.helper_user_id);
  ensureDailyTasks(r.rest_date, famId(req));
  notify(family.family_id, 'rest_day', '休息日已调整', `你的休息日已调整：${fmtCn(r.rest_date)} 已取消`, 'rest_day', r.rest_day_id, 'maid', r.helper_user_id);
  res.json({ ok: true });
});
function fmtCn(ds) { const [y, m, d] = ds.split('-').map(Number); return `${m}月${d}日 ${wdName(isoWeekday(new Date(y, m - 1, d)))}`; }

// 每周统计（PRD 第 10 节）
api.get('/stats/week', (req, res) => {
  const start = req.query.start ? parseYmd(req.query.start) : mondayOf(new Date());
  const mon = mondayOf(start);
  const rows = [];
  let total = 0, done = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const ds = ymd(d); ensureDailyTasks(ds, famId(req));
    const ts = db.prepare("SELECT status FROM DailyTask WHERE task_date=? AND family_id=? AND status != 'canceled'").all(ds, famId(req));
    const dn = ts.filter((t) => t.status === 'done').length;
    total += ts.length; done += dn;
    rows.push({ date: ds, weekday: i + 1, total: ts.length, done: dn, undone: ts.length - dn });
  }
  res.json({ rows, total, done, rate: total ? Math.round((done / total) * 100) : 0 });
});

// ===== 固定任务模板 CRUD =====
function templateWith(tpl) {
  tpl.weekdays_arr = (() => { try { return JSON.parse(tpl.weekdays || '[]'); } catch { return []; } })();
  tpl.area = tpl.area_id ? db.prepare('SELECT * FROM Area WHERE area_id=?').get(tpl.area_id) : null;
  tpl.assignee = tpl.assignee_id ? db.prepare('SELECT user_id,name,avatar FROM User WHERE user_id=?').get(tpl.assignee_id) : null;
  tpl.checklist = db.prepare('SELECT * FROM TaskTemplateChecklist WHERE task_template_id=? ORDER BY sort_order').all(tpl.task_template_id);
  return tpl;
}
api.get('/templates', (req, res) => {
  const family = curFamily(req);
  const list = db.prepare("SELECT * FROM TaskTemplate WHERE family_id=? AND status!='deleted' ORDER BY sort_order, task_template_id")
    .all(family.family_id).map(templateWith);
  res.json(list);
});
api.get('/templates/:id', (req, res) => {
  const tpl = db.prepare('SELECT * FROM TaskTemplate WHERE task_template_id=?').get(req.params.id);
  if (!owns(req, tpl)) return res.status(404).json({ error: 'not found' });
  res.json(templateWith(tpl));
});
api.post('/templates', (req, res) => {
  const family = curFamily(req);
  const b = req.body;
  const weekdays = Array.isArray(b.weekdays) ? b.weekdays : [];
  if (weekdays.length === 0) return res.status(400).json({ error: 'weekdays_required' }); // 未选星期不能发布
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM TaskTemplate WHERE family_id=?').get(famId(req)).m;
  const r = db.prepare(`INSERT INTO TaskTemplate
    (family_id,task_name,task_name_en,description,area_id,assignee_id,priority,estimated_duration,weekdays,require_photo,minimum_photo_count,require_note,require_approval,notify_employer,sort_order,status,creator_id)
    VALUES (@family_id,@task_name,@task_name_en,@description,@area_id,@assignee_id,@priority,@estimated_duration,@weekdays,@require_photo,@minimum_photo_count,@require_note,@require_approval,@notify_employer,@sort_order,@status,@creator_id)`)
    .run({ family_id: family.family_id, task_name: b.task_name || '', task_name_en: b.task_name_en || '', description: b.description || '',
      area_id: b.area_id || null, assignee_id: b.assignee_id || 2, priority: b.priority || 'normal', estimated_duration: b.estimated_duration || 30,
      weekdays: JSON.stringify(weekdays), require_photo: b.require_photo ? 1 : 0, minimum_photo_count: b.minimum_photo_count || 1,
      require_note: b.require_note ? 1 : 0, require_approval: b.require_approval ? 1 : 0, notify_employer: b.notify_employer === false ? 0 : 1,
      sort_order: maxSort + 1, status: b.status || 'active', creator_id: 1 });
  const id = r.lastInsertRowid;
  (b.checklist || []).forEach((c, i) => db.prepare(`INSERT INTO TaskTemplateChecklist (task_template_id,title,title_en,required,sort_order) VALUES (?,?,?,?,?)`).run(id, c.title, c.title_en || '', c.required ? 1 : 0, i));
  // 若今天命中所选星期，立即生成当天实例
  ensureDailyTasks(todayYmd(), famId(req));
  if ((b.status || 'active') === 'active') notify(family.family_id, 'task', '新增固定任务：' + (b.task_name || ''), '每周 ' + weekdays.map(wdName).join('、'), 'task', id, 'maid');
  res.json(templateWith(db.prepare('SELECT * FROM TaskTemplate WHERE task_template_id=?').get(id)));
});
api.patch('/templates/:id', (req, res) => {
  const tpl = db.prepare('SELECT * FROM TaskTemplate WHERE task_template_id=?').get(req.params.id);
  if (!owns(req, tpl)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const weekdays = b.weekdays !== undefined ? (Array.isArray(b.weekdays) ? b.weekdays : []) : JSON.parse(tpl.weekdays || '[]');
  if (b.weekdays !== undefined && weekdays.length === 0) return res.status(400).json({ error: 'weekdays_required' });
  db.prepare(`UPDATE TaskTemplate SET task_name=@task_name, task_name_en=@task_name_en, description=@description, area_id=@area_id,
      assignee_id=@assignee_id, priority=@priority, estimated_duration=@estimated_duration, weekdays=@weekdays,
      require_photo=@require_photo, minimum_photo_count=@minimum_photo_count, require_note=@require_note, require_approval=@require_approval,
      updated_at=datetime('now','localtime') WHERE task_template_id=@id`)
    .run({ task_name: b.task_name ?? tpl.task_name, task_name_en: b.task_name_en ?? tpl.task_name_en, description: b.description ?? tpl.description,
      area_id: b.area_id ?? tpl.area_id, assignee_id: b.assignee_id ?? tpl.assignee_id, priority: b.priority ?? tpl.priority,
      estimated_duration: b.estimated_duration ?? tpl.estimated_duration, weekdays: JSON.stringify(weekdays),
      require_photo: b.require_photo != null ? (b.require_photo ? 1 : 0) : tpl.require_photo, minimum_photo_count: b.minimum_photo_count ?? tpl.minimum_photo_count,
      require_note: b.require_note != null ? (b.require_note ? 1 : 0) : tpl.require_note, require_approval: b.require_approval != null ? (b.require_approval ? 1 : 0) : tpl.require_approval,
      id: tpl.task_template_id });
  // 同步今天"尚未开始"的实例（6.3：已开始/已完成不改）
  if (b.weekdays === undefined) {
    db.prepare(`UPDATE DailyTask SET task_name_snapshot=?, task_name_en_snapshot=?, description_snapshot=?, priority=?, estimated_duration=?
      WHERE task_template_id=? AND task_date=? AND status='today_todo'`)
      .run(b.task_name ?? tpl.task_name, b.task_name_en ?? tpl.task_name_en, b.description ?? tpl.description, b.priority ?? tpl.priority, b.estimated_duration ?? tpl.estimated_duration, tpl.task_template_id, todayYmd());
  }
  res.json(templateWith(db.prepare('SELECT * FROM TaskTemplate WHERE task_template_id=?').get(tpl.task_template_id)));
});
// 暂停 / 恢复 / 删除（6.4 / 6.5）
api.post('/templates/:id/:op', (req, res) => {
  const tpl = db.prepare('SELECT * FROM TaskTemplate WHERE task_template_id=?').get(req.params.id);
  if (!tpl || tpl.family_id !== famId(req)) return res.status(404).json({ error: 'not found' });
  const op = req.params.op;
  if (op === 'pause') {
    db.prepare("UPDATE TaskTemplate SET status='paused' WHERE task_template_id=?").run(tpl.task_template_id);
    // 暂停：当天未开始的实例取消（可选保留，这里默认取消）
    db.prepare("UPDATE DailyTask SET status='canceled' WHERE task_template_id=? AND task_date=? AND status='today_todo'").run(tpl.task_template_id, todayYmd());
  } else if (op === 'resume') {
    db.prepare("UPDATE TaskTemplate SET status='active' WHERE task_template_id=?").run(tpl.task_template_id);
    ensureDailyTasks(todayYmd(), famId(req));
  } else if (op === 'delete') {
    db.prepare("UPDATE TaskTemplate SET status='deleted' WHERE task_template_id=?").run(tpl.task_template_id);
    // 删除该任务在日历上所有日期的实例（如"每周一"的全部周一），而不只是今天
    db.prepare("UPDATE DailyTask SET status='canceled' WHERE task_template_id=?").run(tpl.task_template_id);
  } else if (op === 'duplicate') {
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM TaskTemplate WHERE family_id=?').get(famId(req)).m;
    const nid = db.prepare(`INSERT INTO TaskTemplate
      (family_id,task_name,task_name_en,description,area_id,assignee_id,priority,estimated_duration,weekdays,require_photo,minimum_photo_count,require_note,require_approval,notify_employer,sort_order,status,creator_id)
      SELECT family_id,task_name||' (副本)',task_name_en,description,area_id,assignee_id,priority,estimated_duration,weekdays,require_photo,minimum_photo_count,require_note,require_approval,notify_employer,?,status,creator_id
      FROM TaskTemplate WHERE task_template_id=?`).run(maxSort + 1, tpl.task_template_id).lastInsertRowid;
    db.prepare('SELECT * FROM TaskTemplateChecklist WHERE task_template_id=?').all(tpl.task_template_id)
      .forEach((c) => db.prepare(`INSERT INTO TaskTemplateChecklist (task_template_id,title,title_en,required,sort_order) VALUES (?,?,?,?,?)`).run(nid, c.title, c.title_en, c.required, c.sort_order));
    return res.json(templateWith(db.prepare('SELECT * FROM TaskTemplate WHERE task_template_id=?').get(nid)));
  }
  res.json(templateWith(db.prepare('SELECT * FROM TaskTemplate WHERE task_template_id=?').get(tpl.task_template_id)));
});
function wdName(n) { return ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][n] || ''; }

// ---- 首页仪表盘 ----
api.get('/dashboard/employer', (req, res) => {
  const date = todayYmd();
  ensureDailyTasks(date, famId(req));
  const tasks = db.prepare("SELECT status FROM DailyTask WHERE task_date=? AND family_id=? AND status != 'canceled'").all(date, famId(req));
  const cnt = (s) => tasks.filter((t) => t.status === s).length;
  const summary = { total: tasks.length, done: cnt('done'), in_progress: cnt('in_progress'),
    incomplete: cnt('incomplete'), pending_review: cnt('pending_review'), todo: cnt('today_todo') };
  const meals = db.prepare('SELECT mo.*, r.name recipe_name, r.name_en recipe_name_en, r.cover_image FROM MealOrder mo JOIN Recipe r ON r.recipe_id=mo.recipe_id WHERE mo.family_id=? AND mo.meal_date=?').all(famId(req), date);
  const shopping = db.prepare('SELECT * FROM ShoppingList WHERE family_id=? AND deleted_at IS NULL ORDER BY shopping_list_id DESC LIMIT 1').get(famId(req)) || null;
  const items = shopping ? db.prepare('SELECT * FROM ShoppingItem WHERE shopping_list_id=?').all(shopping.shopping_list_id) : [];
  const shoppingSummary = {
    to_buy: items.filter(i=>i.status==='to_buy').length,
    sub_pending: items.filter(i=>i.status==='sub_requested').length,
    est_total: items.filter(i=>i.status!=='pending_review').reduce((s,i)=> s + (i.estimated_price||0)*(i.quantity||1), 0),
    actual_total: items.reduce((s,i)=> s + (i.actual_total||0), 0),
  };
  const notifications = db.prepare("SELECT * FROM Notification WHERE family_id=? AND to_role IN ('employer') ORDER BY notification_id DESC LIMIT 6").all(famId(req));
  const family = curFamily(req);
  res.json({ summary, meals, shopping, shoppingSummary, notifications, family });
});
api.get('/dashboard/maid', async (req, res) => {
  const date = todayYmd();
  const helperId = resolveHelperId(req, req.query.helper_id);
  const todayRest = !!activeRestDay(date, helperId);
  ensureDailyTasks(date, famId(req));
  // 家庭级可见：同一家庭的女佣都能看到雇主设置的当天任务与今日菜单（不按 assignee 过滤）
  const tasks = db.prepare("SELECT * FROM DailyTask WHERE task_date=? AND family_id=? AND status != 'canceled' ORDER BY sort_order, daily_task_id").all(date, famId(req)).map(dailyWith);
  const done = tasks.filter(t=>['done','skipped'].includes(t.status)).length;
  const next = tasks.find(t=>['today_todo','in_progress','returned'].includes(t.status));
  const meals = db.prepare('SELECT mo.*, r.name recipe_name, r.name_en recipe_name_en, r.cover_image, r.recipe_type FROM MealOrder mo JOIN Recipe r ON r.recipe_id=mo.recipe_id WHERE mo.family_id=? AND mo.meal_date=?').all(famId(req), date);
  // 「今日采购」只显示进行中的采购单：已完成（雇主已确认 confirmed）或已取消（canceled）不再显示
  const shopping = db.prepare("SELECT * FROM ShoppingList WHERE family_id=? AND deleted_at IS NULL AND status NOT IN ('confirmed','canceled') ORDER BY shopping_list_id DESC LIMIT 1").get(famId(req)) || null;
  const items = shopping ? db.prepare('SELECT * FROM ShoppingItem WHERE shopping_list_id=?').all(shopping.shopping_list_id) : [];
  // 本月休息日 + 下一个休息日（第 4 节）
  const now = new Date();
  const monthRest = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND year=? AND month=? AND status='ACTIVE' ORDER BY rest_date")
    .all(helperId, now.getFullYear(), now.getMonth() + 1).map(restDayView);
  const nextRest = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND status='ACTIVE' AND rest_date>=? ORDER BY rest_date LIMIT 1").get(helperId, date);
  // 本地化：任务标题 + 菜单菜名 翻译成女佣语言
  await localizeTasks(req, tasks);
  { const mf = await trMany(meals.map((m) => m.recipe_name), reqLang(req)); meals.forEach((m) => { if (hasCJK(m.recipe_name)) m.recipe_name_en = mf(m.recipe_name); }); }
  // MOM 重要事项（当前登录女佣自己的、按今日展示规则）
  const mom = momTodayFor(famId(req), req.userId, date);
  res.json({ tasks, progress:{ done, total: tasks.length }, next, meals, mom,
    rest:{ today_is_rest: todayRest, month: now.getMonth() + 1, year: now.getFullYear(),
      rest_days: monthRest, rest_count: monthRest.length, next_rest_day: nextRest ? restDayView(nextRest) : null },
    shopping: shopping ? { ...shopping, to_buy: items.filter(i=>i.status==='to_buy').length, budget: shopping.budget } : null });
});

// ---- 菜谱 ----
function recipeWith(r) {
  r.ingredients = db.prepare('SELECT * FROM RecipeIngredient WHERE recipe_id=?').all(r.recipe_id);
  r.steps = db.prepare('SELECT * FROM RecipeStep WHERE recipe_id=? ORDER BY step_number').all(r.recipe_id);
  return r;
}
api.get('/recipes', async (req, res) => {
  const { type } = req.query;
  let sql = 'SELECT * FROM Recipe WHERE status!=\'deleted\' AND family_id=?', args=[famId(req)];
  if (type && type!=='all') { sql += ' AND recipe_type=?'; args.push(type); }
  const recs = db.prepare(sql).all(...args).map(recipeWith); await localizeRecipes(req, recs);
  res.json(recs);
});
api.get('/recipes/:id', async (req, res) => {
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!owns(req, r)) return res.status(404).json({ error:'not found' });
  const rr = recipeWith(r); await localizeRecipes(req, rr);
  res.json(rr);
});
api.post('/recipes/:id/favorite', (req, res) => {
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!owns(req, r)) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE Recipe SET favorite=? WHERE recipe_id=?').run(r.favorite?0:1, r.recipe_id);
  res.json({ favorite: r.favorite?0:1 });
});
// 新建菜谱（含食材 + 步骤）
api.post('/recipes', (req, res) => {
  const family = curFamily(req);
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name_required' });
  const id = db.prepare(`INSERT INTO Recipe (family_id,name,name_en,recipe_type,category,cover_image,servings,duration,difficulty,suitable_age,allergen_info,notes,video_url,status,creator_id)
    VALUES (@family_id,@name,@name_en,@recipe_type,@category,@cover_image,@servings,@duration,@difficulty,@suitable_age,@allergen_info,@notes,@video_url,'published',1)`)
    .run({ family_id: family.family_id, name: b.name.trim(), name_en: b.name_en || '', recipe_type: b.recipe_type === 'baby' ? 'baby' : 'adult',
      category: b.category || '家常菜', cover_image: b.cover_image || '🍲', servings: b.servings || 2, duration: b.duration || 30,
      difficulty: ['easy','normal','hard'].includes(b.difficulty) ? b.difficulty : 'normal', suitable_age: b.suitable_age || '', allergen_info: b.allergen_info || '', notes: b.notes || '',
      video_url: b.video_url || null }).lastInsertRowid;
  (b.ingredients || []).filter((i) => i.name && i.name.trim()).forEach((i) => db.prepare(`INSERT INTO RecipeIngredient (recipe_id,name,name_en,quantity,unit,required,substitute) VALUES (?,?,?,?,?,?,?)`)
    .run(id, i.name.trim(), i.name_en || '', i.quantity || '', i.unit || '', i.required === false ? 0 : 1, i.substitute || ''));
  (b.steps || []).filter((s) => (s.instruction || '').trim()).forEach((s, idx) => db.prepare(`INSERT INTO RecipeStep (recipe_id,step_number,instruction,instruction_en,image_url,duration) VALUES (?,?,?,?,?,?)`)
    .run(id, idx + 1, s.instruction.trim(), s.instruction_en || '', s.image_url || null, s.duration || 0));
  res.json(recipeWith(db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(id)));
});
// 修改已有菜谱（覆盖字段 + 重建食材/步骤）
api.patch('/recipes/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!r || r.family_id !== famId(req)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'name_required' });
  const newName = b.name !== undefined ? String(b.name).trim() : null;
  // 改了中文名但没给新英文名 → 清空旧 name_en，否则英文界面（女佣端）一直显示旧译名；
  // 清空后显示回退到新中文名，非中文语言读取时由翻译链路重新生成
  const nameEn = b.name_en ?? (newName && newName !== r.name ? '' : null);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE Recipe SET name=COALESCE(@name,name), name_en=COALESCE(@name_en,name_en), recipe_type=COALESCE(@recipe_type,recipe_type),
        category=COALESCE(@category,category), cover_image=COALESCE(@cover_image,cover_image), servings=COALESCE(@servings,servings),
        duration=COALESCE(@duration,duration), difficulty=COALESCE(@difficulty,difficulty), suitable_age=COALESCE(@suitable_age,suitable_age),
        notes=COALESCE(@notes,notes), video_url=CASE WHEN @has_video_url THEN @video_url ELSE video_url END WHERE recipe_id=@id`)
      .run({ name: newName, name_en: nameEn,
        recipe_type: b.recipe_type ? (b.recipe_type === 'baby' ? 'baby' : 'adult') : null,
        category: b.category ?? null, cover_image: b.cover_image ?? null, servings: b.servings ?? null, duration: b.duration ?? null,
        difficulty: ['easy','normal','hard'].includes(b.difficulty) ? b.difficulty : null, suitable_age: b.suitable_age ?? null,
        notes: b.notes ?? null, has_video_url: b.video_url !== undefined ? 1 : 0, video_url: b.video_url || null, id: r.recipe_id });
    if (b.ingredients) {
      db.prepare('DELETE FROM RecipeIngredient WHERE recipe_id=?').run(r.recipe_id);
      b.ingredients.filter((i) => i.name && i.name.trim()).forEach((i) => db.prepare(`INSERT INTO RecipeIngredient (recipe_id,name,name_en,quantity,unit,required,substitute) VALUES (?,?,?,?,?,?,?)`)
        .run(r.recipe_id, i.name.trim(), i.name_en || '', i.quantity || '', i.unit || '', i.required === false ? 0 : 1, i.substitute || ''));
    }
    if (b.steps) {
      db.prepare('DELETE FROM RecipeStep WHERE recipe_id=?').run(r.recipe_id);
      b.steps.filter((s) => (s.instruction || '').trim()).forEach((s, idx) => db.prepare(`INSERT INTO RecipeStep (recipe_id,step_number,instruction,instruction_en,image_url,duration) VALUES (?,?,?,?,?,?)`)
        .run(r.recipe_id, idx + 1, s.instruction.trim(), s.instruction_en || '', s.image_url || null, s.duration || 0));
    }
  });
  try { tx(); } catch (e) { return res.status(500).json({ error: 'update_failed', detail: String(e.message || e) }); }
  res.json(recipeWith(db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(r.recipe_id)));
});
// 删除菜谱（软删除，列表已过滤 status='deleted'；保留行以免已安排的菜单join失败）
api.delete('/recipes/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!r || r.family_id !== famId(req)) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE Recipe SET status='deleted' WHERE recipe_id=?").run(r.recipe_id);
  res.json({ ok: true });
});
// 从菜谱一键生成采购清单（食材 → 采购项，含二级分类猜测）
function guessFoodSub(name) {
  const map = [['肉类',['肉','排骨','牛','猪','鸡','羊','鸭']],['海鲜',['鱼','虾','蟹','贝','鲈','鱿','蛤']],
    ['蔬菜',['菜','菠','兰花','萝卜','土豆','番茄','葱','姜','蒜','茄','椒']],['水果',['苹果','香蕉','莓','橙','葡萄','梨','桃']],
    ['蛋奶',['蛋','奶','酪']],['主食',['米','面','粉','馒头','包','薯']],['调味品',['盐','酱','醋','油','糖','豉','蚝']],['豆制品',['豆腐','豆干','腐竹','豆浆']]];
  for (const [c, kw] of map) if (kw.some((k) => name.includes(k))) return c;
  return '其他食材';
}
api.post('/recipes/:id/to-shopping', (req, res) => {
  const family = curFamily(req);
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!owns(req, r)) return res.status(404).json({ error: 'not found' });
  const ings = db.prepare('SELECT * FROM RecipeIngredient WHERE recipe_id=?').all(r.recipe_id);
  const lid = db.prepare(`INSERT INTO ShoppingList (family_id,title,assignee_id,status,creator_id) VALUES (?,?,?, 'to_buy', 1)`)
    .run(family.family_id, (r.name.split(' ')[0] || r.name) + ' 采购', defaultHelperId(family.family_id)).lastInsertRowid;
  ings.forEach((ing) => db.prepare(`INSERT INTO ShoppingItem (shopping_list_id,name,name_en,category,primary_category,secondary_category,image_url,quantity,unit,estimated_price,allow_substitute,urgency,status,source_recipe_id)
    VALUES (?,?,?, '食材','食材',?, '🛒', ?, ?, 0, 1, 'normal', 'to_buy', ?)`)
    .run(lid, ing.name, ing.name_en || '', guessFoodSub(ing.name), parseFloat(ing.quantity) || 1, ing.unit || '份', r.recipe_id));
  notify(family.family_id, 'shopping', '新采购清单', '从菜谱「' + r.name + '」生成 ' + ings.length + ' 项食材', 'shopping', lid, 'maid');
  res.json(listWith(db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(lid)));
});
// 从菜谱一键安排到本周任意一天的菜单（默认今天；meal_date 必须落在本周 7 天内，否则回退今天）
api.post('/recipes/:id/to-meal', (req, res) => {
  const family = curFamily(req);
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!owns(req, r)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const mt = ['breakfast','lunch','dinner'].includes(b.meal_type) ? b.meal_type : 'lunch';
  // 任意有效日期均可（支持提前排下周菜单）；格式不合法则落到今天
  const mealDate = /^\d{4}-\d{2}-\d{2}$/.test(b.meal_date || '') ? b.meal_date : todayYmd();
  const mid = db.prepare(`INSERT INTO MealOrder (family_id,recipe_id,meal_date,meal_type,servings,assignee_id,status,notes) VALUES (?,?,?,?,?,?, 'to_receive', ?)`)
    .run(family.family_id, r.recipe_id, mealDate, mt, b.servings || r.servings || 2, defaultHelperId(family.family_id), b.notes || '').lastInsertRowid;
  const dayLabel = mealDate === todayYmd() ? '今日' : (mealDate.slice(5) + ' ');
  notify(family.family_id, 'meal', '新菜单安排', '「' + r.name + '」已安排到' + dayLabel + ({breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}[mt]), 'meal', mid, 'maid');
  res.json(db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(mid));
});

// ---- 菜谱订单 ----
function mealWith(m) {
  m.recipe = recipeWith(db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(m.recipe_id));
  return m;
}
api.get('/meals', async (req, res) => { const ms = db.prepare('SELECT * FROM MealOrder WHERE family_id=? AND meal_date=? ORDER BY start_time').all(famId(req), todayYmd()).map(mealWith); await localizeRecipes(req, ms.map(m=>m.recipe)); res.json(ms); });
// 本周菜单：周一~周日全部菜品，按日期分组（提前排菜 + 周菜单展示）
api.get('/meals/week', async (req, res) => {
  const mon = mondayOf(new Date());
  const off = parseInt(req.query.offset, 10) || 0; // 0=本周，1=下周，-1=上周
  mon.setDate(mon.getDate() + off * 7);
  const today = todayYmd();
  const days = [];
  const allRecipes = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const ds = ymd(d);
    const ms = db.prepare(`SELECT * FROM MealOrder WHERE family_id=? AND meal_date=?
      ORDER BY CASE meal_type WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'dinner' THEN 3 ELSE 4 END`)
      .all(famId(req), ds).map(mealWith);
    ms.forEach((m) => allRecipes.push(m.recipe));
    days.push({ date: ds, weekday: i + 1, isToday: ds === today, meals: ms });
  }
  await localizeRecipes(req, allRecipes);
  res.json({ start: ymd(mon), end: days[6].date, days });
});
api.get('/meals/:id', async (req, res) => {
  const m = db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(req.params.id);
  if (!owns(req, m)) return res.status(404).json({ error:'not found' });
  const mm = mealWith(m); await localizeRecipes(req, mm.recipe);
  res.json(mm);
});
// 修改菜谱订单备注（雇主给女佣的当次注意事项，与菜谱固定说明分离）
api.patch('/meals/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(req.params.id);
  if (!owns(req, m)) return res.status(404).json({ error: 'not found' });
  if (req.body.notes !== undefined) db.prepare('UPDATE MealOrder SET notes=? WHERE meal_order_id=?').run(String(req.body.notes || '').trim(), m.meal_order_id);
  res.json(mealWith(db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(m.meal_order_id)));
});
// 雇主删除今日菜单中的菜品
api.delete('/meals/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(req.params.id);
  if (!owns(req, m)) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM MealOrder WHERE meal_order_id=?').run(m.meal_order_id);
  res.json({ ok: true });
});
api.post('/meals/:id/transition', (req, res) => {
  const m = db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(req.params.id);
  if (!owns(req, m)) return res.status(404).json({ error: 'not found' });
  const { to, result_image } = req.body;
  db.prepare('UPDATE MealOrder SET status=?, result_image=COALESCE(?,result_image) WHERE meal_order_id=?').run(to, result_image??null, m.meal_order_id);
  if (to==='ingredients_short') notify(m.family_id,'meal','食材不足', '菜谱订单缺少食材','meal',m.meal_order_id,'employer');
  if (to==='pending_review') notify(m.family_id,'meal','做饭完成待确认','女佣已完成做饭','meal',m.meal_order_id,'employer');
  res.json(mealWith(db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(m.meal_order_id)));
});

// ===== 采购模块：两级分类（第 3 节）=====
const PRIMARY_CATEGORIES = [
  ['食材', 'Food', '🥩'], ['宝宝用品', 'Baby', '🍼'], ['清洁用品', 'Cleaning', '🧴'],
  ['日用品', 'Daily', '🧻'], ['厨房用品', 'Kitchen', '🍳'], ['卫生间用品', 'Bathroom', '🚿'],
  ['女佣个人用品', 'Helper Personal', '🧕'], ['药品或医疗用品', 'Medical', '💊'],
  ['宠物用品', 'Pet', '🐾'], ['其他', 'Other', '📦'],
];
const FOOD_SUBCATEGORIES = [
  ['肉类', 'Meat', '🥩'], ['蔬菜', 'Vegetable', '🥬'], ['主食', 'Staple', '🍚'], ['水果', 'Fruit', '🍎'],
  ['海鲜', 'Seafood', '🦐'], ['蛋奶', 'Egg & Dairy', '🥚'], ['豆制品', 'Soy', '🫛'], ['调味品', 'Condiment', '🧂'],
  ['冷冻食品', 'Frozen', '🧊'], ['零食饮品', 'Snacks', '🥤'], ['其他食材', 'Other Food', '🍽️'],
];
api.get('/categories', (req, res) => res.json({ primary: PRIMARY_CATEGORIES, food_sub: FOOD_SUBCATEGORIES, gst_rate: gstRate(famId(req)) }));

// 家庭设置：更新 GST 税率 / 家庭名称（家庭级可配置）
api.post('/family/settings', (req, res) => {
  const family = curFamily(req);
  const b = req.body;
  if (b.gst_rate !== undefined) {
    let r = +b.gst_rate;
    if (isNaN(r) || r < 0 || r >= 1) return res.status(400).json({ error: 'invalid_gst_rate' }); // 0–1 之间（小数）
    db.prepare('UPDATE Family SET gst_rate=? WHERE family_id=?').run(r, family.family_id);
  }
  if (b.family_name !== undefined) {
    if (!String(b.family_name).trim()) return res.status(400).json({ error: 'family_name_required' });
    db.prepare("UPDATE Family SET family_name=?, updated_at=datetime('now','localtime') WHERE family_id=?").run(String(b.family_name).trim(), family.family_id);
  }
  res.json(db.prepare('SELECT * FROM Family WHERE family_id=?').get(family.family_id));
});

// ===== Receipt OCR：Claude 视觉识别（第 7 节）=====
const uploadsDir = join(process.env.DATA_DIR || join(__dirname, '..', 'data'), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
// 小票识别的结构化 schema
const RECEIPT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    store_name: { type: 'string' }, purchase_date: { type: 'string' }, currency: { type: 'string' },
    subtotal: { type: 'number' }, tax: { type: 'number' }, total: { type: 'number' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, quantity: { type: 'number' }, unit_price: { type: 'number' }, line_total: { type: 'number' },
        matched_shopping_item_id: { type: ['integer', 'null'] } },
      required: ['name', 'quantity', 'unit_price', 'line_total', 'matched_shopping_item_id'] } },
  },
  required: ['store_name', 'purchase_date', 'currency', 'subtotal', 'tax', 'total', 'items'],
};
// 调用 Claude 视觉识别小票（原始 HTTPS，避免额外依赖）；无 API Key 时返回 null 走兜底
// listItems 传入时同时做小票行与采购清单的跨语言匹配（小票多为英文缩写，清单可能是中文）
async function claudeReceiptOCR(base64, mediaType, listItems) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const listText = (listItems || []).length
    ? `\n\n下面是本次采购清单的商品（JSON）。请把小票上的每一行与清单商品匹配：能对应的填该商品的 shopping_item_id 到 matched_shopping_item_id；小票行在清单里找不到对应商品的填 null。注意小票名称常是英文缩写，清单名称可能是中文，请按语义匹配（如 "COCA COLA 1.5L" ↔ "可乐"）。\n${JSON.stringify(listItems)}`
    : '';
  const body = {
    model: 'claude-opus-4-8', max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA }, effort: 'low' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } },
      { type: 'text', text: '这是一张超市购物小票。请识别：商店名称、购买日期(YYYY-MM-DD)、货币、税前小计(subtotal)、消费税(tax，如 GST/VAT)、含税总金额(total)，以及每个商品的名称、数量、单价、小计。金额一律用数字，不带货币符号。日期无法识别则留空字符串。' + listText },
    ] }],
  };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) { console.error('Claude OCR 失败', r.status, await r.text().catch(() => '')); return null; }
  const data = await r.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) return null;
  try { return { ...JSON.parse(textBlock.text), source: 'claude' }; } catch { return null; }
}

api.post('/shopping/:id/receipt-scan', async (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  if (!owns(req, l)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const base64 = (b.image_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) return res.status(400).json({ error: 'image_required' });
  const mediaType = b.media_type || 'image/jpeg';
  // 保存图片文件，静态可访问
  const ext = (mediaType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const fname = `receipt_${l.shopping_list_id}_${Date.now()}.${ext}`;
  try { fs.writeFileSync(join(uploadsDir, fname), Buffer.from(base64, 'base64')); } catch (e) { /* 忽略写盘失败 */ }
  const fileUrl = `/uploads/${fname}`;

  // 识别：优先 Claude（带清单做逐项匹配），失败/无 Key 兜底（按当前录入的商品小计生成，便于演示）
  const view = listWith(l);
  const listForMatch = view.items.filter((i) => i.status !== 'pending_review')
    .map((i) => ({ shopping_item_id: i.shopping_item_id, name: i.name, name_en: i.name_en || undefined, quantity: i.quantity, unit: i.unit }));
  let ocr = null;
  try { ocr = await claudeReceiptOCR(base64, mediaType, listForMatch); } catch (e) { console.error('OCR error', e); }
  if (!ocr) {
    const sub = view.subtotal || view.items.reduce((s, i) => s + (i.estimated_price || 0) * (i.quantity || 1), 0);
    const tax = +(sub * gstRate(famId(req))).toFixed(2);
    ocr = { source: 'mock', store_name: l.store_name || 'FairPrice', purchase_date: todayYmd(), currency: 'SGD',
      subtotal: +sub.toFixed(2), tax, total: +(sub + tax).toFixed(2), items: [] };
  }
  // 逐项比对：小票行无匹配 = 清单外多买；清单商品未出现在小票 = 小票未见
  const matchedIds = new Set((ocr.items || []).map((i) => i.matched_shopping_item_id).filter(Boolean));
  ocr.missing_items = ocr.items?.length
    ? listForMatch.filter((i) => !matchedIds.has(i.shopping_item_id)).map((i) => ({ shopping_item_id: i.shopping_item_id, name: i.name }))
    : [];
  ocr.extra_count = (ocr.items || []).filter((i) => !i.matched_shopping_item_id).length;
  // 落库：小票图片 + 识别总额 + 商店/日期 + 逐项明细（含匹配结果，供雇主端展示）
  const receiptItemsJson = ocr.items?.length ? JSON.stringify({ items: ocr.items, missing_items: ocr.missing_items }) : null;
  db.prepare(`UPDATE ShoppingList SET receipt_image=?, receipt_total=?, store_name=COALESCE(NULLIF(?,''),store_name), purchase_date=COALESCE(NULLIF(?,''),purchase_date), amount_match_status=?, receipt_items=COALESCE(?,receipt_items) WHERE shopping_list_id=?`)
    .run(fileUrl, ocr.total, ocr.store_name || '', ocr.purchase_date || '', matchStatus(view.helper_total, ocr.total), receiptItemsJson, l.shopping_list_id);
  res.json({ ...ocr, file_url: fileUrl, gst_rate: gstRate(famId(req)) });
});

// 允许误差（第 8.3 节，默认 ±0.05）
const AMOUNT_TOLERANCE = 0.05;
// 消费税（GST）：女佣录入的商品单价为税前价，汇总时额外加税与 receipt 税后总额核对
// 税率为家庭级可配置项（默认新加坡 9%）
const DEFAULT_GST_RATE = 0;
// 消费税统一 0%（设置界面已隐藏）。恢复"按家庭可配置"时，改回读取 Family.gst_rate 即可。
function gstRate(_familyId) {
  return 0;
}
function matchStatus(helperTotal, receiptTotal) {
  if (receiptTotal == null) return 'unrecognized';
  if (helperTotal == null) return 'manual';
  return Math.abs(receiptTotal - helperTotal) <= AMOUNT_TOLERANCE ? 'matched' : 'mismatch';
}

// ---- 采购 ----
function listWith(l) {
  l.items = db.prepare('SELECT * FROM ShoppingItem WHERE shopping_list_id=?').all(l.shopping_list_id);
  l.assignee = l.assignee_id ? db.prepare('SELECT name,avatar FROM User WHERE user_id=?').get(l.assignee_id) : null;
  try { l.receipt_items = l.receipt_items ? JSON.parse(l.receipt_items) : null; } catch { l.receipt_items = null; }
  l.est_total = l.items.filter(i=>i.status!=='pending_review').reduce((s,i)=> s + (i.estimated_price||0)*(i.quantity||1), 0);
  // 女佣录入总金额 = 商品小计 + 消费税 + 其他费用（第 6.3 节公式 + GST）
  const rate = gstRate(l.family_id);
  const subtotal = +l.items.reduce((s,i)=> s + (i.actual_total||0), 0).toFixed(2);
  const gst = +(subtotal * rate).toFixed(2);
  l.subtotal = subtotal;
  l.gst_rate = rate;
  l.gst = gst;
  l.actual_total = +(subtotal + gst + (l.other_fee||0)).toFixed(2);
  l.helper_total = l.helper_entered_total != null ? l.helper_entered_total : l.actual_total;
  // 差额 = Receipt - 录入（第 4.2 节）
  l.amount_difference = (l.receipt_total != null) ? +(l.receipt_total - l.helper_total).toFixed(2) : null;
  l.match_status = l.amount_match_status || matchStatus(l.helper_total, l.receipt_total);
  // 一级分类占比（当前清单，第 15 节的单单版）
  const catMap = {};
  l.items.forEach((i) => { if (i.actual_total) { catMap[i.primary_category||'其他'] = (catMap[i.primary_category||'其他']||0) + i.actual_total; } });
  l.category_breakdown = Object.entries(catMap).map(([k,v]) => ({ category: k, amount: +v.toFixed(2) }));
  return l;
}
// 回收站里超过 30 天的清单彻底清除
function purgeOldTrash(familyId) {
  const old = db.prepare("SELECT shopping_list_id FROM ShoppingList WHERE family_id=? AND deleted_at IS NOT NULL AND deleted_at < datetime('now','-30 days')").all(familyId);
  if (!old.length) return;
  db.transaction(() => old.forEach(({ shopping_list_id }) => {
    db.prepare('DELETE FROM ShoppingItem WHERE shopping_list_id=?').run(shopping_list_id);
    db.prepare('DELETE FROM ShoppingList WHERE shopping_list_id=?').run(shopping_list_id);
  }))();
}
api.get('/shopping', async (req, res) => {
  purgeOldTrash(famId(req));
  const ls = db.prepare('SELECT * FROM ShoppingList WHERE family_id=? AND deleted_at IS NULL ORDER BY shopping_list_id DESC').all(famId(req)).map(listWith);
  await localizeLists(req, ls); res.json(ls);
});
// 回收站：已删除的清单（30 天内），需在 /shopping/:id 之前注册以免被吞
api.get('/shopping/trash', (req, res) => {
  purgeOldTrash(famId(req));
  const ls = db.prepare('SELECT * FROM ShoppingList WHERE family_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC').all(famId(req)).map(listWith);
  res.json(ls);
});
api.get('/shopping/:id', async (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  if (!owns(req, l) || l.deleted_at) return res.status(404).json({ error:'not found' });
  const ll = listWith(l); await localizeLists(req, ll);
  res.json(ll);
});
// 雇主删除采购清单：软删除进回收站，30 天内可恢复
api.delete('/shopping/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  if (!owns(req, l)) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE ShoppingList SET deleted_at=datetime('now') WHERE shopping_list_id=?").run(l.shopping_list_id);
  res.json({ ok: true, soft_deleted: true });
});
// 从回收站恢复
api.post('/shopping/:id/restore', (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  if (!owns(req, l) || !l.deleted_at) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE ShoppingList SET deleted_at=NULL WHERE shopping_list_id=?').run(l.shopping_list_id);
  res.json(listWith(db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(l.shopping_list_id)));
});
// 雇主创建采购清单
api.post('/shopping', (req, res) => {
  const family = curFamily(req);
  const b = req.body;
  const r = db.prepare(`INSERT INTO ShoppingList (family_id,title,assignee_id,budget,store_name,due_time,status,creator_id)
    VALUES (@family_id,@title,@assignee_id,@budget,@store_name,@due_time,@status,@creator_id)`)
    .run({ family_id: family.family_id, title: b.title || '采购清单', assignee_id: b.assignee_id || 2,
      budget: b.budget || 0, store_name: b.store_name || '', due_time: b.due_time || null,
      status: b.status || 'to_buy', creator_id: 1 });
  const id = r.lastInsertRowid;
  if ((b.status || 'to_buy') !== 'draft') notify(family.family_id, 'shopping', '新采购清单：' + (b.title||''), '请查看采购清单', 'shopping', id, 'maid');
  res.json(listWith(db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(id)));
});
// 雇主更新清单信息 / 上传小票
api.patch('/shopping/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  if (!owns(req, l)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  db.prepare(`UPDATE ShoppingList SET
      title=COALESCE(@title,title), budget=COALESCE(@budget,budget), store_name=COALESCE(@store_name,store_name),
      due_time=COALESCE(@due_time,due_time), receipt_image=COALESCE(@receipt_image,receipt_image),
      payment_method=COALESCE(@payment_method,payment_method), other_fee=COALESCE(@other_fee,other_fee),
      purchase_date=COALESCE(@purchase_date,purchase_date), receipt_total=COALESCE(@receipt_total,receipt_total),
      helper_entered_total=COALESCE(@helper_entered_total,helper_entered_total),
      difference_reason=COALESCE(@difference_reason,difference_reason),
      reimbursement_status=COALESCE(@reimbursement_status,reimbursement_status)
    WHERE shopping_list_id=@id`)
    .run({ title:b.title??null, budget:b.budget??null, store_name:b.store_name??null, due_time:b.due_time??null,
      receipt_image:b.receipt_image??null, payment_method:b.payment_method??null, other_fee:b.other_fee??null,
      purchase_date:b.purchase_date??null, receipt_total:b.receipt_total??null, helper_entered_total:b.helper_entered_total??null,
      difference_reason:b.difference_reason??null, reimbursement_status:b.reimbursement_status??null, id:l.shopping_list_id });
  // 重新核对金额（第 8 节）
  const fresh = listWith(db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(l.shopping_list_id));
  db.prepare('UPDATE ShoppingList SET amount_match_status=? WHERE shopping_list_id=?')
    .run(matchStatus(fresh.helper_total, fresh.receipt_total), l.shopping_list_id);
  res.json(listWith(db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(l.shopping_list_id)));
});
// 雇主向清单添加商品（PRD 7.13 添加采购商品页）
api.post('/shopping/:id/items', (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  if (!owns(req, l)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const pc = b.primary_category || '食材';
  // 女佣添加的商品需雇主确认后才进入待购（pending_review → to_buy）
  const isMaid = curUserRole(req) === 'maid';
  const r = db.prepare(`INSERT INTO ShoppingItem
    (shopping_list_id,name,name_en,category,primary_category,secondary_category,image_url,quantity,unit,brand,specification,estimated_price,budget_limit,allow_substitute,urgency,notes,status)
    VALUES (@shopping_list_id,@name,@name_en,@category,@pc,@sc,@image_url,@quantity,@unit,@brand,@specification,@estimated_price,@budget_limit,@allow_substitute,@urgency,@notes,@status)`)
    .run({ shopping_list_id: l.shopping_list_id, name: b.name || '', name_en: b.name_en || '', category: b.category || pc,
      pc, sc: pc === '食材' ? (b.secondary_category || '其他食材') : null,
      image_url: b.image_url || '🛒', quantity: b.quantity || 1, unit: b.unit || '件', brand: b.brand || '',
      specification: b.specification || '', estimated_price: b.estimated_price || 0, budget_limit: b.budget_limit || 0,
      allow_substitute: b.allow_substitute ? 1 : 0, urgency: b.urgency || 'normal', notes: b.notes || '',
      status: isMaid ? 'pending_review' : 'to_buy' });
  if (isMaid) notify(l.family_id, 'shopping', '女佣添加了商品待确认：' + (b.name || ''), `清单「${l.title}」`, 'shopping', l.shopping_list_id, 'employer');
  res.json(db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(r.lastInsertRowid));
});
// 雇主确认/拒绝女佣添加的商品：同意 → 进入待购；拒绝 → 删除
api.post('/items/:id/review', (req, res) => {
  if (!ownsItem(req, req.params.id)) return res.status(404).json({ error: 'not found' });
  if (curUserRole(req) === 'maid') return res.status(403).json({ error: 'employer_only' });
  const it = db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(req.params.id);
  if (it.status !== 'pending_review') return res.status(400).json({ error: 'not_pending' });
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(it.shopping_list_id);
  if (req.body.approve) {
    db.prepare("UPDATE ShoppingItem SET status='to_buy' WHERE shopping_item_id=?").run(it.shopping_item_id);
    notify(l.family_id, 'shopping', '雇主已同意购买：' + it.name, `清单「${l.title}」`, 'shopping', l.shopping_list_id, 'maid');
    return res.json(db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(it.shopping_item_id));
  }
  db.prepare('DELETE FROM ShoppingItem WHERE shopping_item_id=?').run(it.shopping_item_id);
  notify(l.family_id, 'shopping', '雇主未同意购买：' + it.name, `清单「${l.title}」`, 'shopping', l.shopping_list_id, 'maid');
  res.json({ ok: true, rejected: true });
});
api.delete('/items/:id', (req, res) => {
  if (!ownsItem(req, req.params.id)) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM ShoppingItem WHERE shopping_item_id=?').run(req.params.id);
  res.json({ ok: true });
});
api.post('/shopping/:id/transition', (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  if (!owns(req, l)) return res.status(404).json({ error: 'not found' });
  const { to, employer_confirmed_total } = req.body;
  const now = localStamp();
  const view = listWith(l);
  if (to === 'pending_confirm') {
    db.prepare("UPDATE ShoppingList SET status=?, submitted_at=?, helper_entered_total=COALESCE(helper_entered_total,?), purchase_date=COALESCE(purchase_date,?) WHERE shopping_list_id=?")
      .run(to, now, view.helper_total, todayYmd(), l.shopping_list_id);
    notify(l.family_id,'shopping','采购待确认', view.match_status==='mismatch' ? ('金额不一致，差额 S$'+Math.abs(view.amount_difference||0).toFixed(2)) : '女佣已提交采购账目','shopping',l.shopping_list_id,'employer');
  } else if (to === 'confirmed') {
    // 雇主确认金额，默认取 receipt 识别额，否则女佣录入额（第 13.2 / 17.5 节）
    const confirmed = employer_confirmed_total != null ? employer_confirmed_total : (l.receipt_total != null ? l.receipt_total : view.helper_total);
    // 女佣垫付 → 自动进入待报销（第 18.2 节）
    const reimb = l.payment_method === '女佣垫付' ? 'to_reimburse' : (l.reimbursement_status || 'none');
    db.prepare("UPDATE ShoppingList SET status=?, employer_confirmed_total=?, confirmed_at=?, reimbursement_status=? WHERE shopping_list_id=?")
      .run(to, confirmed, now, reimb, l.shopping_list_id);
    notify(l.family_id,'shopping','采购已确认','雇主已确认账目 S$'+(+confirmed).toFixed(2),'shopping',l.shopping_list_id,'maid');
  } else if (to === 'reimbursed') {
    db.prepare("UPDATE ShoppingList SET reimbursement_status='reimbursed' WHERE shopping_list_id=?").run(l.shopping_list_id);
    notify(l.family_id,'shopping','已报销','雇主已完成报销','shopping',l.shopping_list_id,'maid');
  } else if (to === 'returned') {
    db.prepare("UPDATE ShoppingList SET status='buying' WHERE shopping_list_id=?").run(l.shopping_list_id);
    notify(l.family_id,'shopping','采购被退回', req.body.reason || '雇主要求修改账目','shopping',l.shopping_list_id,'maid');
  } else {
    db.prepare('UPDATE ShoppingList SET status=? WHERE shopping_list_id=?').run(to, l.shopping_list_id);
  }
  res.json(listWith(db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(l.shopping_list_id)));
});
// 商品：录价 / 标记状态 / 改分类 / 替代审核
api.patch('/items/:id', (req, res) => {
  if (!ownsItem(req, req.params.id)) return res.status(404).json({ error: 'not found' });
  const it = db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(req.params.id);
  const b = req.body;
  const aq = b.actual_quantity ?? it.actual_quantity;
  const ap = b.actual_unit_price ?? it.actual_unit_price;
  const disc = b.discount ?? it.discount ?? 0;
  const total = (aq!=null && ap!=null) ? (aq*ap - disc) : it.actual_total;
  // 食材必须有二级分类，否则二级留空；一级不填默认「其他」
  const pc = b.primary_category ?? it.primary_category ?? '其他';
  const sc = b.secondary_category !== undefined ? b.secondary_category : it.secondary_category;
  db.prepare(`UPDATE ShoppingItem SET status=COALESCE(@status,status), actual_quantity=@aq, actual_unit_price=@ap, discount=@disc, actual_total=@total,
      primary_category=@pc, secondary_category=@sc, name=COALESCE(@name,name),
      quantity=COALESCE(@quantity,quantity), unit=COALESCE(@unit,unit), specification=COALESCE(@specification,specification),
      brand=COALESCE(@brand,brand), image_url=COALESCE(@image_url,image_url), estimated_price=COALESCE(@estimated_price,estimated_price),
      notes=COALESCE(@notes,notes) WHERE shopping_item_id=@id`)
    .run({ status:b.status??null, aq, ap, disc, total, pc, sc: pc==='食材' ? (sc||null) : null, name: b.name??null,
      quantity: b.quantity??null, unit: b.unit??null, specification: b.specification??null, brand: b.brand??null,
      image_url: b.image_url??null, estimated_price: b.estimated_price??null, notes: b.notes??null, id:it.shopping_item_id });
  res.json(db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(it.shopping_item_id));
});
api.post('/items/:id/substitute', (req, res) => {
  if (!ownsItem(req, req.params.id)) return res.status(404).json({ error: 'not found' });
  // 女佣提交替代申请
  const b = req.body;
  db.prepare(`UPDATE ShoppingItem SET status='sub_requested', sub_name=@sub_name, sub_brand=@sub_brand, sub_spec=@sub_spec, sub_price=@sub_price, sub_reason=@sub_reason WHERE shopping_item_id=@id`)
    .run({ sub_name:b.sub_name||'', sub_brand:b.sub_brand||'', sub_spec:b.sub_spec||'', sub_price:b.sub_price||0, sub_reason:b.sub_reason||'', id:req.params.id });
  const it = db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(req.params.id);
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(it.shopping_list_id);
  notify(l.family_id,'shopping','替代申请待处理','申请用「'+it.sub_name+'」替代「'+it.name+'」','shopping',l.shopping_list_id,'employer');
  res.json(it);
});
api.post('/items/:id/substitute/review', (req, res) => {
  if (!ownsItem(req, req.params.id)) return res.status(404).json({ error: 'not found' });
  const { approve } = req.body;
  const it = db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(req.params.id);
  if (approve) {
    db.prepare("UPDATE ShoppingItem SET status='sub_approved', name=sub_name, brand=sub_brand, specification=sub_spec, estimated_price=sub_price WHERE shopping_item_id=?").run(it.shopping_item_id);
  } else {
    db.prepare("UPDATE ShoppingItem SET status='sub_rejected' WHERE shopping_item_id=?").run(it.shopping_item_id);
  }
  res.json(db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(it.shopping_item_id));
});

// ===== 月度账目汇总 + 分类占比统计（第 14–17 节）=====
// 采购记录归属月份：purchase_date > confirmed_at > created_at（第 17.2 节优先级）
const listMonth = (l) => (l.purchase_date || l.confirmed_at || l.created_at || '').slice(0, 7); // YYYY-MM
api.get('/expense/monthly', (req, res) => {
  const now = new Date();
  const year = req.query.year ? +req.query.year : now.getFullYear();
  const month = req.query.month ? +req.query.month : now.getMonth() + 1;
  const ym = `${year}-${pad(month)}`;
  const all = db.prepare('SELECT * FROM ShoppingList WHERE family_id=? AND deleted_at IS NULL').all(famId(req));
  const inMonth = all.filter((l) => listMonth(l) === ym);
  const confirmed = inMonth.filter((l) => ['confirmed', 'reimbursed'].includes(l.status));
  const pending = inMonth.filter((l) => l.status === 'pending_confirm');
  const confirmedAmt = (l) => l.employer_confirmed_total != null ? l.employer_confirmed_total : listWith(l).helper_total;

  // 指标卡片（第 14.3 节）
  const totalConfirmed = confirmed.reduce((s, l) => s + confirmedAmt(l), 0);
  const pendingAmt = pending.reduce((s, l) => s + listWith(l).helper_total, 0);
  const reimbursed = confirmed.filter((l) => l.reimbursement_status === 'reimbursed').reduce((s, l) => s + confirmedAmt(l), 0);
  const toReimburse = confirmed.filter((l) => l.reimbursement_status === 'to_reimburse').reduce((s, l) => s + confirmedAmt(l), 0);
  const count = confirmed.length;

  // 分类占比：以已确认清单的商品实际总价为基数（第 17.3 / 17.4 节）
  const items = confirmed.flatMap((l) => db.prepare('SELECT * FROM ShoppingItem WHERE shopping_list_id=?').all(l.shopping_list_id));
  const catTotal = items.reduce((s, i) => s + (i.actual_total || 0), 0) || 1;
  const primaryMap = {}, foodMap = {};
  items.forEach((i) => {
    const amt = i.actual_total || 0; if (!amt) return;
    const pc = i.primary_category || '其他';
    primaryMap[pc] = (primaryMap[pc] || 0) + amt;
    if (pc === '食材') { const sc = i.secondary_category || '其他食材'; foodMap[sc] = (foodMap[sc] || 0) + amt; }
  });
  const foodTotal = primaryMap['食材'] || 0;
  const primary = Object.entries(primaryMap).map(([category, amount]) => ({
    category, amount: +amount.toFixed(2), pct: +(amount / catTotal * 100).toFixed(1),
  })).sort((a, b) => b.amount - a.amount);
  const food = Object.entries(foodMap).map(([category, amount]) => ({
    category, amount: +amount.toFixed(2),
    pct_of_total: +(amount / catTotal * 100).toFixed(1),
    pct_of_food: foodTotal ? +(amount / foodTotal * 100).toFixed(1) : 0,
  })).sort((a, b) => b.amount - a.amount);

  // 采购记录列表（第 16 节）
  const records = inMonth.map((l) => {
    const v = listWith(l);
    return { shopping_list_id: l.shopping_list_id, title: l.title, store_name: l.store_name,
      assignee: v.assignee?.name, item_count: v.items.length, purchase_date: l.purchase_date || (l.confirmed_at||'').slice(0,10),
      amount: +confirmedAmt(l).toFixed(2), match_status: v.match_status, status: l.status,
      reimbursement_status: l.reimbursement_status, counted: ['confirmed','reimbursed'].includes(l.status) };
  }).sort((a, b) => (b.purchase_date||'').localeCompare(a.purchase_date||''));

  res.json({
    year, month,
    summary: { total_confirmed: +totalConfirmed.toFixed(2), pending: +pendingAmt.toFixed(2),
      reimbursed: +reimbursed.toFixed(2), to_reimburse: +toReimburse.toFixed(2),
      count, average: count ? +(totalConfirmed / count).toFixed(2) : 0, food_total: +foodTotal.toFixed(2) },
    primary, food, records,
  });
});

// ---- 通知 ----
api.get('/notifications', (req, res) => {
  const { role } = req.query;
  let sql='SELECT * FROM Notification WHERE family_id=?', args=[famId(req)];
  if (role) { sql+=' AND to_role=?'; args.push(role); }
  // 定向通知（to_user_id 非空）只有目标用户可见；群发（为空）所有该角色可见
  sql+=' AND (to_user_id IS NULL OR to_user_id=?)'; args.push(req.userId);
  sql+=' ORDER BY notification_id DESC';
  res.json(db.prepare(sql).all(...args));
});
api.post('/notifications/:id/read', (req,res)=>{
  const n = db.prepare('SELECT * FROM Notification WHERE notification_id=?').get(req.params.id);
  if (!owns(req, n)) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE Notification SET is_read=1 WHERE notification_id=?').run(n.notification_id); res.json({ok:true});
});

// ===================== MOM 重要事项 =====================
// 雇主为女佣创建/管理（体检、WP/护照/保险到期、Levy、住址、MOM 预约等）；女佣只能查看/确认/提交完成。
const REMIND_OFFSETS = [0, 1, 3, 7];
const curUserRole = (req) => { const u = db.prepare('SELECT role FROM User WHERE user_id=?').get(req.userId); return u ? u.role : null; };
const addDays = (dateStr, n) => { const d = parseYmd(dateStr); d.setDate(d.getDate() + n); return ymd(d); };
// 展示状态：done(已完成) / overdue(已逾期) / due_today(当天待完成) / upcoming(即将到期)
function momDisplay(e, today) {
  if (e.status === 'done') return 'done';
  if (e.event_date < today) return 'overdue';
  if (e.event_date === today) return 'due_today';
  return 'upcoming';
}
function momView(e) {
  const today = todayYmd();
  const h = e.helper_user_id ? db.prepare('SELECT user_id,name,avatar FROM User WHERE user_id=?').get(e.helper_user_id) : null;
  return { ...e, helper: h, display_status: momDisplay(e, today), remind_date: addDays(e.event_date, -(e.remind_offset || 0)) };
}
// 是否应在"今日"首页展示：未完成的一直显示（即将到期/当天/逾期）；已完成的仅完成当天显示、次日移除。
// 「提醒时间」只影响推送提醒时机，不再影响首页可见性。
function momShowToday(e, today) {
  if (e.status === 'done') return !!e.completed_at && e.completed_at.slice(0, 10) === today;
  return true;
}
const momTodayFor = (familyId, helperUserId, today) =>
  db.prepare('SELECT * FROM MomEvent WHERE family_id=? AND helper_user_id=? ORDER BY event_date').all(familyId, helperUserId)
    .filter((e) => momShowToday(e, today)).map(momView)
    .sort((a, b) => (({ overdue: 0, due_today: 1, upcoming: 2, done: 3 })[a.display_status] - ({ overdue: 0, due_today: 1, upcoming: 2, done: 3 })[b.display_status]) || a.event_date.localeCompare(b.event_date));

// 列表：雇主看本家庭全部（可按 helper 过滤）；女佣看自己的
api.get('/mom-events', (req, res) => {
  const role = curUserRole(req);
  let rows;
  if (role === 'maid') rows = db.prepare('SELECT * FROM MomEvent WHERE family_id=? AND helper_user_id=? ORDER BY event_date').all(famId(req), req.userId);
  else if (req.query.helper_id) rows = db.prepare('SELECT * FROM MomEvent WHERE family_id=? AND helper_user_id=? ORDER BY event_date').all(famId(req), +req.query.helper_id);
  else rows = db.prepare('SELECT * FROM MomEvent WHERE family_id=? ORDER BY event_date').all(famId(req));
  res.json(rows.map(momView));
});
// 今日模块：女佣看自己的、雇主看全家庭
api.get('/mom-events/today', (req, res) => {
  const today = todayYmd();
  const rows = curUserRole(req) === 'maid'
    ? momTodayFor(famId(req), req.userId, today)
    : db.prepare('SELECT * FROM MomEvent WHERE family_id=? ORDER BY event_date').all(famId(req)).filter((e) => momShowToday(e, today)).map(momView);
  res.json(rows);
});
// 雇主创建
api.post('/mom-events', (req, res) => {
  if (curUserRole(req) !== 'employer') return res.status(403).json({ error: 'only_employer' });
  const b = req.body;
  const helperId = resolveHelperId(req, b.helper_id);
  if (!helperId) return res.status(400).json({ error: 'no_helper' });
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'title_required' });
  if (!b.event_date) return res.status(400).json({ error: 'date_required' });
  const remind = REMIND_OFFSETS.includes(+b.remind_offset) ? +b.remind_offset : 0;
  const repeat = ['none', 'monthly', 'yearly'].includes(b.repeat_rule) ? b.repeat_rule : 'none';
  const id = db.prepare(`INSERT INTO MomEvent (family_id,helper_user_id,title,category,event_date,remind_offset,notify_helper,note,repeat_rule,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(famId(req), helperId, String(b.title).trim(), b.category || null, b.event_date, remind, b.notify_helper === false ? 0 : 1, b.note || '', repeat, req.userId).lastInsertRowid;
  res.json(momView(db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(id)));
});
// 雇主编辑
api.patch('/mom-events/:id', (req, res) => {
  if (curUserRole(req) !== 'employer') return res.status(403).json({ error: 'only_employer' });
  const e = db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(req.params.id);
  if (!owns(req, e)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const remind = b.remind_offset !== undefined && REMIND_OFFSETS.includes(+b.remind_offset) ? +b.remind_offset : e.remind_offset;
  const repeat = b.repeat_rule !== undefined && ['none', 'monthly', 'yearly'].includes(b.repeat_rule) ? b.repeat_rule : e.repeat_rule;
  const helperId = b.helper_id !== undefined ? resolveHelperId(req, b.helper_id) : e.helper_user_id;
  db.prepare(`UPDATE MomEvent SET title=@title, category=@category, event_date=@event_date, remind_offset=@remind,
      notify_helper=@notify, note=@note, repeat_rule=@repeat, helper_user_id=@helper, updated_at=datetime('now','localtime') WHERE mom_event_id=@id`)
    .run({ title: b.title !== undefined ? String(b.title).trim() : e.title, category: b.category !== undefined ? b.category : e.category,
      event_date: b.event_date || e.event_date, remind, notify: b.notify_helper !== undefined ? (b.notify_helper ? 1 : 0) : e.notify_helper,
      note: b.note !== undefined ? b.note : e.note, repeat, helper: helperId, id: e.mom_event_id });
  res.json(momView(db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(e.mom_event_id)));
});
// 雇主删除
api.delete('/mom-events/:id', (req, res) => {
  if (curUserRole(req) !== 'employer') return res.status(403).json({ error: 'only_employer' });
  const e = db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(req.params.id);
  if (!owns(req, e)) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM MomEvent WHERE mom_event_id=?').run(e.mom_event_id);
  res.json({ ok: true });
});
// 女佣"我知道了"
api.post('/mom-events/:id/ack', (req, res) => {
  const e = db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(req.params.id);
  if (!owns(req, e) || e.helper_user_id !== req.userId) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE MomEvent SET helper_ack=1, updated_at=datetime('now','localtime') WHERE mom_event_id=?").run(e.mom_event_id);
  res.json(momView(db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(e.mom_event_id)));
});
// 女佣标记完成 → 待雇主确认，通知雇主
api.post('/mom-events/:id/helper-done', (req, res) => {
  const e = db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(req.params.id);
  if (!owns(req, e) || e.helper_user_id !== req.userId) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE MomEvent SET status='helper_done', helper_ack=1, helper_done_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE mom_event_id=?").run(e.mom_event_id);
  const maid = db.prepare('SELECT name FROM User WHERE user_id=?').get(req.userId);
  notify(e.family_id, 'mom', 'MOM 事项待确认', `${maid?.name || '女佣'} 已标记完成「${e.title}」，请确认`, 'mom', e.mom_event_id, 'employer');
  res.json(momView(db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(e.mom_event_id)));
});
// 雇主确认完成 → done；重复事项自动生成下一次；通知女佣
api.post('/mom-events/:id/confirm', (req, res) => {
  if (curUserRole(req) !== 'employer') return res.status(403).json({ error: 'only_employer' });
  const e = db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(req.params.id);
  if (!owns(req, e)) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE MomEvent SET status='done', completed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE mom_event_id=?").run(e.mom_event_id);
  if (e.repeat_rule === 'monthly' || e.repeat_rule === 'yearly') {
    const d = parseYmd(e.event_date);
    if (e.repeat_rule === 'monthly') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1);
    db.prepare(`INSERT INTO MomEvent (family_id,helper_user_id,title,category,event_date,remind_offset,notify_helper,note,repeat_rule,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(e.family_id, e.helper_user_id, e.title, e.category, ymd(d), e.remind_offset, e.notify_helper, e.note, e.repeat_rule, e.created_by);
  }
  notify(e.family_id, 'mom', 'MOM 事项已完成', `「${e.title}」已确认完成`, 'mom', e.mom_event_id, 'maid', e.helper_user_id);
  res.json(momView(db.prepare('SELECT * FROM MomEvent WHERE mom_event_id=?').get(e.mom_event_id)));
});

// ===================== 订阅：用户侧接口 =====================
api.get('/subscription/plans', (req, res) => res.json({
  promo_text: getConfig('promo_text') || '',
  plans: ['monthly', 'yearly'].map(plan).map((p) => ({ plan_id: p.plan_id, name: p.name, name_zh: p.name_zh,
    original_price: p.original_price.toFixed(2), discount_percent: p.discount_percent, price: p.price.toFixed(2), currency: p.currency, period: p.period })),
}));
api.get('/subscription/current', (req, res) => res.json({ ...subView(req.familyId), paynow_qr_url: getConfig('paynow_qr_url'), paynow_name: getConfig('paynow_name') }));
api.post('/subscription/payment-orders', (req, res) => {
  const me = db.prepare('SELECT role FROM User WHERE user_id=?').get(req.userId);
  if (!me || me.role !== 'employer') return res.status(403).json({ error: 'only_employer_can_pay' });   // 女佣不能付款
  const plan = PLANS[req.body.plan_id];
  if (!plan) return res.status(400).json({ error: 'invalid_plan' });   // 前端只传 plan_id，金额后端定
  const order_no = 'SUB_' + todayYmd().replace(/-/g, '') + '_' + Math.random().toString(36).slice(2, 8).toUpperCase();
  db.prepare(`INSERT INTO PaymentOrder (order_no, family_id, payer_user_id, plan_id, amount, currency, status) VALUES (?,?,?,?,?,?, 'PENDING')`)
    .run(order_no, req.familyId, req.userId, plan.plan_id, plan.price, plan.currency);
  res.json({ order_no, plan_id: plan.plan_id, plan_name: plan.name_zh, amount: plan.price.toFixed(2), currency: plan.currency, status: 'PENDING',
    paynow_qr_url: getConfig('paynow_qr_url'), paynow_name: getConfig('paynow_name') });
});
api.get('/subscription/payment-orders/:order_no', (req, res) => {
  const o = db.prepare('SELECT * FROM PaymentOrder WHERE order_no=?').get(req.params.order_no);
  if (!o || o.family_id !== req.familyId) return res.status(404).json({ error: 'not found' });
  res.json({ order_no: o.order_no, status: o.status, amount: o.amount.toFixed(2), currency: o.currency, plan_id: o.plan_id, plan_name: (PLANS[o.plan_id] || {}).name_zh,
    paynow_qr_url: getConfig('paynow_qr_url'), paynow_name: getConfig('paynow_name') });
});
api.post('/subscription/payment-orders/:order_no/claim', (req, res) => {   // 我已付款 → 待管理员确认
  const o = db.prepare('SELECT * FROM PaymentOrder WHERE order_no=?').get(req.params.order_no);
  if (!o || o.family_id !== req.familyId) return res.status(404).json({ error: 'not found' });
  if (o.status === 'PENDING') db.prepare("UPDATE PaymentOrder SET status='SUBMITTED', claimed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE payment_order_id=?").run(o.payment_order_id);
  res.json({ order_no: o.order_no, status: db.prepare('SELECT status FROM PaymentOrder WHERE payment_order_id=?').get(o.payment_order_id).status });
});

// ===================== 管理后台接口（ADMIN_KEY 鉴权） =====================
api.get('/admin/ping', adminGuard, (req, res) => res.json({ ok: true }));
api.get('/admin/dashboard', adminGuard, (req, res) => {
  // 统计只算当前有效账号，已删除（account_status='removed'）的不计入用户总数/雇主/女佣数
  const users = db.prepare("SELECT role FROM User WHERE COALESCE(account_status,'active') <> 'removed'").all();
  const fams = db.prepare('SELECT family_id FROM Family').all();
  const c = { TRIAL_ACTIVE: 0, ACTIVE: 0, EXPIRING_SOON: 0, EXPIRED: 0, monthly: 0, yearly: 0 };
  for (const f of fams) { const v = subView(f.family_id); c[v.status] = (c[v.status] || 0) + 1; if (v.active && v.plan_id !== 'trial') c[v.plan_id] = (c[v.plan_id] || 0) + 1; }
  const sum = (sql, ...a) => db.prepare(sql).get(...a).s;
  res.json({
    users_total: users.length, employers: users.filter(u => u.role === 'employer').length, maids: users.filter(u => u.role === 'maid').length,
    families_total: fams.length, trial: c.TRIAL_ACTIVE, monthly: c.monthly, yearly: c.yearly, active_paid: c.monthly + c.yearly,
    expiring_soon: c.EXPIRING_SOON, expired: c.EXPIRED,
    revenue_total: sum("SELECT COALESCE(SUM(amount),0) s FROM PaymentOrder WHERE status='PAID'"),
    revenue_month: sum("SELECT COALESCE(SUM(amount),0) s FROM PaymentOrder WHERE status='PAID' AND substr(COALESCE(paid_at,created_at),1,7)=?", todayYmd().slice(0, 7)),
    revenue_today: sum("SELECT COALESCE(SUM(amount),0) s FROM PaymentOrder WHERE status='PAID' AND substr(COALESCE(paid_at,created_at),1,10)=?", todayYmd()),
    pending_orders: db.prepare("SELECT COUNT(*) c FROM PaymentOrder WHERE status IN ('PENDING','SUBMITTED')").get().c,
  });
});
api.get('/admin/orders', adminGuard, (req, res) => {
  let sql = `SELECT po.*, f.family_name, u.name payer_name FROM PaymentOrder po
    LEFT JOIN Family f ON f.family_id=po.family_id LEFT JOIN User u ON u.user_id=po.payer_user_id`;
  const args = []; if (req.query.status) { sql += ' WHERE po.status=?'; args.push(req.query.status); }
  sql += ' ORDER BY po.payment_order_id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});
api.post('/admin/orders/:order_no/confirm', adminGuard, (req, res) => {   // 手动确认到账 → 开通
  const o = db.prepare('SELECT * FROM PaymentOrder WHERE order_no=?').get(req.params.order_no);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.status === 'PAID') return res.json({ ok: true, already: true, subscription: subView(o.family_id) });
  const v = activateSubscription(o, { by: 'super', reason: 'admin_confirm' });
  audit(req, 'PAYMENT_MANUALLY_CONFIRMED', { family_id: o.family_id, user_id: o.payer_user_id, order_id: o.payment_order_id, new: v.expire_at });
  res.json({ ok: true, subscription: v });
});
api.post('/admin/orders/:order_no/reject', adminGuard, (req, res) => {
  const o = db.prepare('SELECT * FROM PaymentOrder WHERE order_no=?').get(req.params.order_no);
  if (!o) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE PaymentOrder SET status='CANCELLED', note=?, updated_at=datetime('now','localtime') WHERE order_no=?").run(req.body.reason || '', req.params.order_no);
  audit(req, 'PAYMENT_REJECTED', { family_id: o.family_id, order_id: o.payment_order_id, reason: req.body.reason });
  res.json({ ok: true });
});
// 修改某订单的实收金额（打折/更正）——已开通订单改后收入统计同步更正
api.post('/admin/orders/:order_no/amount', adminGuard, (req, res) => {
  const o = db.prepare('SELECT * FROM PaymentOrder WHERE order_no=?').get(req.params.order_no);
  if (!o) return res.status(404).json({ error: 'not found' });
  const amt = +req.body.amount;
  if (!(amt >= 0 && amt < 100000 && isFinite(amt))) return res.status(400).json({ error: 'invalid_amount' });
  db.prepare("UPDATE PaymentOrder SET amount=?, note=COALESCE(NULLIF(?,''),note), updated_at=datetime('now','localtime') WHERE payment_order_id=?").run(amt, req.body.reason || '', o.payment_order_id);
  audit(req, 'ORDER_AMOUNT_ADJUSTED', { family_id: o.family_id, user_id: o.payer_user_id, order_id: o.payment_order_id, old: (+o.amount).toFixed(2), new: amt.toFixed(2), reason: req.body.reason });
  res.json({ ok: true, order_no: o.order_no, amount: amt.toFixed(2) });
});
api.get('/admin/subscriptions', adminGuard, (req, res) => {
  const fams = db.prepare(`SELECT f.family_id, f.family_name,
      (SELECT u.name FROM FamilyMember fm JOIN User u ON u.user_id=fm.user_id WHERE fm.family_id=f.family_id AND fm.role='employer' AND fm.status='active' ORDER BY fm.family_member_id LIMIT 1) owner_name
    FROM Family f`).all();
  let rows = fams.map((f) => { const v = subView(f.family_id); const p = familyPaid(f.family_id); return { ...f, ...v, total_paid: p.s, pay_count: p.c }; });
  if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
  res.json(rows.sort((a, b) => b.family_id - a.family_id));
});
api.post('/admin/families/:familyId/extend', adminGuard, (req, res) => {
  const fid = +req.params.familyId; const days = +req.body.days || 0;
  if (!days) return res.status(400).json({ error: 'days_required' });
  if (!req.body.reason) return res.status(400).json({ error: 'reason_required' });
  const s = ensureSubscription(fid);
  const times = [s.trial_end_at, s.current_period_end_at].filter(Boolean).map((x) => new Date(x).getTime());
  const now = Date.now(); const latest = times.length ? Math.max(...times) : 0;
  const base = latest > now ? new Date(latest) : new Date();
  const newEnd = new Date(base.getTime() + days * 86400000);
  db.prepare("UPDATE FamilySubscription SET current_period_end_at=?, status='ACTIVE', access_status='ACTIVE', updated_at=datetime('now','localtime') WHERE family_id=?").run(newEnd.toISOString(), fid);
  db.prepare(`INSERT INTO SubscriptionHistory (family_id, old_status, new_status, old_expire_at, new_expire_at, plan_id, reason) VALUES (?,?,?,?,?,?,?)`)
    .run(fid, s.status, 'ACTIVE', latest ? new Date(latest).toISOString() : null, newEnd.toISOString(), s.plan_id, req.body.reason);
  audit(req, 'SUBSCRIPTION_EXTENDED', { family_id: fid, old: latest ? new Date(latest).toISOString() : null, new: newEnd.toISOString(), reason: req.body.reason });
  if (req.body.notify_user !== false) notify(fid, 'subscription', '订阅已延长', `管理员为你延长 ${days} 天，有效期至 ${newEnd.toISOString().slice(0, 10)}`, 'subscription', null, 'employer');
  res.json({ ok: true, subscription: subView(fid) });
});
api.post('/admin/families/:familyId/lock', adminGuard, (req, res) => {
  const fid = +req.params.familyId; ensureSubscription(fid); const nowIso = new Date().toISOString();
  db.prepare("UPDATE FamilySubscription SET current_period_end_at=?, trial_end_at=?, status='LOCKED', access_status='LOCKED', updated_at=datetime('now','localtime') WHERE family_id=?").run(nowIso, nowIso, fid);
  audit(req, 'SUBSCRIPTION_LOCKED', { family_id: fid, reason: req.body.reason });
  res.json({ ok: true });
});
api.post('/admin/families/:familyId/unlock', adminGuard, (req, res) => {
  const fid = +req.params.familyId; ensureSubscription(fid); const newEnd = addMonths(new Date(), 1);
  db.prepare("UPDATE FamilySubscription SET current_period_end_at=?, status='ACTIVE', access_status='ACTIVE', updated_at=datetime('now','localtime') WHERE family_id=?").run(newEnd.toISOString(), fid);
  audit(req, 'SUBSCRIPTION_UNLOCKED', { family_id: fid, new: newEnd.toISOString(), reason: req.body.reason });
  res.json({ ok: true, subscription: subView(fid) });
});
api.get('/admin/users', adminGuard, (req, res) => {
  const kw = (req.query.keyword || '').trim();
  let sql = `SELECT u.user_id, u.name, u.display_name, u.username, u.role, u.email, u.phone, u.account_status, u.created_at, u.last_login_at,
      fm.family_id, f.family_name FROM User u
      LEFT JOIN FamilyMember fm ON fm.user_id=u.user_id AND fm.status='active'
      LEFT JOIN Family f ON f.family_id=fm.family_id`;
  const args = []; const where = [];
  if (kw) { where.push('(u.name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR f.family_name LIKE ? OR CAST(u.user_id AS TEXT)=?)'); args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, kw); }
  if (req.query.role) { where.push('u.role=?'); args.push(req.query.role); }
  // 默认不显示已注销账号（雇主删女佣/管理员删用户后后台同步隐藏）；需审计时带 include_removed=1 才列出
  if (req.query.include_removed !== '1') where.push("COALESCE(u.account_status,'active') <> 'removed'");
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY u.user_id DESC LIMIT 200';
  res.json(db.prepare(sql).all(...args).map((u) => {
    const sv = u.family_id ? subView(u.family_id) : null;
    return { user_id: u.user_id, name: u.display_name || u.name, username: u.username, role: u.role,
      phone: maskPhone(u.phone), email: maskEmail(u.email), family_id: u.family_id, family_name: u.family_name,
      account_status: u.account_status || 'active', created_at: u.created_at, last_login_at: u.last_login_at,
      sub_status: sv ? sv.status : null, plan_id: sv ? sv.plan_id : null, expire_at: sv ? sv.expire_at : null, personal_paid: userPaid(u.user_id).s };
  }));
});
api.get('/admin/users/:id', adminGuard, (req, res) => {
  const u = db.prepare('SELECT * FROM User WHERE user_id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  const fm = db.prepare("SELECT family_id, role, join_date FROM FamilyMember WHERE user_id=? AND status='active' ORDER BY family_member_id LIMIT 1").get(u.user_id);
  const fam = fm ? db.prepare('SELECT * FROM Family WHERE family_id=?').get(fm.family_id) : null;
  const orders = db.prepare('SELECT order_no, plan_id, amount, currency, status, created_at, paid_at FROM PaymentOrder WHERE payer_user_id=? OR family_id=? ORDER BY payment_order_id DESC LIMIT 50').all(u.user_id, fm ? fm.family_id : 0);
  audit(req, 'USER_VIEWED', { user_id: u.user_id, family_id: fm ? fm.family_id : null });
  res.json({   // 绝不返回 password_hash
    profile: { user_id: u.user_id, name: u.display_name || u.name, username: u.username, role: u.role, avatar: u.avatar,
      phone: maskPhone(u.phone), email: maskEmail(u.email), gender: u.gender, country: u.country, created_at: u.created_at, last_login_at: u.last_login_at, account_status: u.account_status || 'active' },
    family: fam ? { family_id: fam.family_id, family_name: fam.family_name, role: fm.role, invite_code: fam.invite_code } : null,
    subscription: fm ? subView(fm.family_id) : null,
    personal_paid: userPaid(u.user_id).s, family_paid: fm ? familyPaid(fm.family_id).s : 0, orders,
  });
});
// 管理员删除用户（软删除，与 /members/:id/remove 一致）：标记 removed + 释放邮箱(可重注册) + 移出所有家庭；
// 业务数据保留；账号从此无法登录（成员记录 removed → 无 family → 401）。写审计。
api.post('/admin/users/:id/delete', adminGuard, (req, res) => {
  const u = db.prepare('SELECT * FROM User WHERE user_id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  if ((u.account_status || 'active') === 'removed') return res.json({ ok: true, already: true, user_id: u.user_id, account_status: 'removed' });
  const fams = db.prepare("SELECT family_id FROM FamilyMember WHERE user_id=? AND status='active'").all(u.user_id).map((r) => r.family_id);
  db.transaction(() => {
    db.prepare("UPDATE FamilyMember SET status='removed' WHERE user_id=? AND status='active'").run(u.user_id);
    db.prepare("UPDATE User SET account_status='removed', email=NULL, updated_at=datetime('now','localtime') WHERE user_id=?").run(u.user_id);
  })();
  audit(req, 'USER_DELETED', { user_id: u.user_id, family_id: fams[0] ?? null, old: u.account_status || 'active', new: 'removed', reason: req.body?.reason });
  res.json({ ok: true, user_id: u.user_id, account_status: 'removed' });
});
api.get('/admin/audit', adminGuard, (req, res) => res.json(db.prepare('SELECT * FROM AdminAuditLog ORDER BY audit_log_id DESC LIMIT 200').all()));
const adminConfigView = () => ({ paynow_qr_url: getConfig('paynow_qr_url'), paynow_name: getConfig('paynow_name'), promo_text: getConfig('promo_text') || '',
  orig_monthly: planOrig('monthly').toFixed(2), disc_monthly: planDiscount('monthly'), price_monthly: planPrice('monthly').toFixed(2),
  orig_yearly: planOrig('yearly').toFixed(2), disc_yearly: planDiscount('yearly'), price_yearly: planPrice('yearly').toFixed(2) });
api.get('/admin/config', adminGuard, (req, res) => res.json(adminConfigView()));
api.post('/admin/config', adminGuard, (req, res) => {
  const b = req.body;
  if (b.paynow_name !== undefined) setConfig('paynow_name', b.paynow_name);
  if (b.promo_text !== undefined) setConfig('promo_text', String(b.promo_text).slice(0, 120));   // 限时折扣等文案
  // 修改套餐原价 + 折扣（对所有用户实时生效，写审计）
  for (const id of ['monthly', 'yearly']) {
    const ok = 'orig_' + id, dk = 'disc_' + id;
    if (b[ok] !== undefined && b[ok] !== '' && b[ok] !== null) {
      const v = +b[ok];
      if (!(v >= 0 && v < 100000 && isFinite(v))) return res.status(400).json({ error: 'invalid_price' });
      const old = planOrig(id); setConfig(ok, v.toFixed(2));
      if (old !== v) audit(req, 'PLAN_PRICE_CHANGED', { old: `${id}orig:${old}`, new: `${id}orig:${v.toFixed(2)}` });
    }
    if (b[dk] !== undefined && b[dk] !== '' && b[dk] !== null) {
      const v = +b[dk];
      if (!(v >= 0 && v <= 100 && isFinite(v))) return res.status(400).json({ error: 'invalid_discount' });
      const old = planDiscount(id); setConfig(dk, String(v));
      if (old !== v) audit(req, 'PLAN_DISCOUNT_CHANGED', { old: `${id}:${old}%`, new: `${id}:${v}%` });
    }
  }
  if (b.image_base64) {
    const base64 = b.image_base64.replace(/^data:[^;]+;base64,/, ''); const mt = b.media_type || 'image/png';
    const ext = (mt.split('/')[1] || 'png').replace('jpeg', 'jpg'); const fname = `paynow_${Date.now()}.${ext}`;
    try { fs.writeFileSync(join(uploadsDir, fname), Buffer.from(base64, 'base64')); setConfig('paynow_qr_url', `/uploads/${fname}`); }
    catch (e) { return res.status(500).json({ error: 'save_failed' }); }
  } else if (b.paynow_qr_url !== undefined) setConfig('paynow_qr_url', b.paynow_qr_url);
  res.json(adminConfigView());
});

app.use('/api', api);

// ---- MCP server（LLM 客户端接入，见 server/mcp.js）----
import { mountMcp } from './mcp.js';
mountMcp(app);

// ---- 小票图片静态访问 ----
app.use('/uploads', express.static(uploadsDir));

// ---- 静态前端 ----
const dist = join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')));
}

// 3 个月未登录的账号自动清空账号信息（释放 Gmail、移出家庭、标记删除），用户可重新注册；业务数据保留
function cleanupInactiveAccounts() {
  try {
    const rows = db.prepare("SELECT user_id FROM User WHERE COALESCE(account_status,'active')<>'removed' AND last_login_at IS NOT NULL AND last_login_at < datetime('now','localtime','-3 months')").all();
    for (const r of rows) {
      db.prepare("UPDATE User SET account_status='removed', email=NULL, updated_at=datetime('now','localtime') WHERE user_id=?").run(r.user_id);
      db.prepare("UPDATE FamilyMember SET status='removed' WHERE user_id=? AND status='active'").run(r.user_id);
    }
    if (rows.length) console.log(`🧹 已清理 ${rows.length} 个超过 3 个月未登录的账号`);
  } catch (e) { console.error('清理任务出错', e); }
}
cleanupInactiveAccounts();                                   // 启动跑一次
setInterval(cleanupInactiveAccounts, 24 * 60 * 60 * 1000);   // 每天跑一次

// MOM 重要事项每日提醒：提醒日（事件日-提前天数）或事件当天，给女佣+雇主发通知（每事项每天最多一次）
function momDailyReminders() {
  try {
    const today = todayYmd();
    const evs = db.prepare("SELECT * FROM MomEvent WHERE status IN ('pending','helper_done')").all();
    for (const e of evs) {
      if (e.last_reminded_date === today) continue;
      const remindDay = today === addDays(e.event_date, -(e.remind_offset || 0));
      const eventDay = today === e.event_date;
      if (!remindDay && !eventDay) continue;
      if (e.notify_helper) notify(e.family_id, 'mom', 'MOM 重要提醒', `你${eventDay ? '今天' : '即将'}有一项「${e.title}」事项，请查看详情`, 'mom', e.mom_event_id, 'maid', e.helper_user_id);
      if (eventDay) notify(e.family_id, 'mom', 'MOM 重要事项', `女佣今天有一项 MOM 重要事项待完成：${e.title}`, 'mom', e.mom_event_id, 'employer');
      db.prepare('UPDATE MomEvent SET last_reminded_date=? WHERE mom_event_id=?').run(today, e.mom_event_id);
    }
  } catch (err) { console.error('MOM 提醒任务出错', err); }
}
momDailyReminders();
setInterval(momDailyReminders, 6 * 60 * 60 * 1000);          // 每 6 小时检查一次（跨天即触发当天提醒）

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🏠 HomeFlow 运行于 http://localhost:${PORT}`));

export { app };
