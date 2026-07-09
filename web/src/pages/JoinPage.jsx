import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

// 女佣凭邀请码加入家庭（对应后端 POST /api/join）
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

  const submit = async () => {
    if (!code.trim()) return showToast(tt('请输入邀请码', 'Enter the invite code'));
    if (!name.trim()) return showToast(tt('请填写你的姓名', 'Enter your name'));
    setBusy(true);
    try {
      const r = await api.join({ invite_code: code.trim().toUpperCase(), name: name.trim(), preferred_language: plang });
      try { localStorage.setItem('hf_role', 'maid'); localStorage.setItem('hf_maid', JSON.stringify({ user_id: r.user_id, name: r.name, avatar: r.avatar, family: r.family_name })); } catch {}
      setDone(r);
    } catch (e) {
      if (e.code === 'invalid_code') showToast(tt('邀请码无效，请向雇主确认', 'Invalid code — please check with your employer'));
      else showToast(tt('加入失败，请重试', 'Failed to join, please retry'));
    }
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
          <label>{tt('你的姓名', 'Your name')} <span className="req">*</span></label>
          <input className="input" value={name} placeholder={tt('例如 Siti', 'e.g. Siti')} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>{tt('常用语言', 'Preferred language')}</label>
          <div className="seg">
            <button className={'opt' + (plang === 'en' ? ' on' : '')} onClick={() => setPlang('en')}>English</button>
            <button className={'opt' + (plang === 'zh' ? ' on' : '')} onClick={() => setPlang('zh')}>简体中文</button>
          </div>
        </div>

        <div className="hint" style={{ marginTop: 8 }}>🔑 {tt('邀请码由雇主在「女佣管理」页生成并提供给你', 'Ask your employer for the code from Helper Management')}</div>
      </div>

      <div className="actionbar">
        <button className="btn primary block" disabled={busy} onClick={submit}>{busy ? '…' : tt('加入家庭', 'Join family')}</button>
      </div>
    </>
  );
}
