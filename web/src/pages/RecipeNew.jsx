import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

const EMOJIS = ['🍲','🍅','🐟','🍚','🎃','🥦','🍗','🍜','🥘','🍳','🥗','🍤','🍛','🥟','🍠','🧆'];

export default function RecipeNew() {
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const nav = useNavigate();
  const { showToast } = useApp();
  const [f, setF] = useState({ name: '', recipe_type: 'adult', cover_image: '🍲', category: en ? 'Home cooking' : '家常菜',
    servings: 3, duration: 30, difficulty: 'normal', suitable_age: '', notes: '' });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [ings, setIngs] = useState([{ name: '', quantity: '', unit: '' }]);
  const [steps, setSteps] = useState([{ instruction: '' }]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!f.name.trim()) return showToast(en ? 'Enter recipe name' : '请填写菜谱名称');
    setBusy(true);
    try {
      const r = await api.createRecipe({
        ...f, servings: +f.servings || 1, duration: +f.duration || 0,
        ingredients: ings.filter((i) => i.name.trim()).map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, required: true })),
        steps: steps.filter((s) => s.instruction.trim()).map((s) => ({ instruction: s.instruction })),
      });
      showToast(en ? 'Recipe created ✓' : '菜谱已创建 ✓');
      nav('/recipe/' + r.recipe_id, { replace: true });
    } catch { showToast(en ? 'Failed' : '创建失败'); setBusy(false); }
  };

  return (
    <>
      <TopBar title={en ? 'New Recipe' : '新建菜谱'} />
      <div className="content">
        <div className="field">
          <label>{en ? 'Cover' : '封面'}</label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {EMOJIS.map((e) => <button key={e} className={'thumb' + (f.cover_image === e ? '' : '')} style={{ outline: f.cover_image === e ? '2.5px solid var(--teal)' : 'none' }} onClick={() => set('cover_image', e)}>{e}</button>)}
          </div>
        </div>
        <div className="field">
          <label>{en ? 'Recipe name' : '菜谱名称'} <span className="req">*</span></label>
          <input className="input" value={f.name} placeholder={en ? 'e.g. Tomato & Eggs' : '例如：番茄炒蛋'} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('recipeType')}</label>
          <div className="seg">
            <button className={'opt' + (f.recipe_type === 'adult' ? ' on' : '')} onClick={() => set('recipe_type', 'adult')}>{t('adult')}</button>
            <button className={'opt' + (f.recipe_type === 'baby' ? ' on' : '')} onClick={() => set('recipe_type', 'baby')}>{t('baby')}</button>
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field grow"><label>{t('servings')}</label><input className="input" type="number" value={f.servings} onChange={(e) => set('servings', e.target.value)} /></div>
          <div className="field grow"><label>{t('duration')} ({t('min')})</label><input className="input" type="number" value={f.duration} onChange={(e) => set('duration', e.target.value)} /></div>
        </div>
        <div className="field">
          <label>{t('difficulty')}</label>
          <div className="seg">
            {[['easy', t('easy')], ['normal', t('normal')], ['hard', t('hard')]].map(([k, l]) => (
              <button key={k} className={'opt' + (f.difficulty === k ? ' on' : '')} onClick={() => set('difficulty', k)}>{l}</button>
            ))}
          </div>
        </div>
        {f.recipe_type === 'baby' && (
          <div className="field"><label>{en ? 'Suitable age' : '适合月龄'}</label>
            <input className="input" value={f.suitable_age} placeholder={en ? 'e.g. 7 months+' : '例如：7个月+'} onChange={(e) => set('suitable_age', e.target.value)} /></div>
        )}

        {/* 食材 */}
        <div className="section-title">🥗 {t('ingredients')}</div>
        <div className="card">
          {ings.map((it, i) => (
            <div key={i} className="row" style={{ gap: 6, marginBottom: 8 }}>
              <input className="input" style={{ flex: 2 }} value={it.name} placeholder={en ? 'Name' : '食材'} onChange={(e) => setIngs((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <input className="input" style={{ flex: 1 }} value={it.quantity} placeholder={en ? 'Qty' : '数量'} onChange={(e) => setIngs((p) => p.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
              <input className="input" style={{ flex: 1 }} value={it.unit} placeholder={en ? 'Unit' : '单位'} onChange={(e) => setIngs((p) => p.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
              <button className="iconbtn" onClick={() => setIngs((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn sm outline block" onClick={() => setIngs((p) => [...p, { name: '', quantity: '', unit: '' }])}>＋ {t('ingredients')}</button>
        </div>

        {/* 步骤 */}
        <div className="section-title">👩‍🍳 {t('steps')}</div>
        <div className="card">
          {steps.map((s, i) => (
            <div key={i} className="row" style={{ gap: 6, marginBottom: 8, alignItems: 'flex-start' }}>
              <span className="thumb" style={{ width: 26, height: 26, fontSize: 13, fontWeight: 800, flex: 'none' }}>{i + 1}</span>
              <textarea className="input" value={s.instruction} placeholder={en ? 'Step…' : '步骤说明…'} onChange={(e) => setSteps((p) => p.map((x, j) => j === i ? { ...x, instruction: e.target.value } : x))} />
              <button className="iconbtn" onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn sm outline block" onClick={() => setSteps((p) => [...p, { instruction: '' }])}>＋ {t('steps')}</button>
        </div>
      </div>

      <div className="actionbar">
        <button className="btn outline" onClick={() => nav(-1)}>{t('cancel')}</button>
        <button className="btn primary" style={{ flex: 2 }} disabled={busy} onClick={save}>{t('save')}</button>
      </div>
    </>
  );
}
