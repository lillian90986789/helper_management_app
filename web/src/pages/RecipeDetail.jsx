import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function RecipeDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { role, showToast } = useApp();
  const { data: r, reload } = useAsync(() => api.recipe(id), [id]);
  if (!r) return <><TopBar title={t('recipes')} /><div className="empty">加载中…</div></>;

  const fav = async () => { await api.favorite(r.recipe_id); reload(); };

  return (
    <>
      <TopBar title={pick(lang, r.name, r.name_en)} right={<button className="iconbtn" onClick={fav}>{r.favorite ? '⭐' : '☆'}</button>} />
      <div className="content">
        {/* 封面 */}
        <div className="card" style={{ textAlign: 'center', padding: '26px' }}>
          <div style={{ fontSize: 70 }}>{r.cover_image}</div>
          <div className="bold mt8" style={{ fontSize: 20 }}>{pick(lang, r.name, r.name_en)}</div>
          <div className="row mt12" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={'badge ' + (r.recipe_type === 'baby' ? 'purple' : 'teal')}>{r.recipe_type === 'baby' ? t('baby') : t('adult')}</span>
            <span className="badge gray">⏱ {r.duration}{t('min')}</span>
            <span className="badge gray">🍽 {r.servings}{lang==='en'?' ppl':'人份'}</span>
            <span className="badge gray">📊 {t(r.difficulty)}</span>
          </div>
          {r.suitable_age && <div className="small muted mt8">👶 {lang==='en'?'Suitable age: ':'适合月龄：'}{r.suitable_age} · {r.notes}</div>}
        </div>

        {/* 食材 */}
        <div className="section-title">🥗 {t('ingredients')} <span className="muted">({r.ingredients.length})</span></div>
        <div className="card">
          {r.ingredients.map((ing) => (
            <div key={ing.ingredient_id} className="checkrow">
              <span className="grow">{pick(lang, ing.name, ing.name_en)} <span className="muted small">{ing.quantity}{ing.unit}</span></span>
              {ing.required
                ? <span className="badge teal tiny">{t('requiredIng')}</span>
                : <span className="badge gray tiny">{t('optionalIng')}</span>}
            </div>
          ))}
        </div>

        {/* 步骤 */}
        <div className="section-title">👩‍🍳 {t('steps')} <span className="muted">({r.steps.length})</span></div>
        <div className="card">
          {r.steps.map((s) => (
            <div key={s.step_id} className="row" style={{ alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--line)', gap: 12 }}>
              <div className="thumb" style={{ width: 30, height: 30, fontSize: 14, fontWeight: 800, color: 'var(--teal-d)' }}>{s.step_number}</div>
              <div className="grow">
                <div style={{ lineHeight: 1.6 }}>{pick(lang, s.instruction, s.instruction_en)}</div>
                <div className="tiny muted mt4">
                  {s.duration ? '⏱ ' + s.duration + t('min') : ''}{s.notes ? ' · ⚠️ ' + s.notes : ''}
                  {lang === 'en' && s.instruction_en && <span className="badge blue tiny" style={{ marginLeft: 6 }}>{t('autoTranslated')}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {role === 'maid'
        ? <div className="actionbar">
            <button className="btn outline" onClick={() => showToast(t('confirmRead') + ' ✓')}>{t('confirmRead')}</button>
            <button className="btn primary" style={{ flex: 2 }} onClick={() => showToast(t('addToCart') + ' ✓')}>🛒 {t('ingredientsShort')}</button>
          </div>
        : <div className="actionbar">
            <button className="btn outline" onClick={() => showToast(t('addToCart') + ' ✓')}>🛒 {t('addToCart')}</button>
            <button className="btn primary" style={{ flex: 2 }} onClick={() => showToast(t('arrangeToMenu') + ' ✓')}>📅 {t('arrangeToMenu')}</button>
          </div>}
    </>
  );
}
