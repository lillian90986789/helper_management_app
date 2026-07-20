import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, CategoryPicker, catLabel, ReceiptCompare } from '../ui.jsx';
import { useApp } from '../App.jsx';

const TOL = 0.05; // 允许误差 ±0.05（第 8.3 节）

export default function ShoppingSettle() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const nav = useNavigate();
  const { showToast } = useApp();
  const [list, setList] = useState(null);
  const [cats, setCats] = useState(null);
  const [rows, setRows] = useState({});
  const [otherFee, setOtherFee] = useState(0);
  const [receipt, setReceipt] = useState('');
  const [receiptTotal, setReceiptTotal] = useState('');   // Receipt 识别/手填总额
  const [reason, setReason] = useState('');
  const [payment, setPayment] = useState('雇主现金');
  const [editCat, setEditCat] = useState(null);           // 正在编辑分类的 itemId
  const [scanInfo, setScanInfo] = useState(null);         // OCR 结果 {source, store_name, purchase_date, tax}
  const [scanning, setScanning] = useState(false);

  useEffect(() => { api.categories().then(setCats); }, []);
  const GST = cats?.gst_rate ?? 0.09;
  useEffect(() => {
    api.shopping(id).then((l) => {
      setList(l);
      const r = {};
      l.items.forEach((it) => { r[it.shopping_item_id] = {
        qty: it.actual_quantity ?? it.quantity, price: it.actual_unit_price ?? it.estimated_price ?? 0, discount: it.discount ?? 0,
        oos: it.status === 'out_of_stock', name: it.name,
        primary_category: it.primary_category || '食材', secondary_category: it.secondary_category || (it.primary_category === '食材' ? '肉类' : null) };
      });
      setRows(r);
      setOtherFee(l.other_fee || 0);
      setReceipt(l.receipt_image || '');
      setReceiptTotal(l.receipt_total != null ? l.receipt_total : '');
      setPayment(l.payment_method || '雇主现金');
    });
  }, [id]);
  if (!list) return <><TopBar title={t('settle')} /><div className="empty">加载中…</div></>;

  const setRow = (iid, k, v) => setRows((p) => ({ ...p, [iid]: { ...p[iid], [k]: v } }));
  const lineTotal = (iid) => { const r = rows[iid]; if (!r || r.oos) return 0; return Math.max(0, (+r.qty || 0) * (+r.price || 0) - (+r.discount || 0)); };
  // 商品小计 → +9%消费税 → +其他费用 = 录入总额
  const subtotal = +list.items.reduce((s, it) => s + lineTotal(it.shopping_item_id), 0).toFixed(2);
  const gstAmt = +(subtotal * GST).toFixed(2);
  const grand = +(subtotal + gstAmt + (+otherFee || 0)).toFixed(2);
  const over = grand > list.budget;

  // 金额核对（第 8 节）
  const rt = receiptTotal === '' ? null : +receiptTotal;
  const matchStatus = rt == null ? 'unrecognized' : (Math.abs(rt - grand) <= TOL ? 'matched' : 'mismatch');
  const diff = rt == null ? 0 : +(rt - grand).toFixed(2);

  // 真实 OCR：上传图片 → 后端 Claude 识别 → 回填 receipt 总额/商店/日期
  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setScanning(true);
    try {
      const dataUrl = await new Promise((ok, err) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = err; fr.readAsDataURL(file); });
      const r = await api.scanReceipt(list.shopping_list_id, { image_base64: dataUrl, media_type: file.type });
      setReceipt(r.file_url); setReceiptTotal(r.total != null ? r.total : ''); setScanInfo(r);
      showToast((r.source === 'claude' ? (en ? 'Recognized: S$' : 'Claude 识别：S$') : (en ? 'Demo scan: S$' : '模拟识别：S$')) + (r.total||0).toFixed(2));
    } catch (err) { showToast(en ? 'Scan failed' : '识别失败，请重试'); }
    setScanning(false); e.target.value = '';
  };
  // 兜底：无图片时按录入额生成一致的 receipt 总额
  const mockScan = () => { setReceipt('🧾'); setReceiptTotal(grand.toFixed(2)); setScanInfo({ source: 'mock', tax: gstAmt }); showToast(en ? 'Demo scan: S$' + grand.toFixed(2) : '模拟识别：S$' + grand.toFixed(2)); };
  const isImg = (v) => typeof v === 'string' && (v.startsWith('/uploads') || v.startsWith('data:') || v.startsWith('http'));

  const submit = async () => {
    if (!receipt) return showToast(en ? 'Please upload the receipt first' : '请先上传小票');
    if (matchStatus === 'mismatch' && !reason) return showToast(en ? 'Amounts differ — please pick a reason' : '金额不一致，请选择差异原因');
    for (const it of list.items) {
      const r = rows[it.shopping_item_id];
      if (r.oos) continue;
      await api.patchItem(it.shopping_item_id, { status: 'bought', actual_quantity: +r.qty, actual_unit_price: +r.price, discount: +r.discount,
        primary_category: r.primary_category, secondary_category: r.secondary_category, name: r.name });
    }
    await api.patchList(list.shopping_list_id, {
      other_fee: +otherFee || 0, receipt_image: receipt || null, payment_method: payment,
      receipt_total: rt, helper_entered_total: +grand.toFixed(2),
      difference_reason: matchStatus === 'mismatch' ? reason : null,
    });
    await api.shoppingTransition(list.shopping_list_id, { to: 'pending_confirm' });
    showToast(t('submitToEmployer') + ' ✓');
    nav('/shopping-list/' + list.shopping_list_id, { replace: true });
  };

  const reasons = t('diffReasons').split('|');
  const payMethods = t('payMethods').split('|');
  const payMethodsZh = '雇主现金|雇主银行卡|雇主二维码付款|女佣垫付|线上支付|其他'.split('|');

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
                  <div className="tiny muted">{en ? 'Est. ' : '预计 '}S${(it.estimated_price||0).toFixed(2)} · {en ? 'Budget ' : '预算 '}S${it.budget_limit||'-'}</div>
                  {/* 分类快捷展示 + 编辑 */}
                  <button className="chip" style={{ marginTop: 6 }} onClick={() => setEditCat(editCat === it.shopping_item_id ? null : it.shopping_item_id)}>
                    🏷️ {catLabel(cats, r.primary_category, lang)}{r.secondary_category ? ' / ' + catLabel(cats, r.secondary_category, lang) : ''} ▾
                  </button>
                </div>
                <div className={'switch' + (r.oos ? '' : ' on')} onClick={() => setRow(it.shopping_item_id, 'oos', !r.oos)}><i /></div>
              </div>
              {editCat === it.shopping_item_id &&
                <CategoryPicker cats={cats} primary={r.primary_category} secondary={r.secondary_category}
                  onChange={(pc, sc) => setRows((p) => ({ ...p, [it.shopping_item_id]: { ...p[it.shopping_item_id], primary_category: pc, secondary_category: sc } }))} />}
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

        {/* 金额汇总：商品小计 + 9% 消费税 + 其他费用 */}
        <div className="card">
          <div className="spread"><span className="muted">{t('itemsSubtotal')}</span><span>S${subtotal.toFixed(2)}</span></div>
          <div className="spread mt8"><span className="muted">{t('gst')}（{Math.round(GST*100)}%）</span><span>+ S${gstAmt.toFixed(2)}</span></div>
          {(+otherFee||0) > 0 && <div className="spread mt8"><span className="muted">{t('otherFee')}</span><span>+ S${(+otherFee).toFixed(2)}</span></div>}
          <div className="spread mt8" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <span className="bold">{t('helperTotal')}</span><span className="bold" style={{ fontSize: 20, color: over ? 'var(--red)' : 'var(--teal)' }}>S${grand.toFixed(2)}</span></div>
        </div>

        {/* 小票上传 + Claude 识别 */}
        <div className="section-title">🧾 {en ? 'Receipt' : '小票'}</div>
        {receipt
          ? <div className="card">
              <div className="row">
                {isImg(receipt)
                  ? <img src={receipt} alt="receipt" style={{ width: 72, height: 96, objectFit: 'cover', borderRadius: 10, flex: 'none' }} />
                  : <div className="thumb lg">{receipt}</div>}
                <div className="grow">
                  <div className="bold small">{t('receiptUploaded')} ✓ {scanInfo && <span className="badge teal tiny">{scanInfo.source === 'claude' ? (en ? 'Claude OCR' : 'Claude 识别') : (en ? 'Demo' : '模拟')}</span>}</div>
                  {scanInfo?.store_name && <div className="tiny muted mt4">🏬 {scanInfo.store_name}{scanInfo.purchase_date ? ' · ' + scanInfo.purchase_date : ''}{scanInfo.tax != null ? ' · GST S$' + (+scanInfo.tax).toFixed(2) : ''}</div>}
                  <div className="field" style={{ margin: '8px 0 0' }}>
                    <label>{t('receiptTotal')} (S$)</label>
                    <input className="input" type="number" step="0.01" value={receiptTotal} placeholder={t('enterReceiptTotal')} onChange={(e) => setReceiptTotal(e.target.value)} />
                  </div>
                </div>
                <button className="btn sm outline" onClick={() => { setReceipt(''); setReceiptTotal(''); setScanInfo(null); }}>{t('cancel')}</button>
              </div>
              <ReceiptCompare data={scanInfo} listItems={list?.items} lang={lang} t={t} />
            </div>
          : <div className="card">
              <label className="uploadbox" style={{ cursor: 'pointer', display: 'block' }}>
                {scanning ? '⏳ ' + (en ? 'Recognizing…' : '识别中…') : '📷 ' + (en ? 'Upload receipt (auto OCR)' : '上传小票（自动识别）')}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} disabled={scanning} />
              </label>
              <button className="btn sm outline block mt12" onClick={mockScan}>✨ {t('scanReceipt')}</button>
            </div>}

        {/* 金额核对结果（第 9/10/11 节） */}
        <div className="card">
          <div className="spread"><span className="muted">{t('helperTotal')}（{en ? 'incl. GST' : '含税'}）</span><span className="bold">S${grand.toFixed(2)}</span></div>
          <div className="spread mt8"><span className="muted">{t('receiptTotal')}</span><span>{rt == null ? '—' : 'S$' + rt.toFixed(2)}</span></div>
          {rt != null && <div className="spread mt8"><span className="muted">{t('diff')}</span><span style={{ color: Math.abs(diff) <= TOL ? 'var(--green)' : 'var(--red)' }}>{diff >= 0 ? '+' : ''}{diff.toFixed(2)}</span></div>}
          <div style={{ marginTop: 10, padding: 12, borderRadius: 12, fontSize: 13, background: matchStatus==='matched' ? '#dcfce7' : matchStatus==='mismatch' ? '#fee2e2' : '#f1f5f9', color: matchStatus==='matched' ? '#166534' : matchStatus==='mismatch' ? '#b91c1c' : '#475569' }}>
            {matchStatus === 'matched' ? '✅ ' + t('amtMatched') : matchStatus === 'mismatch' ? '⚠️ ' + t('amtMismatch') + '（' + (en ? 'diff ' : '差额 ') + Math.abs(diff).toFixed(2) + '）' : 'ℹ️ ' + t('amtUnrecognized')}
          </div>
          {matchStatus === 'mismatch' && (
            <div className="field" style={{ marginTop: 10 }}>
              <label>{t('diffReason')} <span className="req">*</span></label>
              <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
                {reasons.map((rz) => <button key={rz} className={'chip' + (reason === rz ? ' on' : '')} onClick={() => setReason(rz)}>{rz}</button>)}
              </div>
            </div>
          )}
          {over && <div className="tiny" style={{ color: 'var(--red)', marginTop: 8 }}>⚠️ {en ? 'Over budget S$' + list.budget : '超出预算 S$' + list.budget}</div>}
        </div>

        {/* 付款方式（第 18.1 节） */}
        <div className="field">
          <label>{t('paymentMethod')}</label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {payMethods.map((pm, i) => <button key={pm} className={'chip' + (payment === payMethodsZh[i] ? ' on' : '')} onClick={() => setPayment(payMethodsZh[i])}>{pm}</button>)}
          </div>
          {payment === '女佣垫付' && <div className="tiny muted" style={{ marginTop: 6 }}>💡 {en ? 'Will enter "to reimburse" after confirmation' : '确认后自动进入「待报销」'}</div>}
        </div>
      </div>

      <div className="actionbar">
        <button className="btn outline" onClick={() => nav(-1)}>{t('saveDraft')}</button>
        <button className="btn primary" style={{ flex: 2 }} onClick={submit}>{t('submitToEmployer')} · S${grand.toFixed(2)}</button>
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
