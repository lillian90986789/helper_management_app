# HomeFlow 开发进展（供新 session 读取上下文）

> 最后更新：2026-07-10。新开 session 时先读本文件了解当前状态，再动手。
> 用户偏好：**用中文回复**。

## 项目概况
- 家务管家 PWA：雇主（employer）+ 女佣（maid/helper）。
- 目录 `/Users/bytedance/Downloads/Claude/女佣app/homeflow/`，远端 `git@github.com:GaoQinghong/helper_management_app.git`（分支 main）。
- 技术栈：Node22 + Express + better-sqlite3（单文件 `data/homeflow.db`，WAL）；React18 + Vite + HashRouter；Docker/compose 部署（app + Caddy 自动 HTTPS）。
- 认证：HMAC 签名令牌 `signToken/verifyToken`（密钥 `AUTH_SECRET`）。客户端发 `X-Auth-Token` 头，中间件（server/index.js:23）校验。已废弃不安全的明文 `X-User-Id`。
- 后台：`/#/admin`，`ADMIN_KEY` 环境变量门控，`X-Admin-Key` 头。
- 当前真实 HEAD：`bdafd1a`（本地==远端，已核对）。

## ⚠️ 环境注意事项（很重要，避免踩坑）
- **Bash 工具有时会返回伪造/乱码输出**（假的 commit hash、假的"测试通过"、假的 grep 结果）。
  - 教训：曾出现假的 `3d5e8b1 push 成功`，实际 HEAD 还是 ffd3823，三处编辑根本没落盘。
  - 对策：改动后务必用 `grep` 核对文件真的有那段代码；提交后用 `git rev-parse HEAD` 对比 `origin/main`；测试断言直接查 sqlite 库，别只信 curl+python 的 stdout。
- **禁止推送机密**：`.env`、DB、`GOOGLE_CLIENT_ID`（xxx.apps.googleusercontent.com）、各类 KEY、用户名密码。
  提交前跑：`git status --porcelain | grep -iE "\.db$|/data/|\.env$|_KEY=[A-Za-z0-9]{10}|apps\.googleusercontent"`。
- `web/dist` 被 .gitignore 忽略，不提交；部署时构建。

## 五项需求进展
1. **一个 Gmail 只能注册一个账号** — ✅ 完成。`server/db.js` 建 `idx_user_email` 唯一索引（email 非空时唯一）+ 应用层查重。
2. **账号绑定 Google、Gmail 作主 key** — ✅ 雇主 + 女佣均完成。
   - 雇主登录页 `web/src/pages/EmployerAuth.jsx` 改为**以「用 Gmail 登录/注册」为主**；账号密码收进「旧账号（legacy）」折叠入口；Google 未配置（/config 无 client_id）时自动回退显示账号密码，避免锁死。
   - **女佣也改为以 Gmail 唯一标识**（用户 2026-07-11 明确要求，推翻 7-10 的"女佣不改"）。见下「2026-07-11 女佣 Google 绑定」。
   - 雇主 Gmail 登录走 `/auth/google`（tokeninfo 校验 → 按 email 匹配/新建家庭）。老用户可在「我的」页 `/auth/google/bind` 绑 Gmail。

### 2026-07-11 女佣 Google 绑定（修复：女佣看不到任务/休息日 + 每次加入都新建账号）
- **根因**：`/join` 每次无条件新建 maid 账号 → 一个家庭堆多个女佣号；而 `/dashboard/maid`、`/month`、`/rest-days` 都按 `helper_id`(=女佣自己 id) 过滤 `assignee_id`/`helper_user_id`，雇主设任务/休息日时锁定的是 `defaultHelperId`(家庭最小 id 的女佣)，与新登录女佣 id 对不上 → 任务、休息日全看不到。
- **修复**：新端点 `POST /api/auth/google/join`（server/index.js，`/auth/google/bind` 之后）：Google 校验 → 按 email 找女佣：① 已存在→复用(跨设备/重进同一人，去重)；② 否则认领本家庭「无邮箱的默认女佣旧号」并写入 email（让雇主已设的任务/休息日立刻对得上）；③ 都没有才新建。家庭成员记录 upsert(复活/去重)。拒绝已是雇主的 Gmail(409 email_is_employer)。
- 前端 `web/src/pages/JoinPage.jsx` 改为 **Google 优先**：填邀请码→用 Google 加入（`api.googleJoin`）；Google 未配置时回退「邀请码+姓名」旧流程(`/join`)避免锁死。
- **前提**：服务器必须配 `GOOGLE_CLIENT_ID`（且 OAuth 授权来源含线上域名），否则女佣端回退旧流程、问题依旧。
- 已用真实端点 + sqlite 断言测试(14/14)：认领旧号不新建/重进去重/任务可见/休息日可见/第二个 Gmail 新建/雇主 Gmail 被拒/无效码 404。测试脚本在 scratchpad `test_google_join.mjs`（mock `globalThis.fetch` 的 tokeninfo）。`server/index.js` 末尾加了 `export { app }` 供测试 import。
3. **雇主能看女佣采购的 receipt 图片** — ✅ 完成（提交 a9f1c2e，`ShoppingPage.jsx` 用 `isImgAvatar` 判断，URL 渲染成可点击放大的 img）。
4. **雇主删成员 → 后台同步删除** — ✅ 完成。`/members/:id/remove`（server/index.js:425）事务内标记 `FamilyMember.status='removed'` + `User.account_status='removed', email=NULL`（释放 Gmail 可重注册）；禁止删自己（400 cannot_remove_self）。
5. **记录女佣登录时间 + 3 个月不活跃自动清空** — ✅ 完成。
   - 认证中间件（server/index.js:27 附近）按 **1 小时节流** 记录 `last_login_at`（雇主+女佣通用）。
   - `cleanupInactiveAccounts()`（app.listen 前）：超 3 个月未活跃 → `account_status='removed'` + `email=NULL` + 移出家庭；**业务数据保留**；启动跑一次 + 每 24h 跑一次。清空后该 Gmail 可重新注册。
   - 已用真实 sqlite 断言测试：删成员/禁删自己/last_login 记录/3月清理/活跃账号不受影响，全部通过。

### 2026-07-11 后台删用户同步 + 女佣加入按钮修复
- **雇主删女佣后后台仍显示**：`/admin/users` 从 User 表 LEFT JOIN，removed 的行还在，且前端没展示 account_status → 看起来没删。改：`/admin/users` **默认排除 `account_status='removed'`**（带 `include_removed=1` 才列出）；AdminConsole 加「状态」列(正常/已注销 badge) + 「显示已注销」开关。
- **管理员删除用户**：新增 `POST /api/admin/users/:id/delete`（软删除：removed + 释放邮箱 + 移出家庭 + 写审计 USER_DELETED），`adminApi.deleteUser` 已加。**注意：AdminConsole 里还没放删除按钮**（用户中途喊停），需要时再接 UI。
- **女佣加入页没有登录按钮**（回归）：之前「加入」按钮只在 `!googleReady` 时渲染，配了 client_id 但 GSI 没画出按钮时就没有可点入口。改：**任何情况下 actionbar 都渲染「加入家庭」按钮**（Google 未配→primary；已配→outline，Google 按钮作推荐入口并存），姓名字段常显，永不锁死。
- 测试：`test_admin_delete_sync.mjs`（端到端 12/12）雇主删女佣→后台默认隐藏/include_removed 显示/管理员删除+审计。

### 2026-07-11 女佣「加入后必须绑定 Google」门禁 + 后台删除按钮
- **需求（用户 2026-07-11 定稿）**：女佣凭邀请码加入家庭，**加入后必须绑定 Google 账号才能使用**。
- **实现（前端为主，复用已测的后端端点）**：
  - `JoinPage`：姓名加入成功后，若服务器启用了 Google（`/config` 有 client_id）→ 直接 `nav('/m/bind')` 强制绑定；未启用则照常进入（防锁死）。加入时把邀请码/邮箱存进 `hf_maid`。
  - 新页 `web/src/pages/MaidBind.jsx`（路由 `/m/bind`，无底部 Tab、无跳过）：Google 按钮回调复用 `POST /auth/google/join`（带保存的邀请码）→ 自动去重/认领旧号、写邮箱、换回该账号 token → 进 `/m/today`。
  - `App.jsx` 门禁：`googleOn`（拉 `/config` 判断）+ `maidUnbound()`（`hf_maid` 有 user_id 但无 email）→ 女佣未绑定就拦到 `/m/bind`；`googleOn` 为假时不拦（本地/未配 Google 不锁死）。
  - **判定"已绑定"= `hf_maid.email` 有值**（Google 加入/绑定后才有）。
- **后台删除按钮**：`AdminConsole` 用户表加「操作」列 → 正常账号显示红色「删除」按钮（`window.confirm`+原因 prompt → `adminApi.deleteUser`），已注销显示「已注销」。
- 测试：`test_join_then_bind.mjs`（11/11）姓名加入→google/join 绑定→认领同一账号/写邮箱/无重复号/重进不变。`test_admin_delete_sync.mjs`（12/12，含管理员删除+审计）。
- **注意**：整套强制绑定只在服务器配了 `GOOGLE_CLIENT_ID` 时才启用；线上务必配好（含 OAuth 授权来源域名），否则女佣端只走姓名加入、不强制。

### 2026-07-11 女佣端任务/菜单改为家庭级可见
- **需求**：同一家庭里**任何女佣（含新加入的）都要能看到雇主设置的任务、今日菜单、采购单**。
- **根因**：`/dashboard/maid`（MaidToday 首页）的任务/菜单、`/month`（MaidCalendar 日历）的每日任务数原本按 `assignee_id=helperId` 过滤，新女佣 id 与被指派对象不同 → 看不到。（采购单本就是家庭级，一直可见。）
- **改法**：这三处去掉 `assignee_id` 过滤，改为家庭级（`family_id`）。休息日仍按女佣个人（`isRestDay` 不变）。server/index.js:~1111/1114/875。
- 测试 `test_maid_family_visible.mjs`（7/7）：女佣B（≠被指派的A）能看到任务/菜单/日历任务数/采购单。回归 google_join 14/14、join_then_bind 11/11。

### 2026-07-11 女佣「今日采购」隐藏已完成采购单
- **需求**：已完成的采购清单不在任何女佣的「今日采购」显示。
- **改法**：`/dashboard/maid` 的 shopping 卡片查询加 `status NOT IN ('confirmed','canceled')`（confirmed=雇主已确认账目=已完成；canceled=已取消），只取最新的进行中单；无进行中单则卡片为空。采购管理页 `/shopping` 仍列出全部（含历史），不受影响。雇主 dashboard 未改（需求仅针对女佣）。
- 测试 `test_today_shopping_hide_done.mjs`（5/5）：进行中显示、confirmed/canceled 不显示、回退到更早的进行中单、无进行中则为空。

### 2026-07-11 女佣「直接用 Google 登录」入口
- **需求**：登录/注册页在「我是女佣，用邀请码加入」上方，加同样式按钮「女佣已加入大家庭，直接用 Google 登录」。
- **实现**：
  - 后端 `POST /auth/google/maid-login`：校验 Google → 按 email 找 `role='maid'` 且未注销的账号 → 返回 token+家庭；找不到 404 `maid_not_found`（提示先用邀请码加入），无家庭 404 `maid_not_in_family`。
  - 前端新页 `MaidLogin.jsx`（路由 `/m/login`，已加入 App.jsx 公共页白名单，未登录可访问）：GSI 按钮 → `api.maidGoogleLogin` → 存 hf_maid → `/m/today`。
  - `EmployerAuth.jsx`(/login) 与 `Register.jsx`(/register) 的女佣邀请码按钮上方各加一个 outline 按钮 → `nav('/m/login')`。
  - 说明：同页 GSI 只能一个 initialize 回调，故女佣登录单独放一页，而非在登录页再挂一个 Google 按钮。
- 测试 `test_maid_google_login.mjs`（8/8）：加入后直接登录同账号、陌生/雇主 Gmail 404、已注销 404。

### 2026-07-11 休息日「选择女佣」+ 定向通知
- **需求**：雇主设休息日页可选择为哪位女佣设置；设置后只有对应女佣收到通知。
- **实现**：
  - `Notification` 加 `to_user_id`（db.js addCol）；`notify(...,toRole,toUserId=null)` 支持定向；`/notifications` 拉取加 `(to_user_id IS NULL OR to_user_id=?)`（req.userId）——定向通知只目标用户可见，群发（为空）按角色全体可见。
  - 休息日设置/取消的通知带上 `helperId`/`r.helper_user_id` → 只有对应女佣收到。
  - 前端 `RestDaySettings.jsx`：加载家庭内所有女佣，家庭有多名女佣时显示「为哪位女佣设置」chips 选择器；切换后按该女佣加载其休息日（`api.month(y,m,helper.user_id)`）；保存已带 `helper_id`（原本就有）。
- 测试 `test_restday_notify_target.mjs`（7/7）：为A设休息日→A收到、B收不到、通知 to_user_id=A；群发两人都收到。回归 14/14、7/7、8/8。

### 2026-07-11 菜谱图片统一裁剪（竖图冲出方框修复）
- **现象**：女佣首页「今日做饭」和菜谱列表里，竖图（如排骨汤）冲出缩略图方框。
- **根因**：`.thumb` 用 `display:grid; place-items:center` 且无 `overflow:hidden`，竖图 `height:100%` 在 grid auto 行里解析失败→回退成原始高度撑破容器。
- **改法**：`styles.css` 的 `.thumb` 改为 `display:flex; align-items/justify center; overflow:hidden`（`.thumb.lg` 继承）→ `height:100%` 正确解析成固定高度，`object-fit:cover` 真正裁成统一方形。
- 顺带修 `MealOrder.jsx` 两处直接把 `cover_image` 当文本渲染（上传图会显示成 URL 文字）→ 改用 `CoverThumb`。

### 2026-07-11 小票雇主可见 + 休息日选择器常显
- **小票 bug**：雇主查看采购单时小票显示成一串字符——`ShoppingPage.jsx` 小票区把 `receipt_image`(URL) 当文本塞进 `.thumb lg`。改为 `isImgAvatar` 判断→渲染成 `<img>`（完整显示、maxHeight 340、点击 window.open 看大图）；非图片才回退文本。（女佣端 ShoppingSettle 本就用 isImg 正确渲染。）
- **休息日选择器**：原「≥2 名女佣才显示」→ 只有一名时看不到、不知如何选。改为始终显示「为哪位女佣设置休息日」卡片（0 名提示先邀请，多名给使用说明）。

### 2026-07-11 今日菜单只显示当天
- **需求**：今日菜单只展示 `meal_date=今天` 的，不显示昨天/往日的。
- **改法**：`/dashboard/maid`、`/dashboard/employer` 的 meals 查询和 `/meals` 都加 `AND meal_date=today`。（meal_date 在所有 MealOrder INSERT 处都已赋值，过滤安全。）
- 测试 `test_today_menu_only.mjs`（5/5）：今天的显示、昨天的不显示、做饭页仅 1 条。

### 2026-07-11 雇主删除女佣加二次确认
- **需求**：雇主删女佣的 ✕ 按钮点了立即删除，易误操作，需二次确认。
- **改法**：`Members.jsx` 的 ✕ 改为打开底部确认弹层（显示成员名 + 后果说明「移出家庭/释放 Gmail/不可撤销」），点「确认删除」才真正调 `removeMember`；取消或点遮罩关闭。删除中禁用按钮防重复。

### 2026-07-11 MOM 重要事项模块（新功能）
- **需求**：雇主为女佣创建 MOM 相关事项（体检/WP/护照/保险到期、缴Levy、住址、MOM预约、自定义），女佣今日首页展示+确认，雇主最终确认；含提醒。
- **数据**：新表 `MomEvent`（helper_user_id/title/category/event_date/remind_offset(0/1/3/7)/notify_helper/note/repeat_rule(none/monthly/yearly)/status(pending/helper_done/done)/helper_ack/completed_at/last_reminded_date）。
- **后端**（server/index.js MOM 段）：`GET /mom-events`（雇主全家庭/女佣自己）、`/mom-events/today`（今日展示规则）、`POST/PATCH/DELETE`（仅雇主）、`/:id/ack`（女佣我知道了）、`/:id/helper-done`（女佣标记完成→通知雇主）、`/:id/confirm`（雇主确认→done，重复则生成下一次，通知女佣）。展示状态由日期算：overdue/due_today/upcoming(提醒窗内)/done(完成当天显示、次日移除)。`/dashboard/maid` 返回 `mom`。每日提醒 `momDailyReminders()`（启动+每6h，提醒日/当天给女佣+雇主发定向通知，按 last_reminded_date 去重）。
- **前端**：雇主页 `MomEvents.jsx`（路由 `/mom-events`，女佣管理页入口「🇸🇬 MOM 重要事项」）——选女佣+列表+增删改+标记/确认完成+删除确认；女佣 `MaidToday` 顶部 MOM 模块（我知道了/已完成，提交后待雇主确认）。
- **权限**：创建/编辑/删除/确认仅雇主；女佣只能 ack/helper-done 自己的。
- 测试 `test_mom_events.mjs`（18/18）：创建/展示规则/权限/ack/helper-done/confirm/通知/重复生成全覆盖。回归 7/7、7/7、5/5、14/14。

### 2026-07-11 统一当地时区（新加坡）
- **问题**：线上 Docker 默认 UTC，导致「今日」判断、时间戳/日志都比新加坡时间差 8 小时。
- **改法（统一存"当地墙钟时间"+进程 TZ=SGT，自洽）**：
  - `TZ=Asia/Singapore`：`server/db.js` 顶部 `process.env.TZ ||= 'Asia/Singapore'`（在任何 Date/SQLite 之前）+ `server/index.js` 兜底；`Dockerfile` 装 `tzdata` + `ENV TZ`；两个 compose 加 `TZ=Asia/Singapore`。→ 修好所有 `new Date()` 的 todayYmd/ymd/「今日」逻辑。
  - SQLite `datetime('now')` 全局改 `datetime('now','localtime')`（db.js+index.js，66 处），created_at/updated_at/last_login/审计/任务日志/通知等时间戳存 SGT；两侧比较仍一致（throttle/cleanup 也都是 localtime）。
  - JS 加 `localStamp()`（`toLocaleString('sv-SE')` → `YYYY-MM-DD HH:MM:SS` SGT），任务/采购/休息日 3 处 `const now` 改用它。
  - 订阅/验证码/邀请的 `toISOString()` **保留 UTC**：它们是 JS 里按 `.getTime()` 绝对时刻比较，进程 TZ=SGT 后依然正确（`subView` 验证过）。
- **注意**：本次之前已入库的行是 UTC，显示会偏 8h；新数据起正确。前端无改动（浏览器本地 tz + 直接 slice 已存的 SGT 值）。
- 测试 `test_timezone.mjs`（8/8：TZ/格式/SGT 小时/JS 与 SQL 一致/订阅比较正常）；全量回归 9 套全绿。

## 待办 / 待确认
- **需求2 彻底程度**：目前雇主登录页保留"旧账号 用户名密码"作为过渡 + fallback（Google 未配时）。用户说过"全部基于邮箱"——是否要**彻底移除**用户名密码入口？倾向保留 fallback 以免锁死，等用户确认。
- **线上部署**：需在服务器 `.env` 配 `GOOGLE_CLIENT_ID`（+ Google Cloud OAuth 授权来源加 https://helpermanagement.xyz），否则登录页只显示账号密码。部署后 `docker compose -f docker-compose.prod.yml up -d --build --force-recreate`。验证：`curl https://helpermanagement.xyz/api/config` 看 google_client_id。（注意 prod 用 expose 非 ports，curl localhost:8080 为空是正常的。）
- **需求4 admin UI**：后端已置 `account_status='removed'`，admin 用户列表是否正确展示 removed 状态，待验证（`web/src/pages/*Admin*` / `/admin/users`）。
- **机器翻译**：女佣端按需把雇主中文翻成女佣语言（Google Translate v2 + `Translation` 缓存表 + Key 门控），代码已完成（提交 ffd3823）。但用户提供的 key `AIza...ZG24EM` **无效**（API key not valid），且用户"没有设置翻译的 key"，当前**回退显示原文**。等有效 `GOOGLE_TRANSLATE_API_KEY`（在服务器 .env 配，勿进 git）。
- i18n：4 语言 zh/en/id/my（中/英/印尼/缅甸）。`web/src/i18n.jsx`，`pick(lang,zh,en)`，非中文回退英文。

## 常用命令
- 本地起服务：`cd homeflow && npm start`（默认 8080；带后台需 `env ADMIN_KEY=xxx npm start`）。
- 前端构建：`cd homeflow/web && npm run build`。
- 提交前安全检查见上「环境注意事项」。
