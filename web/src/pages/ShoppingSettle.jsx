import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function ShoppingSettle() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { role, showToast } = useApp();
  const [list, setList] = useState(null);
  const [rows, setRows] = useState({}); // itemId -> {qty, price, discount}
  const [otherFee, setOtherFee] = useState(0);
  const [receipt, setReceipt] = useState('');

  useEffect(() => {
    api.shopping(id).then((l) => {
      setList(l);
      const r = {};
      l.items.forEach((it) => { r[it.shopping_item_id] = {
        qty: it.actual_quantity ?? it.quantity, price: it.actual_unit_price ?? it.estimated_price ?? 0, discount: it.discount ?? 0,
        oos: it.status === 'out_of_stock' };
      });
      setRows(r);
      setOtherFee(l.other_fee || 0);
      setReceipt(l.receipt_image || '');
    });
  }, [id]);
  if (!list) return <><TopBar title={t('settle')} /><div className="empty">加载中…</div></>;

  const setRow = (iid, k, v) => setRows((p) => ({ ...p, [iid]: { ...p[iid], [k]: v } }));
  const lineTotal = (iid) => { const r = rows[iid]; if (!r || r.oos) return 0; return Math.max(0, (+r.qty || 0) * (+r.price || 0) - (+r.discount || 0)); };
  const grand = list.items.reduce((s, it) => s + lineTotal(it.shopping_item_id), 0) + (+otherFee || 0);
  const over = grand > list.budget;

  const submit = async () => {
    for (const it of list.items) {
      const r = rows[it.shopping_item_id];
      if (r.oos) continue;
      await api.patchItem(it.shopping_item_id, { status: 'bought', actual_quantity: +r.qty, actual_unit_price: +r.price, discount: +r.discount });
    }
    // 持久化小票、其他费用、付款方式
    await api.patchList(list.shopping_list_id, { other_fee: +otherFee || 0, receipt_image: receipt || null, payment_method: receipt ? (lang === 'en' ? 'PayNow' : '微信/PayNow') : null });
    await api.shoppingTransition(list.shopping_list_id, { to: 'pending_confirm' });
    showToast(t('submitPurchase') + ' ✓');
    nav('/shopping-list/' + list.shopping_list_id, { replace: true });
  };

  return (
    <>
      <TopBar title={t('settle')} />
      <div className="content">
        {list.items.map((it) => {
          const r = rows[it.shopping_item_id] || {};
          return (
            <div key={it.shopping_item_id} className="card">
              <div className="row">
                <div className="thumb">{it.image_url}</div>
                <div className="grow">
                  <div className="bold">{pick(lang, it.name, it.name_en)}</div>
                  <div className="tiny muted">{lang==='en'?'Est. ':'预计 '}S${(it.estimated_price||0).toFixed(2)} · {lang==='en'?'Budget ':'预算 '}S${it.budget_limit||'-'}</div>
                </div>
                <div className={'switch' + (r.oos ? '' : ' on')} onClick={() => setRow(it.shopping_item_id, 'oos', !r.oos)}><i /></div>
              </div>
              {r.oos ? <div className="small muted mt8">🚫 {t('outOfStock')}</div> : (
                <>
                  <div className="row mt12" style={{ gap: 8 }}>
                    <Num label={t('actualQty')} value={r.qty} onChange={(v) => setRow(it.shopping_item_id, 'qty', v)} suffix={it.unit} />
                    <Num label={t('actualPrice')} value={r.price} onChange={(v) => setRow(it.shopping_item_id, 'price', v)} prefix="S$" step="0.1" />
                    <Num label={t('discount')} value={r.discount} onChange={(v) => setRow(it.shopping_item_id, 'discount', v)} prefix="S$" step="0.1" />
                  </div>
                  <div className="spread mt8">
                    <span className="small muted">{t('actualTotal')}</span>
                    <span className="bold" style={{ color: 'var(--teal)' }}>S${lineTotal(it.shopping_item_id).toFixed(2)}</span>
                  </div>
                  {it.budget_limit > 0 && lineTotal(it.shopping_item_id) > it.budget_limit &&
                    <div className="tiny" style={{ color: 'var(--red)', marginTop: 4 }}>⚠️ {t('overBudget')}</div>}
                </>
              )}
            </div>
          );
        })}

        <div className="card">
          <div className="field" style={{ margin: 0 }}>
            <label>{t('otherFee')}</label>
            <input className="input" type="number" step="0.1" value={otherFee} onChange={(e) => setOtherFee(e.target.value)} />
          </div>
        </div>

        <div className="card">
          <div className="spread"><span className="muted">{t('estTotal')}</span><span>S${list.est_total.toFixed(2)}</span></div>
          <div className="spread mt8"><span className="bold">{t('actualTotal')}</span><span className="bold" style={{ fontSize: 20, color: over ? 'var(--red)' : 'var(--teal)' }}>S${grand.toFixed(2)}</span></div>
          <div className="spread mt8"><span className="muted">{t('budget')}</span><span>S${list.budget}</span></div>
          {over && <div style={{ background: '#fee2e2', color: '#b91c1c', marginTop: 10, padding: 12, borderRadius: 12, fontSize: 13 }}>
            ⚠️ {lang === 'en' ? 'Total exceeds budget. Please confirm with employer.' : '总额超出预算，建议联系雇主确认。'}
          </div>}
        </div>
        {/* 小票上传 */}
        {receipt
          ? <div className="card">
              <div className="row">
                <div className="thumb lg">{receipt}</div>
                <div className="grow"><div className="bold small">{t('receiptUploaded')} ✓</div><div className="tiny muted">{lang === 'en' ? 'Tap to retake' : '点击可重拍'}</div></div>
                <button className="btn sm outline" onClick={() => setReceipt('')}>{t('cancel')}</button>
              </div>
            </div>
          : <div className="uploadbox" onClick={() => setReceipt('🧾')} style={{ cursor: 'pointer' }}>🧾 {t('uploadReceipt')}</div>}
      </div>

      <div className="actionbar">
        <button className="btn outline" onClick={() => nav(-1)}>{t('saveDraft')}</button>
        <button className="btn primary" style={{ flex: 2 }} onClick={submit}>{t('submitPurchase')} · S${grand.toFixed(2)}</button>
      </div>
    </>
  );
}

function Num({ label, value, onChange, prefix, suffix, step }) {
  return (
    <div className="grow">
      <div className="tiny muted" style={{ marginBottom: 4 }}>{label}</div>
      <div className="row" style={{ gap: 2 }}>
        {prefix && <span className="tiny muted">{prefix}</span>}
        <input className="input" style={{ padding: '8px 8px' }} type="number" step={step || '1'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="tiny muted">{suffix}</span>}
      </div>
    </div>
  );
}
