# HomeFlow 家务管家

家庭事务协作 App（雇主 / 家庭成员 / 女佣），覆盖 **家务任务 · 做饭菜谱 · 采购结算** 三条核心业务链路。
依据《家庭事务协作 App 产品需求文档 PRD V1.0》实现 MVP 优先页面。

- **跨平台**：移动端优先的 Web App / PWA，iOS、Android 浏览器均可使用，支持「添加到主屏幕」像原生 App 一样全屏运行。
- **双语**：简体中文 / English 一键切换（系统文案人工翻译，菜谱步骤等内容字段双语）。
- **双角色**：雇主端（首页/任务/菜谱/采购/我的）与女佣端（今日/任务/做饭/采购/我的）独立底部导航与操作权限。
- **可部署**：单容器（Node + Express + SQLite），一条命令部署到 NAS（群晖 Synology / 威联通 QNAP 等支持 Docker 的 NAS）。

---

## 一、技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite + React Router（HashRouter）+ 自研移动端设计系统（纯 CSS） |
| 后端 | Node 22 + Express + better-sqlite3 |
| 数据 | SQLite 单文件，持久化到 `data/`（Docker 卷） |
| 部署 | 多阶段 Dockerfile + docker-compose，单端口 8080 同时提供 API 与前端 |

已实现的 10 个优先页面（PRD 第 19 节重点）：雇主首页、女佣今日首页、任务列表、新建任务、任务详情、
菜谱详情、菜谱订单、采购清单、采购结算、替代商品确认；外加 菜谱列表 / 消息中心 / 我的。

---

## 二、本地运行（开发）

```bash
# 0. 克隆仓库（克隆后的目录即整个应用根目录）
git clone git@github.com:GaoQinghong/helper_management_app.git
cd helper_management_app

# 1. 后端（含自动建表 + 种子数据）
npm install
npm run seed          # 可选：手动重置演示数据
npm start             # 启动后端，默认 http://localhost:8080

# 2. 前端（开发热更新，另开一个终端）
cd web
npm install
npm run dev           # http://localhost:5173 （已配置 /api 代理到 8080）
```

生产模式（前端构建后由后端统一托管，单端口）：

```bash
cd helper_management_app/web && npm install && npm run build
cd .. && npm install && npm start
# 打开 http://localhost:8080
```

> 在手机浏览器访问同一局域网地址（如 `http://<电脑IP>:8080`）即可看到全屏移动端界面。

---

## 三、Receipt 小票识别（OCR）· 配置你自己的 API Key

采购结算时，女佣可上传小票照片，系统用 **Claude 视觉模型（`claude-opus-4-8`）** 自动识别商店、日期、税前小计、消费税、含税总额，并回填与录入金额做核对（新加坡 GST 9%，税率可在「我的 → 采购设置」里改）。

- **不配 Key（默认）**：走「模拟识别」——按女佣录入的商品小计 + 消费税生成一致的 receipt 金额，仅用于演示走通流程，**不真正读取图片内容**。
- **配 Key（真实识别）**：真正读取小票图片内容并回填，识别来源标签显示「Claude 识别」。

### 如何获取 API Key

1. 打开 Anthropic 开发者控制台：<https://platform.claude.com>（登录后）
2. 进入 **Settings → API Keys**（直达 <https://platform.claude.com/settings/keys>）→ **Create Key** → 复制 `sk-ant-...`（只显示一次）
3. 在 **Settings → Billing** 充值信用额度（API 按用量计费，与 claude.ai 订阅不同；每张小票约几分钱）

> ⚠️ API Key 是密码级凭据：只放在启动命令 / 环境变量里，**不要写进代码或提交到 git**。本仓库不含任何 Key。

### 启用方式

**本地 / 生产（命令行）**——启动服务器时用环境变量传入：

```bash
# macOS / Linux
ANTHROPIC_API_KEY=sk-ant-你的key PORT=8080 npm start
```

**Docker / NAS**——在 `docker-compose.yml` 的服务下增加环境变量（不要把 Key 写进仓库，建议用 NAS 的密钥/环境变量管理，或本地 `.env` 且已被 `.gitignore` 排除）：

```yaml
services:
  homeflow:
    environment:
      - ANTHROPIC_API_KEY=sk-ant-你的key   # 生产建议改为从 .env 注入
      - DATA_DIR=/app/data
```

配置后重启，进入 **女佣端 → 采购 → 点清单 → 填写价格·采购结算 → 📷 上传小票（自动识别）**，上传真实小票即可看到「Claude 识别」结果。识别用到的环境变量：

| 变量 | 说明 | 默认 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API Key，配置后启用真实小票识别 | 未配置时走模拟兜底 |
| `PORT` | 服务端口 | `8080` |
| `DATA_DIR` | SQLite + 小票图片存储目录 | `./data` |

> 小票原图保存在 `DATA_DIR/uploads/`，通过 `/uploads/...` 静态访问，雇主审核时可查看原图。

---

## 四、部署到 NAS（Docker）

适用于群晖 Synology / 威联通 QNAP 等支持 Docker（Container Manager）的 NAS。

### 方式 A：命令行（SSH）

```bash
# 把整个项目目录上传到 NAS，例如 /volume1/docker/helper_management_app
# （即含 Dockerfile / docker-compose.yml 的那个目录）
cd /volume1/docker/helper_management_app
docker compose up -d --build
```

打开 `http://<NAS-IP>:8080` 即可访问。数据库持久化在 `./data/homeflow.db`，容器重建不丢数据。

### 方式 B：群晖 Container Manager（图形界面）

1. 将项目文件夹 `helper_management_app`（含 Dockerfile / docker-compose.yml）上传到 NAS（File Station）。
2. 打开 **Container Manager → 项目（Project） → 新增**，来源选「现有 docker-compose.yml」，指向该文件夹。
3. 构建并启动，端口映射保持 `8080:8080`（如被占用，把左边改成别的，如 `9000:8080`）。
4. 浏览器访问 `http://<NAS-IP>:8080`（或你改的端口）。

### 端口 / 反向代理

- 如需 HTTPS 或自定义域名，在 NAS 的「反向代理」里把 `home.yourdomain.com` 指向 `localhost:8080` 即可。
- 配好 HTTPS 后，iOS/Android 上用 Safari/Chrome 打开 → 分享 → **添加到主屏幕**，即作为 PWA 安装。

---

## 五、演示账户与数据

种子数据内置一个家庭「陈先生家 / Chen Family」：

| 角色 | 名称 | 说明 |
|---|---|---|
| 雇主 | 陈先生 | 全部管理权限 |
| 女佣 | Siti | 执行任务、做饭、采购、录价 |
| 家庭成员 | 陈太太 | 可配置权限 |

含 6 条任务、3 个菜谱（含 1 个宝宝辅食）、3 个今日菜单订单、1 份采购清单（6 件商品，含 1 件缺货 + 1 件替代申请），可完整走通三条业务链。

> 桌面浏览器访问时，左侧有「角色 / 语言」切换栏，方便预览雇主端与女佣端；手机端为纯全屏 App，此栏自动隐藏。
> 当前为 MVP 演示版，登录注册以演示家庭直接进入；真实部署可在此基础上接入手机/邮箱验证（PRD 17 节安全要求）。

---

## 六、目录结构

```
helper_management_app/
├── server/            # 后端
│   ├── db.js          # SQLite 建表（PRD 第 11 节 13 张数据表）
│   ├── seed.js        # 演示种子数据
│   └── index.js       # Express REST API + 静态前端托管
├── web/               # 前端 React 应用
│   ├── src/pages/     # 各业务页面
│   ├── src/i18n.jsx   # 中英双语字典
│   └── src/...
├── Dockerfile         # 多阶段构建
├── docker-compose.yml # NAS 一键部署
└── data/              # SQLite 数据库（运行后生成，挂载为持久卷）
```

---

## 七、与 PRD 的对应 / 后续可扩展

已实现：
- **雇主注册**：手机/邮箱验证码、密码规则、创建家庭、区域、推荐任务模板、邀请女佣、中断恢复。
- **任务清单（按星期重复 + 日历 + 休息日）**：固定任务模板、每日实例、雇主周视图、女佣月/周日历、每周统计；雇主按月设置女佣休息日，女佣首页展示本月休息日、休息日当天不排任务。
- **菜谱 / 做饭**：食材步骤、菜谱下单、做饭状态机。
- **采购模块（完整闭环）**：两级分类（食材再分肉/菜/主食/水果等）、女佣逐项录价、**Receipt 小票识别（Claude 视觉，见第三节）**、金额核对（含 GST 消费税、±0.05 误差、差异原因）、雇主审核确认、付款方式与报销、**月度账目 + 一级/食材二级分类占比统计**。
- 替代商品申请与审核、消息通知、中英双语。

第二/三版可扩展：Receipt 商品明细自动识别并自动匹配清单、商品历史价格趋势与异常提醒、每月分类预算与超支提醒、多张小票合并结算、账目 Excel/PDF 导出、每周菜单日历、家庭库存与临期提醒、AI 菜单推荐等。
