import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useApp } from '../App.jsx';

// 订阅套餐页 —— 同时兼作雇主「订阅已到期」锁定页
export default function Subscribe() {
  const { lang } = useI18n(); const en = lang === 'en'; const tt = (z, e) => (en ? e : z);
  const nav = useNavigate(); const { showToast } = useApp();
  const [cur, setCur] = useState(null); const [plans, setPlans] = useState([]); const [promo, setPromo] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api.subCurrent().then(setCur).catch(() => {}); api.subPlans().then((r) => { setPlans(r.plans || []); setPromo(r.promo_text || ''); }).catch(() => {}); }, []);
  const locked = cur && cur.access_status === 'LOCKED';
  const planOf = (id) => plans.find((p) => p.plan_id === id) || {};
  const choose = async (plan_id) => {
    if (busy) return; setBusy(true);
    try { const o = await api.createPaymentOrder(plan_id); nav('/subscribe/pay/' + o.order_no); }
    catch (e) { showToast(e.code === 'only_employer_can_pay' ? tt('只有雇主可以付款', 'Only employer can pay') : tt('操作失败', 'Failed')); setBusy(false); }
  };
  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 20 }}>
        <div className="grow">
          <h1 style={{ fontSize: 20 }}>{locked ? '🔒 ' + tt('订阅已到期', 'Subscription expired') : tt('订阅套餐', 'Subscription')}</h1>
          <div className="sub">{locked ? tt('完成续费后即可恢复所有功能', 'Renew to restore all features') : tt('选择适合您的订阅计划', 'Choose your plan')}</div>
        </div>
      </div>
      <div className="content">
        {cur && (
          <div className="card" style={{ borderLeft: '3px solid var(--teal)' }}>
            <div className="spread"><span className="bold small">{tt('当前状态', 'Status')}</span><StatusChip cur={cur} tt={tt} /></div>
            <div className="tiny muted mt4">
              {cur.is_trial ? tt('免费试用', 'Free trial') : (cur.plan_id === 'yearly' ? tt('年度订阅', 'Yearly') : tt('月度订阅', 'Monthly'))}
              {' · '}{tt('有效期至', 'Until')} {cur.expire_at?.slice(0, 10)}{' · '}{tt('剩余', 'left')} {cur.remaining_days} {tt('天', 'days')}
            </div>
          </div>
        )}
        {promo && <div className="card" style={{ background: 'linear-gradient(135deg,#fef3c7,#fde68a)', border: 'none', textAlign: 'center', fontWeight: 700, color: '#92400e' }}>🔥 {promo}</div>}
        <PlanCard label={tt('选择月度订阅', 'Choose Monthly')} title={tt('月度订阅', 'Monthly')} plan={planOf('monthly')} period={tt('/月', '/mo')} tt={tt}
          desc={tt('包含全部功能，每次付款获得 1 个月', 'All features · 1 month per payment')} onClick={() => choose('monthly')} busy={busy} />
        <PlanCard label={tt('选择年度订阅', 'Choose Yearly')} title={tt('年度订阅', 'Yearly')} plan={planOf('yearly')} period={tt('/年', '/yr')} best={tt('最划算', 'Best value')} tt={tt}
          desc={tt('买一年更省，按月更灵活', 'Save more with yearly')} onClick={() => choose('yearly')} busy={busy} />
        <div className="hint" style={{ marginTop: 12 }}>
          {tt('付款方式：PayNow 扫码。付款后由客服核对到账为你开通（通常几分钟内），到期不会删除任何历史数据。',
            'Pay by PayNow QR. Activated after payment is verified. No data is deleted on expiry.')}
        </div>
        {!locked && <button className="btn outline block mt12" onClick={() => nav(-1)}>{tt('返回', 'Back')}</button>}
      </div>
    </>
  );
}
function StatusChip({ cur, tt }) {
  const map = { TRIAL_ACTIVE: ['blue', tt('试用中', 'Trial')], ACTIVE: ['green', tt('生效中', 'Active')], EXPIRING_SOON: ['amber', tt('即将到期', 'Expiring')], EXPIRED: ['red', tt('已到期', 'Expired')] };
  const [c, l] = map[cur.status] || ['gray', cur.status];
  return <span className={'badge ' + c}>{l}</span>;
}
function PlanCard({ title, plan, period, desc, best, onClick, busy, label, tt }) {
  const disc = +(plan.discount_percent || 0);
  const hasDisc = disc > 0 && plan.original_price && plan.price && plan.original_price !== plan.price;
  return (
    <div className="card" style={best ? { border: '2px solid var(--teal)' } : undefined}>
      <div className="spread">
        <span className="bold">{title}
          {best && <span className="badge teal tiny" style={{ marginLeft: 8 }}>{best}</span>}
          {hasDisc && <span className="badge red tiny" style={{ marginLeft: 8 }}>{tt(`省${disc}%`, `${disc}% OFF`)}</span>}
        </span>
        <span style={{ textAlign: 'right' }}>
          {hasDisc && <span className="tiny muted" style={{ textDecoration: 'line-through', marginRight: 6 }}>S${plan.original_price}</span>}
          <span className="bold" style={{ color: 'var(--teal)', fontSize: 20 }}>S${plan.price}</span>
          <span className="tiny muted">{period}</span>
        </span>
      </div>
      <div className="tiny muted mt4">{desc}</div>
      <button className="btn primary block mt12" disabled={busy} onClick={onClick}>{label}</button>
    </div>
  );
}
