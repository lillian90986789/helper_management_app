import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n } from '../i18n.jsx';
import { TopBar, Empty, Avatar, AvatarPicker, ageFromBirth } from '../ui.jsx';
import { useApp } from '../App.jsx';

const roleBadge = { employer: 'teal', maid: 'purple', member: 'blue' };
const AVATAR_EMOJIS = ['👩🏽‍🦱','👩🏻‍🦰','👱🏽‍♀️','🧑🏽','👨🏻','👩🏻','👵🏻','👴🏻','🧒🏻','👶🏻'];
const blankForm = () => ({ name: '', role: 'maid', preferred_language: 'en', avatar: '👩🏽‍🦱', gender: '', birth_date: '' });

export default function Members() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { showToast } = useApp();
  const { data, reload } = useAsync(() => api.members());
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [confirmRemove, setConfirmRemove] = useState(null);   // 待确认删除的成员（防误操作，二次确认）
  const [removing, setRemoving] = useState(false);
  const setF = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  if (!data) return <><TopBar title={t('memberMgmt')} /><div className="empty">加载中…</div></>;
  const active = data.members.filter((m) => m.status !== 'removed');
  const genderIcon = (g) => g === 'male' ? '♂️' : g === 'female' ? '♀️' : '';

  const copy = async () => {
    try { await navigator.clipboard.writeText(data.invite_code); } catch {}
    showToast(t('copied'));
  };
  const regen = async () => { await api.regenInvite(); showToast(t('regenCode') + ' ✓'); reload(); };
  const submit = async () => {
    if (!form.name.trim()) return showToast(lang === 'en' ? 'Enter a name' : '请填写姓名');
    await api.addMember(form);
    showToast(t('addMaid') + ' ✓');
    setForm(blankForm());
    setAdding(false);
    reload();
  };
  // 实际删除（在二次确认弹层里点确认后调用）
  const doRemove = async () => {
    const m = confirmRemove;
    if (!m || m.role === 'employer') return;
    setRemoving(true);
    try {
      await api.removeMember(m.family_member_id);
      showToast(t('removed') + ' ✓');
      setConfirmRemove(null);
      reload();
    } catch (e) {
      showToast((lang === 'en' ? 'Failed: ' : '删除失败：') + (e.code || ''));
    }
    setRemoving(false);
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
              <Avatar value={m.avatar} size={44} />
              <div className="grow">
                <div className="bold">{m.name} {genderIcon(m.gender)} {m.role === 'employer' && <span className="tiny muted">👑</span>}</div>
                <div className="tiny muted">{m.birth_date ? ageFromBirth(m.birth_date, lang) + ' · ' : ''}{m.preferred_language === 'en' ? 'English' : '简体中文'} · {t('active')}</div>
              </div>
              <span className={'badge ' + (roleBadge[m.role] || 'gray')}>{t(m.role)}</span>
              {m.role === 'maid' &&
                <button className="iconbtn" onClick={() => nav('/rest-days')} title={t('restDaySettings')}>🌙</button>}
              {m.role !== 'employer' &&
                <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => setConfirmRemove(m)} title={t('removeMember')}>✕</button>}
            </div>
          ))}
        </div>

        <button className="btn outline block mt12" onClick={() => nav('/rest-days')}>🌙 {t('restDaySettings')}</button>
        <button className="btn outline block mt12" onClick={() => nav('/mom-events')}>🇸🇬 {lang === 'en' ? 'MOM Important Events' : 'MOM 重要事项'}</button>
        <button className="btn primary block mt12" onClick={() => setAdding(true)}>＋ {t('addMaid')}</button>
      </div>

      {/* 添加女佣弹层 */}
      {adding && (
        <div onClick={() => setAdding(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
            <div className="spread"><span className="bold" style={{ fontSize: 17 }}>{form.role === 'member' ? t('addMember') : t('addMaid')}</span><button className="iconbtn" onClick={() => setAdding(false)}>✕</button></div>
            <div style={{ maxHeight: '70vh', overflowY: 'auto', marginTop: 12 }}>
              <div className="field">
                <label>{t('avatar')}</label>
                <AvatarPicker value={form.avatar} onChange={(v) => setF('avatar', v)} emojis={AVATAR_EMOJIS} showToast={showToast} />
              </div>
              <div className="field">
                <label>{t('memberName')} <span className="req">*</span></label>
                <input className="input" value={form.name} placeholder={lang === 'en' ? 'Name' : '姓名'} onChange={(e) => setF('name', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('memberRole')}</label>
                <div className="seg">
                  {[['maid', t('maid')], ['member', t('member')]].map(([k, lbl]) => (
                    <button key={k} className={'opt' + (form.role === k ? ' on' : '')} onClick={() => setF('role', k)}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <div className="field grow">
                  <label>{t('gender')}</label>
                  <div className="seg">
                    {[['', t('notSet')], ['male', t('male')], ['female', t('female')]].map(([k, lbl]) => (
                      <button key={k || 'na'} className={'opt' + (form.gender === k ? ' on' : '')} onClick={() => setF('gender', k)}>{lbl}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="field">
                <label>{t('birthDate')} {form.birth_date && <span className="tiny muted">· {t('age')} {ageFromBirth(form.birth_date, lang)}</span>}</label>
                <input className="input" type="date" value={form.birth_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF('birth_date', e.target.value)} />
              </div>
              <div className="field">
                <label>{t('memberLang')}</label>
                <div className="seg">
                  {[['en', 'English'], ['zh', '简体中文']].map(([k, lbl]) => (
                    <button key={k} className={'opt' + (form.preferred_language === k ? ' on' : '')} onClick={() => setF('preferred_language', k)}>{lbl}</button>
                  ))}
                </div>
              </div>
            </div>
            <button className="btn primary block mt12" onClick={submit}>{t('addDirectly')}</button>
          </div>
        </div>
      )}

      {/* 删除成员二次确认（防误操作） */}
      {confirmRemove && (
        <div onClick={() => !removing && setConfirmRemove(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
            <div className="bold" style={{ fontSize: 17 }}>⚠️ {lang === 'en' ? 'Remove this member?' : '确认删除该成员？'}</div>
            <div className="small muted" style={{ margin: '10px 0 16px' }}>
              {lang === 'en'
                ? `“${confirmRemove.name}” will be removed from the family and lose access. Their Gmail is released (can rejoin later). This cannot be undone.`
                : `将把「${confirmRemove.name}」移出家庭并收回其访问权限，释放其绑定的 Gmail（之后可重新加入）。此操作不可撤销。`}
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn outline grow" disabled={removing} onClick={() => setConfirmRemove(null)}>{t('cancel')}</button>
              <button className="btn danger grow" disabled={removing} onClick={doRemove}>{removing ? '…' : (lang === 'en' ? 'Remove' : '确认删除')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
