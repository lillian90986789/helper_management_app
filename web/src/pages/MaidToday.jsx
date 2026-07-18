import { useNavigate } from 'react-router-dom';
import { api, currentMaidId } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { StatusBadge, PriorityBadge, fmtTime, WeeklyMenu } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function MaidToday() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { showToast } = useApp();
  const { data, reload } = useAsync(() => api.dashMaid(currentMaidId()));
  const { data: week } = useAsync(() => api.mealsWeek());
  if (!data) return <div className="content"><div className="empty">加载中…</div></div>;
  const { tasks, progress, next, meals, shopping, rest, mom } = data;
  const dateLocale = { zh: 'zh-CN', en: 'en-US', id: 'id-ID', my: 'my-MM' }[lang] || 'en-US';
  const dateStr = new Date().toLocaleDateString(dateLocale, { month: 'long', day: 'numeric', weekday: 'long' });
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const en = lang === 'en';
  const maidName = (() => { try { return JSON.parse(localStorage.getItem('hf_maid') || 'null')?.name || 'Siti'; } catch { return 'Siti'; } })();
  const restLabel = (r) => en ? `${enMon(r.rest_date)} · ${r.weekday_name_en}` : `${cnMD(r.rest_date)} ${r.weekday_name}`;

  const startNext = async () => {
    if (!next) return;
    await api.taskTransition(next.task_id, { to: 'in_progress', action: '开始任务' });
    showToast(t('start') + ' ✓'); reload();
  };
  const momAck = async (e) => { try { await api.momAck(e.mom_event_id); reload(); } catch { showToast(en ? 'Failed' : '操作失败'); } };
  const momDone = async (e) => { try { await api.momHelperDone(e.mom_event_id); showToast((en ? 'Marked done' : '已标记完成') + ' ✓'); reload(); } catch { showToast(en ? 'Failed' : '操作失败'); } };
  const MOM_STATUS = { overdue: [en ? 'Overdue' : '已逾期', 'red'], due_today: [en ? 'To do' : '待完成', 'amber'], upcoming: [en ? 'Upcoming' : '即将到期', 'blue'], done: [en ? 'Done' : '已完成', 'green'] };
  const momBadge = (e) => e.status === 'helper_done' && e.display_status !== 'done' ? [en ? 'Awaiting confirm' : '待雇主确认', 'purple'] : (MOM_STATUS[e.display_status] || MOM_STATUS.upcoming);

  return (
    <>
      {/* 日期 + 工作状态 */}
      <div className="topbar teal" style={{ flexDirection: 'column', alignItems: 'stretch', paddingTop: 18, paddingBottom: 18, gap: 10 }}>
        <div className="spread">
          <div>
            <div className="small" style={{ opacity: .9 }}>{dateStr}</div>
            <h1 style={{ fontSize: 22 }}>{({ zh: '早上好，', en: 'Hi, ', id: 'Halo, ', my: 'မင်္ဂလာပါ, ' }[lang] || 'Hi, ') + maidName + ' 👋'}</h1>
          </div>
          <span className="badge" style={{ background: 'rgba(255,255,255,.25)', color: '#fff' }}>● {t('workday')}</span>
        </div>
        <div>
          <div className="spread small" style={{ opacity: .95, marginBottom: 5 }}>
            <span>{t('todayList')}</span><span>{progress.done}/{progress.total}</span>
          </div>
          <div className="prog" style={{ background: 'rgba(255,255,255,.3)' }}><i style={{ width: pct + '%', background: '#fff' }} /></div>
        </div>
      </div>

      <div className="content">
        {/* MOM 重要事项（顶部；无事项时不显示） */}
        {mom && mom.length > 0 && (
          <>
            <div className="section-title">🇸🇬 {en ? 'MOM Important Events' : 'MOM 重要事项'}</div>
            {mom.map((e) => {
              const [label, color] = momBadge(e);
              const doneMarked = e.status === 'helper_done' || e.status === 'done';
              return (
                <div key={e.mom_event_id} className="card" style={{ borderLeft: '4px solid ' + (color === 'red' ? 'var(--red)' : color === 'amber' ? 'var(--amber)' : color === 'green' ? 'var(--teal)' : '#7c5cff') }}>
                  <div className="spread">
                    <span className="bold">{e.event_date.slice(5).replace('-', '月') + '日'}｜{e.title}</span>
                    <span className={'badge ' + color}>{label}</span>
                  </div>
                  {e.note && <div className="small muted mt4">{e.note}</div>}
                  {!doneMarked && (
                    <div className="row mt8" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {!e.helper_ack && <button className="btn sm outline" onClick={() => momAck(e)}>{en ? 'Got it' : '我知道了'}</button>}
                      <button className="btn sm primary" onClick={() => momDone(e)}>{en ? 'Mark done' : '已完成'}</button>
                    </div>
                  )}
                  {doneMarked && <div className="tiny muted mt8">✅ {en ? 'Waiting for employer to confirm' : '已提交，待雇主确认'}</div>}
                </div>
              );
            })}
          </>
        )}

        {/* 今天是休息日提示（第 4.2 节） */}
        {rest?.today_is_rest && (
          <div className="rest-banner">
            <span style={{ fontSize: 26 }}>🌙</span>
            <div className="grow">
              <div className="bold">{t('todayIsRest')}</div>
              <div className="tiny" style={{ opacity: .9 }}>{t('restDayHint')}</div>
            </div>
            <button className="btn sm" style={{ background: 'rgba(255,255,255,.25)', color: '#fff', flex: 'none' }} onClick={() => nav('/m/tasks')}>{t('viewMonthRest')}</button>
          </div>
        )}

        {/* 本月休息日卡片（第 4.1 节） */}
        {rest && (
          <>
            <div className="section-title">🌙 {t('monthRest')} <span className="muted">{en ? `${enMonthName(rest.month)} ${rest.year}` : `${rest.year}年${rest.month}月`}</span></div>
            <div className="card">
              {rest.rest_days.length === 0
                ? <div className="muted small" style={{ padding: '4px 0' }}>{t('noRestThisMonth')}</div>
                : <>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      {rest.rest_days.map((r) => (
                        <span key={r.rest_date} className="badge purple" style={{ padding: '6px 10px' }}>{restLabel(r)}</span>
                      ))}
                    </div>
                    {rest.next_rest_day && <div className="tiny muted mt12">➡️ {t('nextRest')}：<b style={{ color: 'var(--ink)' }}>{restLabel(rest.next_rest_day)}</b></div>}
                  </>}
              <button className="btn sm outline block mt12" onClick={() => nav('/m/tasks')}>📅 {t('calendar')}</button>
            </div>
          </>
        )}

        {/* 下一项任务（大卡片，单一主操作） */}
        {next && (
          <div className="card" style={{ borderLeft: '4px solid var(--teal)' }}>
            <div className="spread">
              <span className="badge teal">⏰ {t('nextTask')}</span>
              <PriorityBadge priority={next.priority} />
            </div>
            <div className="bold mt8" style={{ fontSize: 19 }}>{pick(lang, next.title, next.title_en)}</div>
            <div className="small muted mt4">
              {next.area && (pick(lang, next.area.name, next.area.name_en))} · ⏳ {next.estimated_duration}{t('min')}
            </div>
            {next.description && <div className="small mt8" style={{ color: 'var(--ink-2)' }}>{next.description}</div>}
            <div className="btn-row mt12">
              <button className="btn outline" onClick={() => nav('/task/' + next.task_id)}>{t('viewDetail')}</button>
              <button className="btn primary" onClick={startNext}>▶ {t('startTask')}</button>
            </div>
          </div>
        )}

        {/* 今日任务清单 */}
        <div className="section-title">🧹 {t('todayList')}</div>
        <div className="card">
          {tasks.map((task) => (
            <div key={task.task_id} className="list-item" onClick={() => nav('/task/' + task.task_id)}>
              <div className="thumb">{task.area?.icon || '🧹'}</div>
              <div className="grow">
                <div className="spread">
                  <span className="bold ellipsis">{pick(lang, task.title, task.title_en)}</span>
                  {task.require_photo ? <span className="tiny">📷</span> : null}
                </div>
                <div className="tiny muted">{task.area && pick(lang, task.area.name, task.area.name_en)} · ⏳ {task.estimated_duration}{t('min')}</div>
              </div>
              <StatusBadge status={task.status} />
            </div>
          ))}
        </div>

        {/* 本周做饭 */}
        <div className="section-title">🍳 {t('todayCook')}</div>
        <div className="card">
          {week ? <WeeklyMenu days={week.days} lang={lang} t={t} onOpen={(id) => nav('/meal/' + id)} /> : <div className="empty tiny">加载中…</div>}
        </div>

        {/* 下一个休息日提示（非休息日时，第 4.2 节） */}
        {rest && !rest.today_is_rest && rest.next_rest_day && (
          <div className="card tap" onClick={() => nav('/m/tasks')} style={{ borderLeft: '3px solid #7c5cff' }}>
            <div className="spread">
              <span className="small">🌙 {t('nextRest')}</span>
              <span className="bold small">{restLabel(rest.next_rest_day)}</span>
            </div>
          </div>
        )}

        {/* 今日采购 */}
        {shopping && <>
          <div className="section-title">🛒 {t('todayBuy')}</div>
          <div className="card tap" onClick={() => nav('/shopping-list/' + shopping.shopping_list_id)}>
            <div className="spread">
              <div>
                <div className="bold">{shopping.title}</div>
                <div className="small muted mt4">📍 {shopping.store_name} · {t('budget')} S${shopping.budget}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="bold" style={{ fontSize: 22, color: 'var(--teal)' }}>{shopping.to_buy}</div>
                <div className="tiny muted">{t('toBuy')}</div>
              </div>
            </div>
            <button className="btn sm primary block mt12">{t('viewList')} →</button>
          </div>
        </>}
      </div>
    </>
  );
}

// 休息日日期格式化
function cnMD(ds) { const [, m, d] = ds.split('-').map(Number); return `${m}月${d}日`; }
function enMon(ds) { const [, m, d] = ds.split('-').map(Number); return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]} ${d}`; }
function enMonthName(m) { return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]; }
