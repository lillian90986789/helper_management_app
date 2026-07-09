import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, WeekdayPicker, Avatar } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function TaskNew() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { id } = useParams();         // 有 id = 编辑模板
  const editing = !!id;
  const { showToast } = useApp();
  const { data: boot } = useAsync(() => api.bootstrap());
  const { data: existing } = useAsync(() => (editing ? api.template(id) : Promise.resolve(null)), [id]);

  const [f, setF] = useState({
    task_name: '', task_name_en: '', description: '', area_id: null, assignee_id: 2, priority: 'normal',
    estimated_duration: 30, weekdays: [1, 2, 3, 4, 5, 6, 7],
    require_photo: true, require_note: false, require_approval: true,
  });
  const [subtasks, setSubtasks] = useState([{ title: '' }]);
  const [loaded, setLoaded] = useState(false);

  // 编辑时回填
  if (editing && existing && !loaded) {
    setF({
      task_name: existing.task_name, task_name_en: existing.task_name_en || '', description: existing.description || '',
      area_id: existing.area_id, assignee_id: existing.assignee_id, priority: existing.priority,
      estimated_duration: existing.estimated_duration, weekdays: existing.weekdays_arr,
      require_photo: !!existing.require_photo, require_note: !!existing.require_note, require_approval: !!existing.require_approval,
    });
    setSubtasks(existing.checklist.length ? existing.checklist.map((c) => ({ title: c.title, title_en: c.title_en })) : [{ title: '' }]);
    setLoaded(true);
  }

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const submit = async (status) => {
    if (!f.task_name.trim()) return showToast(lang === 'en' ? 'Please enter task name' : '请填写任务名称');
    if (f.weekdays.length === 0) return showToast(t('atLeastOneDay'));
    const body = {
      ...f, status,
      checklist: subtasks.filter((s) => s.title.trim()).map((s) => ({ title: s.title, title_en: s.title_en || '', required: true })),
    };
    if (editing) { await api.updateTemplate(id, body); showToast(lang === 'en' ? 'Saved ✓' : '已保存 ✓'); nav(-1); }
    else { await api.createTemplate(body); showToast(status === 'draft' ? (lang === 'en' ? 'Draft saved' : '草稿已保存') : (lang === 'en' ? 'Published ✓' : '已发布 ✓')); nav('/e/tasks', { replace: true }); }
  };

  const areas = boot?.areas || [];
  // 可指定的执行人：家庭内女佣 + 家庭成员（§4.1）
  const assignees = (boot?.users || []).filter((u) => ['maid', 'member'].includes(u.role));
  // 新建任务默认派给第一个女佣（编辑时保留原执行人）
  useEffect(() => {
    if (editing || !assignees.length) return;
    if (!assignees.some((u) => u.user_id === f.assignee_id)) {
      const firstMaid = assignees.find((u) => u.role === 'maid') || assignees[0];
      if (firstMaid) set('assignee_id', firstMaid.user_id);
    }
  }, [boot]);

  return (
    <>
      <TopBar title={editing ? t('edit') : t('newTask')} />
      <div className="content">
        <div className="field">
          <label>{t('taskName')} <span className="req">*</span></label>
          <input className="input" value={f.task_name} maxLength={50} placeholder={lang === 'en' ? 'e.g. Clean kitchen' : '例如：打扫厨房'} onChange={(e) => set('task_name', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('taskDesc')}</label>
          <textarea className="input" value={f.description} placeholder={lang === 'en' ? 'Describe requirements…' : '描述具体要求…'} onChange={(e) => set('description', e.target.value)} />
        </div>

        {/* 每周执行日（核心改动） */}
        <div className="field">
          <label>{t('weekdayRun')} <span className="req">*</span></label>
          <WeekdayPicker value={f.weekdays} onChange={(v) => set('weekdays', v)} />
        </div>

        <div className="field">
          <label>{t('area')} <span className="req">*</span></label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {areas.map((a) => (
              <button key={a.area_id} className={'chip' + (f.area_id === a.area_id ? ' on' : '')} onClick={() => set('area_id', a.area_id)}>
                {a.icon} {pick(lang, a.name, a.name_en)}
              </button>
            ))}
          </div>
        </div>

        {/* 执行人：指定女佣或家庭成员（任务清单模块 §4.1） */}
        <div className="field">
          <label>{t('assignee')} <span className="req">*</span></label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {assignees.length === 0 ? <span className="tiny muted">{lang === 'en' ? 'No helper yet — invite one first' : '还没有女佣，请先邀请'}</span> :
              assignees.map((u) => (
                <button key={u.user_id} className={'chip' + (f.assignee_id === u.user_id ? ' on' : '')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => set('assignee_id', u.user_id)}>
                  <Avatar value={u.avatar} size={18} style={{ background: 'transparent' }} /> {u.name}{u.role === 'member' ? '·' + t('member') : ''}
                </button>
              ))}
          </div>
        </div>

        <div className="field">
          <label>{t('priority')} <span className="req">*</span></label>
          <div className="seg">
            {['normal', 'important', 'urgent'].map((p) => (
              <button key={p} className={'opt' + (f.priority === p ? ' on' : '')} onClick={() => set('priority', p)}>{t(p)}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('minDuration')}</label>
          <input className="input" type="number" value={f.estimated_duration} onChange={(e) => set('estimated_duration', +e.target.value)} />
        </div>

        <div className="card" style={{ padding: '4px 16px' }}>
          <Toggle label={t('requirePhoto')} on={f.require_photo} onClick={() => set('require_photo', !f.require_photo)} />
          <Toggle label={t('requireApproval')} on={f.require_approval} onClick={() => set('require_approval', !f.require_approval)} />
        </div>

        <div className="section-title">☑️ {t('subtasks')}</div>
        <div className="card">
          {subtasks.map((s, i) => (
            <div key={i} className="row" style={{ marginBottom: 8 }}>
              <span className="muted">{i + 1}.</span>
              <input className="input" value={s.title} placeholder={lang === 'en' ? 'Subtask…' : '子任务…'}
                onChange={(e) => setSubtasks((p) => p.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
              <button className="iconbtn" onClick={() => setSubtasks((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn sm outline block" onClick={() => setSubtasks((p) => [...p, { title: '' }])}>＋ {t('addSubtask')}</button>
        </div>
      </div>

      <div className="actionbar">
        {!editing && <button className="btn outline" onClick={() => submit('draft')}>{t('saveDraft')}</button>}
        <button className="btn primary" style={{ flex: 2 }} onClick={() => submit('active')}>{editing ? t('save') : t('publishTask')}</button>
      </div>
    </>
  );
}

function Toggle({ label, on, onClick }) {
  return (
    <div className="spread" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="bold small">{label}</span>
      <div className={'switch' + (on ? ' on' : '')} onClick={onClick}><i /></div>
    </div>
  );
}
