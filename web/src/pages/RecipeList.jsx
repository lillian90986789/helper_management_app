import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { StatusBadge, fmtTime, Empty } from '../ui.jsx';

export default function RecipeList({ cooking }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [type, setType] = useState('all');
  const { data: recipes } = useAsync(() => api.recipes('all'));
  const { data: meals } = useAsync(() => api.meals());

  // 女佣“做饭”页：显示今日菜谱订单
  if (cooking) {
    return (
      <>
        <div className="topbar"><h1>{t('cooking')}</h1></div>
        <div className="content">
          <div className="section-title">🍽️ {t('todayMenu')}</div>
          {!meals ? <Empty text="加载中…" /> : meals.map((m) => (
            <div key={m.meal_order_id} className="card tap" onClick={() => nav('/meal/' + m.meal_order_id)}>
              <div className="row">
                <div className="thumb lg">{m.recipe.cover_image}</div>
                <div className="grow">
                  <div className="spread">
                    <span className="bold">{pick(lang, m.recipe.name, m.recipe.name_en)}</span>
                    {m.recipe.recipe_type === 'baby' && <span className="badge purple tiny">{t('baby')}</span>}
                  </div>
                  <div className="tiny muted mt4">{t(m.meal_type)} · {m.servings}{lang==='en'?' ppl':'人'} · ⏰{fmtTime(m.start_time)}</div>
                  <div className="mt8"><StatusBadge status={m.status} /></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  const list = (recipes || []).filter((r) => type === 'all' || r.recipe_type === type);
  return (
    <>
      <div className="topbar"><h1>{t('recipes')}</h1>
        <button className="iconbtn" onClick={() => nav('/recipe-new')} title={lang === 'en' ? 'New recipe' : '新建菜谱'}>＋</button>
      </div>
      <div style={{ position: 'sticky', top: 61, background: 'var(--bg)', zIndex: 20, padding: '10px 16px 6px' }}>
        <div className="chips">
          {[['all', t('all')], ['adult', t('adult')], ['baby', t('baby')]].map(([k, label]) => (
            <button key={k} className={'chip' + (type === k ? ' on' : '')} onClick={() => setType(k)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="content" style={{ paddingTop: 8 }}>
        {!recipes ? <Empty text="加载中…" /> : list.map((r) => (
          <div key={r.recipe_id} className="card tap" onClick={() => nav('/recipe/' + r.recipe_id)}>
            <div className="row">
              <div className="thumb lg">{r.cover_image}</div>
              <div className="grow">
                <div className="spread">
                  <span className="bold">{pick(lang, r.name, r.name_en)}</span>
                  <span>{r.favorite ? '⭐' : ''}</span>
                </div>
                <div className="tiny muted mt4">
                  ⏱ {r.duration}{t('min')} · 🍽 {r.servings}{lang==='en'?'':'份'} · 🥗 {r.ingredients.length}{lang==='en'?' items':'种食材'}
                </div>
                <div className="row mt8" style={{ gap: 6 }}>
                  <span className={'badge ' + (r.recipe_type === 'baby' ? 'purple' : 'teal') + ' tiny'}>{r.recipe_type === 'baby' ? t('baby') : t('adult')}</span>
                  <span className="badge gray tiny">{r.category}</span>
                  {r.suitable_age && <span className="badge blue tiny">{r.suitable_age}</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
