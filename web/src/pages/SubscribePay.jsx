import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

// PayNow 扫码付款页（个人 PayNow + 手动开通）
export default function SubscribePay() {
  const { order_no } = useParams();
  const { lang } = useI18n(); const en = lang === 'en'; const tt = (z, e) => (en ? e : z);
  const nav = useNavigate(); const { showToast } = useApp();
  const [o, setO] = useState(null); const [busy, setBusy] = useState(false);
  const load = () => api.getPaymentOrder(order_no).then(setO).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [order_no]);
  if (!o) return <><TopBar title={tt('付款', 'Payment')} /><div className="empty">…</div></>;

  const claim = async () => { setBusy(true); try { await api.claimPayment(order_no); await load(); showToast(tt('已提交，等待确认', 'Submitted, pending confirmation')); } catch {} setBusy(false); };

  if (o.status === 'PAID') return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 20 }}><div className="grow"><h1 style={{ fontSize: 20 }}>🎉 {tt('付款成功', 'Payment success')}</h1></div></div>
      <div className="content">
        <div className="card" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <div style={{ fontSize: 44 }}>✅</div>
          <div className="bold mt8" style={{ fontSize: 18 }}>{o.plan_name} {tt('已开通', 'activated')}</div>
          <div className="tiny muted mt4">{tt('订单号', 'Order')}: {o.order_no}</div>
        </div>
        <button className="btn primary block mt12" onClick={() => nav('/e/home')}>{tt('开始使用', 'Start using')}</button>
      </div>
    </>
  );

  return (
    <>
      <TopBar title={tt('扫码付款', 'Pay via PayNow')} />
      <div className="content">
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="bold">{o.plan_name}</div>
          <div className="bold" style={{ fontSize: 26, color: 'var(--teal)', margin: '6px 0' }}>S${o.amount}</div>
          <div className="tiny muted">{tt('请用支持 PayNow 的银行 App 扫码付款', 'Scan with a PayNow-enabled bank app')}</div>
          {o.paynow_qr_url
            ? <img src={o.paynow_qr_url} alt="PayNow QR" style={{ width: 220, height: 220, objectFit: 'contain', margin: '14px auto', display: 'block', border: '1px solid var(--line)', borderRadius: 12 }} />
            : <div className="hint" style={{ marginTop: 12 }}>{tt('商家尚未配置收款码，请联系客服', 'Merchant QR not configured, please contact support')}</div>}
          {o.paynow_name && <div className="tiny muted">{tt('收款方', 'Payee')}: {o.paynow_name}</div>}
          <div className="tiny muted mt8">{tt('转账时请在备注填写订单号', 'Add the order no. as payment reference')}:</div>
          <div className="bold" style={{ letterSpacing: 1 }}>{o.order_no}</div>
          <div className="mt8"><span className="badge gray">{tt('当前状态', 'Status')}: {o.status}</span></div>
        </div>
        <div className="hint" style={{ marginTop: 12 }}>⚠️ {tt('点“我已付款”不会立即开通；客服核对到账后为你开通（通常几分钟内）。', '“I have paid” does not unlock instantly; support confirms your payment first.')}</div>
      </div>
      <div className="actionbar" style={{ flexDirection: 'column', gap: 10 }}>
        <button className="btn primary block" disabled={busy || o.status === 'SUBMITTED'} onClick={claim}>
          {o.status === 'SUBMITTED' ? tt('已提交，等待确认', 'Submitted — pending') : tt('我已付款', 'I have paid')}
        </button>
        <div className="btn-row">
          <button className="btn outline" onClick={load}>{tt('刷新状态', 'Refresh')}</button>
          <button className="btn outline" onClick={() => nav('/subscribe')}>{tt('返回套餐', 'Back to plans')}</button>
        </div>
      </div>
    </>
  );
}
