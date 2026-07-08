import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n, pick } from '../i18n.jsx';
import { StatusBadge, PriorityBadge, Empty } from '../ui.jsx';

const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export default function TaskList({ role }) {
  if (role === 'maid') return <MaidTaskList />;
  return <EmployerWeek />;
}

// ===== 雇主端：周视图 + 星期切换栏 =====
function EmployerWeek() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [weekStart, setWeekStart] = useState(null);     // 周一 ymd
  const [week, setWeek] = useState(null);
  const [selected, setSelected] = useState(null);       // 选中日期 ymd
  const [day, setDay] = useState(null);

  const loadWeek = (start) => api.week(start).then((w) => {
    setWeek(w); setWeekStart(w.start);
    const today = w.days.find((d) => d.isToday);
    const pickDate = (selected && w.days.some((d) => d.date === selected)) ? selected : (today ? today.date : w.days[0].date);
    setSelected(pickDate);
  });
  useEffect(() => { loadWeek(); }, []);
  useEffect(() => { if (selected) api.daily(selected).then(setDay); }, [selected]);

  const shiftWeek = (dir) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + dir * 7);
    const s = d.toISOString().slice(0, 10);
    setSelected(null); loadWeek(s);
  };
  const fmtRange = (a, b) => {
    const f = (s) => { const [, m, dd] = s.split('-'); return lang === 'en' ? `${+m}/${+dd}` : `${+m}月${+dd}日`; };
    return `${f(a)} — ${f(b)}`;
  };

  if (!week) return <><div className="topbar"><h1>{t('tasks')}</h1></div><Empty text="加载中…" /></>;

  return (
    <>
      <div className="topbar"><h1>{t('tasks')}</h1>
        <button className="iconbtn" onClick={() => nav('/rest-days')} title={t('restDaySettings')}>🌙</button>
        <button className="iconbtn" onClick={() => nav('/templates')} title={t('manageTemplates')}>⚙️</button>
        <button className="iconbtn" onClick={() => nav('/task-new')}>＋</button>
      </div>

      {/* 周导航 */}
      <div style={{ position: 'sticky', top: 61, zIndex: 20, background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
        <div className="spread" style={{ padding: '10px 16px 4px' }}>
          <button className="chip" onClick={() => shiftWeek(-1)}>‹ {t('prevWeek')}</button>
          <span className="bold small">{t('thisWeek')}：{fmtRange(week.start, week.end)}</span>
          <button className="chip" onClick={() => shiftWeek(1)}>{t('nextWeek')} ›</button>
        </div>
        {/* 星期切换栏 */}
        <div className="row" style={{ gap: 5, padding: '6px 12px 12px', overflowX: 'auto' }}>
          {week.days.map((d) => {
            const on = d.date === selected;
            return (
              <button key={d.date} onClick={() => setSelected(d.date)} style={{
                flex: '1 0 46px', minWidth: 46, borderRadius: 12, padding: '7px 2px', textAlign: 'center',
                border: on ? '1.5px solid var(--teal)' : '1.5px solid transparent',
                background: on ? 'var(--teal-l)' : d.isRestDay ? '#f3f0ff' : 'var(--bg)', position: 'relative',
              }}>
                <div className="tiny" style={{ color: on ? 'var(--teal-d)' : 'var(--muted)', fontWeight: 700 }}>{t(WD[d.weekday - 1])}</div>
                <div className="bold" style={{ fontSize: 15, color: d.isToday ? 'var(--teal)' : 'var(--ink)' }}>{+d.date.split('-')[2]}</div>
                <div className="tiny" style={{ color: 'var(--muted)' }}>{d.isRestDay ? '🌙' : `${d.done}/${d.total}`}</div>
                {!d.isRestDay && d.incomplete > 0 && <span style={{ position: 'absolute', top: 4, right: 6, width: 6, height: 6, borderRadius: 3, background: 'var(--red)' }} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="content" style={{ paddingTop: 12 }}>
        {(() => {
          const sel = week.days.find((d) => d.date === selected);
          if (sel?.isRestDay) return (
            <div className="card" style={{ textAlign: 'center', padding: '26px 16px' }}>
              <div style={{ fontSize: 38 }}>🌙</div>
              <div className="bold" style={{ marginTop: 8 }}>{t('restDay')}</div>
              <div className="tiny muted" style={{ marginTop: 4 }}>{t('restDayHint')}</div>
              <button className="btn sm outline mt12" onClick={() => nav('/rest-days')}>{t('restDaySettings')}</button>
            </div>
          );
          const visible = day ? day.tasks.filter((x) => x.status !== 'canceled') : [];
          if (!day) return <Empty text="加载中…" />;
          if (visible.length === 0) return <Empty icon="🗓️" text={t('noData')} />;
          return visible.map((task) => <TaskCard key={task.daily_task_id} task={task} onClick={() => nav('/task/' + task.daily_task_id)} />);
        })()}
      </div>
    </>
  );
}

// ===== 女佣端：今日任务，按区域分组，已完成沉底 =====
function MaidTaskList() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  useEffect(() => { api.daily().then(setData); }, []);
  if (!data) return <><div className="topbar"><h1>{t('tasks')}</h1></div><Empty text="加载中…" /></>;

  const mine = data.tasks.filter((t) => t.assignee_id === 2);
  const active = mine.filter((t) => !['done', 'skipped', 'canceled', 'incomplete'].includes(t.status));
  const finished = mine.filter((t) => ['done', 'skipped'].includes(t.status));

  // 按区域分组
  const groups = {};
  active.forEach((task) => {
    const key = task.area ? pick(lang, task.area.name, task.area.name_en) : (lang === 'en' ? 'Other' : '其他');
    (groups[key] ||= []).push(task);
  });

  return (
    <>
      <div className="topbar"><h1>{t('tasks')}</h1><span className="badge teal">{t('byArea')}</span></div>
      <div className="content" style={{ paddingTop: 12 }}>
        {Object.entries(groups).map(([area, tasks]) => (
          <div key={area}>
            <div className="section-title">{tasks[0].area?.icon || '📦'} {area} <span className="muted">{tasks.length}</span></div>
            {tasks.map((task) => <TaskCard key={task.daily_task_id} task={task} onClick={() => nav('/task/' + task.daily_task_id)} />)}
          </div>
        ))}
        {active.length === 0 && <Empty icon="✅" text={lang === 'en' ? 'All done for today!' : '今日任务全部完成！'} />}

        {finished.length > 0 && <>
          <div className="section-title">✅ {t('completedSection')} <span className="muted">{finished.length}</span></div>
          {finished.map((task) => <TaskCard key={task.daily_task_id} task={task} dim onClick={() => nav('/task/' + task.daily_task_id)} />)}
        </>}
      </div>
    </>
  );
}

function TaskCard({ task, onClick, dim }) {
  const { t, lang } = useI18n();
  const checks = task.checklist || [];
  const doneChecks = checks.filter((c) => c.status === 'done').length;
  return (
    <div className="card tap" onClick={onClick} style={dim ? { opacity: .62 } : undefined}>
      <div className="row">
        <div className="thumb">{task.area?.icon || '🧹'}</div>
        <div className="grow">
          <div className="spread">
            <span className="bold ellipsis">{pick(lang, task.title, task.title_en)}</span>
            <StatusBadge status={task.status} />
          </div>
          <div className="tiny muted mt4">
            {task.area && pick(lang, task.area.name, task.area.name_en)} · ⏳ {task.estimated_duration}{t('min')}
          </div>
          <div className="row mt8" style={{ gap: 6 }}>
            <PriorityBadge priority={task.priority} />
            {task.require_approval ? <span className="tiny muted">⚖️</span> : null}
            {task.require_photo ? <span className="tiny muted">📷</span> : null}
            {checks.length > 0 && <span className="tiny muted">☑ {doneChecks}/{checks.length}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
