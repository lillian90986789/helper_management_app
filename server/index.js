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
  const uid = +req.headers['x-user-id'] || 0;
  if (uid) {
    const fm = db.prepare("SELECT family_id FROM FamilyMember WHERE user_id=? AND status='active' ORDER BY family_member_id LIMIT 1").get(uid);
    if (fm) { req.userId = uid; req.familyId = fm.family_id; }
  }
  // 公共端点无需登录：运行配置、各类登录/注册、女佣凭邀请码加入
  const p = req.path;
  const isPublic = p === '/config' || p === '/join' || p.startsWith('/auth/');
  if (isPublic || req.method === 'OPTIONS') return next();
  if (!req.familyId) return res.status(401).json({ error: 'auth_required' });
  next();
});
// 当前家庭（按登录用户）。未登录时的受保护端点已被上面拦截，这里必有 familyId。
const curFamily = (req) => db.prepare('SELECT * FROM Family WHERE family_id=?').get(req.familyId);
const famId = (req) => req.familyId;
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
const notify = (familyId,type,title,content,refType,refId,toRole) =>
  db.prepare(`INSERT INTO Notification (family_id,type,title,content,ref_type,ref_id,to_role) VALUES (?,?,?,?,?,?,?)`).run(familyId,type,title,content,refType,refId,toRole);

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
      VALUES (?,?,?, 'employer', 'google', 'zh', 'active', 'COMPLETED', datetime('now'), datetime('now'))`)
      .run(info.name || email.split('@')[0], '👤', email).lastInsertRowid;
    db.prepare("INSERT INTO FamilyMember (family_id, user_id, role, permissions, status) VALUES (?,?,?,?,?)")
      .run(family.family_id, uid, 'employer', 'owner', 'active');
    u = db.prepare('SELECT * FROM User WHERE user_id=?').get(uid);
  } else {
    db.prepare("UPDATE User SET name=COALESCE(NULLIF(name,''), ?), login_method='google', last_login_at=datetime('now') WHERE user_id=?")
      .run(info.name || null, u.user_id);
    u = db.prepare('SELECT * FROM User WHERE user_id=?').get(u.user_id);
    const fm = db.prepare("SELECT family_id FROM FamilyMember WHERE user_id=? AND status='active' ORDER BY family_member_id LIMIT 1").get(u.user_id);
    family = fm ? db.prepare('SELECT * FROM Family WHERE family_id=?').get(fm.family_id) : createEmptyFamily((u.name || 'My') + ' 的家');
    if (!fm) db.prepare("INSERT INTO FamilyMember (family_id, user_id, role, permissions, status) VALUES (?,?,?,?,?)").run(family.family_id, u.user_id, 'employer', 'owner', 'active');
  }
  res.json({ ok: true, is_new: isNew, user: { user_id: u.user_id, name: u.name, avatar: u.avatar, email },
    family: { family_id: family.family_id, family_name: family.family_name } });
});

// ---- 引导/家庭/用户 ----
api.get('/bootstrap', (req, res) => {
  const family = curFamily(req);
  const users = db.prepare(`SELECT u.* FROM User u JOIN FamilyMember fm ON fm.user_id=u.user_id
    WHERE fm.family_id=? AND fm.status='active' ORDER BY fm.family_member_id`).all(family.family_id);
  const areas = db.prepare('SELECT * FROM Area WHERE family_id=?').all(family.family_id);
  res.json({ family, users, areas });
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
  res.json({ user_id: uid, family_id: family.family_id, family_name: family.family_name, name: name.trim(), avatar });
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
      gender=COALESCE(@gender,gender), birth_date=COALESCE(@birth_date,birth_date), updated_at=datetime('now') WHERE user_id=@id`)
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
  const fname = `avatar_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  try { fs.writeFileSync(join(uploadsDir, fname), Buffer.from(base64, 'base64')); }
  catch (e) { return res.status(500).json({ error: 'save_failed' }); }
  res.json({ url: `/uploads/${fname}` });
});
api.post('/members/:id/remove', (req, res) => {
  // 成员离开家庭：失去数据访问（这里标记为 removed）
  db.prepare('UPDATE FamilyMember SET status=? WHERE family_member_id=?').run('removed', req.params.id);
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
    db.prepare("UPDATE RegistrationDraft SET channel=?, registration_status=?, data=?, updated_at=datetime('now') WHERE contact=?")
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
      VALUES (@name,@avatar,@phone,@cc,@email,'employer',@lm,@pwd,@dn,@gender,@lang,@nlang,@country,@tz,@cur,'active','COMPLETED',datetime('now'))`)
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
      VALUES (@fn,@fa,@country,@city,@addr,@tz,@dl,@hl,@cur,@ws,@code,@uid,@uid,'active',datetime('now'))`)
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
    db.prepare("UPDATE RegistrationDraft SET registration_status='COMPLETED', user_id=?, family_id=?, updated_at=datetime('now') WHERE contact=?").run(uid, fam, contact);
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
      VALUES (?,?,?, '👨🏻‍💼', 'employer', 'password', 'zh', 'active', 'COMPLETED', datetime('now'), datetime('now'))`)
      .run(fullName, username, hashPwd(password)).lastInsertRowid;
    db.prepare("INSERT INTO FamilyMember (family_id,user_id,role,permissions,status) VALUES (?,?,?,?,?)").run(family.family_id, uid, 'employer', 'owner', 'active');
    return { uid, family };
  });
  let r; try { r = tx(); } catch (e) { return res.status(500).json({ error: 'register_failed', detail: String(e.message || e) }); }
  const user = db.prepare('SELECT user_id,name,avatar,role,username FROM User WHERE user_id=?').get(r.uid);
  res.json({ ok: true, user, family: { family_id: r.family.family_id, family_name: r.family.family_name } });
});

api.post('/auth/employer/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const u = db.prepare("SELECT * FROM User WHERE username=? AND role='employer'").get(username);
  if (!u || !u.password_hash || u.password_hash !== hashPwd(password)) return res.status(401).json({ error: 'invalid_credentials' });
  db.prepare("UPDATE User SET last_login_at=datetime('now') WHERE user_id=?").run(u.user_id);
  const fm = db.prepare("SELECT family_id FROM FamilyMember WHERE user_id=? AND status='active' ORDER BY family_member_id LIMIT 1").get(u.user_id);
  const family = fm ? db.prepare('SELECT family_id,family_name FROM Family WHERE family_id=?').get(fm.family_id) : null;
  res.json({ ok: true, user: { user_id: u.user_id, name: u.name, avatar: u.avatar, username }, family });
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
api.get('/daily', (req, res) => {
  const date = req.query.date || todayYmd();
  ensureDailyTasks(date, famId(req));
  const rows = db.prepare("SELECT * FROM DailyTask WHERE task_date=? AND family_id=? AND status != 'canceled' ORDER BY sort_order, daily_task_id").all(date, famId(req)).map(dailyWith);
  res.json({ date, tasks: rows });
});
api.get('/daily/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM DailyTask WHERE daily_task_id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(dailyWith(t));
});
api.post('/daily/:id/transition', (req, res) => {
  const t = db.prepare('SELECT * FROM DailyTask WHERE daily_task_id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const { to, actor_id, action, note } = req.body;
  const now = new Date().toISOString();
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
  const ns = c.status === 'done' ? 'todo' : 'done';
  db.prepare('UPDATE DailyTaskChecklist SET status=? WHERE checklist_id=?').run(ns, c.checklist_id);
  res.json({ ...c, status: ns });
});
api.post('/daily/:id/attachment', (req, res) => {
  const { file_url, file_type, uploader_id } = req.body;
  db.prepare('INSERT INTO DailyTaskAttachment (daily_task_id,uploader_id,file_type,file_url) VALUES (?,?,?,?)').run(req.params.id, uploader_id || 2, file_type || 'image', file_url);
  res.json(db.prepare('SELECT * FROM DailyTaskAttachment WHERE daily_task_id=?').all(req.params.id));
});

// 周视图：某周 7 天的任务汇总（雇主端星期切换栏，含休息日标记）
api.get('/week', (req, res) => {
  const start = req.query.start ? parseYmd(req.query.start) : mondayOf(new Date());
  const helperId = req.query.helper_id ? +req.query.helper_id : defaultHelperId(famId(req));
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
  const helperId = req.query.helper_id ? +req.query.helper_id : defaultHelperId(famId(req));
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWd = isoWeekday(new Date(year, month - 1, 1)); // 该月 1 号是周几
  const days = [];
  let mTotal = 0, mDone = 0;
  for (let dd = 1; dd <= daysInMonth; dd++) {
    const dObj = new Date(year, month - 1, dd);
    const ds = ymd(dObj);
    ensureDailyTasks(ds, famId(req));
    // 按当前女佣过滤（女佣日历只看自己的任务；雇主设休息日时看该女佣的任务量）
    const tasks = db.prepare("SELECT status FROM DailyTask WHERE task_date=? AND assignee_id=? AND family_id=? AND status != 'canceled'").all(ds, helperId, famId(req));
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
  const helperId = req.query.helper_id ? +req.query.helper_id : defaultHelperId(famId(req));
  const rows = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND year=? AND month=? AND status='ACTIVE' ORDER BY rest_date")
    .all(helperId, year, month).map(restDayView);
  res.json({ year, month, helper_id: helperId, rest_days: rows });
});

// 女佣休息日汇总（首页卡片用）：本月休息日 + 下一个休息日 + 今天是否休息
api.get('/rest-days/summary', (req, res) => {
  const now = new Date();
  const year = req.query.year ? +req.query.year : now.getFullYear();
  const month = req.query.month ? +req.query.month : now.getMonth() + 1;
  const helperId = req.query.helper_id ? +req.query.helper_id : defaultHelperId(famId(req));
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
  const helperId = b.helper_id || defaultHelperId(famId(req));
  const dates = Array.isArray(b.dates) ? b.dates.filter(Boolean) : [];
  if (dates.length === 0) return res.status(400).json({ error: 'dates_required' });
  const handle = b.handle === 'keep' ? 'keep' : 'cancel';   // MVP：默认取消当天任务
  const notify_helper = b.notify !== false;
  const now = new Date().toISOString();
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
    notify(family.family_id, 'rest_day', '休息日已更新', msg, 'rest_day', created[0] || null, 'maid');
  }
  res.json({ ok: true, created_count: created.length });
});

// 取消休息日
api.delete('/rest-days/:id', (req, res) => {
  const family = curFamily(req);
  const r = db.prepare('SELECT * FROM HelperRestDay WHERE rest_day_id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE HelperRestDay SET status='CANCELED', updated_at=datetime('now') WHERE rest_day_id=?").run(r.rest_day_id);
  // 复活当天因休息日被取消的任务，使其重新生成
  db.prepare("DELETE FROM DailyTask WHERE task_date=? AND assignee_id=? AND status='canceled' AND is_rest_day_task=0").run(r.rest_date, r.helper_user_id);
  ensureDailyTasks(r.rest_date, famId(req));
  notify(family.family_id, 'rest_day', '休息日已调整', `你的休息日已调整：${fmtCn(r.rest_date)} 已取消`, 'rest_day', r.rest_day_id, 'maid');
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
  if (!tpl) return res.status(404).json({ error: 'not found' });
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
  if (!tpl) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const weekdays = b.weekdays !== undefined ? (Array.isArray(b.weekdays) ? b.weekdays : []) : JSON.parse(tpl.weekdays || '[]');
  if (b.weekdays !== undefined && weekdays.length === 0) return res.status(400).json({ error: 'weekdays_required' });
  db.prepare(`UPDATE TaskTemplate SET task_name=@task_name, task_name_en=@task_name_en, description=@description, area_id=@area_id,
      assignee_id=@assignee_id, priority=@priority, estimated_duration=@estimated_duration, weekdays=@weekdays,
      require_photo=@require_photo, minimum_photo_count=@minimum_photo_count, require_note=@require_note, require_approval=@require_approval,
      updated_at=datetime('now') WHERE task_template_id=@id`)
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
  const meals = db.prepare('SELECT mo.*, r.name recipe_name, r.name_en recipe_name_en, r.cover_image FROM MealOrder mo JOIN Recipe r ON r.recipe_id=mo.recipe_id WHERE mo.family_id=?').all(famId(req));
  const shopping = db.prepare('SELECT * FROM ShoppingList WHERE family_id=? ORDER BY shopping_list_id DESC LIMIT 1').get(famId(req)) || null;
  const items = shopping ? db.prepare('SELECT * FROM ShoppingItem WHERE shopping_list_id=?').all(shopping.shopping_list_id) : [];
  const shoppingSummary = {
    to_buy: items.filter(i=>i.status==='to_buy').length,
    sub_pending: items.filter(i=>i.status==='sub_requested').length,
    est_total: items.reduce((s,i)=> s + (i.estimated_price||0)*(i.quantity||1), 0),
    actual_total: items.reduce((s,i)=> s + (i.actual_total||0), 0),
  };
  const notifications = db.prepare("SELECT * FROM Notification WHERE family_id=? AND to_role IN ('employer') ORDER BY notification_id DESC LIMIT 6").all(famId(req));
  const family = curFamily(req);
  res.json({ summary, meals, shopping, shoppingSummary, notifications, family });
});
api.get('/dashboard/maid', (req, res) => {
  const date = todayYmd();
  const helperId = req.query.helper_id ? +req.query.helper_id : defaultHelperId(famId(req));
  const todayRest = !!activeRestDay(date, helperId);
  ensureDailyTasks(date, famId(req));
  const tasks = db.prepare("SELECT * FROM DailyTask WHERE task_date=? AND assignee_id=? AND family_id=? AND status != 'canceled' ORDER BY sort_order, daily_task_id").all(date, helperId, famId(req)).map(dailyWith);
  const done = tasks.filter(t=>['done','skipped'].includes(t.status)).length;
  const next = tasks.find(t=>['today_todo','in_progress','returned'].includes(t.status));
  const meals = db.prepare('SELECT mo.*, r.name recipe_name, r.name_en recipe_name_en, r.cover_image, r.recipe_type FROM MealOrder mo JOIN Recipe r ON r.recipe_id=mo.recipe_id WHERE assignee_id=? AND mo.family_id=?').all(helperId, famId(req));
  const shopping = db.prepare('SELECT * FROM ShoppingList WHERE family_id=? ORDER BY shopping_list_id DESC LIMIT 1').get(famId(req)) || null;
  const items = shopping ? db.prepare('SELECT * FROM ShoppingItem WHERE shopping_list_id=?').all(shopping.shopping_list_id) : [];
  // 本月休息日 + 下一个休息日（第 4 节）
  const now = new Date();
  const monthRest = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND year=? AND month=? AND status='ACTIVE' ORDER BY rest_date")
    .all(helperId, now.getFullYear(), now.getMonth() + 1).map(restDayView);
  const nextRest = db.prepare("SELECT * FROM HelperRestDay WHERE helper_user_id=? AND status='ACTIVE' AND rest_date>=? ORDER BY rest_date LIMIT 1").get(helperId, date);
  res.json({ tasks, progress:{ done, total: tasks.length }, next, meals,
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
api.get('/recipes', (req, res) => {
  const { type } = req.query;
  let sql = 'SELECT * FROM Recipe WHERE status!=\'deleted\' AND family_id=?', args=[famId(req)];
  if (type && type!=='all') { sql += ' AND recipe_type=?'; args.push(type); }
  res.json(db.prepare(sql).all(...args).map(recipeWith));
});
api.get('/recipes/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error:'not found' });
  res.json(recipeWith(r));
});
api.post('/recipes/:id/favorite', (req, res) => {
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  db.prepare('UPDATE Recipe SET favorite=? WHERE recipe_id=?').run(r.favorite?0:1, r.recipe_id);
  res.json({ favorite: r.favorite?0:1 });
});
// 新建菜谱（含食材 + 步骤）
api.post('/recipes', (req, res) => {
  const family = curFamily(req);
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name_required' });
  const id = db.prepare(`INSERT INTO Recipe (family_id,name,name_en,recipe_type,category,cover_image,servings,duration,difficulty,suitable_age,allergen_info,notes,status,creator_id)
    VALUES (@family_id,@name,@name_en,@recipe_type,@category,@cover_image,@servings,@duration,@difficulty,@suitable_age,@allergen_info,@notes,'published',1)`)
    .run({ family_id: family.family_id, name: b.name.trim(), name_en: b.name_en || '', recipe_type: b.recipe_type === 'baby' ? 'baby' : 'adult',
      category: b.category || '家常菜', cover_image: b.cover_image || '🍲', servings: b.servings || 2, duration: b.duration || 30,
      difficulty: ['easy','normal','hard'].includes(b.difficulty) ? b.difficulty : 'normal', suitable_age: b.suitable_age || '', allergen_info: b.allergen_info || '', notes: b.notes || '' }).lastInsertRowid;
  (b.ingredients || []).filter((i) => i.name && i.name.trim()).forEach((i) => db.prepare(`INSERT INTO RecipeIngredient (recipe_id,name,name_en,quantity,unit,required,substitute) VALUES (?,?,?,?,?,?,?)`)
    .run(id, i.name.trim(), i.name_en || '', i.quantity || '', i.unit || '', i.required === false ? 0 : 1, i.substitute || ''));
  (b.steps || []).filter((s) => (s.instruction || '').trim()).forEach((s, idx) => db.prepare(`INSERT INTO RecipeStep (recipe_id,step_number,instruction,instruction_en,duration) VALUES (?,?,?,?,?)`)
    .run(id, idx + 1, s.instruction.trim(), s.instruction_en || '', s.duration || 0));
  res.json(recipeWith(db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(id)));
});
// 修改已有菜谱（覆盖字段 + 重建食材/步骤）
api.patch('/recipes/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!r || r.family_id !== famId(req)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  if (b.name !== undefined && !String(b.name).trim()) return res.status(400).json({ error: 'name_required' });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE Recipe SET name=COALESCE(@name,name), name_en=COALESCE(@name_en,name_en), recipe_type=COALESCE(@recipe_type,recipe_type),
        category=COALESCE(@category,category), cover_image=COALESCE(@cover_image,cover_image), servings=COALESCE(@servings,servings),
        duration=COALESCE(@duration,duration), difficulty=COALESCE(@difficulty,difficulty), suitable_age=COALESCE(@suitable_age,suitable_age),
        notes=COALESCE(@notes,notes) WHERE recipe_id=@id`)
      .run({ name: b.name !== undefined ? String(b.name).trim() : null, name_en: b.name_en ?? null,
        recipe_type: b.recipe_type ? (b.recipe_type === 'baby' ? 'baby' : 'adult') : null,
        category: b.category ?? null, cover_image: b.cover_image ?? null, servings: b.servings ?? null, duration: b.duration ?? null,
        difficulty: ['easy','normal','hard'].includes(b.difficulty) ? b.difficulty : null, suitable_age: b.suitable_age ?? null,
        notes: b.notes ?? null, id: r.recipe_id });
    if (b.ingredients) {
      db.prepare('DELETE FROM RecipeIngredient WHERE recipe_id=?').run(r.recipe_id);
      b.ingredients.filter((i) => i.name && i.name.trim()).forEach((i) => db.prepare(`INSERT INTO RecipeIngredient (recipe_id,name,name_en,quantity,unit,required,substitute) VALUES (?,?,?,?,?,?,?)`)
        .run(r.recipe_id, i.name.trim(), i.name_en || '', i.quantity || '', i.unit || '', i.required === false ? 0 : 1, i.substitute || ''));
    }
    if (b.steps) {
      db.prepare('DELETE FROM RecipeStep WHERE recipe_id=?').run(r.recipe_id);
      b.steps.filter((s) => (s.instruction || '').trim()).forEach((s, idx) => db.prepare(`INSERT INTO RecipeStep (recipe_id,step_number,instruction,instruction_en,duration) VALUES (?,?,?,?,?)`)
        .run(r.recipe_id, idx + 1, s.instruction.trim(), s.instruction_en || '', s.duration || 0));
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
  if (!r) return res.status(404).json({ error: 'not found' });
  const ings = db.prepare('SELECT * FROM RecipeIngredient WHERE recipe_id=?').all(r.recipe_id);
  const lid = db.prepare(`INSERT INTO ShoppingList (family_id,title,assignee_id,status,creator_id) VALUES (?,?,?, 'to_buy', 1)`)
    .run(family.family_id, (r.name.split(' ')[0] || r.name) + ' 采购', defaultHelperId(family.family_id)).lastInsertRowid;
  ings.forEach((ing) => db.prepare(`INSERT INTO ShoppingItem (shopping_list_id,name,name_en,category,primary_category,secondary_category,image_url,quantity,unit,estimated_price,allow_substitute,urgency,status,source_recipe_id)
    VALUES (?,?,?, '食材','食材',?, '🛒', ?, ?, 0, 1, 'normal', 'to_buy', ?)`)
    .run(lid, ing.name, ing.name_en || '', guessFoodSub(ing.name), parseFloat(ing.quantity) || 1, ing.unit || '份', r.recipe_id));
  notify(family.family_id, 'shopping', '新采购清单', '从菜谱「' + r.name + '」生成 ' + ings.length + ' 项食材', 'shopping', lid, 'maid');
  res.json(listWith(db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(lid)));
});
// 从菜谱一键安排到今日菜单
api.post('/recipes/:id/to-meal', (req, res) => {
  const family = curFamily(req);
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const mt = ['breakfast','lunch','dinner'].includes(b.meal_type) ? b.meal_type : 'lunch';
  const mid = db.prepare(`INSERT INTO MealOrder (family_id,recipe_id,meal_date,meal_type,servings,assignee_id,status,notes) VALUES (?,?,?,?,?,?, 'to_receive', ?)`)
    .run(family.family_id, r.recipe_id, todayYmd(), mt, b.servings || r.servings || 2, defaultHelperId(family.family_id), b.notes || '').lastInsertRowid;
  notify(family.family_id, 'meal', '新菜单安排', '「' + r.name + '」已安排到' + ({breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}[mt]), 'meal', mid, 'maid');
  res.json(db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(mid));
});

// ---- 菜谱订单 ----
function mealWith(m) {
  m.recipe = recipeWith(db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(m.recipe_id));
  return m;
}
api.get('/meals', (req, res) => res.json(db.prepare('SELECT * FROM MealOrder WHERE family_id=? ORDER BY start_time').all(famId(req)).map(mealWith)));
api.get('/meals/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error:'not found' });
  res.json(mealWith(m));
});
// 雇主删除今日菜单中的菜品
api.delete('/meals/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM MealOrder WHERE meal_order_id=?').run(m.meal_order_id);
  res.json({ ok: true });
});
api.post('/meals/:id/transition', (req, res) => {
  const m = db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(req.params.id);
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
    db.prepare("UPDATE Family SET family_name=?, updated_at=datetime('now') WHERE family_id=?").run(String(b.family_name).trim(), family.family_id);
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
      properties: { name: { type: 'string' }, quantity: { type: 'number' }, unit_price: { type: 'number' }, line_total: { type: 'number' } },
      required: ['name', 'quantity', 'unit_price', 'line_total'] } },
  },
  required: ['store_name', 'purchase_date', 'currency', 'subtotal', 'tax', 'total', 'items'],
};
// 调用 Claude 视觉识别小票（原始 HTTPS，避免额外依赖）；无 API Key 时返回 null 走兜底
async function claudeReceiptOCR(base64, mediaType) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const body = {
    model: 'claude-opus-4-8', max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA }, effort: 'low' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } },
      { type: 'text', text: '这是一张超市购物小票。请识别：商店名称、购买日期(YYYY-MM-DD)、货币、税前小计(subtotal)、消费税(tax，如 GST/VAT)、含税总金额(total)，以及每个商品的名称、数量、单价、小计。金额一律用数字，不带货币符号。日期无法识别则留空字符串。' },
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
  if (!l) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const base64 = (b.image_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) return res.status(400).json({ error: 'image_required' });
  const mediaType = b.media_type || 'image/jpeg';
  // 保存图片文件，静态可访问
  const ext = (mediaType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const fname = `receipt_${l.shopping_list_id}_${Date.now()}.${ext}`;
  try { fs.writeFileSync(join(uploadsDir, fname), Buffer.from(base64, 'base64')); } catch (e) { /* 忽略写盘失败 */ }
  const fileUrl = `/uploads/${fname}`;

  // 识别：优先 Claude，失败/无 Key 兜底（按当前录入的商品小计 + 9% GST 生成，便于演示）
  let ocr = null;
  try { ocr = await claudeReceiptOCR(base64, mediaType); } catch (e) { console.error('OCR error', e); }
  const view = listWith(l);
  if (!ocr) {
    const sub = view.subtotal || view.items.reduce((s, i) => s + (i.estimated_price || 0) * (i.quantity || 1), 0);
    const tax = +(sub * gstRate(famId(req))).toFixed(2);
    ocr = { source: 'mock', store_name: l.store_name || 'FairPrice', purchase_date: todayYmd(), currency: 'SGD',
      subtotal: +sub.toFixed(2), tax, total: +(sub + tax).toFixed(2), items: [] };
  }
  // 落库：小票图片 + 识别总额 + 商店/日期
  db.prepare(`UPDATE ShoppingList SET receipt_image=?, receipt_total=?, store_name=COALESCE(NULLIF(?,''),store_name), purchase_date=COALESCE(NULLIF(?,''),purchase_date), amount_match_status=? WHERE shopping_list_id=?`)
    .run(fileUrl, ocr.total, ocr.store_name || '', ocr.purchase_date || '', matchStatus(view.helper_total, ocr.total), l.shopping_list_id);
  res.json({ ...ocr, file_url: fileUrl, gst_rate: gstRate(famId(req)) });
});

// 允许误差（第 8.3 节，默认 ±0.05）
const AMOUNT_TOLERANCE = 0.05;
// 消费税（GST）：女佣录入的商品单价为税前价，汇总时额外加税与 receipt 税后总额核对
// 税率为家庭级可配置项（默认新加坡 9%）
const DEFAULT_GST_RATE = 0.09;
function gstRate(familyId) {
  const f = familyId ? db.prepare('SELECT gst_rate FROM Family WHERE family_id=?').get(familyId) : null;
  const r = f && f.gst_rate != null ? f.gst_rate : DEFAULT_GST_RATE;
  return (r >= 0 && r < 1) ? r : DEFAULT_GST_RATE;
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
  l.est_total = l.items.reduce((s,i)=> s + (i.estimated_price||0)*(i.quantity||1), 0);
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
api.get('/shopping', (req, res) => res.json(db.prepare('SELECT * FROM ShoppingList WHERE family_id=? ORDER BY shopping_list_id DESC').all(famId(req)).map(listWith)));
api.get('/shopping/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  if (!l) return res.status(404).json({ error:'not found' });
  res.json(listWith(l));
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
  if (!l) return res.status(404).json({ error: 'not found' });
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
  if (!l) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const pc = b.primary_category || '食材';
  const r = db.prepare(`INSERT INTO ShoppingItem
    (shopping_list_id,name,name_en,category,primary_category,secondary_category,image_url,quantity,unit,brand,specification,estimated_price,budget_limit,allow_substitute,urgency,notes,status)
    VALUES (@shopping_list_id,@name,@name_en,@category,@pc,@sc,@image_url,@quantity,@unit,@brand,@specification,@estimated_price,@budget_limit,@allow_substitute,@urgency,@notes,'to_buy')`)
    .run({ shopping_list_id: l.shopping_list_id, name: b.name || '', name_en: b.name_en || '', category: b.category || pc,
      pc, sc: pc === '食材' ? (b.secondary_category || '其他食材') : null,
      image_url: b.image_url || '🛒', quantity: b.quantity || 1, unit: b.unit || '件', brand: b.brand || '',
      specification: b.specification || '', estimated_price: b.estimated_price || 0, budget_limit: b.budget_limit || 0,
      allow_substitute: b.allow_substitute ? 1 : 0, urgency: b.urgency || 'normal', notes: b.notes || '' });
  res.json(db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(r.lastInsertRowid));
});
api.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM ShoppingItem WHERE shopping_item_id=?').run(req.params.id);
  res.json({ ok: true });
});
api.post('/shopping/:id/transition', (req, res) => {
  const l = db.prepare('SELECT * FROM ShoppingList WHERE shopping_list_id=?').get(req.params.id);
  const { to, employer_confirmed_total } = req.body;
  const now = new Date().toISOString();
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
      primary_category=@pc, secondary_category=@sc, name=COALESCE(@name,name) WHERE shopping_item_id=@id`)
    .run({ status:b.status??null, aq, ap, disc, total, pc, sc: pc==='食材' ? (sc||null) : null, name: b.name??null, id:it.shopping_item_id });
  res.json(db.prepare('SELECT * FROM ShoppingItem WHERE shopping_item_id=?').get(it.shopping_item_id));
});
api.post('/items/:id/substitute', (req, res) => {
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
  const all = db.prepare('SELECT * FROM ShoppingList WHERE family_id=?').all(famId(req));
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
  let sql='SELECT * FROM Notification', args=[];
  if (role) { sql+=' WHERE to_role=?'; args.push(role); }
  sql+=' ORDER BY notification_id DESC';
  res.json(db.prepare(sql).all(...args));
});
api.post('/notifications/:id/read', (req,res)=>{ db.prepare('UPDATE Notification SET is_read=1 WHERE notification_id=?').run(req.params.id); res.json({ok:true}); });

app.use('/api', api);

// ---- 小票图片静态访问 ----
app.use('/uploads', express.static(uploadsDir));

// ---- 静态前端 ----
const dist = join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')));
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🏠 HomeFlow 运行于 http://localhost:${PORT}`));
