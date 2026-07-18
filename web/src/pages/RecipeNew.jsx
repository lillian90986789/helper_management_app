import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar, AvatarPicker, compressAndUploadImage } from '../ui.jsx';
import { useApp } from '../App.jsx';

const EMOJIS = ['🍲','🍅','🐟','🍚','🎃','🥦','🍗','🍜','🥘','🍳','🥗','🍤','🍛','🥟','🍠','🧆'];

export default function RecipeNew() {
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const nav = useNavigate();
  const { id } = useParams();          // 有 id = 编辑已有菜谱
  const editing = !!id;
  const { showToast } = useApp();
  const [f, setF] = useState({ name: '', recipe_type: 'adult', cover_image: '🍲', category: en ? 'Home cooking' : '家常菜',
    servings: 3, duration: 30, difficulty: 'normal', suitable_age: '', notes: '', video_url: '' });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [ings, setIngs] = useState([{ name: '', quantity: '', unit: '' }]);
  const [steps, setSteps] = useState([{ instruction: '' }]);
  const [busy, setBusy] = useState(false);

  // 编辑时回填
  useEffect(() => {
    if (!editing) return;
    api.recipe(id).then((r) => {
      setF({ name: r.name || '', recipe_type: r.recipe_type || 'adult', cover_image: r.cover_image || '🍲',
        category: r.category || (en ? 'Home cooking' : '家常菜'), servings: r.servings || 3, duration: r.duration || 30,
        difficulty: r.difficulty || 'normal', suitable_age: r.suitable_age || '', notes: r.notes || '', video_url: r.video_url || '' });
      setIngs(r.ingredients?.length ? r.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })) : [{ name: '', quantity: '', unit: '' }]);
      setSteps(r.steps?.length ? r.steps.map((s) => ({ instruction: s.instruction, image_url: s.image_url || '' })) : [{ instruction: '' }]);
    }).catch(() => showToast(en ? 'Load failed' : '加载失败'));
  }, [id]);

  // 步骤配图：客户端压缩后上传，写回该步骤的 image_url
  const onStepImage = async (e, i) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { const url = await compressAndUploadImage(file, { kind: 'recipe' }); setSteps((p) => p.map((x, j) => j === i ? { ...x, image_url: url } : x)); }
    catch { showToast(en ? 'Upload failed' : '上传失败'); }
    e.target.value = '';
  };

  const save = async () => {
    if (!f.name.trim()) return showToast(en ? 'Enter recipe name' : '请填写菜谱名称');
    setBusy(true);
    try {
      const body = {
        ...f, servings: +f.servings || 1, duration: +f.duration || 0,
        ingredients: ings.filter((i) => i.name.trim()).map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, required: true })),
        steps: steps.filter((s) => s.instruction.trim()).map((s) => ({ instruction: s.instruction, image_url: s.image_url || '' })),
      };
      const r = editing ? await api.updateRecipe(id, body) : await api.createRecipe(body);
      showToast(editing ? (en ? 'Saved ✓' : '已保存 ✓') : (en ? 'Recipe created ✓' : '菜谱已创建 ✓'));
      nav('/recipe/' + r.recipe_id, { replace: true });
    } catch { showToast(en ? 'Failed' : (editing ? '保存失败' : '创建失败')); setBusy(false); }
  };

  return (
    <>
      <TopBar title={editing ? (en ? 'Edit Recipe' : '编辑菜谱') : (en ? 'New Recipe' : '新建菜谱')} />
      <div className="content">
        <div className="field">
          <label>{en ? 'Cover' : '封面'} <span className="tiny muted">（{en ? 'pick an emoji or upload a photo' : '选表情或上传本地图片'}）</span></label>
          <AvatarPicker value={f.cover_image} onChange={(v) => set('cover_image', v)} emojis={EMOJIS} showToast={showToast} />
        </div>
        <div className="field">
          <label>{t('videoUrl')}</label>
          <input className="input" value={f.video_url} placeholder="https://youtube.com/watch?v=..." onChange={(e) => set('video_url', e.target.value)} />
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
            <div key={i} style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <span className="thumb" style={{ width: 26, height: 26, fontSize: 13, fontWeight: 800, flex: 'none' }}>{i + 1}</span>
                <textarea className="input" value={s.instruction} placeholder={en ? 'Step…' : '步骤说明…'} onChange={(e) => setSteps((p) => p.map((x, j) => j === i ? { ...x, instruction: e.target.value } : x))} />
                <button className="iconbtn" onClick={() => setSteps((p) => p.filter((_, j) => j !== i))}>✕</button>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 4, marginLeft: 32, alignItems: 'center' }}>
                {s.image_url && <img src={s.image_url} alt="" style={{ height: 56, borderRadius: 8 }} />}
                <label className="btn sm outline" style={{ cursor: 'pointer', flex: 'none' }}>
                  📷 {s.image_url ? (en ? 'Replace' : '换图') : (en ? 'Photo' : '加图')}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onStepImage(e, i)} />
                </label>
                {s.image_url && <button className="iconbtn" onClick={() => setSteps((p) => p.map((x, j) => j === i ? { ...x, image_url: '' } : x))}>🗑</button>}
              </div>
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
