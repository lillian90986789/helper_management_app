import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { StatusBadge, fmtTime } from '../ui.jsx';

export default function EmployerHome() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { data, reload } = useAsync(() => api.dashEmployer());
  if (!data) return <div className="content"><div className="empty">加载中…</div></div>;
  const { summary, meals, shoppingSummary, notifications, activity, family } = data;
  const unread = notifications.filter((n) => !n.is_read).length;
  const delMeal = async (e, m) => {
    e.stopPropagation();
    if (!window.confirm(lang === 'en' ? `Remove "${m.recipe_name}" from today's menu?` : `从今日菜单删除「${m.recipe_name}」？`)) return;
    await api.deleteMeal(m.meal_order_id); reload();
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

        {/* 今日菜单卡片 */}
        <div className="section-title">🍽️ {t('todayMenu')}</div>
        <div className="card">
          {meals.slice(0, 4).map((m) => (
            <div key={m.meal_order_id} className="list-item" onClick={() => nav('/meal/' + m.meal_order_id)}>
              <div className="thumb">{m.cover_image}</div>
              <div className="grow">
                <div className="bold">{pick(lang, m.recipe_name, m.recipe_name_en)}
                  {m.status === 'pending_review' && <span className="badge amber tiny" style={{ marginLeft: 6 }}>{t('pendingReview')}</span>}</div>
                <div className="small muted">{t(m.meal_type)} · {m.servings}{lang==='en'?' ppl':'人'} · {fmtTime(m.start_time)}</div>
              </div>
              <StatusBadge status={m.status} />
              <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={(e) => delMeal(e, m)} title={lang==='en'?'Remove':'删除'}>✕</button>
            </div>
          ))}
          {meals.length === 0 && <div className="empty tiny" style={{ padding: '8px 0' }}>{lang==='en'?'No dishes today':'今日暂无菜品'}</div>}
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

        {/* 最新动态 */}
        <div className="section-title">🕑 {t('activity')}</div>
        <div className="card">
          <div className="tl">
            {activity.map((a) => (
              <div key={a.log_id} className="tl-item">
                <div className="small"><b>{a.actor_name}</b> {a.action} · <span className="muted">{a.task_title}</span></div>
                <div className="tiny muted">{fmtTime(a.created_at)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function iconFor(type) {
  return { task: '🧹', meal: '🍽️', shopping: '🛒' }[type] || '🔔';
}
