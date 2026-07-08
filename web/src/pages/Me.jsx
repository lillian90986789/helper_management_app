import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';

export default function Me({ role }) {
  const { t, lang, setLang } = useI18n();
  const nav = useNavigate();
  const isEmp = role === 'employer';
  const user = isEmp ? { name: '陈先生', avatar: '👨🏻‍💼', role: t('employer') } : { name: 'Siti', avatar: '👩🏽‍🦱', role: t('maid') };

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
          <div className="sub">{user.role} · 陈先生家</div>
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
