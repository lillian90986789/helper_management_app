# Weekly Menu Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the employer arrange dishes onto any day of the current week (not just today), and let both employer and maid browse the current week's menu day-by-day from the home screen.

**Architecture:** Add one new read endpoint (`GET /meals/week`) that returns the current Mon–Sun `MealOrder` rows grouped by date, reusing the existing `mondayOf`/`ymd` week-boundary helpers already used by the task-list `/week` endpoint. Extend the existing `to-meal` write endpoint to accept a `meal_date` within that same week. On the frontend, add one new shared `WeeklyMenu` component (day-chip strip + swipe) used by both `EmployerHome` and `MaidToday`, and extend the existing "arrange to menu" sheet on `RecipeDetail` with a day picker.

**Tech Stack:** Node/Express + better-sqlite3 (server), React 18 + Vite, no client or server test framework is configured in this repo (no jest/vitest/mocha) — verification below is manual QA against the running dev app, matching how the rest of this codebase is verified.

**Spec:** `docs/superpowers/specs/2026-07-17-weekly-menu-design.md`

---

### Task 1: Backend — `GET /meals/week` endpoint

**Files:**
- Modify: `server/index.js:1283` (insert new route immediately after the existing `api.get('/meals', ...)` line and before `api.get('/meals/:id', ...)` at line 1284 — route order matters, `/meals/week` must be registered before the `/meals/:id` catch-all or Express will match `week` as `:id`)

- [ ] **Step 1: Add the `GET /meals/week` route**

Insert this block between the existing line 1283 (`api.get('/meals', ...)`) and line 1284 (`api.get('/meals/:id', ...)`):

```js
// 本周菜单：周一~周日全部菜品，按日期分组（提前排菜 + 周菜单展示）
api.get('/meals/week', async (req, res) => {
  const mon = mondayOf(new Date());
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
```

- [ ] **Step 2: Manual verification**

Start the backend (`npm start` from repo root, default `http://localhost:8080`). Log into the app as the employer in a browser so a valid auth token is stored in `localStorage`, open devtools console and run:

```js
fetch('/api/meals/week', { headers: { 'X-Auth-Token': JSON.parse(localStorage.getItem('hf_employer')).token } }).then(r => r.json()).then(console.log)
```

Expected: an object with `start`, `end` (7 days apart), and `days` — an array of exactly 7 objects, each with `date`, `weekday` (1–7), `isToday` (`true` on exactly one of the 7), and `meals` (array, empty `[]` for days with nothing arranged).

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add GET /meals/week for current-week menu view"
```

---

### Task 2: Backend — `to-meal` accepts a `meal_date` within the current week

**Files:**
- Modify: `server/index.js:1266-1276` (the existing `api.post('/recipes/:id/to-meal', ...)` handler)

- [ ] **Step 1: Replace the handler**

Current code (lines 1266-1276):

```js
// 从菜谱一键安排到今日菜单
api.post('/recipes/:id/to-meal', (req, res) => {
  const family = curFamily(req);
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!owns(req, r)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const mt = ['breakfast','lunch','dinner'].includes(b.meal_type) ? b.meal_type : 'lunch';
  const mid = db.prepare(`INSERT INTO MealOrder (family_id,recipe_id,meal_date,meal_type,servings,assignee_id,status,notes) VALUES (?,?,?,?,?,?, 'to_receive', ?)`)
    .run(family.family_id, r.recipe_id, todayYmd(), mt, b.servings || r.servings || 2, defaultHelperId(family.family_id), b.notes || '').lastInsertRowid;
  notify(family.family_id, 'meal', '新菜单安排', '「' + r.name + '」已安排到' + ({breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}[mt]), 'meal', mid, 'maid');
  res.json(db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(mid));
});
```

Replace with:

```js
// 从菜谱一键安排到本周任意一天的菜单（默认今天；meal_date 必须落在本周 7 天内，否则回退今天）
api.post('/recipes/:id/to-meal', (req, res) => {
  const family = curFamily(req);
  const r = db.prepare('SELECT * FROM Recipe WHERE recipe_id=?').get(req.params.id);
  if (!owns(req, r)) return res.status(404).json({ error: 'not found' });
  const b = req.body;
  const mt = ['breakfast','lunch','dinner'].includes(b.meal_type) ? b.meal_type : 'lunch';
  const mon = mondayOf(new Date());
  const weekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return ymd(d); });
  const mealDate = weekDates.includes(b.meal_date) ? b.meal_date : todayYmd();
  const mid = db.prepare(`INSERT INTO MealOrder (family_id,recipe_id,meal_date,meal_type,servings,assignee_id,status,notes) VALUES (?,?,?,?,?,?, 'to_receive', ?)`)
    .run(family.family_id, r.recipe_id, mealDate, mt, b.servings || r.servings || 2, defaultHelperId(family.family_id), b.notes || '').lastInsertRowid;
  const dayLabel = mealDate === todayYmd() ? '今日' : (mealDate.slice(5) + ' ');
  notify(family.family_id, 'meal', '新菜单安排', '「' + r.name + '」已安排到' + dayLabel + ({breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}[mt]), 'meal', mid, 'maid');
  res.json(db.prepare('SELECT * FROM MealOrder WHERE meal_order_id=?').get(mid));
});
```

- [ ] **Step 2: Manual verification**

With the backend running and an employer token available (see Task 1 Step 2), in the browser devtools console:

```js
const tok = JSON.parse(localStorage.getItem('hf_employer')).token;
fetch('/api/recipes/1/to-meal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': tok },
  body: JSON.stringify({ meal_type: 'dinner', meal_date: '2099-01-01' }) }).then(r => r.json()).then(console.log)
```

Expected: response `meal_date` is **not** `2099-01-01` (falls back to today's date) because that date is outside the current week — confirms the server-side range validation. Repeat with one of the `date` values returned by `/meals/week` in Task 1 and confirm the response `meal_date` matches exactly what was sent.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: recipeToMeal accepts a meal_date anywhere in the current week"
```

---

### Task 3: Frontend — `api.mealsWeek()` and date helpers

**Files:**
- Modify: `web/src/api.js:144` (add new method next to existing `meals:`)
- Modify: `web/src/ui.jsx:1` (imports) and end of file (new helpers)

- [ ] **Step 1: Add the API method**

In `web/src/api.js`, change line 144 from:

```js
  meals: () => req('/meals'),
```

to:

```js
  meals: () => req('/meals'),
  mealsWeek: () => req('/meals/week'),
```

- [ ] **Step 2: Add client-side week-date helpers to `ui.jsx`**

`ui.jsx` currently imports only `useState` from React (line 1) and does not import `pick` from `i18n.jsx` (line 3 imports only `useI18n`). Update the top imports:

```js
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n, pick } from './i18n.jsx';
import { api } from './api.js';
```

Then append these two exports at the end of `ui.jsx` (after `weekdaysText`):

```js
// 本地当天日期 YYYY-MM-DD（与服务端 ymd() 同格式，用于跟本周日期数组比对）
export function localYmd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 本周（周一~周日）7 个日期，与服务端 mondayOf()/ymd() 的"周一起始"规则保持一致
export function currentWeekDates() {
  const now = new Date();
  const day = now.getDay(); // 0=周日…6=周六
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now); mon.setDate(now.getDate() - diff);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return localYmd(d); });
}
```

- [ ] **Step 3: Manual verification**

In the browser devtools console on any page of the running app:

```js
// paste the two functions above, or just check the network tab shows GET /api/meals/week succeeding after Task 4/5 are wired up
```

Confirm no import errors appear in the Vite dev server console/terminal after saving (`cd web && npm run dev`, watch terminal output for compile errors).

- [ ] **Step 4: Commit**

```bash
git add web/src/api.js web/src/ui.jsx
git commit -m "feat: add mealsWeek API call and current-week date helpers"
```

---

### Task 4: Frontend — shared `WeeklyMenu` component

**Files:**
- Modify: `web/src/ui.jsx` (append new component, after the helpers added in Task 3)

- [ ] **Step 1: Add the `WeeklyMenu` component**

Append to `ui.jsx`:

```js
// 本周菜单：顶部 7 天日期胶囊 + 下方选中日的三餐；点击胶囊或在内容区左右滑动切换查看的那一天。
// days: 来自 GET /meals/week 的 days 数组；onDelete 传入则显示删除按钮（雇主端），不传则只读（女佣端）。
export function WeeklyMenu({ days, lang, t, onOpen, onDelete }) {
  const todayIdx = days.findIndex((d) => d.isToday);
  const [idx, setIdx] = useState(todayIdx >= 0 ? todayIdx : 0);
  const day = days[idx];
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx < -40 && idx < 6) setIdx(idx + 1);
    else if (dx > 40 && idx > 0) setIdx(idx - 1);
  };
  const labels = [t('monS'), t('tueS'), t('wedS'), t('thuS'), t('friS'), t('satS'), t('sunS')];
  return (
    <div>
      <div className="row" style={{ gap: 4, justifyContent: 'space-between', marginBottom: 10 }}>
        {days.map((d, i) => (
          <button key={d.date} onClick={() => setIdx(i)} style={{
            flex: 1, padding: '6px 2px', borderRadius: 10, textAlign: 'center', border: 'none',
            background: i === idx ? 'var(--teal)' : 'transparent', color: i === idx ? '#fff' : 'var(--ink-2)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{labels[i]}</div>
            <div style={{ fontSize: 11 }}>{+d.date.slice(8)}{d.meals.length > 0 ? ' ●' : ''}</div>
          </button>
        ))}
      </div>
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {day.meals.length === 0
          ? <div className="empty tiny" style={{ padding: '8px 0' }}>{lang === 'en' ? 'No dishes' : '暂无菜品'}</div>
          : day.meals.map((m) => (
            <div key={m.meal_order_id} className="list-item" onClick={() => onOpen(m.meal_order_id)}>
              <div className="thumb"><CoverThumb value={m.recipe.cover_image} /></div>
              <div className="grow">
                <div className="bold">{pick(lang, m.recipe.name, m.recipe.name_en)}</div>
                <div className="small muted">{t(m.meal_type)} · {m.servings}{lang === 'en' ? ' ppl' : '人'}</div>
              </div>
              <StatusBadge status={m.status} />
              {onDelete && <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={(e) => { e.stopPropagation(); onDelete(m); }} title={lang === 'en' ? 'Remove' : '删除'}>✕</button>}
            </div>
          ))}
      </div>
    </div>
  );
}
```

This uses `CoverThumb` and `StatusBadge`, both already defined earlier in the same file — no new imports needed beyond Task 3's `useRef`/`pick`.

- [ ] **Step 2: Manual verification**

`cd web && npm run dev`, confirm the Vite terminal shows no compile errors after saving `ui.jsx`. (This component isn't rendered anywhere yet — that's Task 5/6.)

- [ ] **Step 3: Commit**

```bash
git add web/src/ui.jsx
git commit -m "feat: add shared WeeklyMenu day-strip + swipe component"
```

---

### Task 5: Frontend — wire `WeeklyMenu` into `EmployerHome`

**Files:**
- Modify: `web/src/pages/EmployerHome.jsx`

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `web/src/pages/EmployerHome.jsx` with:

```jsx
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { WeeklyMenu } from '../ui.jsx';

export default function EmployerHome() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { data, reload } = useAsync(() => api.dashEmployer());
  const { data: week, reload: reloadWeek } = useAsync(() => api.mealsWeek());
  const { data: sub } = useAsync(() => api.subCurrent().catch(() => null));
  if (!data) return <div className="content"><div className="empty">加载中…</div></div>;
  const { summary, shoppingSummary, notifications, family } = data;
  const unread = notifications.filter((n) => !n.is_read).length;
  const delMeal = async (m) => {
    const name = pick(lang, m.recipe.name, m.recipe.name_en);
    if (!window.confirm(lang === 'en' ? `Remove "${name}" from the menu?` : `从菜单删除「${name}」？`)) return;
    await api.deleteMeal(m.meal_order_id); reloadWeek();
  };

  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 16, paddingBottom: 16, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <div className="spread">
          <div>
            <div className="small" style={{ opacity: .85 }}>{family?.family_name || (lang === 'en' ? 'My Family' : '我的家庭')}</div>
            <h1 style={{ fontSize: 21 }}>{t('todayTasks')}</h1>
          </div>
          <button className="iconbtn" onClick={() => nav('/notifications')}>
            🔔{unread > 0 && <span style={{ position:'absolute', marginTop:-18, marginLeft:10, background:'#ef4444', borderRadius:8, fontSize:9, padding:'1px 5px' }}>{unread}</span>}
          </button>
        </div>
      </div>

      <div className="content">
        {/* 订阅状态卡片 */}
        {sub && (
          <div className="card tap" onClick={() => nav('/subscribe')}
            style={{ borderLeft: '3px solid ' + (sub.status === 'EXPIRING_SOON' ? 'var(--amber)' : sub.status === 'EXPIRED' ? 'var(--red)' : 'var(--teal)') }}>
            <div className="spread">
              <div>
                <span className="bold small">{sub.is_trial ? (lang === 'en' ? 'Free trial' : '免费试用') : (sub.plan_id === 'yearly' ? (lang === 'en' ? 'Yearly plan' : '年度订阅') : (lang === 'en' ? 'Monthly plan' : '月度订阅'))}</span>
                <div className="tiny muted mt4">
                  {sub.status === 'EXPIRED' ? (lang === 'en' ? 'Expired' : '已到期')
                    : (lang === 'en' ? 'Until ' : '有效期至 ') + (sub.expire_at || '').slice(0, 10) + ' · ' + (lang === 'en' ? sub.remaining_days + 'd left' : '剩余 ' + sub.remaining_days + ' 天')}
                </div>
              </div>
              <button className="btn sm primary">{['TRIAL_ACTIVE', 'ACTIVE'].includes(sub.status) ? (lang === 'en' ? 'Manage' : '查看') : (lang === 'en' ? 'Renew' : '续费')}</button>
            </div>
            {sub.status === 'EXPIRING_SOON' && <div className="tiny" style={{ color: 'var(--amber)', marginTop: 6 }}>⚠️ {lang === 'en' ? 'Expiring soon — renew to keep access' : '即将到期，请及时续费'}</div>}
          </div>
        )}

        {/* 今日任务卡片 */}
        <div className="section-title">📋 {t('todayTasks')}</div>
        <div className="card">
          <div className="mini-grid">
            <div className="mini"><div className="n">{summary.total}</div><div className="l">{t('total')}</div></div>
            <div className="mini"><div className="n" style={{ color:'var(--green)' }}>{summary.done}</div><div className="l">{t('done')}</div></div>
            <div className="mini"><div className="n" style={{ color:'var(--blue)' }}>{summary.in_progress}</div><div className="l">{t('inProgress')}</div></div>
            <div className="mini"><div className="n" style={{ color:'var(--amber)' }}>{summary.pending_review}</div><div className="l">{t('pendingReview')}</div></div>
            <div className="mini"><div className="n" style={{ color:'var(--red)' }}>{summary.incomplete}</div><div className="l">{t('incompleteSection')}</div></div>
          </div>
          <div className="btn-row mt12">
            <button className="btn sm outline" onClick={() => nav('/e/tasks')}>{t('viewAll')}</button>
            <button className="btn sm primary" onClick={() => nav('/task-new')}>＋ {t('newTask')}</button>
          </div>
        </div>

        {/* 本周菜单卡片 */}
        <div className="section-title">🍽️ {t('todayMenu')}</div>
        <div className="card">
          {week ? <WeeklyMenu days={week.days} lang={lang} t={t} onOpen={(id) => nav('/meal/' + id)} onDelete={delMeal} /> : <div className="empty tiny">加载中…</div>}
          <button className="btn sm outline block mt12" onClick={() => nav('/e/recipes')}>{t('arrangeMenu')}</button>
        </div>

        {/* 采购卡片 */}
        <div className="section-title">🛒 {t('purchase')}</div>
        <div className="card">
          <div className="stat-grid">
            <div><div className="muted small">{t('toBuy')}</div><div className="bold" style={{ fontSize: 20 }}>{shoppingSummary.to_buy}</div></div>
            <div><div className="muted small">{t('subPending')}</div><div className="bold" style={{ fontSize: 20, color: shoppingSummary.sub_pending? 'var(--amber)':'inherit' }}>{shoppingSummary.sub_pending}</div></div>
            <div><div className="muted small">{t('estAmount')}</div><div className="bold" style={{ fontSize: 20 }}>S${shoppingSummary.est_total.toFixed(1)}</div></div>
            <div><div className="muted small">{t('done')}</div><div className="bold" style={{ fontSize: 20, color:'var(--teal)' }}>S${shoppingSummary.actual_total.toFixed(1)}</div></div>
          </div>
          <button className="btn sm outline block mt12" onClick={() => nav('/e/shopping')}>{t('viewProgress')}</button>
        </div>

        {/* 异常提醒 */}
        {notifications.length > 0 && <>
          <div className="section-title">⚠️ {t('alerts')}</div>
          <div className="card">
            {notifications.slice(0, 3).map((n) => (
              <div key={n.notification_id} className="list-item" onClick={() => nav('/notifications')}>
                <div className="thumb" style={{ background:'#fef3c7' }}>{iconFor(n.type)}</div>
                <div className="grow"><div className="bold small">{n.title}</div><div className="tiny muted ellipsis">{n.content}</div></div>
              </div>
            ))}
          </div>
        </>}
      </div>
    </>
  );
}

function iconFor(type) {
  return { task: '🧹', meal: '🍽️', shopping: '🛒' }[type] || '🔔';
}
```

Note what changed vs. the original: `meals` is no longer destructured from `data` (dashboard/employer still returns it, just unused here now); a new `week`/`reloadWeek` pair drives the menu card; `delMeal` takes the whole `MealOrder` row (with nested `.recipe`) instead of an event + row, since `WeeklyMenu` already calls `e.stopPropagation()` internally before invoking `onDelete`.

- [ ] **Step 2: Manual verification**

`cd web && npm run dev`, log in as employer, open the home page. Confirm:
- The "今日菜单" card shows a 7-day strip with today highlighted.
- Clicking another day's chip switches the list below without a page reload.
- Swiping left/right over the meal list also switches days.
- Deleting a dish still asks for confirmation and removes it from the list after confirming.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/EmployerHome.jsx
git commit -m "feat: EmployerHome shows the current week's menu with day switcher"
```

---

### Task 6: Frontend — wire `WeeklyMenu` into `MaidToday` (read-only)

**Files:**
- Modify: `web/src/pages/MaidToday.jsx`

- [ ] **Step 1: Add the week-menu fetch and import**

At the top of `web/src/pages/MaidToday.jsx`, change:

```js
import { StatusBadge, PriorityBadge, fmtTime, CoverThumb } from '../ui.jsx';
```

to:

```js
import { StatusBadge, PriorityBadge, fmtTime, WeeklyMenu } from '../ui.jsx';
```

(`CoverThumb` is no longer used directly in this file once Step 2 replaces the meals block with `WeeklyMenu`, which imports its own `CoverThumb` internally from the same `ui.jsx` module.)

Inside the component body, right after the existing line:

```js
  const { data, reload } = useAsync(() => api.dashMaid(currentMaidId()));
```

add:

```js
  const { data: week } = useAsync(() => api.mealsWeek());
```

- [ ] **Step 2: Replace the "今日做饭" block**

Replace:

```jsx
        {/* 今日做饭 */}
        <div className="section-title">🍳 {t('todayCook')}</div>
        <div className="card">
          {meals.map((m) => (
            <div key={m.meal_order_id} className="list-item" onClick={() => nav('/meal/' + m.meal_order_id)}>
              <div className="thumb"><CoverThumb value={m.cover_image} /></div>
              <div className="grow">
                <div className="bold">{pick(lang, m.recipe_name, m.recipe_name_en)} {m.recipe_type === 'baby' && <span className="badge purple tiny">{t('baby')}</span>}</div>
                <div className="tiny muted">{t(m.meal_type)} · {fmtTime(m.start_time)}</div>
              </div>
              <StatusBadge status={m.status} />
            </div>
          ))}
        </div>
```

with:

```jsx
        {/* 本周做饭 */}
        <div className="section-title">🍳 {t('todayCook')}</div>
        <div className="card">
          {week ? <WeeklyMenu days={week.days} lang={lang} t={t} onOpen={(id) => nav('/meal/' + id)} /> : <div className="empty tiny">加载中…</div>}
        </div>
```

`meals` is still destructured from `data` at the top of the component (`const { tasks, progress, next, meals, shopping, rest, mom } = data;`) — leave that destructuring as-is even though this block no longer uses it directly; nothing else in this plan touches it.

- [ ] **Step 3: Manual verification**

Log in as the maid role, open the "今日" home page. Confirm the "今日做饭" section now shows the same 7-day strip (read-only — no delete button), today highlighted by default, and switching days works via tap and swipe. Confirm nothing else on the page (tasks, rest days, shopping) changed behavior.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/MaidToday.jsx
git commit -m "feat: MaidToday shows the current week's menu with day switcher"
```

---

### Task 7: Frontend — day picker on the "arrange to menu" sheet

**Files:**
- Modify: `web/src/pages/RecipeDetail.jsx`

- [ ] **Step 1: Import the week-date helper and add state**

Change the import line:

```js
import { TopBar, CoverThumb } from '../ui.jsx';
```

to:

```js
import { TopBar, CoverThumb, currentWeekDates, localYmd } from '../ui.jsx';
```

Add, right after the existing `const [confirmDel, setConfirmDel] = useState(false);` line:

```js
  const weekDates = currentWeekDates();
  const [mealDate, setMealDate] = useState(() => localYmd());
```

- [ ] **Step 2: Pass `meal_date` when arranging**

Change:

```js
  const toMeal = async (meal_type) => {
    if (busy) return; setBusy(true);
    try { await api.recipeToMeal(r.recipe_id, { meal_type }); setPickMeal(false); showToast(en ? 'Added to menu ✓' : '已安排到今日菜单 ✓'); nav('/e/home'); }
    catch { showToast(en ? 'Failed' : '操作失败'); } setBusy(false);
  };
```

to:

```js
  const toMeal = async (meal_type) => {
    if (busy) return; setBusy(true);
    try {
      await api.recipeToMeal(r.recipe_id, { meal_type, meal_date: mealDate });
      setPickMeal(false);
      showToast(en ? 'Added to menu ✓' : '已安排到菜单 ✓');
      nav('/e/home');
    } catch { showToast(en ? 'Failed' : '操作失败'); } setBusy(false);
  };
```

- [ ] **Step 3: Add the day-picker row to the sheet**

Change the sheet body from:

```jsx
      {pickMeal && (
        <div className="sheet-mask" onClick={() => setPickMeal(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bold">{t('arrangeToMenu')} · {t('mealType')}</div>
            <div className="tiny muted" style={{ margin: '6px 0 12px' }}>{en ? 'Add to today’s menu' : '安排到今日菜单'}</div>
            <div className="row" style={{ gap: 8 }}>
              {[['breakfast','🌅'],['lunch','🍚'],['dinner','🌙']].map(([mt, ic]) => (
                <button key={mt} className="btn outline" style={{ flex: 1, flexDirection: 'column', height: 'auto', padding: '14px 4px' }} disabled={busy} onClick={() => toMeal(mt)}>
                  <div style={{ fontSize: 22 }}>{ic}</div>{t(mt)}
                </button>
              ))}
            </div>
            <button className="btn outline block" style={{ marginTop: 12 }} onClick={() => setPickMeal(false)}>{t('cancel')}</button>
          </div>
        </div>
      )}
```

to:

```jsx
      {pickMeal && (
        <div className="sheet-mask" onClick={() => setPickMeal(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bold">{t('arrangeToMenu')} · {t('mealType')}</div>
            <div className="tiny muted" style={{ margin: '6px 0 8px' }}>{en ? 'Pick a day this week' : '选择本周哪一天'}</div>
            <div className="row" style={{ gap: 6, marginBottom: 12 }}>
              {weekDates.map((ds, i) => (
                <button key={ds} className={'chip' + (mealDate === ds ? ' on' : '')} onClick={() => setMealDate(ds)}>
                  {[t('monS'),t('tueS'),t('wedS'),t('thuS'),t('friS'),t('satS'),t('sunS')][i]}{ds.slice(8)}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {[['breakfast','🌅'],['lunch','🍚'],['dinner','🌙']].map(([mt, ic]) => (
                <button key={mt} className="btn outline" style={{ flex: 1, flexDirection: 'column', height: 'auto', padding: '14px 4px' }} disabled={busy} onClick={() => toMeal(mt)}>
                  <div style={{ fontSize: 22 }}>{ic}</div>{t(mt)}
                </button>
              ))}
            </div>
            <button className="btn outline block" style={{ marginTop: 12 }} onClick={() => setPickMeal(false)}>{t('cancel')}</button>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Manual verification**

Log in as employer, open any recipe detail page, tap "安排到菜单". Confirm 7 day chips show (today pre-selected), tapping a different day and then a meal type (e.g. 🌙 晚餐) navigates back to the home page, and the dish now shows up under that day in the `WeeklyMenu` strip from Task 5 (not under today, unless today was picked).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/RecipeDetail.jsx
git commit -m "feat: recipe detail lets employer pick which day this week to arrange to"
```

---

## Self-Review Notes

- **Spec coverage:** date range fixed to Mon–Sun (Task 1/2, no prev/next-week nav added anywhere) ✓; day-strip + swipe UI (Task 4) ✓; arrange-to-menu entry point extended with day picker, no draft/publish step added (Task 7) ✓; maid sees the same week read-only (Task 6) ✓.
- **Consistency check:** `WeeklyMenu`'s `days` prop shape (`{date, weekday, isToday, meals:[{..., recipe:{...}}]}`) matches exactly what `GET /meals/week` (Task 1) returns — same field names used in Task 4/5/6, no mismatch.
- **No route ordering bug:** `/meals/week` is registered before `/meals/:id` (Task 1), so it won't be swallowed by the `:id` param route.
