import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

// 加载 Google 身份服务脚本（只加载一次）
let gsiPromise = null;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = ok; s.onerror = err; document.head.appendChild(s);
  });
  return gsiPromise;
}

// 女佣凭邀请码加入家庭：以 Google(Gmail) 作唯一标识，避免每次加入都新建账号（对应 POST /api/auth/google/join）。
// 本环境未配 GOOGLE_CLIENT_ID 时，回退到「邀请码 + 姓名」加入（POST /api/join），避免锁死。
export default function JoinPage() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const tt = (zh, e) => (en ? e : zh);
  const nav = useNavigate();
  const { showToast } = useApp();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [plang, setPlang] = useState('en');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const gbtn = useRef(null);
  const [googleReady, setGoogleReady] = useState(false);
  // Google 回调是闭包，用 ref 拿到点击那一刻最新的邀请码/语言
  const codeRef = useRef(''); codeRef.current = code;
  const plangRef = useRef('en'); plangRef.current = plang;

  // 保存登录态。email 来自 Google 加入（已绑定）；邀请码存下来供「加入后强制绑定」步骤复用。
  const persist = (r) => {
    try { localStorage.setItem('hf_role', 'maid'); localStorage.setItem('hf_maid', JSON.stringify({ user_id: r.user_id, name: r.name, avatar: r.avatar, family: r.family_name, token: r.token, email: r.email || null, invite_code: code.trim().toUpperCase() })); } catch {}
  };

  const joinErr = (e) => {
    if (e.code === 'invalid_code') showToast(tt('邀请码无效，请向雇主确认', 'Invalid code — please check with your employer'));
    else if (e.code === 'email_is_employer') showToast(tt('该 Gmail 已是雇主账号，无法作为女佣加入', 'This Gmail is already an employer account'));
    else showToast(tt('加入失败，请重试', 'Failed to join, please retry'));
  };

  // Google 登录：仅当服务器配了 GOOGLE_CLIENT_ID 时渲染按钮
  useEffect(() => {
    let cancelled = false;
    api.runtimeConfig().then(async (cfg) => {
      if (cancelled || !cfg?.google_client_id) return;
      await loadGsi();
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: async ({ credential }) => {
          const invite = codeRef.current.trim().toUpperCase();
          if (!invite) return showToast(tt('请先输入邀请码', 'Enter the invite code first'));
          setBusy(true);
          try { const r = await api.googleJoin({ invite_code: invite, credential, preferred_language: plangRef.current }); persist(r); setDone(r); }
          catch (e) { joinErr(e); }
          setBusy(false);
        },
      });
      if (gbtn.current) window.google.accounts.id.renderButton(gbtn.current, { theme: 'outline', size: 'large', width: 300, text: 'continue_with' });
      if (!cancelled) setGoogleReady(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 邀请码 + 姓名加入。启用了 Google 时，加入后强制跳绑定页（不绑不能用）；未启用则直接进入。
  const submitLegacy = async () => {
    if (!code.trim()) return showToast(tt('请输入邀请码', 'Enter the invite code'));
    if (!name.trim()) return showToast(tt('请填写你的姓名', 'Enter your name'));
    setBusy(true);
    try {
      const r = await api.join({ invite_code: code.trim().toUpperCase(), name: name.trim(), preferred_language: plang });
      persist(r);
      if (googleReady) nav('/m/bind', { replace: true }); else setDone(r);
    } catch (e) { joinErr(e); }
    setBusy(false);
  };

  if (done) return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 22 }}>
        <div className="grow"><h1 style={{ fontSize: 20 }}>🎉 {tt('加入成功', 'Joined')}</h1>
          <div className="sub">{tt('欢迎使用 HomeFlow', 'Welcome to HomeFlow')}</div></div>
      </div>
      <div className="content">
        <div className="card" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <div style={{ fontSize: 44 }}>{done.avatar || '👩🏽‍🦱'}</div>
          <div className="bold" style={{ marginTop: 8, fontSize: 18 }}>{done.name}</div>
          <div className="tiny muted mt4">{tt('已加入', 'Joined')} · {done.family_name}</div>
          {done.email && <div className="tiny muted mt4">🔗 {done.email}</div>}
        </div>
        <button className="btn primary block mt12" onClick={() => nav('/m/today')}>☀️ {tt('进入今日工作', 'Go to Today')}</button>
      </div>
    </>
  );

  return (
    <>
      <TopBar title={tt('女佣加入家庭', 'Join a Family')} onBack={() => nav('/')} />
      <div className="content" style={{ paddingTop: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 48 }}>🧹</div>
          <h1 style={{ fontSize: 20, margin: '10px 0 6px' }}>{tt('输入邀请码加入', 'Enter your invite code')}</h1>
          <div className="muted small">{tt('邀请码由雇主提供（在「女佣管理」页）', 'Your employer shares this code from Helper Management')}</div>
        </div>

        <div className="field">
          <label>{tt('邀请码', 'Invite code')} <span className="req">*</span></label>
          <input className="input" style={{ letterSpacing: 2, fontWeight: 700, textTransform: 'uppercase' }}
            value={code} placeholder="HOME-XXXX" onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="field">
          <label>{tt('常用语言', 'Preferred language')}</label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {[['en', '🇬🇧 English'], ['id', '🇮🇩 Indonesia'], ['my', '🇲🇲 မြန်မာ'], ['zh', '🇨🇳 简体中文']].map(([c, label]) => (
              <button key={c} className={'chip' + (plang === c ? ' on' : '')} onClick={() => setPlang(c)}>{label}</button>
            ))}
          </div>
        </div>

        {/* 推荐：用 Google 加入（以 Gmail 唯一识别女佣，重进不再新建账号） */}
        {googleReady && (
          <div style={{ marginTop: 12 }}>
            <div className="muted small" style={{ marginBottom: 8 }}>{tt('推荐用 Google 加入（同一 Gmail 始终是同一个你）', 'Recommended: join with Google — the same Gmail is always the same you')}</div>
            <div ref={gbtn} style={{ display: 'flex', justifyContent: 'center', opacity: busy ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }} />
            <div className="row" style={{ alignItems: 'center', gap: 8, margin: '14px 0 2px' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--line,#e5e7eb)' }} />
              <span className="tiny muted">{tt('或用姓名加入', 'or join with your name')}</span>
              <div style={{ flex: 1, height: 1, background: 'var(--line,#e5e7eb)' }} />
            </div>
          </div>
        )}

        {/* 姓名加入（始终可用，避免 Google 未画出/未配置时锁死） */}
        <div className="field">
          <label>{tt('你的姓名', 'Your name')} <span className="req">*</span></label>
          <input className="input" value={name} placeholder={tt('例如 Siti', 'e.g. Siti')} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="hint" style={{ marginTop: 12 }}>🔑 {tt('邀请码由雇主在「女佣管理」页生成并提供给你', 'Ask your employer for the code from Helper Management')}</div>
      </div>

      <div className="actionbar">
        <button className={'btn block ' + (googleReady ? 'outline' : 'primary')} disabled={busy} onClick={submitLegacy}>{busy ? '…' : tt('加入家庭', 'Join family')}</button>
      </div>
    </>
  );
}
