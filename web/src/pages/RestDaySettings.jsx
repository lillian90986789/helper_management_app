import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';

const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// 雇主端：休息日设置页（任务清单模块：日历查看 + 休息日设置 第 5 节）
export default function RestDaySettings() {
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const { showToast } = useApp();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [helpers, setHelpers] = useState([]);          // 家庭内所有女佣
  const [helper, setHelper] = useState(null);          // 当前为哪位女佣设置
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(new Set());          // 当前希望成为休息日的日期集合（含已保存）
  const [savedMap, setSavedMap] = useState({});        // date -> rest_day_id（已保存）
  const [notify, setNotify] = useState(true);
  const [confirm, setConfirm] = useState(null);        // 待确认：{ add:[], remove:[], conflicts:[] }

  useEffect(() => { api.bootstrap().then((b) => { const ms = (b.users || []).filter((u) => u.role === 'maid'); setHelpers(ms); setHelper(ms[0] || null); }); }, []);
  // 按当前选中的女佣加载其休息日（不传则用默认女佣）
  const load = (y, m) => api.month(y, m, helper?.user_id).then((d) => {
    setData(d);
    const s = new Set(); const map = {};
    d.rest_days.forEach((r) => { s.add(r.rest_date); map[r.rest_date] = r.rest_day_id; });
    setSel(s); setSavedMap(map);
  });
  useEffect(() => { load(ym.y, ym.m); }, [ym, helper]);

  const shiftMonth = (dir) => { let { y, m } = ym; m += dir; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } setYm({ y, m }); };
  const toggle = (ds) => setSel((prev) => { const n = new Set(prev); n.has(ds) ? n.delete(ds) : n.add(ds); return n; });

  const quickPick = (weekday) => setSel((prev) => {
    const n = new Set(prev);
    data.days.filter((d) => d.weekday === weekday).forEach((d) => n.add(d.date));
    return n;
  });
  const firstSunday = () => setSel((prev) => {
    const n = new Set(prev); const s = data.days.find((d) => d.weekday === 7); if (s) n.add(s.date); return n;
  });
  const clearMonth = () => setSel(new Set());

  const prepareSave = () => {
    const saved = new Set(Object.keys(savedMap));
    const add = [...sel].filter((d) => !saved.has(d));
    const remove = [...saved].filter((d) => !sel.has(d));
    if (add.length === 0 && remove.length === 0) return showToast(en ? 'No changes' : '没有变更');
    // 冲突：新增休息日当天已有任务
    const conflicts = add.filter((d) => { const day = data.days.find((x) => x.date === d); return day && day.total > 0 && !day.isRestDay; });
    if (conflicts.length > 0) setConfirm({ add, remove, conflicts, handle: 'cancel' });
    else doSave({ add, remove, handle: 'cancel' });
  };

  const doSave = async ({ add, remove, handle }) => {
    try {
      if (add.length) await api.setRestDays({ helper_id: helper?.user_id, dates: add, handle, notify });
      for (const d of remove) if (savedMap[d]) await api.cancelRestDay(savedMap[d]);
      setConfirm(null);
      showToast(t('restSaved') + ' ✓');
      load(ym.y, ym.m);
    } catch (e) { showToast((en ? 'Failed: ' : '保存失败：') + (e.code || e.message)); }
  };

  if (!data) return <><TopBar title={t('restDaySettings')} /><Empty text="加载中…" /></>;

  const monthTitle = en ? `${enMonth(ym.m)} ${ym.y}` : `${ym.y}年${ym.m}月`;
  const blanks = Array.from({ length: data.first_offset }, (_, i) => i);
  const changedCount = (() => {
    const saved = new Set(Object.keys(savedMap));
    return [...sel].filter((d) => !saved.has(d)).length + [...saved].filter((d) => !sel.has(d)).length;
  })();

  return (
    <>
      <TopBar title={t('restDaySettings')} sub={helper ? `${helper.avatar} ${helper.name}` : ''} />
      <div className="content">
        {/* 选择为哪位女佣设置休息日（多名女佣时显示；设置后只有该女佣收到通知） */}
        {helpers.length > 1 && (
          <div style={{ marginBottom: 10 }}>
            <div className="tiny muted" style={{ marginBottom: 4 }}>👩🏽‍🦱 {en ? 'Set rest day for' : '为哪位女佣设置'}</div>
            <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
              {helpers.map((h) => (
                <button key={h.user_id} className={'chip' + (helper?.user_id === h.user_id ? ' on' : '')} onClick={() => setHelper(h)}>{h.avatar} {h.name}</button>
              ))}
            </div>
          </div>
        )}

        {/* 月份导航 */}
        <div className="spread" style={{ marginBottom: 8 }}>
          <button className="chip" onClick={() => shiftMonth(-1)}>‹ {t('prevMonth')}</button>
          <span className="bold">{monthTitle}</span>
          <button className="chip" onClick={() => shiftMonth(1)}>{t('nextMonth')} ›</button>
        </div>
        <div className="tiny muted" style={{ marginBottom: 10 }}>
          🌙 {t('monthRest')}：{sel.size} · {t('selectDates')}
        </div>

        {/* 月历选择 */}
        <div className="card" style={{ padding: '10px 8px' }}>
          <div className="row" style={{ gap: 0 }}>
            {WD.map((w) => <div key={w} className="tiny muted" style={{ flex: 1, textAlign: 'center', padding: '2px 0', fontWeight: 700 }}>{t(w)}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginTop: 4 }}>
            {blanks.map((b) => <div key={'b' + b} />)}
            {data.days.map((d) => {
              const picked = sel.has(d.date);
              return (
                <button key={d.date} onClick={() => toggle(d.date)} style={{
                  position: 'relative', borderRadius: 10, minHeight: 46, padding: '4px 0',
                  border: picked ? '1.5px solid #7c5cff' : '1.5px solid var(--line)',
                  background: picked ? '#f3f0ff' : '#fff',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span className="bold" style={{ fontSize: 14, color: d.isToday ? 'var(--teal)' : 'var(--ink)' }}>{d.day}</span>
                  {picked ? <span style={{ fontSize: 11 }}>🌙</span>
                    : d.total > 0 ? <span className="tiny" style={{ color: 'var(--muted)', fontSize: 9 }}>{d.total}{en ? '' : '项'}</span>
                    : <span className="tiny" style={{ color: 'var(--line)', fontSize: 9 }}>·</span>}
                  {d.total > 0 && !picked && <span style={{ position: 'absolute', top: 3, right: 4, width: 5, height: 5, borderRadius: 3, background: 'var(--amber)' }} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 快捷选择（第 5.4 节） */}
        <div className="section-title">⚡ {en ? 'Quick pick' : '快捷选择'}</div>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          <button className="chip" onClick={() => quickPick(7)}>{t('allSundays')}</button>
          <button className="chip" onClick={() => quickPick(6)}>{t('allSaturdays')}</button>
          <button className="chip" onClick={() => quickPick(1)}>{t('allMondays')}</button>
          <button className="chip" onClick={firstSunday}>{t('firstSunday')}</button>
          <button className="chip" onClick={clearMonth}>{t('clearMonth')}</button>
        </div>

        <div className="card" style={{ padding: '4px 16px', marginTop: 12 }}>
          <div className="spread" style={{ padding: '12px 0' }}>
            <span className="bold small">{t('notifyHelper')}</span>
            <div className={'switch' + (notify ? ' on' : '')} onClick={() => setNotify(!notify)}><i /></div>
          </div>
        </div>
      </div>

      <div className="actionbar">
        <button className="btn primary" style={{ flex: 1 }} onClick={prepareSave}>
          {t('saveRest')}{changedCount > 0 ? `（${changedCount}）` : ''}
        </button>
      </div>

      {/* 已有任务处理弹层（第 6.2 节） */}
      {confirm && (
        <div className="sheet-mask" onClick={() => setConfirm(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bold">{t('existingTasksTitle')}</div>
            <div className="small muted" style={{ margin: '8px 0 12px' }}>
              {en ? `${confirm.conflicts.length} day(s) already have tasks. ` : `所选 ${confirm.conflicts.length} 天已有任务。`}{t('existingTasksMsg')}
            </div>
            <div className="seg" style={{ marginBottom: 14 }}>
              <button className={'opt' + (confirm.handle === 'cancel' ? ' on' : '')} onClick={() => setConfirm({ ...confirm, handle: 'cancel' })}>{t('cancelDayTasks')}</button>
              <button className={'opt' + (confirm.handle === 'keep' ? ' on' : '')} onClick={() => setConfirm({ ...confirm, handle: 'keep' })}>{t('keepDayTasks')}</button>
            </div>
            <div className="btn-row">
              <button className="btn outline" onClick={() => setConfirm(null)}>{t('cancel')}</button>
              <button className="btn primary" style={{ flex: 2 }} onClick={() => doSave(confirm)}>{t('confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function enMonth(m) { return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]; }
