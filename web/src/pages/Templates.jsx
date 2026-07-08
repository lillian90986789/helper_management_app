import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, StatusBadge, Empty, weekdaysText } from '../ui.jsx';
import { useApp } from '../App.jsx';

// 固定任务管理页（PRD 任务清单模块修改版 第 5 节）+ 每周任务统计（第 10 节）
export default function Templates() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { showToast } = useApp();
  const [list, setList] = useState(null);
  const [boot, setBoot] = useState(null);
  const [stats, setStats] = useState(null);
  const [fArea, setFArea] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [fWeekday, setFWeekday] = useState(0);     // 0 = 全部
  const en = lang === 'en';

  const reload = () => api.templates().then(setList);
  useEffect(() => { reload(); api.bootstrap().then(setBoot); api.statsWeek().then(setStats); }, []);

  const op = async (id, name) => {
    if (name === 'delete' && !window.confirm(en ? 'Delete this fixed task? History records are kept.' : '删除该固定任务？历史完成记录将保留。')) return;
    await api.templateOp(id, name);
    showToast(en ? 'Done ✓' : '已处理 ✓');
    reload(); api.statsWeek().then(setStats);
  };

  const areas = boot?.areas || [];
  const filtered = (list || []).filter((tpl) => {
    if (fArea !== 'all' && tpl.area_id !== fArea) return false;
    if (fStatus !== 'all' && tpl.status !== fStatus) return false;
    if (fWeekday && !tpl.weekdays_arr.includes(fWeekday)) return false;
    return true;
  });

  const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  return (
    <>
      <TopBar title={t('fixedTasks')} right={<button className="iconbtn" onClick={() => nav('/task-new')}>＋</button>} />
      <div className="content">
        {/* 每周任务统计 */}
        {stats && (
          <>
            <div className="section-title">📊 {t('weekStats')}</div>
            <div className="card">
              <div className="spread" style={{ marginBottom: 10 }}>
                <span className="bold">{t('completionRate')}</span>
                <span className="bold" style={{ color: 'var(--teal)' }}>{stats.rate}%（{stats.done}/{stats.total}）</span>
              </div>
              <div className="prog"><i style={{ width: stats.rate + '%' }} /></div>
              <div className="row" style={{ gap: 4, marginTop: 12, justifyContent: 'space-between' }}>
                {stats.rows.map((r) => {
                  const max = Math.max(1, ...stats.rows.map((x) => x.total));
                  return (
                    <div key={r.date} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ height: 56, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                        <span title={en ? 'Done' : '已完成'} style={{ width: 7, height: (r.done / max) * 56 || 2, background: 'var(--teal)', borderRadius: 2 }} />
                        <span title={en ? 'Undone' : '未完成'} style={{ width: 7, height: (r.undone / max) * 56 || 2, background: 'var(--line)', borderRadius: 2 }} />
                      </div>
                      <div className="tiny muted" style={{ marginTop: 4 }}>{t(WD[r.weekday - 1])}</div>
                      <div className="tiny bold">{r.done}/{r.total}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* 筛选条件（PRD 5.2） */}
        <div className="section-title">🔎 {t('filter')}</div>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          <button className={'chip' + (fStatus === 'all' && fArea === 'all' && !fWeekday ? ' on' : '')}
            onClick={() => { setFStatus('all'); setFArea('all'); setFWeekday(0); }}>{t('all')}</button>
          <button className={'chip' + (fStatus === 'active' ? ' on' : '')} onClick={() => setFStatus(fStatus === 'active' ? 'all' : 'active')}>{t('enabled')}</button>
          <button className={'chip' + (fStatus === 'paused' ? ' on' : '')} onClick={() => setFStatus(fStatus === 'paused' ? 'all' : 'paused')}>{t('paused')}</button>
        </div>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginTop: 6 }}>
          {areas.map((a) => (
            <button key={a.area_id} className={'chip' + (fArea === a.area_id ? ' on' : '')}
              onClick={() => setFArea(fArea === a.area_id ? 'all' : a.area_id)}>{a.icon} {pick(lang, a.name, a.name_en)}</button>
          ))}
        </div>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginTop: 6 }}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button key={d} className={'chip' + (fWeekday === d ? ' on' : '')}
              onClick={() => setFWeekday(fWeekday === d ? 0 : d)}>{t(WD[d - 1])}</button>
          ))}
        </div>

        {/* 列表 */}
        <div className="section-title" style={{ marginTop: 16 }}>📋 {t('fixedTasks')} <span className="muted">{filtered.length}</span></div>
        {!list ? <Empty text="加载中…" /> : filtered.length === 0 ? <Empty icon="🗓️" text={t('noData')} /> :
          filtered.map((tpl) => (
            <div key={tpl.task_template_id} className="card">
              <div className="spread">
                <span className="bold ellipsis">{tpl.area?.icon || '🧹'} {pick(lang, tpl.task_name, tpl.task_name_en)}</span>
                <StatusBadge status={tpl.status} />
              </div>
              <div className="tiny muted mt4">
                {tpl.area && pick(lang, tpl.area.name, tpl.area.name_en)} · 🗓️ {weekdaysText(tpl.weekdays_arr, t)} · ⏳ {tpl.estimated_duration}{t('min')}
              </div>
              <div className="row mt8" style={{ gap: 6 }}>
                {tpl.assignee && <span className="tiny muted">{tpl.assignee.avatar} {tpl.assignee.name}</span>}
                {tpl.require_approval ? <span className="tiny muted">⚖️ {en ? 'Review' : '需审核'}</span> : null}
                {tpl.require_photo ? <span className="tiny muted">📷</span> : null}
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn sm outline" onClick={() => nav('/task-new/' + tpl.task_template_id)}>{t('edit')}</button>
                <button className="btn sm outline" onClick={() => op(tpl.task_template_id, 'duplicate')}>{t('duplicate')}</button>
                {tpl.status === 'active'
                  ? <button className="btn sm outline" onClick={() => op(tpl.task_template_id, 'pause')}>{t('pause')}</button>
                  : <button className="btn sm outline" onClick={() => op(tpl.task_template_id, 'resume')}>{t('resume')}</button>}
                <button className="btn sm danger" onClick={() => op(tpl.task_template_id, 'delete')}>{t('deleteTpl')}</button>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
