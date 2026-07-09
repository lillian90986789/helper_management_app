import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function RecipeDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const nav = useNavigate();
  const { role, showToast } = useApp();
  const { data: r, reload } = useAsync(() => api.recipe(id), [id]);
  const [pickMeal, setPickMeal] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!r) return <><TopBar title={t('recipes')} /><div className="empty">加载中…</div></>;

  const fav = async () => { await api.favorite(r.recipe_id); reload(); };
  // 真实：生成采购清单
  const toShopping = async () => {
    if (busy) return; setBusy(true);
    try { const l = await api.recipeToShopping(r.recipe_id); showToast(en ? 'Added to shopping list ✓' : '已生成采购清单 ✓'); nav('/shopping-list/' + l.shopping_list_id); }
    catch { showToast(en ? 'Failed' : '操作失败'); } setBusy(false);
  };
  // 真实：安排到今日菜单（选餐次）
  const toMeal = async (meal_type) => {
    if (busy) return; setBusy(true);
    try { await api.recipeToMeal(r.recipe_id, { meal_type }); setPickMeal(false); showToast(en ? 'Added to menu ✓' : '已安排到今日菜单 ✓'); nav('/e/home'); }
    catch { showToast(en ? 'Failed' : '操作失败'); } setBusy(false);
  };

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
            <button className="btn primary" style={{ flex: 2 }} disabled={busy} onClick={toShopping}>🛒 {t('addToCart')}</button>
          </div>
        : <div className="actionbar">
            <button className="btn outline" disabled={busy} onClick={toShopping}>🛒 {t('addToCart')}</button>
            <button className="btn primary" style={{ flex: 2 }} disabled={busy} onClick={() => setPickMeal(true)}>📅 {t('arrangeToMenu')}</button>
          </div>}

      {/* 安排到菜单：选餐次 */}
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
    </>
  );
}
