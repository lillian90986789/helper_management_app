# Recipe YouTube Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recipe carry one optional video-tutorial link (e.g. a YouTube URL), editable from the recipe form and openable from the recipe detail page.

**Architecture:** Add one nullable `video_url` column to `Recipe` via the existing idempotent `addCol` migration helper in `db.js`. Thread it through the existing recipe create/update handlers (both already accept a flat body and use `INSERT`/`UPDATE ... COALESCE` patterns — `video_url` slots in the same way as `notes`). On the frontend, add one input to `RecipeNew` and one conditional button to `RecipeDetail`.

**Tech Stack:** Node/Express + better-sqlite3 (server), React 18 + Vite. No test framework is configured in this repo — verification below is manual QA against the running dev app.

**Spec:** `docs/superpowers/specs/2026-07-17-recipe-youtube-link-design.md`

---

### Task 1: Backend — schema + create/update handlers

**Files:**
- Modify: `server/db.js:417-418` (add migration column next to the other `Area`/`DailyTask` `addCol` calls)
- Modify: `server/index.js:1192-1206` (`POST /recipes`)
- Modify: `server/index.js:1208-1236` (`PATCH /recipes/:id`)

- [ ] **Step 1: Add the column migration**

In `server/db.js`, change:

```js
// Area → 对应 PRD FamilyArea
addCol('Area', 'sort_order', 'INTEGER DEFAULT 0');
addCol('Area', 'status', "TEXT DEFAULT 'active'");
```

to:

```js
// Area → 对应 PRD FamilyArea
addCol('Area', 'sort_order', 'INTEGER DEFAULT 0');
addCol('Area', 'status', "TEXT DEFAULT 'active'");
// Recipe → 菜谱整体可选挂一个视频教程链接（YouTube 或其他视频站点，不做格式校验）
addCol('Recipe', 'video_url', 'TEXT');
```

- [ ] **Step 2: Include `video_url` on create**

In `server/index.js`, change the `POST /recipes` handler:

```js
api.post('/recipes', (req, res) => {
  const family = curFamily(req);
  const b = req.body;
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name_required' });
  const id = db.prepare(`INSERT INTO Recipe (family_id,name,name_en,recipe_type,category,cover_image,servings,duration,difficulty,suitable_age,allergen_info,notes,status,creator_id)
    VALUES (@family_id,@name,@name_en,@recipe_type,@category,@cover_image,@servings,@duration,@difficulty,@suitable_age,@allergen_info,@notes,'published',1)`)
    .run({ family_id: family.family_id, name: b.name.trim(), name_en: b.name_en || '', recipe_type: b.recipe_type === 'baby' ? 'baby' : 'adult',
      category: b.category || '家常菜', cover_image: b.cover_image || '🍲', servings: b.servings || 2, duration: b.duration || 30,
      difficulty: ['easy','normal','hard'].includes(b.difficulty) ? b.difficulty : 'normal', suitable_age: b.suitable_age || '', allergen_info: b.allergen_info || '', notes: b.notes || '' }).lastInsertRowid;
```

to:

```js
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
```

(The rest of the handler — ingredients/steps inserts and the final `res.json(recipeWith(...))` — is unchanged.)

- [ ] **Step 3: Include `video_url` on update**

Change the `PATCH /recipes/:id` handler's `UPDATE` statement:

```js
    db.prepare(`UPDATE Recipe SET name=COALESCE(@name,name), name_en=COALESCE(@name_en,name_en), recipe_type=COALESCE(@recipe_type,recipe_type),
        category=COALESCE(@category,category), cover_image=COALESCE(@cover_image,cover_image), servings=COALESCE(@servings,servings),
        duration=COALESCE(@duration,duration), difficulty=COALESCE(@difficulty,difficulty), suitable_age=COALESCE(@suitable_age,suitable_age),
        notes=COALESCE(@notes,notes) WHERE recipe_id=@id`)
      .run({ name: b.name !== undefined ? String(b.name).trim() : null, name_en: b.name_en ?? null,
        recipe_type: b.recipe_type ? (b.recipe_type === 'baby' ? 'baby' : 'adult') : null,
        category: b.category ?? null, cover_image: b.cover_image ?? null, servings: b.servings ?? null, duration: b.duration ?? null,
        difficulty: ['easy','normal','hard'].includes(b.difficulty) ? b.difficulty : null, suitable_age: b.suitable_age ?? null,
        notes: b.notes ?? null, id: r.recipe_id });
```

to:

```js
    db.prepare(`UPDATE Recipe SET name=COALESCE(@name,name), name_en=COALESCE(@name_en,name_en), recipe_type=COALESCE(@recipe_type,recipe_type),
        category=COALESCE(@category,category), cover_image=COALESCE(@cover_image,cover_image), servings=COALESCE(@servings,servings),
        duration=COALESCE(@duration,duration), difficulty=COALESCE(@difficulty,difficulty), suitable_age=COALESCE(@suitable_age,suitable_age),
        notes=COALESCE(@notes,notes), video_url=CASE WHEN @has_video_url THEN @video_url ELSE video_url END WHERE recipe_id=@id`)
      .run({ name: b.name !== undefined ? String(b.name).trim() : null, name_en: b.name_en ?? null,
        recipe_type: b.recipe_type ? (b.recipe_type === 'baby' ? 'baby' : 'adult') : null,
        category: b.category ?? null, cover_image: b.cover_image ?? null, servings: b.servings ?? null, duration: b.duration ?? null,
        difficulty: ['easy','normal','hard'].includes(b.difficulty) ? b.difficulty : null, suitable_age: b.suitable_age ?? null,
        notes: b.notes ?? null, has_video_url: b.video_url !== undefined ? 1 : 0, video_url: b.video_url || null, id: r.recipe_id });
```

Note: this field needs a `CASE WHEN @has_video_url` guard instead of the simpler `COALESCE(@video_url,video_url)` pattern used for the other columns, because `COALESCE` can't distinguish "clear the link back to empty" (`b.video_url === ''`) from "field not sent" (`b.video_url === undefined`) — both would otherwise pass `null`/falsy through to `@video_url` and `COALESCE` would keep the old value either way, making it impossible to ever clear a previously-set link. The `has_video_url` flag makes "field omitted from the request" and "field explicitly cleared to empty" behave differently, matching how every other edit form in this app (e.g. `RecipeNew`) always sends the full field set on save.

- [ ] **Step 4: Manual verification**

Restart the backend (`npm start` — this re-runs `db.js`'s `addCol` migrations, which are idempotent so this is safe on an existing `data/homeflow.db`). Log in as employer, in devtools console:

```js
const tok = JSON.parse(localStorage.getItem('hf_employer')).token;
fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': tok },
  body: JSON.stringify({ name: '测试菜谱', video_url: 'https://youtube.com/watch?v=abc123' }) }).then(r => r.json()).then(console.log)
```

Expected: response includes `"video_url":"https://youtube.com/watch?v=abc123"`. Then `GET /api/recipes/<that id>` (or reload the recipe list in the browser) and confirm `video_url` persists. Then `PATCH` the same recipe with `{ video_url: '' }` and confirm it comes back `null`/empty (verifies the clear-the-link path), and `PATCH` with a body that omits `video_url` entirely and confirm the previously-set value is preserved.

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/index.js
git commit -m "feat: recipes can store an optional video tutorial link"
```

---

### Task 2: Frontend — i18n keys

**Files:**
- Modify: `web/src/i18n.jsx` (zh dict around line 53-54, en dict around line ~180)

- [ ] **Step 1: Add keys to the `zh` dict**

Change:

```js
    recipeType: '类型', ingredients: '食材', steps: '烹饪步骤', servings: '份数', duration: '制作时间', difficulty: '难度', easy: '简单', hard: '复杂',
    addToCart: '加入采购清单', arrangeToMenu: '安排到菜单', favorite: '收藏', requiredIng: '必需', optionalIng: '可选',
```

to:

```js
    recipeType: '类型', ingredients: '食材', steps: '烹饪步骤', servings: '份数', duration: '制作时间', difficulty: '难度', easy: '简单', hard: '复杂',
    addToCart: '加入采购清单', arrangeToMenu: '安排到菜单', favorite: '收藏', requiredIng: '必需', optionalIng: '可选',
    videoUrl: '视频教程链接', watchVideo: '观看视频教程',
```

- [ ] **Step 2: Add the same keys to the `en` dict**

Change:

```js
    recipeType: 'Type', ingredients: 'Ingredients', steps: 'Steps', servings: 'Servings', duration: 'Duration', difficulty: 'Difficulty', easy: 'Easy', hard: 'Hard',
    addToCart: 'Add to Shopping List', arrangeToMenu: 'Add to Menu', favorite: 'Favorite', requiredIng: 'Required', optionalIng: 'Optional',
```

to:

```js
    recipeType: 'Type', ingredients: 'Ingredients', steps: 'Steps', servings: 'Servings', duration: 'Duration', difficulty: 'Difficulty', easy: 'Easy', hard: 'Hard',
    addToCart: 'Add to Shopping List', arrangeToMenu: 'Add to Menu', favorite: 'Favorite', requiredIng: 'Required', optionalIng: 'Optional',
    videoUrl: 'Video tutorial link', watchVideo: 'Watch video tutorial',
```

(`id`/`my` intentionally left untouched — falls back to `en` per the existing `t()` fallback behavior.)

- [ ] **Step 3: Manual verification**

`cd web && npm run dev`, confirm no compile errors in the terminal.

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n.jsx
git commit -m "feat: add i18n keys for recipe video link"
```

---

### Task 3: Frontend — input field on `RecipeNew`

**Files:**
- Modify: `web/src/pages/RecipeNew.jsx`

- [ ] **Step 1: Add `video_url` to initial state**

Change:

```js
  const [f, setF] = useState({ name: '', recipe_type: 'adult', cover_image: '🍲', category: en ? 'Home cooking' : '家常菜',
    servings: 3, duration: 30, difficulty: 'normal', suitable_age: '', notes: '' });
```

to:

```js
  const [f, setF] = useState({ name: '', recipe_type: 'adult', cover_image: '🍲', category: en ? 'Home cooking' : '家常菜',
    servings: 3, duration: 30, difficulty: 'normal', suitable_age: '', notes: '', video_url: '' });
```

- [ ] **Step 2: Fill it in when editing**

Change:

```js
    api.recipe(id).then((r) => {
      setF({ name: r.name || '', recipe_type: r.recipe_type || 'adult', cover_image: r.cover_image || '🍲',
        category: r.category || (en ? 'Home cooking' : '家常菜'), servings: r.servings || 3, duration: r.duration || 30,
        difficulty: r.difficulty || 'normal', suitable_age: r.suitable_age || '', notes: r.notes || '' });
```

to:

```js
    api.recipe(id).then((r) => {
      setF({ name: r.name || '', recipe_type: r.recipe_type || 'adult', cover_image: r.cover_image || '🍲',
        category: r.category || (en ? 'Home cooking' : '家常菜'), servings: r.servings || 3, duration: r.duration || 30,
        difficulty: r.difficulty || 'normal', suitable_age: r.suitable_age || '', notes: r.notes || '', video_url: r.video_url || '' });
```

- [ ] **Step 3: Add the input field**

`save()` already spreads `...f` into the request body (`const body = { ...f, servings: +f.servings || 1, ... }`), so `video_url` reaches the API automatically once it's in `f` — no change needed there. Add the field in the JSX, right after the "封面" field:

```jsx
        <div className="field">
          <label>{en ? 'Cover' : '封面'} <span className="tiny muted">（{en ? 'pick an emoji or upload a photo' : '选表情或上传本地图片'}）</span></label>
          <AvatarPicker value={f.cover_image} onChange={(v) => set('cover_image', v)} emojis={EMOJIS} showToast={showToast} />
        </div>
```

to:

```jsx
        <div className="field">
          <label>{en ? 'Cover' : '封面'} <span className="tiny muted">（{en ? 'pick an emoji or upload a photo' : '选表情或上传本地图片'}）</span></label>
          <AvatarPicker value={f.cover_image} onChange={(v) => set('cover_image', v)} emojis={EMOJIS} showToast={showToast} />
        </div>
        <div className="field">
          <label>{t('videoUrl')}</label>
          <input className="input" value={f.video_url} placeholder="https://youtube.com/watch?v=..." onChange={(e) => set('video_url', e.target.value)} />
        </div>
```

(`t` is already imported and used elsewhere in this file via `useI18n()`.)

- [ ] **Step 4: Manual verification**

`cd web && npm run dev`, log in as employer, create a new recipe with a video link filled in (any URL, e.g. a plain non-YouTube string like `notaurl`), save, and confirm no validation error blocks the save (per the design's non-goal: no format validation). Reopen the recipe for editing and confirm the link field shows the previously-saved value. Clear the field and save again, reopen, confirm it's now empty.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/RecipeNew.jsx
git commit -m "feat: recipe form has an optional video tutorial link field"
```

---

### Task 4: Frontend — "watch video" button on `RecipeDetail`

**Files:**
- Modify: `web/src/pages/RecipeDetail.jsx`

- [ ] **Step 1: Add the button to the cover card**

Change:

```jsx
        {/* 封面 */}
        <div className="card" style={{ textAlign: 'center', padding: '26px' }}>
          <div style={{ fontSize: 70 }}><CoverThumb value={r.cover_image} imgStyle={{ width: 96, height: 96, borderRadius: 18 }} /></div>
          <div className="bold mt8" style={{ fontSize: 20 }}>{pick(lang, r.name, r.name_en)}</div>
          <div className="row mt12" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={'badge ' + (r.recipe_type === 'baby' ? 'purple' : 'teal')}>{r.recipe_type === 'baby' ? t('baby') : t('adult')}</span>
            <span className="badge gray">⏱ {r.duration}{t('min')}</span>
            <span className="badge gray">🍽 {r.servings}{lang==='en'?' ppl':'人份'}</span>
            <span className="badge gray">📊 {t(r.difficulty)}</span>
          </div>
          {r.suitable_age && <div className="small muted mt8">👶 {lang==='en'?'Suitable age: ':'适合月龄：'}{r.suitable_age} · {r.notes}</div>}
        </div>
```

to:

```jsx
        {/* 封面 */}
        <div className="card" style={{ textAlign: 'center', padding: '26px' }}>
          <div style={{ fontSize: 70 }}><CoverThumb value={r.cover_image} imgStyle={{ width: 96, height: 96, borderRadius: 18 }} /></div>
          <div className="bold mt8" style={{ fontSize: 20 }}>{pick(lang, r.name, r.name_en)}</div>
          <div className="row mt12" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={'badge ' + (r.recipe_type === 'baby' ? 'purple' : 'teal')}>{r.recipe_type === 'baby' ? t('baby') : t('adult')}</span>
            <span className="badge gray">⏱ {r.duration}{t('min')}</span>
            <span className="badge gray">🍽 {r.servings}{lang==='en'?' ppl':'人份'}</span>
            <span className="badge gray">📊 {t(r.difficulty)}</span>
          </div>
          {r.suitable_age && <div className="small muted mt8">👶 {lang==='en'?'Suitable age: ':'适合月龄：'}{r.suitable_age} · {r.notes}</div>}
          {r.video_url && <button className="btn sm outline mt12" onClick={() => window.open(r.video_url, '_blank', 'noopener,noreferrer')}>▶️ {t('watchVideo')}</button>}
        </div>
```

- [ ] **Step 2: Manual verification**

Open a recipe with a `video_url` set (from Task 3) — confirm the "▶️ 观看视频教程" button shows and clicking it opens the link in a new tab. Open a recipe with no `video_url` (any recipe not yet edited) and confirm no button renders (no empty/dead button).

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/RecipeDetail.jsx
git commit -m "feat: recipe detail shows a watch-video button when a link is set"
```

---

## Self-Review Notes

- **Spec coverage:** single recipe-level link, no per-step nesting (Task 1 adds one column, not touching `RecipeStep`) ✓; no format validation anywhere in create/update/display (Task 1/3/4) ✓; button hidden when empty (Task 4) ✓; old recipes with `NULL` `video_url` render fine (Task 4's `r.video_url &&` guard, Task 3's `r.video_url || ''` fallback) ✓.
- **Consistency check:** the field is named `video_url` identically in the DB column (Task 1), the API body (Task 1 handlers), the form state (Task 3), and the detail page read (Task 4) — no naming drift.
