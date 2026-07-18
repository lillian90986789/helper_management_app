import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { WeeklyMenu } from '../ui.jsx';

export default function EmployerHome() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { data, reload } = useAsync(() => api.dashEmployer());
  const { data: week, reload: reloadWeek } = useAsync(() => api.mealsWeek());
  const { data: sub } = useAsync(() => api.subCurrent().catch(() => null));
  if (!data) return <div className="content"><div className="empty">加载中…</div></div>;
  const { summary, shoppingSummary, notifications, family } = data;
  const unread = notifications.filter((n) => !n.is_read).length;
  const delMeal = async (m) => {
    const name = pick(lang, m.recipe.name, m.recipe.name_en);
    if (!window.confirm(lang === 'en' ? `Remove "${name}" from the menu?` : `从菜单删除「${name}」？`)) return;
    await api.deleteMeal(m.meal_order_id); reloadWeek();
  };

  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 16, paddingBottom: 16, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <div className="spread">
          <div>
            <div className="small" style={{ opacity: .85 }}>{family?.family_name || (lang === 'en' ? 'My Family' : '我的家庭')}</div>
            <h1 style={{ fontSize: 21 }}>{t('todayTasks')}</h1>
          </div>
          <button className="iconbtn" onClick={() => nav('/notifications')}>
            🔔{unread > 0 && <span style={{ position:'absolute', marginTop:-18, marginLeft:10, background:'#ef4444', borderRadius:8, fontSize:9, padding:'1px 5px' }}>{unread}</span>}
          </button>
        </div>
      </div>

      <div className="content">
        {/* 订阅状态卡片 */}
        {sub && (
          <div className="card tap" onClick={() => nav('/subscribe')}
            style={{ borderLeft: '3px solid ' + (sub.status === 'EXPIRING_SOON' ? 'var(--amber)' : sub.status === 'EXPIRED' ? 'var(--red)' : 'var(--teal)') }}>
            <div className="spread">
              <div>
                <span className="bold small">{sub.is_trial ? (lang === 'en' ? 'Free trial' : '免费试用') : (sub.plan_id === 'yearly' ? (lang === 'en' ? 'Yearly plan' : '年度订阅') : (lang === 'en' ? 'Monthly plan' : '月度订阅'))}</span>
                <div className="tiny muted mt4">
                  {sub.status === 'EXPIRED' ? (lang === 'en' ? 'Expired' : '已到期')
                    : (lang === 'en' ? 'Until ' : '有效期至 ') + (sub.expire_at || '').slice(0, 10) + ' · ' + (lang === 'en' ? sub.remaining_days + 'd left' : '剩余 ' + sub.remaining_days + ' 天')}
                </div>
              </div>
              <button className="btn sm primary">{['TRIAL_ACTIVE', 'ACTIVE'].includes(sub.status) ? (lang === 'en' ? 'Manage' : '查看') : (lang === 'en' ? 'Renew' : '续费')}</button>
            </div>
            {sub.status === 'EXPIRING_SOON' && <div className="tiny" style={{ color: 'var(--amber)', marginTop: 6 }}>⚠️ {lang === 'en' ? 'Expiring soon — renew to keep access' : '即将到期，请及时续费'}</div>}
          </div>
        )}

        {/* 今日任务卡片 */}
        <div className="section-title">📋 {t('todayTasks')}</div>
        <div className="card">
          <div className="mini-grid">
            <div className="mini"><div className="n">{summary.total}</div><div className="l">{t('total')}</div></div>
            <div className="mini"><div className="n" style={{ color:'var(--green)' }}>{summary.done}</div><div className="l">{t('done')}</div></div>
            <div className="mini"><div className="n" style={{ color:'var(--blue)' }}>{summary.in_progress}</div><div className="l">{t('inProgress')}</div></div>
            <div className="mini"><div className="n" style={{ color:'var(--amber)' }}>{summary.pending_review}</div><div className="l">{t('pendingReview')}</div></div>
            <div className="mini"><div className="n" style={{ color:'var(--red)' }}>{summary.incomplete}</div><div className="l">{t('incompleteSection')}</div></div>
          </div>
          <div className="btn-row mt12">
            <button className="btn sm outline" onClick={() => nav('/e/tasks')}>{t('viewAll')}</button>
            <button className="btn sm primary" onClick={() => nav('/task-new')}>＋ {t('newTask')}</button>
          </div>
        </div>

        {/* 本周菜单卡片 */}
        <div className="section-title">🍽️ {t('todayMenu')}</div>
        <div className="card">
          {week ? <WeeklyMenu days={week.days} lang={lang} t={t} onOpen={(id) => nav('/meal/' + id)} onDelete={delMeal} /> : <div className="empty tiny">加载中…</div>}
          <button className="btn sm outline block mt12" onClick={() => nav('/e/recipes')}>{t('arrangeMenu')}</button>
        </div>

        {/* 采购卡片 */}
        <div className="section-title">🛒 {t('purchase')}</div>
        <div className="card">
          <div className="stat-grid">
            <div><div className="muted small">{t('toBuy')}</div><div className="bold" style={{ fontSize: 20 }}>{shoppingSummary.to_buy}</div></div>
            <div><div className="muted small">{t('subPending')}</div><div className="bold" style={{ fontSize: 20, color: shoppingSummary.sub_pending? 'var(--amber)':'inherit' }}>{shoppingSummary.sub_pending}</div></div>
            <div><div className="muted small">{t('estAmount')}</div><div className="bold" style={{ fontSize: 20 }}>S${shoppingSummary.est_total.toFixed(1)}</div></div>
            <div><div className="muted small">{t('done')}</div><div className="bold" style={{ fontSize: 20, color:'var(--teal)' }}>S${shoppingSummary.actual_total.toFixed(1)}</div></div>
          </div>
          <button className="btn sm outline block mt12" onClick={() => nav('/e/shopping')}>{t('viewProgress')}</button>
        </div>

        {/* 异常提醒 */}
        {notifications.length > 0 && <>
          <div className="section-title">⚠️ {t('alerts')}</div>
          <div className="card">
            {notifications.slice(0, 3).map((n) => (
              <div key={n.notification_id} className="list-item" onClick={() => nav('/notifications')}>
                <div className="thumb" style={{ background:'#fef3c7' }}>{iconFor(n.type)}</div>
                <div className="grow"><div className="bold small">{n.title}</div><div className="tiny muted ellipsis">{n.content}</div></div>
              </div>
            ))}
          </div>
        </>}
      </div>
    </>
  );
}

function iconFor(type) {
  return { task: '🧹', meal: '🍽️', shopping: '🛒' }[type] || '🔔';
}
