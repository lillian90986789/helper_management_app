import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';

// 女佣端锁定页：家庭订阅到期后女佣只能看到此页
export default function MaidLocked() {
  const { lang } = useI18n(); const en = lang === 'en'; const tt = (z, e) => (en ? e : z);
  const nav = useNavigate();
  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 22 }}><div className="grow"><h1 style={{ fontSize: 20 }}>🔒 {tt('家庭订阅已到期', 'Subscription expired')}</h1></div></div>
      <div className="content">
        <div className="card" style={{ textAlign: 'center', padding: '26px 16px' }}>
          <div style={{ fontSize: 44 }}>🔒</div>
          <div className="bold mt8">{tt('当前暂时无法使用任务、菜谱和采购等功能', 'Tasks, recipes and shopping are paused')}</div>
          <div className="muted small mt8">{tt('请联系您的雇主完成续费后继续使用。', 'Please ask your employer to renew the subscription.')}</div>
        </div>
        <button className="btn danger block mt12" onClick={() => { try { localStorage.removeItem('hf_maid'); } catch {} nav('/join'); }}>{tt('退出登录', 'Log out')}</button>
      </div>
    </>
  );
}
