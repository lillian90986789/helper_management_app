import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { useApp } from '../App.jsx';

// 雇主：用户名 + 密码 注册 / 登录（女佣走邀请码 /join）
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

  const finish = (r) => {
    try {
      localStorage.setItem('hf_role', 'employer');
      localStorage.setItem('hf_employer', JSON.stringify({ user_id: r.user.user_id, name: r.user.name, avatar: r.user.avatar, family: r.family?.family_name, token: r.token }));
    } catch {}
    nav('/e/home', { replace: true });
  };

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
      <div className="content" style={{ paddingTop: 20 }}>
        {/* 登录 / 注册 切换 */}
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
      </div>

      <div className="actionbar" style={{ flexDirection: 'column', gap: 10 }}>
        <button className="btn primary block" disabled={busy} onClick={submit}>
          {busy ? '…' : (mode === 'login' ? tt('登录', 'Log in') : tt('注册并进入', 'Sign up'))}
        </button>
        <button className="btn outline block" onClick={() => nav('/join')}>🧹 {tt('我是女佣，用邀请码加入', "I'm a helper — join with invite code")}</button>
      </div>
    </>
  );
}
