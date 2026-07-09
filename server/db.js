import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

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
  created_at TEXT DEFAULT (datetime('now')),
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
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS FamilyMember (
  family_member_id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER,
  user_id INTEGER,
  role TEXT,
  permissions TEXT,
  join_date TEXT DEFAULT (datetime('now')),
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
  created_at TEXT DEFAULT (datetime('now')),
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
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS TaskLog (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  actor_id INTEGER,
  action TEXT,
  from_status TEXT,
  to_status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS DailyTaskLog (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_task_id INTEGER,
  actor_id INTEGER,
  action TEXT,
  from_status TEXT,
  to_status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
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
  created_at TEXT DEFAULT (datetime('now'))
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
// Family → 采购模块：可配置消费税率 GST（第 8.3 节风格，家庭级设置）
addCol('Family', 'gst_rate', 'REAL DEFAULT 0.09');
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
// DailyTask → 任务清单模块（日历 + 休息日）第 9.2 节新增字段
addCol('DailyTask', 'weekday', 'INTEGER');               // 1=周一 … 7=周日，便于日历快速展示
addCol('DailyTask', 'is_rest_day_task', 'INTEGER DEFAULT 0'); // 是否为休息日特别任务
// ShoppingItem → 采购模块：两级分类（第 3 节）
addCol('ShoppingItem', 'primary_category', "TEXT DEFAULT '其他'");   // 一级分类
addCol('ShoppingItem', 'secondary_category', 'TEXT');                // 二级分类（食材必填）
// ShoppingList → 采购模块：Receipt 金额核对（第 8 节）+ 报销（第 18 节）
addCol('ShoppingList', 'purchase_date', 'TEXT');                     // 采购日期（YYYY-MM-DD）
addCol('ShoppingList', 'receipt_total', 'REAL');                     // Receipt 识别/手填总金额
addCol('ShoppingList', 'helper_entered_total', 'REAL');             // 女佣录入总金额
addCol('ShoppingList', 'employer_confirmed_total', 'REAL');          // 雇主确认金额
addCol('ShoppingList', 'amount_match_status', 'TEXT');               // matched|mismatch|unrecognized|manual
addCol('ShoppingList', 'difference_reason', 'TEXT');                 // 差异原因
addCol('ShoppingList', 'reimbursement_status', "TEXT DEFAULT 'none'"); // none|to_reimburse|reimbursed|partial|disputed
addCol('ShoppingList', 'confirmed_at', 'TEXT');
addCol('ShoppingList', 'submitted_at', 'TEXT');

export default db;
