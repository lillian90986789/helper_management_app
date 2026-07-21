import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// 统一时区为当地时区（默认新加坡）。必须在任何 Date / SQLite 本地时间取值之前设置。
// 生产环境同时由 Docker 的 TZ 环境变量设定（更权威）；此处兜底本地/未设 TZ 的情况。
process.env.TZ = process.env.TZ || 'Asia/Singapore';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 数据库文件存放在 data/ 目录，便于 NAS 上挂载为持久卷
const dataDir = process.env.DATA_DIR || join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, 'homeflow.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- 建表（对应 PRD 第 11 节数据模型） ----
db.exec(`
CREATE TABLE IF NOT EXISTS Family (
  family_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_name TEXT NOT NULL,
  country TEXT,
  timezone TEXT,
  address TEXT,
  default_language TEXT DEFAULT 'zh',
  invite_code TEXT,
  creator_user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS User (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  avatar TEXT,
  phone TEXT,
  email TEXT,
  role TEXT NOT NULL,                 -- employer | member | maid
  preferred_language TEXT DEFAULT 'zh',
  account_status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS FamilyMember (
  family_member_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  user_id INTEGER,
  role TEXT,
  permissions TEXT,
  join_date TEXT DEFAULT (datetime('now','localtime')),
  status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS Area (
  area_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  name TEXT,
  name_en TEXT,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS Task (
  task_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  title TEXT NOT NULL,
  title_en TEXT,
  description TEXT,
  task_type TEXT,                    -- daily | weekly | monthly | temp
  area_id INTEGER,
  assignee_id INTEGER,
  priority TEXT DEFAULT 'normal',    -- normal | important | urgent
  estimated_duration INTEGER,
  start_time TEXT,
  due_time TEXT,
  repeat_rule TEXT,
  require_photo INTEGER DEFAULT 0,
  min_photos INTEGER DEFAULT 0,
  require_note INTEGER DEFAULT 0,
  require_approval INTEGER DEFAULT 0,
  status TEXT DEFAULT 'todo',        -- draft|todo|received|in_progress|paused|pending_review|returned|done|overdue|skip_requested|skipped|canceled
  note TEXT,
  creator_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS TaskChecklist (
  checklist_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  title TEXT,
  title_en TEXT,
  description TEXT,
  required INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'todo'         -- todo | done
);

CREATE TABLE IF NOT EXISTS TaskAttachment (
  attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  uploader_id INTEGER,
  file_type TEXT,
  file_url TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS TaskLog (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  actor_id INTEGER,
  action TEXT,
  from_status TEXT,
  to_status TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- ===== 任务清单模块（修改版）：按星期重复 =====
-- 固定任务模板：定义"每周哪几天做"
CREATE TABLE IF NOT EXISTS TaskTemplate (
  task_template_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  task_name TEXT NOT NULL,
  task_name_en TEXT,
  description TEXT,
  area_id INTEGER,
  assignee_id INTEGER,
  priority TEXT DEFAULT 'normal',
  estimated_duration INTEGER,
  weekdays TEXT,                     -- JSON 多选星期，例如 [1,3,5]（1=周一 … 7=周日）
  require_photo INTEGER DEFAULT 0,
  minimum_photo_count INTEGER DEFAULT 1,
  require_note INTEGER DEFAULT 0,
  require_approval INTEGER DEFAULT 0,
  notify_employer INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',      -- active(启用) | paused(已暂停) | deleted(已删除)
  creator_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS TaskTemplateChecklist (
  checklist_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_template_id INTEGER,
  title TEXT,
  title_en TEXT,
  description TEXT,
  required INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);
-- 每日任务实例：记录"某一天是否完成"
CREATE TABLE IF NOT EXISTS DailyTask (
  daily_task_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_template_id INTEGER,
  family_id INTEGER,
  task_date TEXT,                    -- YYYY-MM-DD
  assignee_id INTEGER,
  task_name_snapshot TEXT,
  task_name_en_snapshot TEXT,
  description_snapshot TEXT,
  area_id INTEGER,
  priority TEXT,
  estimated_duration INTEGER,
  require_photo INTEGER DEFAULT 0,
  minimum_photo_count INTEGER DEFAULT 1,
  require_note INTEGER DEFAULT 0,
  require_approval INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  note TEXT,
  status TEXT DEFAULT 'today_todo',  -- today_todo|in_progress|pending_review|done|returned|incomplete|skipped|canceled
  started_at TEXT,
  submitted_at TEXT,
  confirmed_at TEXT,
  completed_at TEXT,
  reviewer_id INTEGER,
  reject_reason TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS DailyTaskChecklist (
  checklist_id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_task_id INTEGER,
  title TEXT,
  title_en TEXT,
  required INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'todo'
);
CREATE TABLE IF NOT EXISTS DailyTaskAttachment (
  attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_task_id INTEGER,
  uploader_id INTEGER,
  file_type TEXT,
  file_url TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS DailyTaskLog (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_task_id INTEGER,
  actor_id INTEGER,
  action TEXT,
  from_status TEXT,
  to_status TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS Recipe (
  recipe_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  name TEXT NOT NULL,
  name_en TEXT,
  recipe_type TEXT,                  -- adult | baby
  category TEXT,
  cover_image TEXT,
  servings INTEGER,
  duration INTEGER,
  difficulty TEXT,                   -- easy | normal | hard
  suitable_age TEXT,
  allergen_info TEXT,
  notes TEXT,
  favorite INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published',
  creator_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS RecipeIngredient (
  ingredient_id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER,
  name TEXT,
  name_en TEXT,
  quantity TEXT,
  unit TEXT,
  required INTEGER DEFAULT 1,
  substitute TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS RecipeStep (
  step_id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER,
  step_number INTEGER,
  instruction TEXT,
  instruction_en TEXT,
  image_url TEXT,
  video_url TEXT,
  duration INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS MealOrder (
  meal_order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  recipe_id INTEGER,
  meal_date TEXT,
  meal_type TEXT,                    -- breakfast | lunch | dinner
  servings INTEGER,
  start_time TEXT,
  due_time TEXT,
  assignee_id INTEGER,
  status TEXT DEFAULT 'to_receive',  -- draft|to_receive|received|checking|ingredients_ready|ingredients_short|to_start|preparing|cooking|pending_review|done|canceled|returned
  notes TEXT,
  result_image TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ShoppingList (
  shopping_list_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  title TEXT,
  assignee_id INTEGER,
  budget REAL,
  store_name TEXT,
  due_time TEXT,
  status TEXT DEFAULT 'to_buy',      -- draft|to_buy|buying|partial|sub_pending|to_settle|pending_confirm|confirmed|reimbursed|canceled
  receipt_image TEXT,
  payment_method TEXT,
  other_fee REAL DEFAULT 0,
  creator_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ShoppingItem (
  shopping_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  shopping_list_id INTEGER,
  name TEXT,
  name_en TEXT,
  category TEXT,
  image_url TEXT,
  quantity REAL,
  unit TEXT,
  brand TEXT,
  specification TEXT,
  estimated_price REAL,
  budget_limit REAL,
  allow_substitute INTEGER DEFAULT 1,
  urgency TEXT DEFAULT 'normal',
  notes TEXT,
  source_recipe_id INTEGER,
  actual_quantity REAL,
  actual_unit_price REAL,
  discount REAL DEFAULT 0,
  actual_total REAL,
  status TEXT DEFAULT 'to_buy',      -- to_buy|bought|out_of_stock|sub_requested|sub_approved|sub_rejected|canceled
  sub_name TEXT,
  sub_brand TEXT,
  sub_spec TEXT,
  sub_price REAL,
  sub_reason TEXT
);

CREATE TABLE IF NOT EXISTS Notification (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  type TEXT,
  title TEXT,
  content TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  to_role TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- ===== 雇主注册功能 =====
-- 验证码（手机号/邮箱）：对应注册流程 CODE_SENT / CONTACT_VERIFIED
CREATE TABLE IF NOT EXISTS VerificationCode (
  code_id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,                      -- phone | email
  contact TEXT,                      -- 完整手机号(含区号) 或 邮箱(小写)
  code TEXT,
  expires_at TEXT,
  verified INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
-- 注册草稿：支持"中断与恢复"（PRD 16），按 contact 保存每一步已完成数据
CREATE TABLE IF NOT EXISTS RegistrationDraft (
  draft_id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  contact TEXT UNIQUE,
  registration_status TEXT DEFAULT 'INIT',  -- INIT|CONTACT_SUBMITTED|CODE_SENT|CONTACT_VERIFIED|PASSWORD_CREATED|PROFILE_COMPLETED|FAMILY_CREATED|HELPER_INVITED|COMPLETED
  data TEXT,                          -- JSON：累积的注册数据
  user_id INTEGER,                    -- 提交后落库的雇主账号
  family_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
-- 女佣休息日（任务清单模块：日历查看 + 休息日设置，第 9.3 节 HelperRestDay）
CREATE TABLE IF NOT EXISTS HelperRestDay (
  rest_day_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  helper_user_id INTEGER,
  rest_date TEXT,                    -- YYYY-MM-DD
  weekday INTEGER,                   -- 1=周一 … 7=周日
  month INTEGER,
  year INTEGER,
  note TEXT,
  status TEXT DEFAULT 'ACTIVE',      -- ACTIVE(已设置) | CANCELED(已取消)
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  notified_at TEXT
);
-- 女佣邀请（PRD 20 FamilyInvitation）
CREATE TABLE IF NOT EXISTS FamilyInvitation (
  invitation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  inviter_user_id INTEGER,
  invitee_name TEXT,
  invitee_phone TEXT,
  invitee_email TEXT,
  invitee_role TEXT DEFAULT 'maid',
  invite_code TEXT,
  invite_link TEXT,
  preferred_language TEXT DEFAULT 'en',
  status TEXT DEFAULT 'pending',     -- pending(待接受)|viewed|accepted|expired|revoked|failed
  expires_at TEXT,
  accepted_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// ---- 增量迁移：为已存在的库补充雇主注册相关字段（幂等） ----
const addCol = (table, col, def) => {
  try { db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run(); } catch { /* 已存在 */ }
};
// User → 对应 PRD EmployerUser
addCol('User', 'username', 'TEXT');                        // 雇主用户名登录（唯一）
addCol('User', 'phone_country_code', 'TEXT');
addCol('User', 'password_hash', 'TEXT');
addCol('User', 'login_method', "TEXT DEFAULT 'phone'");   // phone|email|apple|google
addCol('User', 'display_name', 'TEXT');                    // 对女佣显示的称呼
addCol('User', 'gender', 'TEXT');
addCol('User', 'birth_date', 'TEXT');                      // 出生年月日 YYYY-MM-DD（用于自动显示年龄）
addCol('User', 'notification_language', 'TEXT');
addCol('User', 'country', 'TEXT');
addCol('User', 'timezone', 'TEXT');
addCol('User', 'default_currency', 'TEXT');
addCol('User', 'registration_status', "TEXT DEFAULT 'COMPLETED'");
addCol('User', 'updated_at', 'TEXT');
addCol('User', 'last_login_at', 'TEXT');
// Notification → 可定向到具体用户（如休息日只通知对应女佣）；为空表示按 to_role 群发
addCol('Notification', 'to_user_id', 'INTEGER');
// Family → 采购模块：可配置消费税率 GST（第 8.3 节风格，家庭级设置）
addCol('Family', 'gst_rate', 'REAL DEFAULT 0');   // 消费税默认 0%（雇主可在「我的」页调整）
// Family → 对应 PRD Family
addCol('Family', 'owner_user_id', 'INTEGER');
addCol('Family', 'family_avatar_url', 'TEXT');
addCol('Family', 'city', 'TEXT');
addCol('Family', 'helper_language', "TEXT DEFAULT 'en'");
addCol('Family', 'default_currency', "TEXT DEFAULT 'SGD'");
addCol('Family', 'week_start_day', "TEXT DEFAULT 'mon'");  // mon|sun
addCol('Family', 'updated_at', 'TEXT');
// Area → 对应 PRD FamilyArea
addCol('Area', 'sort_order', 'INTEGER DEFAULT 0');
addCol('Area', 'status', "TEXT DEFAULT 'active'");
// Recipe → 菜谱整体可选挂一个视频教程链接（YouTube 或其他视频站点，不做格式校验）
addCol('Recipe', 'video_url', 'TEXT');
// DailyTask → 任务清单模块（日历 + 休息日）第 9.2 节新增字段
addCol('DailyTask', 'weekday', 'INTEGER');               // 1=周一 … 7=周日，便于日历快速展示
addCol('DailyTask', 'is_rest_day_task', 'INTEGER DEFAULT 0'); // 是否为休息日特别任务
// ShoppingItem → 采购模块：两级分类（第 3 节）
addCol('ShoppingItem', 'primary_category', "TEXT DEFAULT '其他'");   // 一级分类
addCol('ShoppingItem', 'secondary_category', 'TEXT');                // 二级分类（食材必填）
// ShoppingList → 采购模块：Receipt 金额核对（第 8 节）+ 报销（第 18 节）
addCol('ShoppingList', 'purchase_date', 'TEXT');                     // 采购日期（YYYY-MM-DD）
addCol('ShoppingList', 'receipt_total', 'REAL');                     // Receipt 识别/手填总金额
addCol('ShoppingList', 'receipt_items', 'TEXT');                     // Receipt 逐项识别明细 JSON（含与清单的匹配结果）
addCol('ShoppingList', 'deleted_at', 'TEXT');                        // 软删除时间（回收站，30 天后彻底清除）
addCol('ShoppingList', 'helper_entered_total', 'REAL');             // 女佣录入总金额
addCol('ShoppingList', 'employer_confirmed_total', 'REAL');          // 雇主确认金额
addCol('ShoppingList', 'amount_match_status', 'TEXT');               // matched|mismatch|unrecognized|manual
addCol('ShoppingList', 'difference_reason', 'TEXT');                 // 差异原因
addCol('ShoppingList', 'reimbursement_status', "TEXT DEFAULT 'none'"); // none|to_reimburse|reimbursed|partial|disputed
addCol('ShoppingList', 'confirmed_at', 'TEXT');
addCol('ShoppingList', 'submitted_at', 'TEXT');

// ---- 用户订阅与收费模块 ----
db.exec(`
CREATE TABLE IF NOT EXISTS FamilySubscription (
  subscription_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER UNIQUE,
  plan_id TEXT DEFAULT 'trial',              -- trial|monthly|yearly（当前/最近套餐）
  status TEXT DEFAULT 'TRIAL_ACTIVE',        -- TRIAL_ACTIVE|ACTIVE|EXPIRING_SOON|EXPIRED|LOCKED
  trial_start_at TEXT,
  trial_end_at TEXT,
  current_period_start_at TEXT,
  current_period_end_at TEXT,
  access_status TEXT DEFAULT 'ACTIVE',        -- ACTIVE|LOCKED
  last_payment_order_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS PaymentOrder (
  payment_order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE,
  family_id INTEGER,
  payer_user_id INTEGER,
  plan_id TEXT,
  amount REAL,
  currency TEXT DEFAULT 'SGD',
  payment_provider TEXT DEFAULT 'PAYNOW_MANUAL',
  payment_method TEXT DEFAULT 'PAYNOW',
  status TEXT DEFAULT 'PENDING',              -- PENDING|SUBMITTED|PAID|EXPIRED|CANCELLED|REJECTED
  claimed_at TEXT,                            -- 用户点“我已付款”
  paid_at TEXT,
  confirmed_by TEXT,                          -- 管理员确认人
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS SubscriptionHistory (
  history_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  old_status TEXT,
  new_status TEXT,
  old_expire_at TEXT,
  new_expire_at TEXT,
  plan_id TEXT,
  reason TEXT,
  payment_order_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS AppConfig (
  config_key TEXT PRIMARY KEY,
  config_value TEXT,
  updated_at TEXT
);
-- 机器翻译缓存：同一句话+目标语言只翻一次
CREATE TABLE IF NOT EXISTS Translation (
  target_lang TEXT,
  source_text TEXT,
  translated_text TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (target_lang, source_text)
);
CREATE TABLE IF NOT EXISTS AdminAuditLog (
  audit_log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT,                              -- MVP：单超级管理员，记 'super'
  action_type TEXT,                           -- SUBSCRIPTION_EXTENDED / PAYMENT_MANUALLY_CONFIRMED / ...
  target_user_id INTEGER,
  target_family_id INTEGER,
  target_payment_order_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS AdminNote (
  note_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  family_id INTEGER,
  admin_id TEXT,
  note_content TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// MOM 重要事项（雇主为女佣创建：体检/WP/护照/保险/Levy/住址/预约/其他）。女佣只能查看/确认/提交完成。
db.exec(`
CREATE TABLE IF NOT EXISTS MomEvent (
  mom_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  helper_user_id INTEGER,            -- 为哪位女佣
  title TEXT NOT NULL,               -- 事项名称
  category TEXT,                     -- 分类（可空）
  event_date TEXT,                   -- YYYY-MM-DD
  remind_offset INTEGER DEFAULT 0,   -- 提前天数：0/1/3/7
  notify_helper INTEGER DEFAULT 1,
  note TEXT,
  repeat_rule TEXT DEFAULT 'none',   -- none|monthly|yearly
  status TEXT DEFAULT 'pending',     -- pending(待完成)|helper_done(女佣已标记待确认)|done(雇主确认完成)
  helper_ack INTEGER DEFAULT 0,      -- 女佣"我知道了"
  helper_done_at TEXT,
  completed_at TEXT,                 -- 雇主确认完成时间
  last_reminded_date TEXT,           -- 上次生成提醒的日期（去重每日提醒）
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

// 一次性：把此前加列时系统回填的 9% GST 重置为 0%（消费税默认 0%）。用 AppConfig 标记只跑一次，
// 之后雇主主动设成 9% 也不会被再次清零。
try {
  const done = db.prepare("SELECT 1 FROM AppConfig WHERE config_key='gst_default_zero_v1'").get();
  if (!done) {
    db.prepare('UPDATE Family SET gst_rate=0 WHERE gst_rate=0.09').run();
    db.prepare("INSERT OR REPLACE INTO AppConfig (config_key, config_value) VALUES ('gst_default_zero_v1','1')").run();
  }
} catch (e) { /* noop */ }

// 一个 Gmail 只能对应一个账号（空邮箱不限，女佣可无邮箱）。已有重复时忽略建索引，应用层仍会查重。
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON User(email) WHERE email IS NOT NULL AND email<>''"); } catch (e) { /* noop */ }

export default db;
