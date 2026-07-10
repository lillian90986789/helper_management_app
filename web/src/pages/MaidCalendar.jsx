import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, currentMaidId } from '../api.js';
import { useI18n, pick } from '../i18n.jsx';
import { StatusBadge, PriorityBadge, Empty } from '../ui.jsx';

const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// 女佣端任务日历页（任务清单模块：日历查看 + 休息日设置 第 3 节）
export default function MaidCalendar() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const en = lang !== 'zh';   // 非中文一律显示英文（回退）
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [view, setView] = useState('month');           // month | week
  const [data, setData] = useState(null);               // /month 返回
  const [selected, setSelected] = useState(null);       // 选中日期 ymd
  const [day, setDay] = useState(null);                 // 当天任务清单

  const todayStr = ymd(now);
  const maidId = currentMaidId();
  const load = (y, m) => api.month(y, m, maidId).then((d) => {
    setData(d);
    const pickDate = (selected && d.days.some((x) => x.date === selected)) ? selected
      : (d.days.find((x) => x.isToday)?.date || d.days[0].date);
    setSelected(pickDate);
  });
  useEffect(() => { load(ym.y, ym.m); }, [ym]);
  useEffect(() => { if (selected) api.daily(selected).then(setDay); }, [selected]);

  const shiftMonth = (dir) => {
    let { y, m } = ym; m += dir;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    setSelected(null); setYm({ y, m });
  };
  const goToday = () => { setSelected(todayStr); setYm({ y: now.getFullYear(), m: now.getMonth() + 1 }); };

  if (!data) return <><div className="topbar"><h1>{t('calendar')}</h1></div><Empty text={en ? "Loading…" : "加载中…"} /></>;

  const selDay = data.days.find((d) => d.date === selected);
  const monthTitle = en ? `${enMonth(ym.m)} ${ym.y}` : `${ym.y}年${ym.m}月`;

  return (
    <>
      <div className="topbar"><h1>{t('tasks')}</h1>
        <div className="seg" style={{ width: 128, flex: 'none' }}>
          <button className={'opt' + (view === 'month' ? ' on' : '')} onClick={() => setView('month')}>{t('monthView')}</button>
          <button className={'opt' + (view === 'week' ? ' on' : '')} onClick={() => setView('week')}>{t('weekView')}</button>
        </div>
      </div>

      {/* 月份导航 + 汇总 */}
      <div style={{ position: 'sticky', top: 61, zIndex: 20, background: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
        <div className="spread" style={{ padding: '10px 16px 6px' }}>
          <button className="chip" onClick={() => shiftMonth(-1)}>‹ {t('prevMonth')}</button>
          <span className="bold">{monthTitle}</span>
          <button className="chip" onClick={() => shiftMonth(1)}>{t('nextMonth')} ›</button>
        </div>
        <div className="spread" style={{ padding: '0 16px 8px' }}>
          <span className="tiny muted">🌙 {t('restCount')} <b style={{ color: 'var(--ink)' }}>{data.rest_count}</b> · ✅ {data.task_done}/{data.task_total}（{data.rate}%）</span>
          <button className="chip" onClick={goToday}>{t('backToday')}</button>
        </div>

        {view === 'month' ? (
          <MonthGrid data={data} selected={selected} onPick={setSelected} t={t} />
        ) : (
          <WeekStrip data={data} selected={selected} onPick={setSelected} t={t} todayStr={todayStr} />
        )}
      </div>

      {/* 选中日期详情 */}
      <div className="content" style={{ paddingTop: 12 }}>
        {selDay && <DayHeader d={selDay} t={t} en={en} />}
        {!selDay ? null : selDay.isRestDay ? (
          <div className="card" style={{ textAlign: 'center', padding: '28px 16px' }}>
            <div style={{ fontSize: 40 }}>🌙</div>
            <div className="bold" style={{ marginTop: 8 }}>{t('restDay')}</div>
            <div className="tiny muted" style={{ marginTop: 4 }}>{t('restDayHint')}</div>
          </div>
        ) : !day ? <Empty text={en ? "Loading…" : "加载中…"} /> : (
          <DayTasks day={day} nav={nav} t={t} lang={lang} maidId={maidId} />
        )}
      </div>
    </>
  );
}

function DayHeader({ d, t, en }) {
  const [y, m, dd] = d.date.split('-').map(Number);
  const dateLabel = en ? `${enMonth(m)} ${dd}` : `${m}月${dd}日`;
  return (
    <div className="spread" style={{ marginBottom: 8 }}>
      <span className="bold">{dateLabel} · {t(WD[d.weekday - 1])} {d.isToday && <span className="badge teal tiny">{en ? 'Today' : '今天'}</span>}</span>
      {!d.isRestDay && <span className="tiny muted">✅ {d.done}/{d.total} · ⏳ {d.undone - d.pending_review} · ⚖️ {d.pending_review}</span>}
    </div>
  );
}

// 按区域分组展示当天任务（仅当前女佣的任务）
function DayTasks({ day, nav, t, lang, maidId }) {
  const tasks = day.tasks.filter((x) => x.status !== 'canceled' && x.assignee_id === maidId);
  if (tasks.length === 0) return <Empty icon="🗓️" text={t('noData')} />;
  const active = tasks.filter((x) => !['done', 'skipped', 'incomplete'].includes(x.status));
  const finished = tasks.filter((x) => ['done', 'skipped', 'incomplete'].includes(x.status));
  const groups = {};
  active.forEach((task) => {
    const key = task.area ? pick(lang, task.area.name, task.area.name_en) : (lang !== 'zh' ? 'Other' : '其他');
    (groups[key] ||= []).push(task);
  });
  return (
    <>
      {Object.entries(groups).map(([area, list]) => (
        <div key={area}>
          <div className="section-title">{list[0].area?.icon || '📦'} {area} <span className="muted">{list.length}</span></div>
          {list.map((task) => <TaskCard key={task.daily_task_id} task={task} onClick={() => nav('/task/' + task.daily_task_id)} lang={lang} t={t} />)}
        </div>
      ))}
      {active.length === 0 && <Empty icon="✅" text={lang !== 'zh' ? 'All done!' : '全部完成！'} />}
      {finished.length > 0 && <>
        <div className="section-title">✅ {t('completedSection')} <span className="muted">{finished.length}</span></div>
        {finished.map((task) => <TaskCard key={task.daily_task_id} task={task} dim onClick={() => nav('/task/' + task.daily_task_id)} lang={lang} t={t} />)}
      </>}
    </>
  );
}

function TaskCard({ task, onClick, dim, lang, t }) {
  const checks = task.checklist || [];
  const doneChecks = checks.filter((c) => c.status === 'done').length;
  return (
    <div className="card tap" onClick={onClick} style={dim ? { opacity: .62 } : undefined}>
      <div className="row">
        <div className="thumb">{task.area?.icon || '🧹'}</div>
        <div className="grow">
          <div className="spread">
            <span className="bold ellipsis">{pick(lang, task.title, task.title_en)}
              {task.is_rest_day_task ? <span className="badge purple tiny" style={{ marginLeft: 6 }}>🌙 {t('restSpecialTask')}</span> : null}</span>
            <StatusBadge status={task.status} />
          </div>
          <div className="tiny muted mt4">{task.area && pick(lang, task.area.name, task.area.name_en)} · ⏳ {task.estimated_duration}{t('min')}</div>
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

// ===== 月历网格 =====
function MonthGrid({ data, selected, onPick, t }) {
  const blanks = Array.from({ length: data.first_offset }, (_, i) => i);
  return (
    <div style={{ padding: '2px 10px 10px' }}>
      <div className="row" style={{ gap: 0 }}>
        {WD.map((w) => <div key={w} className="tiny muted" style={{ flex: 1, textAlign: 'center', padding: '4px 0', fontWeight: 700 }}>{t(w)}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
        {blanks.map((b) => <div key={'b' + b} />)}
        {data.days.map((d) => {
          const on = d.date === selected;
          const bg = on ? 'var(--teal-l)' : d.isRestDay ? '#f3f0ff' : 'var(--bg)';
          const border = on ? '1.5px solid var(--teal)' : '1.5px solid transparent';
          return (
            <button key={d.date} onClick={() => onPick(d.date)} style={{
              position: 'relative', borderRadius: 10, border, background: bg, padding: '5px 0 4px', minHeight: 48,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
            }}>
              <span className="bold" style={{ fontSize: 14, color: d.isToday ? 'var(--teal)' : 'var(--ink)' }}>{d.day}</span>
              {d.isRestDay
                ? <span style={{ fontSize: 11, lineHeight: '12px' }}>🌙</span>
                : d.total > 0
                  ? <span className="tiny" style={{ color: 'var(--muted)', fontSize: 10 }}>{d.done}/{d.total}</span>
                  : <span className="tiny" style={{ color: 'var(--line)', fontSize: 10 }}>·</span>}
              {!d.isRestDay && d.incomplete > 0 && <span style={{ position: 'absolute', top: 4, right: 5, width: 5, height: 5, borderRadius: 3, background: 'var(--red)' }} />}
              {d.isToday && <span style={{ position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, background: 'var(--teal)' }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===== 周视图横条 =====
function WeekStrip({ data, selected, onPick, t, todayStr }) {
  // 取包含选中日的那一周（周一~周日）
  const sel = selected || todayStr;
  const selD = parseYmd(sel);
  const monday = new Date(selD); monday.setDate(selD.getDate() - (isoWd(selD) - 1));
  const week = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    const ds = ymd(dt);
    week.push(data.days.find((x) => x.date === ds) || { date: ds, day: dt.getDate(), weekday: i + 1, total: 0, done: 0, incomplete: 0, isRestDay: false, isToday: ds === todayStr });
  }
  return (
    <div className="row" style={{ gap: 5, padding: '4px 12px 12px', overflowX: 'auto' }}>
      {week.map((d) => {
        const on = d.date === selected;
        return (
          <button key={d.date} onClick={() => onPick(d.date)} style={{
            flex: '1 0 46px', minWidth: 46, borderRadius: 12, padding: '7px 2px', textAlign: 'center', position: 'relative',
            border: on ? '1.5px solid var(--teal)' : '1.5px solid transparent',
            background: on ? 'var(--teal-l)' : d.isRestDay ? '#f3f0ff' : 'var(--bg)',
          }}>
            <div className="tiny" style={{ color: on ? 'var(--teal-d)' : 'var(--muted)', fontWeight: 700 }}>{t(WD[d.weekday - 1])}</div>
            <div className="bold" style={{ fontSize: 15, color: d.isToday ? 'var(--teal)' : 'var(--ink)' }}>{d.day}</div>
            <div className="tiny" style={{ color: 'var(--muted)' }}>{d.isRestDay ? '🌙' : `${d.done}/${d.total}`}</div>
            {!d.isRestDay && d.incomplete > 0 && <span style={{ position: 'absolute', top: 4, right: 6, width: 6, height: 6, borderRadius: 3, background: 'var(--red)' }} />}
          </button>
        );
      })}
    </div>
  );
}

// ---- 小工具 ----
function ymd(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function isoWd(d) { const x = d.getDay(); return x === 0 ? 7 : x; }
function enMonth(m) { return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]; }
