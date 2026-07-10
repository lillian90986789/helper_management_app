import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

// 加载 Google 身份服务脚本（只加载一次）
let _gsi = null;
const loadGsi = () => window.google?.accounts?.id ? Promise.resolve()
  : (_gsi = _gsi || new Promise((ok, err) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = err; document.head.appendChild(s); }));

// 女佣已加入并绑定过 Google → 直接用 Google 登录进原账号（POST /auth/google/maid-login）。
export default function MaidLogin() {
  const { lang } = useI18n();
  const en = lang !== 'zh';
  const tt = (zh, e) => (en ? e : zh);
  const nav = useNavigate();
  const { showToast } = useApp();
  const box = useRef(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [noGoogle, setNoGoogle] = useState(false);

  useEffect(() => {
    let dead = false;
    api.runtimeConfig().then(async (cfg) => {
      if (dead) return;
      if (!cfg?.google_client_id) { setNoGoogle(true); return; }
      await loadGsi();
      if (dead || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: async ({ credential }) => {
          setBusy(true);
          try {
            const r = await api.maidGoogleLogin(credential);
            localStorage.setItem('hf_role', 'maid');
            localStorage.setItem('hf_maid', JSON.stringify({ user_id: r.user_id, name: r.name, avatar: r.avatar, family: r.family_name, token: r.token, email: r.email, invite_code: null }));
            nav('/m/today', { replace: true });
          } catch (e) {
            if (e.code === 'maid_not_found') showToast(tt('该 Gmail 还没加入家庭，请先用邀请码加入', 'This Gmail has not joined a family yet — use an invite code first'));
            else if (e.code === 'maid_not_in_family') showToast(tt('你已被移出家庭，请重新用邀请码加入', 'You were removed from the family — join again with an invite code'));
            else showToast(tt('登录失败，请重试', 'Sign-in failed, please retry'));
          }
          setBusy(false);
        },
      });
      if (box.current) window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', width: 300, text: 'signin_with' });
      if (!dead) setReady(true);
    }).catch(() => {});
    return () => { dead = true; };
  }, []);

  return (
    <>
      <TopBar title={tt('女佣用 Google 登录', 'Helper — sign in with Google')} onBack={() => nav('/login')} />
      <div className="content" style={{ paddingTop: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 48 }}>👩🏽‍🦱</div>
          <h1 style={{ fontSize: 20, margin: '10px 0 6px' }}>{tt('用 Google 登录', 'Sign in with Google')}</h1>
          <div className="muted small">{tt('已加入家庭并绑定过 Google 的女佣，直接用 Google 登录进原账号。', 'If you already joined a family and linked Google, sign in directly.')}</div>
        </div>

        <div className="card" style={{ padding: '20px 16px' }}>
          {/* ref 容器必须始终挂载，否则 renderButton 时 box.current 为空、按钮画不出来 */}
          <div ref={box} style={{ display: 'flex', justifyContent: 'center', minHeight: 44, opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }} />
          {!ready && !noGoogle && <div className="tiny muted" style={{ textAlign: 'center', marginTop: 8 }}>{tt('正在加载 Google…', 'Loading Google…')}</div>}
          {noGoogle && <div className="tiny muted" style={{ textAlign: 'center' }}>{tt('本环境未启用 Google 登录，请用邀请码加入。', 'Google sign-in is not enabled here — use an invite code.')}</div>}
        </div>

        <button className="btn outline block mt12" onClick={() => nav('/join')}>🧹 {tt('还没加入？用邀请码加入', "Not joined yet? Use an invite code")}</button>
      </div>
    </>
  );
}
