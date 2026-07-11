import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';

const CATS = ['体检', 'Work Permit 到期', '护照到期', '保险到期', '缴纳 Levy', '更新住址', 'MOM 预约', '其他'];
const REMIND = [[0, '当天'], [1, '提前1天'], [3, '提前3天'], [7, '提前7天']];
const REPEAT = [['none', '不重复'], ['monthly', '每月'], ['yearly', '每年']];

const STATUS = {
  overdue: ['已逾期', 'red'], due_today: ['待完成', 'amber'], upcoming: ['即将到期', 'blue'],
  done: ['已完成', 'green'], helper_done: ['待确认', 'purple'],
};
const badgeOf = (e) => e.status === 'helper_done' && e.display_status !== 'done' ? STATUS.helper_done : (STATUS[e.display_status] || STATUS.upcoming);

const blank = { title: '', category: '', event_date: '', remind_offset: 0, notify_helper: true, note: '', repeat_rule: 'none' };

// 雇主端：MOM 重要事项管理（女佣管理 → MOM 重要事项）。女佣只能查看/确认，创建管理仅雇主。
export default function MomEvents() {
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const nav = useNavigate();
  const { showToast } = useApp();
  const [helpers, setHelpers] = useState([]);
  const [helper, setHelper] = useState(null);
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);   // 表单：{...event} 或 blank；null=关闭
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => { api.bootstrap().then((b) => { const ms = (b.users || []).filter((u) => u.role === 'maid'); setHelpers(ms); setHelper(ms[0] || null); }); }, []);
  const load = () => api.momEvents(helper?.user_id).then(setRows).catch(() => setRows([]));
  useEffect(() => { if (helper !== undefined) load(); }, [helper]);

  const save = async () => {
    const f = editing;
    if (!f.title.trim()) return showToast(en ? 'Enter a title' : '请填写事项名称');
    if (!f.event_date) return showToast(en ? 'Pick a date' : '请选择事件日期');
    try {
      const body = { ...f, helper_id: helper?.user_id };
      if (f.mom_event_id) await api.momUpdate(f.mom_event_id, body); else await api.momCreate(body);
      setEditing(null); showToast((en ? 'Saved' : '已保存') + ' ✓'); load();
    } catch (e) { showToast((en ? 'Failed: ' : '保存失败：') + (e.code || '')); }
  };
  const confirmDone = async (e) => { try { await api.momConfirm(e.mom_event_id); showToast((en ? 'Done' : '已完成') + ' ✓'); load(); } catch { showToast(en ? 'Failed' : '操作失败'); } };
  const doDelete = async () => { try { await api.momDelete(confirmDel.mom_event_id); setConfirmDel(null); showToast((en ? 'Deleted' : '已删除') + ' ✓'); load(); } catch { showToast(en ? 'Failed' : '删除失败'); } };

  const set = (k, v) => setEditing((p) => ({ ...p, [k]: v }));

  return (
    <>
      <TopBar title="🇸🇬 MOM 重要事项" sub={helper ? `${helper.avatar} ${helper.name}` : ''} onBack={() => nav('/members')} />
      <div className="content">
        {/* 选择女佣 */}
        <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
          <div className="bold small" style={{ marginBottom: 8 }}>👩🏽‍🦱 {en ? 'For which helper' : '为哪位女佣'}</div>
          {helpers.length === 0
            ? <div className="tiny muted">{en ? 'No helper yet.' : '还没有女佣，请先邀请。'}</div>
            : <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
                {helpers.map((h) => <button key={h.user_id} className={'chip' + (helper?.user_id === h.user_id ? ' on' : '')} onClick={() => setHelper(h)}>{h.avatar} {h.name}</button>)}
              </div>}
        </div>

        {rows === null ? <Empty text="加载中…" />
          : rows.length === 0 ? <Empty text={en ? 'No MOM events yet' : '暂无 MOM 事项，点下方新增'} />
          : rows.map((e) => {
            const [label, color] = badgeOf(e);
            return (
              <div key={e.mom_event_id} className="card">
                <div className="spread">
                  <span className="bold">{e.title}</span>
                  <span className={'badge ' + color}>{label}</span>
                </div>
                <div className="tiny muted mt4">📅 {e.event_date}{e.repeat_rule !== 'none' ? ' · 🔁 ' + (e.repeat_rule === 'monthly' ? '每月' : '每年') : ''}{e.remind_offset ? ' · 🔔 提前' + e.remind_offset + '天' : ''}</div>
                {e.note && <div className="tiny muted mt4">📝 {e.note}</div>}
                <div className="row mt8" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {e.status !== 'done' && <button className="btn sm primary" onClick={() => confirmDone(e)}>{e.status === 'helper_done' ? (en ? 'Confirm done' : '确认完成') : (en ? 'Mark done' : '标记完成')}</button>}
                  <button className="btn sm outline" onClick={() => setEditing({ ...blank, ...e, notify_helper: !!e.notify_helper })}>{en ? 'Edit' : '编辑'}</button>
                  <button className="btn sm outline" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => setConfirmDel(e)}>{en ? 'Delete' : '删除'}</button>
                </div>
              </div>
            );
          })}
      </div>

      <div className="actionbar">
        <button className="btn primary block" disabled={!helper} onClick={() => setEditing({ ...blank })}>＋ {en ? 'Add MOM event' : '添加事项'}</button>
      </div>

      {/* 添加/编辑表单 */}
      {editing && (
        <div onClick={() => setEditing(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{ background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
            <div className="spread"><span className="bold" style={{ fontSize: 17 }}>{editing.mom_event_id ? (en ? 'Edit event' : '编辑事项') : (en ? 'Add MOM event' : '添加事项')}</span><button className="iconbtn" onClick={() => setEditing(null)}>✕</button></div>
            <div style={{ maxHeight: '72vh', overflowY: 'auto', marginTop: 12 }}>
              <div className="field">
                <label>{en ? 'Quick type' : '快捷类型'}</label>
                <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
                  {CATS.map((c) => <button key={c} className={'chip' + (editing.category === c ? ' on' : '')} onClick={() => setEditing((p) => ({ ...p, category: c, title: p.title || c }))}>{c}</button>)}
                </div>
              </div>
              <div className="field">
                <label>{en ? 'Title' : '事项名称'} <span className="req">*</span></label>
                <input className="input" value={editing.title} placeholder={en ? 'e.g. Semi-annual checkup' : '例如：半年体检'} onChange={(e) => set('title', e.target.value)} />
              </div>
              <div className="field">
                <label>{en ? 'Event date' : '事件日期'} <span className="req">*</span></label>
                <input className="input" type="date" value={editing.event_date} onChange={(e) => set('event_date', e.target.value)} />
              </div>
              <div className="field">
                <label>{en ? 'Remind' : '提醒时间'}</label>
                <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
                  {REMIND.map(([v, lbl]) => <button key={v} className={'chip' + (editing.remind_offset === v ? ' on' : '')} onClick={() => set('remind_offset', v)}>{lbl}</button>)}
                </div>
              </div>
              <div className="field">
                <label>{en ? 'Repeat' : '是否重复'}</label>
                <div className="seg">
                  {REPEAT.map(([v, lbl]) => <button key={v} className={'opt' + (editing.repeat_rule === v ? ' on' : '')} onClick={() => set('repeat_rule', v)}>{lbl}</button>)}
                </div>
              </div>
              <div className="field">
                <label>{en ? 'Note (address, documents to bring…)' : '备注（地址、需携带材料等）'}</label>
                <textarea className="input" rows={2} value={editing.note} onChange={(e) => set('note', e.target.value)} />
              </div>
              <div className="spread" style={{ padding: '4px 0' }}>
                <span className="bold small">{en ? 'Notify helper' : '通知女佣'}</span>
                <div className={'switch' + (editing.notify_helper ? ' on' : '')} onClick={() => set('notify_helper', !editing.notify_helper)}><i /></div>
              </div>
            </div>
            <button className="btn primary block mt12" onClick={save}>{en ? 'Save' : '保存'}</button>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
            <div className="bold" style={{ fontSize: 17 }}>⚠️ {en ? 'Delete this event?' : '确认删除该事项？'}</div>
            <div className="small muted" style={{ margin: '10px 0 16px' }}>「{confirmDel.title}」{en ? 'will be permanently removed.' : '将被删除，不可撤销。'}</div>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn outline grow" onClick={() => setConfirmDel(null)}>{t('cancel')}</button>
              <button className="btn danger grow" onClick={doDelete}>{en ? 'Delete' : '确认删除'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
