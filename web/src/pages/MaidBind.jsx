import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useApp } from '../App.jsx';

// 加载 Google 身份服务脚本（只加载一次）
let _gsi = null;
const loadGsi = () => window.google?.accounts?.id ? Promise.resolve()
  : (_gsi = _gsi || new Promise((ok, err) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = err; document.head.appendChild(s); }));

const readMaid = () => { try { return JSON.parse(localStorage.getItem('hf_maid') || 'null'); } catch { return null; } };

// 女佣加入后【必须】绑定 Google 才能使用：本页无跳过入口，绑定成功才放行进入 App。
// 绑定复用 /auth/google/join（带加入时保存的邀请码）→ 自动去重/认领旧号，Gmail 作女佣唯一标识。
export default function MaidBind() {
  const { lang } = useI18n();
  const en = lang !== 'zh';
  const tt = (zh, e) => (en ? e : zh);
  const nav = useNavigate();
  const { showToast } = useApp();
  const box = useRef(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const maid = readMaid();

  useEffect(() => {
    let dead = false;
    api.runtimeConfig().then(async (cfg) => {
      if (dead || !cfg?.google_client_id) return;   // 未启用 Google：门禁不会把人带到这里
      await loadGsi();
      if (dead || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: async ({ credential }) => {
          setBusy(true);
          try {
            const r = maid?.invite_code
              ? await api.googleJoin({ invite_code: maid.invite_code, credential })
              : await api.bindGoogle(credential);
            // googleJoin 返回完整身份（可能认领到另一账号）；bindGoogle 只回 email，绑到当前账号
            const next = r.token
              ? { user_id: r.user_id, name: r.name, avatar: r.avatar, family: r.family_name, token: r.token, email: r.email, invite_code: maid?.invite_code || null }
              : { ...maid, email: r.email };
            localStorage.setItem('hf_role', 'maid');
            localStorage.setItem('hf_maid', JSON.stringify(next));
            showToast(tt('绑定成功 ✓', 'Linked ✓'));
            nav('/m/today', { replace: true });
          } catch (e) {
            showToast(e.code === 'email_is_employer' ? tt('该 Gmail 已是雇主账号', 'This Gmail is an employer account') : tt('绑定失败，请重试', 'Link failed, please retry'));
          }
          setBusy(false);
        },
      });
      if (box.current) window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', width: 300, text: 'continue_with' });
      if (!dead) setReady(true);
    }).catch(() => {});
    return () => { dead = true; };
  }, []);

  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 22 }}>
        <div className="grow"><h1 style={{ fontSize: 20 }}>🔗 {tt('绑定 Google 账号', 'Link your Google account')}</h1>
          <div className="sub">{maid?.family ? tt('已加入 ', 'Joined ') + maid.family : tt('完成最后一步', 'One last step')}</div></div>
      </div>
      <div className="content" style={{ paddingTop: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 48 }}>🔐</div>
          <h1 style={{ fontSize: 19, margin: '10px 0 6px' }}>{tt('请绑定你的 Google 账号', 'Please link your Google account')}</h1>
          <div className="muted small">{tt('绑定后才能开始使用；同一个 Gmail 始终对应同一个你，换设备重新登录也不会丢失记录。', 'Linking is required to continue. The same Gmail is always the same you — your records stay even on a new device.')}</div>
        </div>

        <div className="card" style={{ padding: '20px 16px' }}>
          {/* ref 容器必须始终挂载，否则 renderButton 时 box.current 为空、按钮画不出来 */}
          <div ref={box} style={{ display: 'flex', justifyContent: 'center', minHeight: 44, opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }} />
          {!ready && <div className="tiny muted" style={{ textAlign: 'center', marginTop: 8 }}>{tt('正在加载 Google…', 'Loading Google…')}</div>}
        </div>

        <div className="hint" style={{ marginTop: 14 }}>ℹ️ {tt('这一步是必需的，不能跳过。', 'This step is required and cannot be skipped.')}</div>
      </div>
    </>
  );
}
