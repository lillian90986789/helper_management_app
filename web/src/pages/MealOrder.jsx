import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, StatusBadge, fmtTime, CoverThumb } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function MealOrder() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { role, showToast } = useApp();
  const { data: m, reload } = useAsync(() => api.meal(id), [id]);
  if (!m) return <><TopBar title={t('mealOrder')} /><div className="empty">加载中…</div></>;

  const trans = async (to, msg, result_image) => { await api.mealTransition(m.meal_order_id, { to, result_image }); showToast(msg || '✓'); reload(); };
  const delMeal = async () => {
    if (!window.confirm(lang === 'en' ? 'Remove this dish from the menu?' : '从菜单删除这道菜？')) return;
    await api.deleteMeal(m.meal_order_id); showToast(lang === 'en' ? 'Removed' : '已删除'); nav(-1);
  };

  return (
    <>
      <TopBar title={t('mealOrder')} right={role !== 'maid' ? <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={delMeal} title={lang === 'en' ? 'Remove dish' : '删除菜品'}>🗑️</button> : undefined} />
      <div className="content">
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, display: 'flex', justifyContent: 'center' }}><CoverThumb value={m.recipe.cover_image} imgStyle={{ width: 84, height: 84, borderRadius: 18 }} /></div>
          <div className="bold mt8" style={{ fontSize: 19 }}>{pick(lang, m.recipe.name, m.recipe.name_en)}</div>
          <div className="mt8"><StatusBadge status={m.status} /></div>
          <div className="row mt12" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge gray">{t(m.meal_type)}</span>
            <span className="badge gray">🍽 {m.servings}{lang==='en'?' ppl':'人'}</span>
            <span className="badge gray">⏰ {fmtTime(m.start_time)}</span>
          </div>
          {m.notes && <div className="small muted mt8">📝 {m.notes}</div>}
        </div>

        {/* 食材清单 */}
        <div className="section-title">🥗 {t('ingredients')}</div>
        <div className="card">
          {m.recipe.ingredients.map((ing) => {
            const missing = m.status === 'ingredients_short' && !ing.required ? false : (m.status === 'ingredients_short' && ing.name.includes('鱼'));
            return (
              <div key={ing.ingredient_id} className="checkrow">
                <span className="grow">{pick(lang, ing.name, ing.name_en)} <span className="muted small">{ing.quantity}{ing.unit}</span></span>
                {missing ? <span className="badge red tiny">{t('missingIng')}</span> : <span className="badge green tiny">✓</span>}
              </div>
            );
          })}
        </div>

        {/* 完成照片 */}
        {(m.result_image || m.status === 'done') && <>
          <div className="section-title">📷 {t('resultPhoto')}</div>
          <div className="card"><div className="thumb lg"><CoverThumb value={m.result_image || m.recipe.cover_image} /></div></div>
        </>}

        {/* 步骤摘要 */}
        <div className="section-title">👩‍🍳 {t('steps')}</div>
        <div className="card">
          {m.recipe.steps.map((s) => (
            <div key={s.step_id} className="checkrow">
              <span className="thumb" style={{ width: 26, height: 26, fontSize: 13, fontWeight: 800 }}>{s.step_number}</span>
              <span className="grow small">{pick(lang, s.instruction, s.instruction_en)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 操作 */}
      {role === 'maid' ? <MaidActions m={m} t={t} trans={trans} /> :
        <div className="actionbar">
          {m.status === 'pending_review'
            ? <><button className="btn danger" onClick={() => trans('returned', t('returnMeal'))}>↩ {t('returnMeal')}</button>
                <button className="btn primary" style={{ flex: 2 }} onClick={() => trans('done', '✓')}>✓ {t('confirmMeal')}</button></>
            : <button className="btn outline block" onClick={() => nav(-1)}>{t('back')}</button>}
        </div>}
    </>
  );
}

function MaidActions({ m, t, trans }) {
  const s = m.status;
  if (s === 'to_receive' || s === 'received') return <div className="actionbar">
    <button className="btn danger" onClick={() => trans('ingredients_short', t('markMissing'))}>{t('ingredientsShort')}</button>
    <button className="btn primary" style={{ flex: 2 }} onClick={() => trans('ingredients_ready', t('ingredientsReady'))}>✓ {t('ingredientsReady')}</button>
  </div>;
  if (s === 'ingredients_ready' || s === 'to_start') return <div className="actionbar">
    <button className="btn primary block" onClick={() => trans('cooking', t('startCook'))}>▶ {t('startCook')}</button>
  </div>;
  if (s === 'ingredients_short') return <div className="actionbar">
    <button className="btn amber block" onClick={() => trans('ingredients_ready', t('ingredientsReady'))}>🛒 {t('addToCart')} → {t('ingredientsReady')}</button>
  </div>;
  if (s === 'cooking' || s === 'preparing') return <div className="actionbar">
    <button className="btn primary block" onClick={() => trans('pending_review', t('cookDone'), m.recipe.cover_image)}>📷 {t('uploadResult')} · {t('cookDone')}</button>
  </div>;
  return <div className="actionbar"><button className="btn outline block" disabled>{t('done')} ✓</button></div>;
}
