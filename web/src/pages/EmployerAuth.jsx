import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
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

// 雇主：以 Gmail（Google）为准登录 / 注册；旧账号仍可用用户名密码。女佣走邀请码 /join
export default function EmployerAuth() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const tt = (zh, e) => (en ? e : zh);
  const nav = useNavigate();
  const { showToast } = useApp();
  const [mode, setMode] = useState('login');    // login | register
  const [f, setF] = useState({ username: '', password: '', confirm: '', full_name: '', family_name: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const gbtn = useRef(null);
  const [googleReady, setGoogleReady] = useState(false);   // Google 登录是否可用
  const [showPwd, setShowPwd] = useState(false);            // 是否展开旧版账号密码登录

  const finish = (r) => {
    try {
      localStorage.setItem('hf_role', 'employer');
      localStorage.setItem('hf_employer', JSON.stringify({ user_id: r.user.user_id, name: r.user.name, avatar: r.user.avatar, family: r.family?.family_name, token: r.token }));
    } catch {}
    nav('/e/home', { replace: true });
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
          try { finish(await api.authGoogle(credential)); }
          catch (e) { showToast(tt('Google 登录失败', 'Google sign-in failed')); }
        },
      });
      if (gbtn.current) window.google.accounts.id.renderButton(gbtn.current, { theme: 'outline', size: 'large', width: 300, text: 'continue_with' });
      if (!cancelled) setGoogleReady(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    if (!f.username.trim()) return showToast(tt('请输入用户名', 'Enter a username'));
    if (!f.password) return showToast(tt('请输入密码', 'Enter a password'));
    setBusy(true);
    try {
      if (mode === 'login') {
        finish(await api.employerLogin({ username: f.username.trim(), password: f.password }));
      } else {
        if (f.username.trim().length < 3) { setBusy(false); return showToast(tt('用户名至少 3 位', 'Username ≥ 3 chars')); }
        if (f.password.length < 6) { setBusy(false); return showToast(tt('密码至少 6 位', 'Password ≥ 6 chars')); }
        if (f.password !== f.confirm) { setBusy(false); return showToast(tt('两次密码不一致', 'Passwords do not match')); }
        finish(await api.employerRegister({ username: f.username.trim(), password: f.password, full_name: f.full_name.trim(), family_name: f.family_name.trim() }));
        showToast(tt('注册成功', 'Registered'));
      }
    } catch (e) {
      const map = {
        invalid_credentials: tt('用户名或密码错误', 'Wrong username or password'),
        username_taken: tt('用户名已被占用', 'Username already taken'),
        username_required: tt('用户名至少 3 位', 'Username must be ≥ 3 chars'),
        weak_password: tt('密码至少 6 位', 'Password must be ≥ 6 chars'),
      };
      showToast(map[e.code] || tt('操作失败，请重试', 'Failed, please retry'));
    }
    setBusy(false);
  };

  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 20 }}>
        <div className="grow"><h1 style={{ fontSize: 20 }}>🏠 HomeFlow</h1>
          <div className="sub">{tt('家务管家', 'Household Manager')}</div></div>
      </div>
      <div className="content" style={{ paddingTop: 24 }}>
        {/* 雇主：以 Gmail（Google）为准登录 / 注册 */}
        <div className="card" style={{ textAlign: 'center', padding: '20px 16px' }}>
          <div className="bold" style={{ fontSize: 16, marginBottom: 4 }}>{tt('用 Gmail 登录或注册', 'Sign in with Gmail')}</div>
          <div className="tiny muted" style={{ marginBottom: 14, lineHeight: 1.5 }}>{tt('雇主账号以 Gmail 为准，一个 Gmail 一个账号；首次登录自动创建家庭。', 'Employer accounts are keyed by Gmail — one account per Gmail. First sign-in creates your family.')}</div>
          <div ref={gbtn} style={{ display: 'flex', justifyContent: 'center' }} />
          {!googleReady && <div className="tiny muted" style={{ marginTop: 10 }}>{tt('（本环境未启用 Google 登录，请用下方账号密码）', '(Google sign-in not enabled here — use username & password below)')}</div>}
        </div>

        {/* 旧版：用户名 + 密码（默认折叠；Google 未启用时自动展开） */}
        {googleReady && !showPwd && (
          <button className="btn ghost block" style={{ marginTop: 14 }} onClick={() => setShowPwd(true)}>
            {tt('用账号密码登录（旧账号）', 'Use username & password (legacy)')}
          </button>
        )}

        {(!googleReady || showPwd) && (
          <div style={{ marginTop: 16 }}>
            <div className="seg" style={{ marginBottom: 16 }}>
              <button className={'opt' + (mode === 'login' ? ' on' : '')} onClick={() => setMode('login')}>{tt('登录', 'Log in')}</button>
              <button className={'opt' + (mode === 'register' ? ' on' : '')} onClick={() => setMode('register')}>{tt('注册', 'Sign up')}</button>
            </div>

            <div className="field">
              <label>{tt('用户名', 'Username')} <span className="req">*</span></label>
              <input className="input" autoCapitalize="none" value={f.username} placeholder={tt('至少 3 位', '≥ 3 characters')} onChange={(e) => set('username', e.target.value.replace(/\s/g, ''))} />
            </div>
            <div className="field">
              <label>{tt('密码', 'Password')} <span className="req">*</span></label>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" type={show ? 'text' : 'password'} value={f.password} placeholder={tt('至少 6 位', '≥ 6 characters')} onChange={(e) => set('password', e.target.value)} />
                <button className="btn sm outline" style={{ flex: 'none' }} onClick={() => setShow(!show)}>{show ? tt('隐藏', 'Hide') : tt('显示', 'Show')}</button>
              </div>
            </div>

            {mode === 'register' && <>
              <div className="field">
                <label>{tt('确认密码', 'Confirm password')} <span className="req">*</span></label>
                <input className="input" type={show ? 'text' : 'password'} value={f.confirm} onChange={(e) => set('confirm', e.target.value)} />
                {f.confirm && f.confirm !== f.password && <div className="tiny" style={{ color: 'var(--red)', marginTop: 6 }}>{tt('两次密码不一致', 'Passwords do not match')}</div>}
              </div>
              <div className="field">
                <label>{tt('称呼', 'Your name')} <span className="tiny muted">（{tt('女佣端可见，可选', 'shown to helper, optional')}）</span></label>
                <input className="input" value={f.full_name} placeholder={tt('例如 高先生 / Madam Gao', 'e.g. Madam Gao')} onChange={(e) => set('full_name', e.target.value)} />
              </div>
              <div className="field">
                <label>{tt('家庭名称', 'Family name')} <span className="tiny muted">（{tt('可选', 'optional')}）</span></label>
                <input className="input" value={f.family_name} placeholder={tt('例如 高先生家', 'e.g. Gao Family')} onChange={(e) => set('family_name', e.target.value)} />
              </div>
            </>}

            <button className="btn primary block" style={{ marginTop: 8 }} disabled={busy} onClick={submit}>
              {busy ? '…' : (mode === 'login' ? tt('登录', 'Log in') : tt('注册并进入', 'Sign up'))}
            </button>
          </div>
        )}
      </div>

      <div className="actionbar">
        <button className="btn outline block" onClick={() => nav('/join')}>🧹 {tt('我是女佣，用邀请码加入', "I'm a helper — join with invite code")}</button>
      </div>
    </>
  );
}
