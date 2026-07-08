import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, StatusBadge } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function SubstituteReview() {
  const { itemId } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { role, showToast } = useApp();
  const [item, setItem] = useState(null);
  // 女佣申请表单
  const [form, setForm] = useState({ sub_name: '', sub_brand: '', sub_spec: '', sub_price: '', sub_reason: '' });

  const load = () => api.shoppingLists().then((lists) => {
    for (const l of lists) { const it = l.items.find((x) => String(x.shopping_item_id) === String(itemId)); if (it) { setItem(it); return; } }
  });
  useEffect(() => { load(); }, [itemId]);
  if (!item) return <><TopBar title={t('subReview')} /><div className="empty">加载中…</div></>;

  // 女佣端：提交替代申请
  const isApply = role === 'maid' && item.status !== 'sub_requested';
  const submitApply = async () => {
    if (!form.sub_name) return showToast(lang === 'en' ? 'Enter substitute name' : '请填写替代商品');
    await fetch('/api/items/' + itemId + '/substitute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, sub_price: +form.sub_price || 0 }) });
    showToast(t('submit') + ' ✓');
    nav(-1);
  };
  const review = async (approve) => { await api.reviewSub(itemId, approve); showToast(approve ? t('approve') + ' ✓' : t('reject') + ' ✓'); nav(-1); };

  return (
    <>
      <TopBar title={isApply ? t('applySub') : t('subReview')} />
      <div className="content">
        {/* 原商品 */}
        <div className="section-title">📦 {t('origItem')}</div>
        <div className="card">
          <div className="row">
            <div className="thumb">{item.image_url}</div>
            <div className="grow">
              <div className="bold">{pick(lang, item.name, item.name_en)}</div>
              <div className="tiny muted">{item.quantity}{item.unit}{item.brand ? ' · ' + item.brand : ''} · {lang==='en'?'Est. ':'预计 '}S${(item.estimated_price||0).toFixed(2)}</div>
            </div>
            <StatusBadge status={item.status} />
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 24, margin: '6px 0' }}>↓</div>

        {/* 替代商品 */}
        <div className="section-title">🔄 {t('subItem')}</div>
        {isApply ? (
          <div className="card">
            <Field label={t('subItem')} req v={form.sub_name} on={(v) => setForm((p) => ({ ...p, sub_name: v }))} ph={lang === 'en' ? 'e.g. Light Soy Sauce' : '例如：生抽'} />
            <Field label={t('subBrand')} v={form.sub_brand} on={(v) => setForm((p) => ({ ...p, sub_brand: v }))} />
            <Field label={t('subSpec')} v={form.sub_spec} on={(v) => setForm((p) => ({ ...p, sub_spec: v }))} />
            <Field label={t('subPrice')} v={form.sub_price} on={(v) => setForm((p) => ({ ...p, sub_price: v }))} type="number" prefix="S$" />
            <div className="field" style={{ margin: 0 }}>
              <label>{t('subReason')}</label>
              <textarea className="input" value={form.sub_reason} onChange={(e) => setForm((p) => ({ ...p, sub_reason: e.target.value }))} />
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="row">
              <div className="thumb" style={{ background: '#fef3c7' }}>🔄</div>
              <div className="grow">
                <div className="bold">{item.sub_name} {item.sub_brand && <span className="muted small">· {item.sub_brand}</span>}</div>
                <div className="tiny muted">{item.sub_spec} · S${(item.sub_price || 0).toFixed(2)}</div>
              </div>
            </div>
            <div className="mt12" style={{ background: 'var(--bg)', borderRadius: 12, padding: 12 }}>
              <div className="tiny muted">{t('subReason')}</div>
              <div className="small mt4">{item.sub_reason}</div>
            </div>
            {/* 差价提示 */}
            <div className="spread mt12">
              <span className="small muted">{lang === 'en' ? 'Price diff' : '差价'}</span>
              <span className="bold" style={{ color: (item.sub_price - item.estimated_price) > 0 ? 'var(--red)' : 'var(--green)' }}>
                {(item.sub_price - item.estimated_price) >= 0 ? '+' : ''}S${(item.sub_price - item.estimated_price).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>

      {isApply
        ? <div className="actionbar"><button className="btn outline" onClick={() => nav(-1)}>{t('cancel')}</button><button className="btn primary" style={{ flex: 2 }} onClick={submitApply}>{t('submit')}</button></div>
        : role === 'employer' && item.status === 'sub_requested'
          ? <div className="actionbar">
              <button className="btn danger" onClick={() => review(false)}>✕ {t('reject')}</button>
              <button className="btn primary" style={{ flex: 2 }} onClick={() => review(true)}>✓ {t('approve')}</button>
            </div>
          : <div className="actionbar"><button className="btn outline block" onClick={() => nav(-1)}>{t('back')}</button></div>}
    </>
  );
}

function Field({ label, v, on, req, ph, type, prefix }) {
  return (
    <div className="field">
      <label>{label} {req && <span className="req">*</span>}</label>
      <div className="row" style={{ gap: 4 }}>
        {prefix && <span className="muted">{prefix}</span>}
        <input className="input" type={type || 'text'} value={v} placeholder={ph} onChange={(e) => on(e.target.value)} />
      </div>
    </div>
  );
}
