import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

export default function Me({ role }) {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const { showToast } = useApp();
  const isEmp = role === 'employer';
  // 女佣信息读取登录时（邀请码加入）记住的身份，未登录则用演示默认 Siti
  const maid = (() => { try { return JSON.parse(localStorage.getItem('hf_maid') || 'null'); } catch { return null; } })();
  const family = maid?.family || '陈先生家';
  const user = isEmp
    ? { name: '陈先生', avatar: '👨🏻‍💼', role: t('employer') }
    : { name: maid?.name || 'Siti', avatar: maid?.avatar || '👩🏽‍🦱', role: t('maid') };

  // 家庭级 GST 税率设置（雇主可配置）
  const [gstPct, setGstPct] = useState(null);
  useEffect(() => { if (isEmp) api.bootstrap().then((b) => setGstPct(Math.round((b.family?.gst_rate ?? 0.09) * 100 * 100) / 100)); }, [isEmp]);
  const saveGst = async (pct) => {
    const p = +pct; if (isNaN(p) || p < 0 || p >= 100) return showToast(lang === 'en' ? 'Enter 0–99' : '请输入 0–99');
    setGstPct(p);
    try { await api.saveFamilySettings({ gst_rate: p / 100 }); showToast((lang === 'en' ? 'GST saved: ' : '消费税已保存：') + p + '%'); }
    catch { showToast(lang === 'en' ? 'Save failed' : '保存失败'); }
  };

  const empItems = [
    ['👨‍👩‍👧 ' + t('familyInfo')], ['👥 ' + t('members'), '/members'], ['🧹 ' + (lang==='en'?'Helper Management':'女佣管理'), '/members'],
    ['🚪 ' + (lang==='en'?'Rooms & Areas':'房间区域')], ['📋 ' + (lang==='en'?'Task Templates':'任务模板')], ['📖 ' + (lang==='en'?'House Manual':'家庭操作手册')],
    ['🔔 ' + t('notifySetting')], ['🔒 ' + (lang==='en'?'Account Security':'账号安全')],
  ];
  const maidItems = [
    ['📅 ' + t('workSchedule')], ['🛌 ' + (lang==='en'?'Rest Days':'休息日')], ['✅ ' + (lang==='en'?'Completed Tasks':'已完成任务')],
    ['🧾 ' + t('purchaseHistory')], ['📖 ' + (lang==='en'?'House Manual':'家庭操作手册')], ['📞 ' + (lang==='en'?'Emergency Contact':'紧急联系人')],
  ];
  const items = isEmp ? empItems : maidItems;

  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 22 }}>
        <div className="avatar" style={{ width: 54, height: 54, fontSize: 30, background: 'rgba(255,255,255,.25)' }}>{user.avatar}</div>
        <div className="grow">
          <h1 style={{ fontSize: 20 }}>{user.name}</h1>
          <div className="sub">{user.role} · {family}</div>
        </div>
      </div>
      <div className="content">
        {/* 语言设置 */}
        <div className="section-title">🌐 {t('langSetting')}</div>
        <div className="card">
          <div className="seg">
            <button className={'opt' + (lang === 'zh' ? ' on' : '')} onClick={() => setLang('zh')}>🇨🇳 简体中文</button>
            <button className={'opt' + (lang === 'en' ? ' on' : '')} onClick={() => setLang('en')}>🇬🇧 English</button>
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

        {isEmp && <button className="btn outline block mt12" onClick={() => nav('/register')}>➕ {lang === 'en' ? 'Register a new employer account' : '注册新雇主账号'}</button>}
        <button className="btn danger block mt12" onClick={() => nav(isEmp ? '/register' : '/')}>{t('logout')}</button>
        <div className="empty tiny" style={{ paddingTop: 20 }}>HomeFlow 家务管家 · MVP v1.0</div>
      </div>
    </>
  );
}
