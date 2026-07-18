# Ad-hoc Photo Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the employer publish a one-off ("temporary") task with reference photos and a text description, without going through the weekly-repeat template flow.

**Architecture:** No schema changes are needed — `DailyTask.task_template_id` is already nullable (a one-off task is just a `DailyTask` row with `task_template_id = NULL`), and `DailyTaskAttachment.file_type` is a free-text column, so employer reference photos can be tagged `'reference'` to stay distinct from the maid's completion-photo uploads (tagged `'image'`). Add one new write endpoint (`POST /daily`), a tab toggle on the existing `TaskNew` page that swaps in a simplified ad-hoc form, and split the attachments section on `TaskDetail` into "reference photos" vs "completion photos" so the two don't render mixed together.

**Tech Stack:** Node/Express + better-sqlite3 (server), React 18 + Vite. No test framework is configured in this repo — verification below is manual QA against the running dev app.

**Spec:** `docs/superpowers/specs/2026-07-17-adhoc-photo-task-design.md`

---

### Task 1: Backend — `POST /daily` (create an ad-hoc task)

**Files:**
- Modify: `server/index.js:816` (insert new route immediately after the existing `api.get('/daily/:id', ...)` handler, before `api.post('/daily/:id/transition', ...)`)

- [ ] **Step 1: Add the route**

Insert this block right after the existing `api.get('/daily/:id', ...)` handler (ends at line 822) and before `api.post('/daily/:id/transition', ...)` (line 823):

```js
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
```

This reuses `dailyWith`, `todayYmd`, `parseYmd`, `isoWeekday`, `notify`, `curFamily` — all already defined earlier in `server/index.js` (see the existing `ensureDailyTasks`/`/templates` handlers for the same helpers).

- [ ] **Step 2: Manual verification**

Start the backend (`npm start`), log into the app as employer in a browser to get a token, then in devtools console:

```js
const tok = JSON.parse(localStorage.getItem('hf_employer')).token;
fetch('/api/daily', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': tok },
  body: JSON.stringify({ task_name: '把阳台箱子搬开', assignee_id: 2, area_id: 1, description: '搬到储物间', reference_images: [] }) })
  .then(r => r.json()).then(console.log)
```

Expected: a JSON object with `daily_task_id`, `task_template_id: null`, `task_name_snapshot: '把阳台箱子搬开'`, `status: 'today_todo'`, `attachments: []`. Then reload the task list in the browser as that maid/employer and confirm the new task appears in today's list (via the existing `GET /daily` — no changes needed there, it already selects by `family_id`/`task_date` regardless of `task_template_id`).

Also verify the 400s: retry the same fetch without `assignee_id` → expect `{"error":"assignee_required"}`; without `area_id` → expect `{"error":"area_required"}`.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add POST /daily to create one-off ad-hoc tasks"
```

---

### Task 2: Frontend — `api.createAdhocTask()`

**Files:**
- Modify: `web/src/api.js:107-111`

- [ ] **Step 1: Add the API method**

Change:

```js
  daily: (date) => req('/daily' + (date ? '?date=' + date : '')),
  dailyTask: (id) => req('/daily/' + id),
```

to:

```js
  daily: (date) => req('/daily' + (date ? '?date=' + date : '')),
  createAdhocTask: (body) => req('/daily', { method: 'POST', body }),
  dailyTask: (id) => req('/daily/' + id),
```

- [ ] **Step 2: Manual verification**

`cd web && npm run dev`, confirm no compile errors in the terminal after saving.

- [ ] **Step 3: Commit**

```bash
git add web/src/api.js
git commit -m "feat: add createAdhocTask API call"
```

---

### Task 3: Frontend — i18n keys for the ad-hoc task tab

**Files:**
- Modify: `web/src/i18n.jsx` (zh dict around line 48, en dict around line 174 — the `taskName`/`taskDesc`/`taskImage` line already present in both)

- [ ] **Step 1: Add tab-label and misc keys to the `zh` dict**

The `zh` dict already has this line (around line 48):

```js
    taskName: '任务名称', taskDesc: '任务说明', taskImage: '任务图片', repeat: '是否重复', repeatFreq: '重复频率',
```

Change it to:

```js
    taskName: '任务名称', taskDesc: '任务说明', taskImage: '任务图片', repeat: '是否重复', repeatFreq: '重复频率',
    repeatTaskTab: '重复任务', adhocTaskTab: '临时任务', addRefPhoto: '添加参考图', dueDateOptional: '截止日期（可选）', dueToday: '不选默认今天',
```

- [ ] **Step 2: Add the same keys to the `en` dict**

The `en` dict has the matching line (around line 174):

```js
    taskName: 'Task Name', taskDesc: 'Description', taskImage: 'Image', repeat: 'Repeat', repeatFreq: 'Frequency',
```

Change it to:

```js
    taskName: 'Task Name', taskDesc: 'Description', taskImage: 'Image', repeat: 'Repeat', repeatFreq: 'Frequency',
    repeatTaskTab: 'Repeating', adhocTaskTab: 'One-off', addRefPhoto: 'Add photo', dueDateOptional: 'Due date (optional)', dueToday: 'Defaults to today',
```

(`id`/`my` dicts are intentionally left untouched — the app's `t()` helper already falls back to the `en` value when a key is missing for those two languages, per the existing comment at `i18n.jsx:314`.)

- [ ] **Step 3: Manual verification**

`cd web && npm run dev`, switch the language toggle to English in the running app, confirm no key renders as a raw key name (e.g. no literal text `repeatTaskTab` visible anywhere yet — it isn't wired into any component until Task 4).

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n.jsx
git commit -m "feat: add i18n keys for the ad-hoc task tab"
```

---

### Task 4: Frontend — tab toggle + ad-hoc form on `TaskNew`

**Files:**
- Modify: `web/src/pages/TaskNew.jsx` (full rewrite of the component body)

- [ ] **Step 1: Replace the full file contents**

Replace `web/src/pages/TaskNew.jsx` in its entirety with:

```jsx
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, WeekdayPicker, Avatar, compressAndUploadImage } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function TaskNew() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { id } = useParams();         // 有 id = 编辑模板（模板编辑始终走"重复任务"表单，不显示切换）
  const editing = !!id;
  const { showToast } = useApp();
  const { data: boot } = useAsync(() => api.bootstrap());
  const { data: existing } = useAsync(() => (editing ? api.template(id) : Promise.resolve(null)), [id]);

  const [mode, setMode] = useState('repeat');   // 'repeat' | 'adhoc'（仅新建时可切换）

  const [f, setF] = useState({
    task_name: '', task_name_en: '', description: '', area_id: null, assignee_id: 2, priority: 'normal',
    estimated_duration: 30, weekdays: [],
    require_photo: true, require_note: false, require_approval: true,
  });
  const [subtasks, setSubtasks] = useState([{ title: '' }]);
  const [loaded, setLoaded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // 编辑时回填
  if (editing && existing && !loaded) {
    setF({
      task_name: existing.task_name, task_name_en: existing.task_name_en || '', description: existing.description || '',
      area_id: existing.area_id, assignee_id: existing.assignee_id, priority: existing.priority,
      estimated_duration: existing.estimated_duration, weekdays: existing.weekdays_arr,
      require_photo: !!existing.require_photo, require_note: !!existing.require_note, require_approval: !!existing.require_approval,
    });
    setSubtasks(existing.checklist.length ? existing.checklist.map((c) => ({ title: c.title, title_en: c.title_en })) : [{ title: '' }]);
    setLoaded(true);
  }

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const doDelete = async () => {
    try { await api.templateOp(id, 'delete'); showToast(lang === 'en' ? 'Task deleted' : '任务已删除'); nav('/e/tasks', { replace: true }); }
    catch { showToast(lang === 'en' ? 'Delete failed' : '删除失败'); }
  };

  const submit = async (status) => {
    if (!f.task_name.trim()) return showToast(lang === 'en' ? 'Please enter task name' : '请填写任务名称');
    if (f.weekdays.length === 0) {
      // 编辑时不选任何执行日 = 删除该任务；新建时仍要求至少一天
      if (editing) return setConfirmDel(true);
      return showToast(t('atLeastOneDay'));
    }
    const body = {
      ...f, status,
      checklist: subtasks.filter((s) => s.title.trim()).map((s) => ({ title: s.title, title_en: s.title_en || '', required: true })),
    };
    if (editing) { await api.updateTemplate(id, body); showToast(lang === 'en' ? 'Saved ✓' : '已保存 ✓'); nav(-1); }
    else { await api.createTemplate(body); showToast(status === 'draft' ? (lang === 'en' ? 'Draft saved' : '草稿已保存') : (lang === 'en' ? 'Published ✓' : '已发布 ✓')); nav('/e/tasks', { replace: true }); }
  };

  const areas = boot?.areas || [];
  // 可指定的执行人：家庭内女佣 + 家庭成员（§4.1）
  const assignees = (boot?.users || []).filter((u) => ['maid', 'member'].includes(u.role));
  // 新建任务默认派给第一个女佣（编辑时保留原执行人）
  useEffect(() => {
    if (editing || !assignees.length) return;
    if (!assignees.some((u) => u.user_id === f.assignee_id)) {
      const firstMaid = assignees.find((u) => u.role === 'maid') || assignees[0];
      if (firstMaid) set('assignee_id', firstMaid.user_id);
    }
  }, [boot]);

  if (mode === 'adhoc' && !editing) {
    return <AdhocTaskForm t={t} lang={lang} nav={nav} showToast={showToast} areas={areas} assignees={assignees} onSwitchMode={() => setMode('repeat')} />;
  }

  return (
    <>
      <TopBar title={editing ? t('edit') : t('newTask')} />
      <div className="content">
        {!editing && (
          <div className="seg" style={{ marginBottom: 4 }}>
            <button className="opt on" onClick={() => setMode('repeat')}>{t('repeatTaskTab')}</button>
            <button className="opt" onClick={() => setMode('adhoc')}>{t('adhocTaskTab')}</button>
          </div>
        )}
        <div className="field">
          <label>{t('taskName')} <span className="req">*</span></label>
          <input className="input" value={f.task_name} maxLength={50} placeholder={lang === 'en' ? 'e.g. Clean kitchen' : '例如：打扫厨房'} onChange={(e) => set('task_name', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('taskDesc')}</label>
          <textarea className="input" value={f.description} placeholder={lang === 'en' ? 'Describe requirements…' : '描述具体要求…'} onChange={(e) => set('description', e.target.value)} />
        </div>

        {/* 每周执行日（核心改动） */}
        <div className="field">
          <label>{t('weekdayRun')} <span className="req">*</span></label>
          <WeekdayPicker value={f.weekdays} onChange={(v) => set('weekdays', v)} />
          {editing && <div className="tiny muted" style={{ marginTop: 6 }}>{lang === 'en' ? 'Deselect all days and save to delete this task.' : '不选任何一天并保存，即可删除此任务。'}</div>}
        </div>

        <div className="field">
          <label>{t('area')} <span className="req">*</span></label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {areas.map((a) => (
              <button key={a.area_id} className={'chip' + (f.area_id === a.area_id ? ' on' : '')} onClick={() => set('area_id', a.area_id)}>
                {a.icon} {pick(lang, a.name, a.name_en)}
              </button>
            ))}
          </div>
        </div>

        {/* 执行人：指定女佣或家庭成员（任务清单模块 §4.1） */}
        <div className="field">
          <label>{t('assignee')} <span className="req">*</span></label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {assignees.length === 0 ? <span className="tiny muted">{lang === 'en' ? 'No helper yet — invite one first' : '还没有女佣，请先邀请'}</span> :
              assignees.map((u) => (
                <button key={u.user_id} className={'chip' + (f.assignee_id === u.user_id ? ' on' : '')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => set('assignee_id', u.user_id)}>
                  <Avatar value={u.avatar} size={18} style={{ background: 'transparent' }} /> {u.name}{u.role === 'member' ? '·' + t('member') : ''}
                </button>
              ))}
          </div>
        </div>

        <div className="field">
          <label>{t('priority')} <span className="req">*</span></label>
          <div className="seg">
            {['normal', 'important', 'urgent'].map((p) => (
              <button key={p} className={'opt' + (f.priority === p ? ' on' : '')} onClick={() => set('priority', p)}>{t(p)}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('minDuration')}</label>
          <input className="input" type="number" value={f.estimated_duration} onChange={(e) => set('estimated_duration', +e.target.value)} />
        </div>

        <div className="card" style={{ padding: '4px 16px' }}>
          <Toggle label={t('requirePhoto')} on={f.require_photo} onClick={() => set('require_photo', !f.require_photo)} />
          <Toggle label={t('requireApproval')} on={f.require_approval} onClick={() => set('require_approval', !f.require_approval)} />
        </div>

        <div className="section-title">☑️ {t('subtasks')}</div>
        <div className="card">
          {subtasks.map((s, i) => (
            <div key={i} className="row" style={{ marginBottom: 8 }}>
              <span className="muted">{i + 1}.</span>
              <input className="input" value={s.title} placeholder={lang === 'en' ? 'Subtask…' : '子任务…'}
                onChange={(e) => setSubtasks((p) => p.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
              <button className="iconbtn" onClick={() => setSubtasks((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn sm outline block" onClick={() => setSubtasks((p) => [...p, { title: '' }])}>＋ {t('addSubtask')}</button>
        </div>
      </div>

      <div className="actionbar">
        {!editing && <button className="btn outline" onClick={() => submit('draft')}>{t('saveDraft')}</button>}
        <button className="btn primary" style={{ flex: 2 }} onClick={() => submit('active')}>{editing ? t('save') : t('publishTask')}</button>
      </div>

      {/* 编辑时不选任何执行日 = 删除任务，二次确认 */}
      {confirmDel && (
        <div className="sheet-mask" onClick={() => setConfirmDel(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bold">{lang === 'en' ? 'Delete this task?' : '删除此任务？'}</div>
            <div className="tiny muted" style={{ margin: '6px 0 14px' }}>{lang === 'en' ? 'No weekday selected — saving will delete this task.' : '未选择任何执行日，保存将删除此任务。'}</div>
            <div className="btn-row">
              <button className="btn outline" onClick={() => setConfirmDel(false)}>{t('cancel')}</button>
              <button className="btn danger" style={{ flex: 2 }} onClick={doDelete}>{lang === 'en' ? 'Delete' : '删除'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Toggle({ label, on, onClick }) {
  return (
    <div className="spread" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="bold small">{label}</span>
      <div className={'switch' + (on ? ' on' : '')} onClick={onClick}><i /></div>
    </div>
  );
}

// ===== 临时任务（一次性，图片描述） =====
function AdhocTaskForm({ t, lang, nav, showToast, areas, assignees, onSwitchMode }) {
  const en = lang === 'en';
  const [f, setF] = useState({
    task_name: '', description: '', area_id: null, assignee_id: assignees[0]?.user_id || null,
    priority: 'normal', due_date: '', require_photo: true, require_approval: true,
  });
  const [images, setImages] = useState([]);   // 参考图片 URL 列表
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const onAddImage = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { const url = await compressAndUploadImage(file, { kind: 'task' }); setImages((p) => [...p, url]); }
    catch { showToast(en ? 'Upload failed' : '上传失败'); }
    e.target.value = '';
  };

  const submit = async () => {
    if (!f.task_name.trim()) return showToast(en ? 'Please enter task name' : '请填写任务名称');
    if (!f.assignee_id) return showToast(en ? 'No helper yet — invite one first' : '还没有女佣，请先邀请');
    if (!f.area_id) return showToast(en ? 'Please pick an area' : '请选择区域');
    if (busy) return; setBusy(true);
    try {
      await api.createAdhocTask({ ...f, task_date: f.due_date || undefined, reference_images: images });
      showToast(en ? 'Published ✓' : '已发布 ✓');
      nav('/e/tasks', { replace: true });
    } catch { showToast(en ? 'Failed' : '发布失败'); setBusy(false); }
  };

  return (
    <>
      <TopBar title={t('newTask')} />
      <div className="content">
        <div className="seg" style={{ marginBottom: 4 }}>
          <button className="opt" onClick={onSwitchMode}>{t('repeatTaskTab')}</button>
          <button className="opt on">{t('adhocTaskTab')}</button>
        </div>
        <div className="field">
          <label>{t('taskName')} <span className="req">*</span></label>
          <input className="input" value={f.task_name} maxLength={50} placeholder={en ? 'e.g. Move the balcony box' : '例如：把阳台箱子搬开'} onChange={(e) => set('task_name', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('taskImage')}</label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', alignItems: 'center', gap: 8 }}>
            {images.map((url, i) => (
              <div key={url} style={{ position: 'relative' }}>
                <img src={url} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover' }} />
                <button className="iconbtn" style={{ position: 'absolute', top: -8, right: -8, background: '#fff', borderRadius: '50%' }}
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <label className="btn sm outline" style={{ cursor: 'pointer', flex: 'none' }}>
              📷 {t('addRefPhoto')}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onAddImage} />
            </label>
          </div>
        </div>
        <div className="field">
          <label>{t('taskDesc')}</label>
          <textarea className="input" value={f.description} placeholder={en ? 'Describe what needs to be done…' : '描述具体要求…'} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('area')} <span className="req">*</span></label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {areas.map((a) => (
              <button key={a.area_id} className={'chip' + (f.area_id === a.area_id ? ' on' : '')} onClick={() => set('area_id', a.area_id)}>
                {a.icon} {pick(lang, a.name, a.name_en)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('assignee')} <span className="req">*</span></label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {assignees.length === 0 ? <span className="tiny muted">{en ? 'No helper yet — invite one first' : '还没有女佣，请先邀请'}</span> :
              assignees.map((u) => (
                <button key={u.user_id} className={'chip' + (f.assignee_id === u.user_id ? ' on' : '')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => set('assignee_id', u.user_id)}>
                  <Avatar value={u.avatar} size={18} style={{ background: 'transparent' }} /> {u.name}
                </button>
              ))}
          </div>
        </div>
        <div className="field">
          <label>{t('priority')} <span className="req">*</span></label>
          <div className="seg">
            {['normal', 'important', 'urgent'].map((p) => (
              <button key={p} className={'opt' + (f.priority === p ? ' on' : '')} onClick={() => set('priority', p)}>{t(p)}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('dueDateOptional')}</label>
          <input className="input" type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
          <div className="tiny muted" style={{ marginTop: 4 }}>{t('dueToday')}</div>
        </div>
        <div className="card" style={{ padding: '4px 16px' }}>
          <Toggle label={t('requirePhoto')} on={f.require_photo} onClick={() => set('require_photo', !f.require_photo)} />
          <Toggle label={t('requireApproval')} on={f.require_approval} onClick={() => set('require_approval', !f.require_approval)} />
        </div>
      </div>
      <div className="actionbar">
        <button className="btn primary block" disabled={busy} onClick={submit}>{t('publishTask')}</button>
      </div>
    </>
  );
}
```

Notes on this rewrite:
- The repeat-task branch is byte-for-byte the original component, plus a `<div className="seg">` tab row inserted right after `<div className="content">` (only rendered when `!editing`).
- `AdhocTaskForm` is a new sibling function in the same file, following the same field/state conventions as the rest of the page (`compressAndUploadImage` is already exported from `ui.jsx` and used the same way in `RecipeNew.jsx`).
- `api.createAdhocTask` body sends `task_date: f.due_date || undefined` so an empty date field lets the backend default to today (Task 1's `/^\d{4}-\d{2}-\d{2}$/.test(b.task_date || '')` check treats `undefined` as not matching, falling back to `todayYmd()`).

- [ ] **Step 2: Manual verification**

`cd web && npm run dev`, log in as employer, go to "新建任务". Confirm:
- A "重复任务 / 临时任务" tab shows at the top (only when creating, not when editing an existing template via `/task-new/:id`).
- Switching to "临时任务" shows the simplified form (no weekday picker).
- Uploading 2-3 photos shows thumbnails with a working remove (✕) button on each.
- Submitting without a task name shows the "请填写任务名称" toast and does not submit.
- Submitting with a name, area, and assignee navigates to `/e/tasks` and the new task appears in today's list (or on the chosen due date if set).

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/TaskNew.jsx
git commit -m "feat: TaskNew supports a one-off ad-hoc task with reference photos"
```

---

### Task 5: Frontend — split reference vs. completion photos on `TaskDetail`

**Files:**
- Modify: `web/src/pages/TaskDetail.jsx`

- [ ] **Step 1: Split the attachments by `file_type`**

Change:

```js
  const doneChecks = task.checklist.filter((c) => c.status === 'done').length;
  const allChecked = task.checklist.length === 0 || doneChecks === task.checklist.length;
  const hasPhoto = task.attachments.some((a) => a.file_type === 'image');
```

to:

```js
  const doneChecks = task.checklist.filter((c) => c.status === 'done').length;
  const allChecked = task.checklist.length === 0 || doneChecks === task.checklist.length;
  const hasPhoto = task.attachments.some((a) => a.file_type === 'image');
  const refPhotos = task.attachments.filter((a) => a.file_type === 'reference');
  const completionPhotos = task.attachments.filter((a) => a.file_type !== 'reference');
```

- [ ] **Step 2: Render reference photos as their own section**

Change:

```jsx
        {/* 附件 / 完成照片 */}
        <div className="section-title">📷 {t('attachments')} {task.require_photo && <span className="badge red tiny">{lang==='en'?'Required':'需照片'}</span>}</div>
        <div className="card">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {task.attachments.map((a) => <div key={a.attachment_id} className="thumb lg">{a.file_url}</div>)}
            {role === 'maid' && ['in_progress','returned','received'].includes(task.status) &&
              <button className="thumb lg" style={{ border: '1.5px dashed var(--line)', background: '#fff' }} onClick={fakeUpload}>＋</button>}
            {task.attachments.length === 0 && role !== 'maid' && <span className="muted small">{t('noData')}</span>}
          </div>
        </div>
```

to:

```jsx
        {/* 雇主发布时的参考图片（只读） */}
        {refPhotos.length > 0 && <>
          <div className="section-title">📎 {lang === 'en' ? 'Reference photos' : '参考图片'}</div>
          <div className="card">
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {refPhotos.map((a) => <img key={a.attachment_id} src={a.file_url} alt="" onClick={() => window.open(a.file_url)} className="thumb lg" style={{ objectFit: 'cover', cursor: 'zoom-in' }} />)}
            </div>
          </div>
        </>}

        {/* 完成照片 */}
        <div className="section-title">📷 {t('attachments')} {task.require_photo && <span className="badge red tiny">{lang==='en'?'Required':'需照片'}</span>}</div>
        <div className="card">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {completionPhotos.map((a) => <div key={a.attachment_id} className="thumb lg">{a.file_url}</div>)}
            {role === 'maid' && ['in_progress','returned','received'].includes(task.status) &&
              <button className="thumb lg" style={{ border: '1.5px dashed var(--line)', background: '#fff' }} onClick={fakeUpload}>＋</button>}
            {completionPhotos.length === 0 && role !== 'maid' && <span className="muted small">{t('noData')}</span>}
          </div>
        </div>
```

- [ ] **Step 3: Fix the "编辑任务" button for ad-hoc tasks**

The employer default-branch `Actions` currently always shows an "编辑任务" button that navigates to `/task-new/<template_id>`, falling back to the blank `/task-new` form when there's no template. Since ad-hoc tasks have no template to edit, that fallback is misleading now that `task_template_id` can legitimately be `null`. Change:

```js
  // 雇主
  const editTpl = () => nav(task.task_template_id ? '/task-new/' + task.task_template_id : '/task-new');
  if (s === 'pending_review') return <Bar>
    <B onClick={() => trans('returned', '退回重做')} danger>↩ {t('returnRedo')}</B>
    <B onClick={() => trans('done', '确认完成')} primary flex2>✓ {t('confirmDone')}</B>
  </Bar>;
  if (s === 'done') return <Bar><B onClick={() => nav('/task-new')}>＋ {t('newTask')}</B></Bar>;
  // 今日未完成（PRD §9）：雇主可标记为已完成 / 取消
  if (s === 'incomplete') return <Bar>
    <B onClick={() => trans('canceled', '取消任务')} danger>{t('cancelTask')}</B>
    <B onClick={() => trans('done', '标记为已完成')} primary flex2>✓ {t('markDone')}</B>
  </Bar>;
  return <Bar>
    <B onClick={() => trans('canceled', '取消任务')} danger>{t('cancelTask')}</B>
    <B onClick={editTpl} primary>✎ {t('editTask')}</B>
  </Bar>;
```

to:

```js
  // 雇主
  const editTpl = () => nav('/task-new/' + task.task_template_id);
  if (s === 'pending_review') return <Bar>
    <B onClick={() => trans('returned', '退回重做')} danger>↩ {t('returnRedo')}</B>
    <B onClick={() => trans('done', '确认完成')} primary flex2>✓ {t('confirmDone')}</B>
  </Bar>;
  if (s === 'done') return <Bar><B onClick={() => nav('/task-new')}>＋ {t('newTask')}</B></Bar>;
  // 今日未完成（PRD §9）：雇主可标记为已完成 / 取消
  if (s === 'incomplete') return <Bar>
    <B onClick={() => trans('canceled', '取消任务')} danger>{t('cancelTask')}</B>
    <B onClick={() => trans('done', '标记为已完成')} primary flex2>✓ {t('markDone')}</B>
  </Bar>;
  return <Bar>
    <B onClick={() => trans('canceled', '取消任务')} danger>{t('cancelTask')}</B>
    {task.task_template_id && <B onClick={editTpl} primary>✎ {t('editTask')}</B>}
  </Bar>;
```

(Only the final default-branch button is conditional now — ad-hoc tasks show just "取消任务"; template-backed tasks keep both buttons exactly as before.)

- [ ] **Step 4: Manual verification**

Open an ad-hoc task created in Task 4 as the employer: confirm a "参考图片" section shows the uploaded photos above the (empty) "完成照片"/attachments section, and the action bar at the bottom shows only "取消任务" (no "编辑任务"). Open a regular template-generated task and confirm both sections and both buttons still render exactly as before. As the maid, open the same ad-hoc task and confirm the reference photos show read-only and the "＋" upload button for completion photos still works (`fakeUpload`).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/TaskDetail.jsx
git commit -m "fix: split reference vs completion photos on task detail; hide edit button for ad-hoc tasks"
```

---

## Self-Review Notes

- **Spec coverage:** one-off creation without weekday picker (Task 4) ✓; multi-photo reference upload (Task 4) ✓; optional due date defaulting to today (Task 1 + Task 4) ✓; require_photo/require_approval toggles reused (Task 4) ✓; reuses `DailyTask`/`DailyTaskAttachment`, no schema change (Task 1) ✓; reference vs completion photo separation (Task 5) ✓.
- **Consistency check:** `reference_images` (frontend field name in Task 4's `createAdhocTask` call) matches `b.reference_images` read in Task 1's `POST /daily` handler; `file_type: 'reference'` string is identical on both the write (Task 1) and the read/filter (Task 5).
- **No placeholders:** `AdhocTaskForm` is fully implemented inline in Task 4, not deferred to "similar to the repeat form."
