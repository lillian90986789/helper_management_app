import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n } from '../i18n.jsx';
import { TopBar, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';

const roleBadge = { employer: 'teal', maid: 'purple', member: 'blue' };

export default function Members() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { showToast } = useApp();
  const { data, reload } = useAsync(() => api.members());
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'maid', preferred_language: 'en' });

  if (!data) return <><TopBar title={t('memberMgmt')} /><div className="empty">加载中…</div></>;
  const active = data.members.filter((m) => m.status !== 'removed');

  const copy = async () => {
    try { await navigator.clipboard.writeText(data.invite_code); } catch {}
    showToast(t('copied'));
  };
  const regen = async () => { await api.regenInvite(); showToast(t('regenCode') + ' ✓'); reload(); };
  const submit = async () => {
    if (!form.name.trim()) return showToast(lang === 'en' ? 'Enter a name' : '请填写姓名');
    await api.addMember(form);
    showToast(t('addMaid') + ' ✓');
    setForm({ name: '', role: 'maid', preferred_language: 'en' });
    setAdding(false);
    reload();
  };
  const remove = async (m) => {
    if (m.role === 'employer') return;
    await api.removeMember(m.family_member_id);
    showToast(t('removed') + ' ✓');
    reload();
  };

  return (
    <>
      <TopBar title={t('maidMgmt')} right={<button className="iconbtn" onClick={() => setAdding(true)}>＋</button>} />
      <div className="content">
        {/* 邀请码卡片 */}
        <div className="section-title">🔑 {t('inviteCode')}</div>
        <div className="card" style={{ background: 'linear-gradient(135deg,#16a085,#0e7a64)', color: '#fff' }}>
          <div className="small" style={{ opacity: .9 }}>{data.family_name || ''}</div>
          <div className="spread mt8">
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 2 }}>{data.invite_code}</span>
            <button className="iconbtn" style={{ background: 'rgba(255,255,255,.22)' }} onClick={copy}>📋</button>
          </div>
          <div className="tiny mt8" style={{ opacity: .9 }}>{t('inviteHint')}</div>
          <div className="btn-row mt12">
            <button className="btn sm" style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }} onClick={copy}>{t('copyCode')}</button>
            <button className="btn sm" style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }} onClick={regen}>🔄 {t('regenCode')}</button>
          </div>
        </div>

        {/* 成员列表 */}
        <div className="section-title">👥 {t('members')} <span className="muted">({active.length})</span></div>
        <div className="card">
          {active.length === 0 ? <Empty text={t('noData')} /> : active.map((m) => (
            <div key={m.family_member_id} className="list-item">
              <div className="avatar" style={{ width: 44, height: 44, fontSize: 24 }}>{m.avatar}</div>
              <div className="grow">
                <div className="bold">{m.name} {m.role === 'employer' && <span className="tiny muted">👑</span>}</div>
                <div className="tiny muted">{m.preferred_language === 'en' ? 'English' : '简体中文'} · {t('active')}</div>
              </div>
              <span className={'badge ' + (roleBadge[m.role] || 'gray')}>{t(m.role)}</span>
              {m.role === 'maid' &&
                <button className="iconbtn" onClick={() => nav('/rest-days')} title={t('restDaySettings')}>🌙</button>}
              {m.role !== 'employer' &&
                <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => remove(m)} title={t('removeMember')}>✕</button>}
            </div>
          ))}
        </div>

        <button className="btn outline block mt12" onClick={() => nav('/rest-days')}>🌙 {t('restDaySettings')}</button>
        <button className="btn primary block mt12" onClick={() => setAdding(true)}>＋ {t('addMaid')}</button>
      </div>

      {/* 添加女佣弹层 */}
      {adding && (
        <div onClick={() => setAdding(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
            <div className="spread"><span className="bold" style={{ fontSize: 17 }}>{t('addMaid')}</span><button className="iconbtn" onClick={() => setAdding(false)}>✕</button></div>
            <div className="field mt12">
              <label>{t('memberName')} <span className="req">*</span></label>
              <input className="input" value={form.name} placeholder={lang === 'en' ? 'Helper name' : '女佣姓名'} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="field">
              <label>{t('memberRole')}</label>
              <div className="seg">
                {[['maid', t('maid')], ['member', t('member')]].map(([k, lbl]) => (
                  <button key={k} className={'opt' + (form.role === k ? ' on' : '')} onClick={() => setForm((p) => ({ ...p, role: k }))}>{lbl}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>{t('memberLang')}</label>
              <div className="seg">
                {[['en', 'English'], ['zh', '简体中文']].map(([k, lbl]) => (
                  <button key={k} className={'opt' + (form.preferred_language === k ? ' on' : '')} onClick={() => setForm((p) => ({ ...p, preferred_language: k }))}>{lbl}</button>
                ))}
              </div>
            </div>
            <button className="btn primary block" onClick={submit}>{t('addDirectly')}</button>
          </div>
        </div>
      )}
    </>
  );
}
