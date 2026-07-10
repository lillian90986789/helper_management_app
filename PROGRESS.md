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
2. **账号绑定 Google、Gmail 作主 key** — ✅ 雇主部分完成。
   - 雇主登录页 `web/src/pages/EmployerAuth.jsx` 改为**以「用 Gmail 登录/注册」为主**；账号密码收进「旧账号（legacy）」折叠入口；Google 未配置（/config 无 client_id）时自动回退显示账号密码，避免锁死。
   - **女佣仍走邀请码登录，不改**（用户 2026-07-10 明确确认：只有雇主基于邮箱）。
   - 雇主 Gmail 登录走 `/auth/google`（tokeninfo 校验 → 按 email 匹配/新建家庭）。老用户可在「我的」页 `/auth/google/bind` 绑 Gmail。
3. **雇主能看女佣采购的 receipt 图片** — ✅ 完成（提交 a9f1c2e，`ShoppingPage.jsx` 用 `isImgAvatar` 判断，URL 渲染成可点击放大的 img）。
4. **雇主删成员 → 后台同步删除** — ✅ 完成。`/members/:id/remove`（server/index.js:425）事务内标记 `FamilyMember.status='removed'` + `User.account_status='removed', email=NULL`（释放 Gmail 可重注册）；禁止删自己（400 cannot_remove_self）。
5. **记录女佣登录时间 + 3 个月不活跃自动清空** — ✅ 完成。
   - 认证中间件（server/index.js:27 附近）按 **1 小时节流** 记录 `last_login_at`（雇主+女佣通用）。
   - `cleanupInactiveAccounts()`（app.listen 前）：超 3 个月未活跃 → `account_status='removed'` + `email=NULL` + 移出家庭；**业务数据保留**；启动跑一次 + 每 24h 跑一次。清空后该 Gmail 可重新注册。
   - 已用真实 sqlite 断言测试：删成员/禁删自己/last_login 记录/3月清理/活跃账号不受影响，全部通过。

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
