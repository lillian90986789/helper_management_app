import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, StatusBadge, PriorityBadge, fmtTime, Avatar, ZoomImg } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function TaskDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { role, showToast } = useApp();
  const { data: task, reload } = useAsync(() => api.dailyTask(id), [id]);
  if (!task) return <><TopBar title={t('tasks')} /><div className="empty">加载中…</div></>;

  const doneChecks = task.checklist.filter((c) => c.status === 'done').length;
  const allChecked = task.checklist.length === 0 || doneChecks === task.checklist.length;
  const hasPhoto = task.attachments.some((a) => a.file_type === 'image');
  const refPhotos = task.attachments.filter((a) => a.file_type === 'reference');
  const completionPhotos = task.attachments.filter((a) => a.file_type !== 'reference');

  const trans = async (to, action) => { await api.taskTransition(task.task_id, { to, action, actor_id: role === 'maid' ? 2 : 1 }); showToast('✓'); reload(); };
  const toggle = async (cid) => { await api.toggleCheck(cid); reload(); };
  const fakeUpload = async () => { await api.addAttachment(task.task_id, { file_url: task.area?.icon || '📷', file_type: 'image', uploader_id: 2 }); showToast(t('uploadPhoto') + ' ✓'); reload(); };

  const submitDone = async () => {
    if (task.require_photo && !hasPhoto) return showToast(t('needPhotoHint'));
    if (!allChecked) return showToast(lang === 'en' ? 'Finish all subtasks first' : '请先完成全部子任务');
    await trans(task.require_approval ? 'pending_review' : 'done', '完成任务');
  };

  return (
    <>
      <TopBar title={pick(lang, task.title, task.title_en)} />
      <div className="content">
        {/* 头部状态 */}
        <div className="card">
          <div className="spread"><StatusBadge status={task.status} /><PriorityBadge priority={task.priority} /></div>
          <div className="bold mt8" style={{ fontSize: 19 }}>{pick(lang, task.title, task.title_en)}</div>
          <div className="row mt8" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="badge gray">📍 {task.area && pick(lang, task.area.name, task.area.name_en)}</span>
            <span className="badge gray">⏳ {task.estimated_duration}{t('min')}</span>
            {task.require_photo ? <span className="badge gray">📷 {lang==='en'?'Photo':'需照片'}</span> : null}
            {task.require_approval ? <span className="badge gray">⚖️ {lang==='en'?'Review':'需审核'}</span> : null}
            {task.assignee && <span className="badge gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Avatar value={task.assignee.avatar} size={16} style={{ background: 'transparent' }} /> {task.assignee.name}</span>}
          </div>
        </div>

        {task.description && <>
          <div className="section-title">📝 {t('taskInfo')}</div>
          <div className="card"><div style={{ lineHeight: 1.7 }}>{task.description}</div></div>
        </>}

        {/* 子任务 */}
        {task.checklist.length > 0 && <>
          <div className="section-title">☑️ {t('subtasks')} <span className="muted">{doneChecks}/{task.checklist.length}</span></div>
          <div className="card">
            {task.checklist.map((c) => (
              <div key={c.checklist_id} className="checkrow" onClick={() => role === 'maid' && toggle(c.checklist_id)}>
                <div className={'checkbox' + (c.status === 'done' ? ' on' : '')}>{c.status === 'done' ? '✓' : ''}</div>
                <span className={c.status === 'done' ? 'muted' : ''} style={{ textDecoration: c.status === 'done' ? 'line-through' : 'none' }}>
                  {pick(lang, c.title, c.title_en)}
                </span>
                {c.required ? <span className="badge red tiny" style={{ marginLeft: 'auto' }}>{lang==='en'?'Required':'必做'}</span> : null}
              </div>
            ))}
          </div>
        </>}

        {/* 雇主发布时的参考图片（只读） */}
        {refPhotos.length > 0 && <>
          <div className="section-title">📎 {lang === 'en' ? 'Reference photos' : '参考图片'}</div>
          <div className="card">
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {refPhotos.map((a) => <ZoomImg key={a.attachment_id} src={a.file_url} className="thumb lg" style={{ objectFit: 'cover' }} />)}
            </div>
          </div>
        </>}

        {/* 完成照片 */}
        <div className="section-title">📷 {t('attachments')} {task.require_photo && <span className="badge red tiny">{lang==='en'?'Required':'需照片'}</span>}</div>
        <div className="card">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {completionPhotos.map((a) => <div key={a.attachment_id} className="thumb lg">{a.file_url}</div>)}
            {role === 'maid' && ['in_progress','returned','received'].includes(task.status) &&
              <button className="thumb lg" style={{ border: '1.5px dashed var(--line)', background: '#fff' }} onClick={fakeUpload}>＋</button>}
            {completionPhotos.length === 0 && role !== 'maid' && <span className="muted small">{t('noData')}</span>}
          </div>
        </div>

        {/* 操作记录 */}
        {task.logs.length > 0 && <>
          <div className="section-title">🕑 {t('opLog')}</div>
          <div className="card"><div className="tl">
            {task.logs.map((l) => (
              <div key={l.log_id} className="tl-item">
                <div className="small"><b>{l.actor_name}</b> {l.action}</div>
                <div className="tiny muted">{fmtTime(l.created_at)}</div>
              </div>
            ))}
          </div></div>
        </>}
      </div>

      {/* 底部操作条：按角色 + 状态显示 */}
      <Actions task={task} role={role} t={t} trans={trans} submitDone={submitDone} nav={nav} />
    </>
  );
}

function Actions({ task, role, t, trans, submitDone, nav }) {
  const s = task.status;
  if (role === 'maid') {
    if (s === 'today_todo' || s === 'received') return <Bar><B onClick={() => trans('in_progress', '开始任务')} primary>▶ {t('start')}</B></Bar>;
    if (s === 'in_progress' || s === 'returned') return <Bar>
      <B onClick={() => trans('paused', '暂停')}>⏸ {t('pause')}</B>
      <B onClick={submitDone} primary flex2>✓ {t('markDone')}</B>
    </Bar>;
    if (s === 'paused') return <Bar><B onClick={() => trans('in_progress', '继续')} primary>▶ {t('start')}</B></Bar>;
    return <Bar><B onClick={() => nav(-1)}>{t('back')}</B></Bar>;
  }
  // 雇主
  const editTpl = () => nav('/task-new/' + task.task_template_id);
  if (s === 'pending_review') return <Bar>
    <B onClick={() => trans('returned', '退回重做')} danger>↩ {t('returnRedo')}</B>
    <B onClick={() => trans('done', '确认完成')} primary flex2>✓ {t('confirmDone')}</B>
  </Bar>;
  if (s === 'done') return <Bar><B onClick={() => nav('/task-new')}>＋ {t('newTask')}</B></Bar>;
  // 今日未完成（PRD §9）：雇主可标记为已完成 / 取消
  if (s === 'incomplete') return <Bar>
    <B onClick={() => trans('canceled', '取消任务')} danger>{t('cancelTask')}</B>
    <B onClick={() => trans('done', '标记为已完成')} primary flex2>✓ {t('markDone')}</B>
  </Bar>;
  return <Bar>
    <B onClick={() => trans('canceled', '取消任务')} danger>{t('cancelTask')}</B>
    {task.task_template_id
      ? <B onClick={editTpl} primary>✎ {t('editTask')}</B>
      : <B onClick={() => nav('/task-edit-adhoc/' + task.daily_task_id)} primary>✎ {t('editTask')}</B>}
  </Bar>;
}
const Bar = ({ children }) => <div className="actionbar">{children}</div>;
const B = ({ children, onClick, primary, danger, flex2 }) =>
  <button className={'btn ' + (primary ? 'primary' : danger ? 'danger' : 'outline')} style={flex2 ? { flex: 2 } : undefined} onClick={onClick}>{children}</button>;
