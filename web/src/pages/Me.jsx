import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { api } from '../api.js';
import { Avatar, AvatarPicker } from '../ui.jsx';
import { useApp } from '../App.jsx';

let _gsi = null;
const loadGsi = () => window.google?.accounts?.id ? Promise.resolve()
  : (_gsi = _gsi || new Promise((ok, err) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = err; document.head.appendChild(s); }));

// 老用户绑定 Gmail：绑定后可用 Google 一键登录进入原账号
function GoogleBind({ en, showToast }) {
  const box = useRef(null); const [bound, setBound] = useState('');
  useEffect(() => {
    let dead = false;
    api.runtimeConfig().then(async (cfg) => {
      if (dead || !cfg?.google_client_id) return;
      await loadGsi(); if (dead || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({ client_id: cfg.google_client_id, callback: async ({ credential }) => {
        try { const r = await api.bindGoogle(credential); setBound(r.email); showToast(en ? 'Google linked ✓' : 'Google 已绑定 ✓'); }
        catch (e) { showToast(e.code === 'email_taken' ? (en ? 'This Gmail is already used by another account' : '该 Gmail 已被其他账号绑定') : (en ? 'Link failed' : '绑定失败')); }
      } });
      if (box.current) window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'medium', text: 'continue_with', width: 260 });
    }).catch(() => {});
    return () => { dead = true; };
  }, []);
  return (
    <>
      <div className="section-title">🔗 {en ? 'Google account' : '绑定 Google 账号'}</div>
      <div className="card">
        <div className="tiny muted" style={{ marginBottom: 10 }}>{bound ? (en ? 'Linked: ' : '已绑定：') + bound : (en ? 'Link your Gmail to sign in with one tap next time.' : '绑定你的 Gmail 后，下次可用 Google 一键登录进入本账号。')}</div>
        <div ref={box} style={{ display: 'flex', justifyContent: 'center' }} />
      </div>
    </>
  );
}

export default function Me({ role }) {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const { showToast } = useApp();
  const isEmp = role === 'employer';
  const en = lang !== 'zh';   // 非中文一律显示英文（回退）
  const AVATARS = isEmp ? ['👨🏻‍💼','👩🏻‍💼','🧑🏽','👨🏽','👩🏽','👵🏻','👴🏻'] : ['👩🏽‍🦱','👩🏻‍🦰','👱🏽‍♀️','🧑🏽','👩🏻','👩🏿'];

  // 当前登录用户资料（雇主从后端读，女佣读加入时记住的身份）
  const [profile, setProfile] = useState(null);   // {user_id, name, avatar}
  const [family, setFamily] = useState('');
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftAvatar, setDraftAvatar] = useState('');
  const [draftFamily, setDraftFamily] = useState('');

  // 家庭级 GST 税率设置（雇主可配置）
  const [gstPct, setGstPct] = useState(null);
  useEffect(() => {
    api.bootstrap().then((b) => {
      const users = b.users || [];
      setFamily(b.family?.family_name || (en ? 'My Family' : '我的家庭'));
      if (isEmp) {
        setGstPct(Math.round((b.family?.gst_rate ?? 0.09) * 100 * 100) / 100);
        let emp = null; try { emp = JSON.parse(localStorage.getItem('hf_employer') || 'null'); } catch {}
        // 只有存的身份在当前家庭里存在才用它，否则回退到家庭雇主（避免更新已删除的用户导致 404）
        const dbUser = emp && users.find((u) => u.user_id === emp.user_id && u.role === 'employer');
        const e = dbUser || users.find((u) => u.role === 'employer') || {};
        setProfile({ user_id: e.user_id, name: e.display_name || e.name || (en ? 'Employer' : '雇主'), avatar: e.avatar || '👨🏻‍💼' });
        if (emp && !dbUser && e.user_id) { try { localStorage.setItem('hf_employer', JSON.stringify({ user_id: e.user_id, name: e.display_name || e.name, avatar: e.avatar, token: emp.token })); } catch {} }
      } else {
        let m = null; try { m = JSON.parse(localStorage.getItem('hf_maid') || 'null'); } catch {}
        const dbUser = m && users.find((u) => u.user_id === m.user_id && u.role === 'maid');
        const mm = dbUser || users.find((u) => u.role === 'maid') || {};
        setProfile({ user_id: mm.user_id || 2, name: dbUser?.name || m?.name || mm.name || 'Siti', avatar: dbUser?.avatar || m?.avatar || mm.avatar || '👩🏽‍🦱' });
        if (m && !dbUser && mm.user_id) { try { localStorage.setItem('hf_maid', JSON.stringify({ ...m, user_id: mm.user_id, name: mm.name, avatar: mm.avatar })); } catch {} }
      }
    });
  }, [isEmp]);

  const openEdit = () => { setDraftName(profile?.name || ''); setDraftAvatar(profile?.avatar || AVATARS[0]); setDraftFamily(family); setEditing(true); };
  const saveProfile = async () => {
    if (!draftName.trim()) return showToast(en ? 'Enter a name' : '请填写姓名');
    if (isEmp && !draftFamily.trim()) return showToast(en ? 'Enter family name' : '请填写家庭名称');
    try {
      const body = { name: draftName.trim(), avatar: draftAvatar };
      if (isEmp) body.display_name = draftName.trim();
      const r = profile?.user_id ? await api.updateUser(profile.user_id, body) : { ...profile, ...body };
      setProfile({ user_id: r.user_id || profile?.user_id, name: r.display_name || r.name, avatar: r.avatar });
      if (isEmp) {
        try { const prev = JSON.parse(localStorage.getItem('hf_employer') || '{}'); localStorage.setItem('hf_employer', JSON.stringify({ ...prev, user_id: r.user_id || profile?.user_id, name: r.display_name || r.name, avatar: r.avatar })); } catch {}
        if (draftFamily.trim() !== family) { await api.saveFamilySettings({ family_name: draftFamily.trim() }); setFamily(draftFamily.trim()); }
      } else {
        try { const m = JSON.parse(localStorage.getItem('hf_maid') || '{}'); localStorage.setItem('hf_maid', JSON.stringify({ ...m, user_id: r.user_id || m.user_id, name: r.name, avatar: r.avatar })); } catch {}
      }
      setEditing(false); showToast(en ? 'Saved ✓' : '已保存 ✓');
    } catch { showToast(en ? 'Save failed' : '保存失败'); }
  };
  const user = { name: profile?.name || (isEmp ? (en ? 'Employer' : '雇主') : 'Siti'), avatar: profile?.avatar || (isEmp ? '👨🏻‍💼' : '👩🏽‍🦱'), role: t(isEmp ? 'employer' : 'maid') };
  const saveGst = async (pct) => {
    const p = +pct; if (isNaN(p) || p < 0 || p >= 100) return showToast(lang !== 'zh' ? 'Enter 0–99' : '请输入 0–99');
    setGstPct(p);
    try { await api.saveFamilySettings({ gst_rate: p / 100 }); showToast((lang !== 'zh' ? 'GST saved: ' : '消费税已保存：') + p + '%'); }
    catch { showToast(lang !== 'zh' ? 'Save failed' : '保存失败'); }
  };

  const empItems = [
    ['👨‍👩‍👧 ' + t('familyInfo')], ['👥 ' + t('members'), '/members'], ['🧹 ' + (lang!=='zh'?'Helper Management':'女佣管理'), '/members'],
    ['🚪 ' + (lang!=='zh'?'Rooms & Areas':'房间区域')], ['📋 ' + (lang!=='zh'?'Task Templates':'任务模板')], ['📖 ' + (lang!=='zh'?'House Manual':'家庭操作手册')],
    ['🔔 ' + t('notifySetting')], ['🔒 ' + (lang!=='zh'?'Account Security':'账号安全')],
  ];
  const maidItems = [
    ['📅 ' + t('workSchedule')], ['🛌 ' + (lang!=='zh'?'Rest Days':'休息日')], ['✅ ' + (lang!=='zh'?'Completed Tasks':'已完成任务')],
    ['🧾 ' + t('purchaseHistory')], ['📖 ' + (lang!=='zh'?'House Manual':'家庭操作手册')], ['📞 ' + (lang!=='zh'?'Emergency Contact':'紧急联系人')],
  ];
  const items = isEmp ? empItems : maidItems;

  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 22 }}>
        <Avatar value={user.avatar} size={54} style={{ background: 'rgba(255,255,255,.25)' }} />
        <div className="grow">
          <h1 style={{ fontSize: 20 }}>{user.name}</h1>
          <div className="sub">{user.role} · {family}</div>
        </div>
        <button className="iconbtn" style={{ background: 'rgba(255,255,255,.22)', color: '#fff' }} onClick={openEdit} title={en ? 'Edit profile' : '编辑资料'}>✏️</button>
      </div>
      <div className="content">
        {/* 编辑资料（姓名 + 头像） */}
        {editing && (
          <div className="card" style={{ borderLeft: '3px solid var(--teal)' }}>
            <div className="bold small" style={{ marginBottom: 8 }}>✏️ {en ? 'Edit profile' : '编辑资料'}</div>
            <div className="field" style={{ margin: 0 }}>
              <label>{en ? 'Name' : '姓名'} {isEmp && <span className="tiny muted">（{en ? 'shown to helper' : '女佣端可见'}）</span>}</label>
              <input className="input" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </div>
            {isEmp && (
              <div className="field" style={{ marginBottom: 0, marginTop: 12 }}>
                <label>{en ? 'Family name' : '家庭名称'} <span className="tiny muted">（{en ? 'shown on home & helper side' : '首页/女佣端显示'}）</span></label>
                <input className="input" value={draftFamily} onChange={(e) => setDraftFamily(e.target.value)} placeholder={en ? 'e.g. Gao Family' : '例如：高先生家'} />
              </div>
            )}
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{en ? 'Avatar' : '头像'}</label>
              <AvatarPicker value={draftAvatar} onChange={setDraftAvatar} emojis={AVATARS} showToast={showToast} />
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn outline" onClick={() => setEditing(false)}>{t('cancel')}</button>
              <button className="btn primary" style={{ flex: 2 }} onClick={saveProfile}>{t('save')}</button>
            </div>
          </div>
        )}

        {/* 语言设置 */}
        <div className="section-title">🌐 {t('langSetting')}</div>
        <div className="card">
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {[['zh', '🇨🇳 简体中文'], ['en', '🇬🇧 English'], ['id', '🇮🇩 Bahasa Indonesia'], ['my', '🇲🇲 မြန်မာ']].map(([code, label]) => (
              <button key={code} className={'chip' + (lang === code ? ' on' : '')} onClick={() => setLang(code)}>{label}</button>
            ))}
          </div>
        </div>

        {/* 采购设置：GST 消费税率（雇主可配置） */}
        {isEmp && gstPct != null && (
          <>
            <div className="section-title">🧾 {lang === 'en' ? 'Shopping Settings' : '采购设置'}</div>
            <div className="card">
              <div className="spread"><span className="bold small">{lang === 'en' ? 'GST rate' : '消费税率 (GST)'}</span>
                <span className="bold" style={{ color: 'var(--teal)' }}>{gstPct}%</span></div>
              <div className="tiny muted mt4">{lang === 'en' ? 'Added on top of item subtotal when settling and reconciling receipts.' : '结算汇总与小票核对时，在商品小计基础上额外计入。'}</div>
              <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginTop: 10 }}>
                {[0, 6, 7, 8, 9, 10].map((p) => (
                  <button key={p} className={'chip' + (gstPct === p ? ' on' : '')} onClick={() => saveGst(p)}>{p}%</button>
                ))}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
                <span className="tiny muted">{lang === 'en' ? 'Custom' : '自定义'}</span>
                <input className="input" style={{ maxWidth: 90 }} type="number" step="0.1" min="0" max="99" value={gstPct}
                  onChange={(e) => setGstPct(e.target.value)} />
                <span className="tiny muted">%</span>
                <button className="btn sm primary" onClick={() => saveGst(gstPct)}>{t('save')}</button>
              </div>
            </div>
          </>
        )}

        <div className="section-title">⚙️ {isEmp ? t('familyInfo') : t('myProfile')}</div>
        <div className="card" style={{ padding: '4px 16px' }}>
          {items.map(([label, link], i) => (
            <div key={i} className="spread" onClick={() => link && nav(link)}
              style={{ padding: '14px 0', borderBottom: i < items.length - 1 ? '1px solid var(--line)' : 'none', cursor: link ? 'pointer' : 'default' }}>
              <span>{label}</span><span className="muted">›</span>
            </div>
          ))}
        </div>

        {isEmp && <GoogleBind en={en} showToast={showToast} />}
        {isEmp && <button className="btn outline block mt12" onClick={() => nav('/register')}>➕ {lang === 'en' ? 'Register a new employer account' : '注册新雇主账号'}</button>}
        <button className="btn danger block mt12" onClick={() => { try { localStorage.removeItem(isEmp ? 'hf_employer' : 'hf_maid'); } catch {} nav(isEmp ? '/register' : '/join'); }}>{t('logout')}</button>
        <div className="empty tiny" style={{ paddingTop: 20 }}>HomeFlow 家务管家 · MVP v1.0</div>
      </div>
    </>
  );
}
