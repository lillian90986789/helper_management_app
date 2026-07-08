import { useNavigate } from 'react-router-dom';
import { useI18n } from './i18n.jsx';

// 状态 → 徽章配色
const statusColor = {
  draft: 'gray', todo: 'gray', today_todo: 'gray', received: 'blue', in_progress: 'blue', paused: 'amber',
  pending_review: 'amber', returned: 'red', done: 'green', overdue: 'red', incomplete: 'red', skipped: 'gray', canceled: 'gray', active: 'green',
  to_receive: 'gray', checking: 'blue', ingredients_ready: 'green', ingredients_short: 'red',
  to_start: 'gray', preparing: 'blue', cooking: 'amber',
  to_buy: 'gray', buying: 'blue', partial: 'amber', sub_pending: 'amber', to_settle: 'amber',
  pending_confirm: 'amber', confirmed: 'green', reimbursed: 'green',
  bought: 'green', out_of_stock: 'red', sub_requested: 'amber', sub_approved: 'green', sub_rejected: 'red',
};
export function StatusBadge({ status }) {
  const { st } = useI18n();
  return <span className={'badge ' + (statusColor[status] || 'gray')}>● {st(status)}</span>;
}

const prColor = { normal: 'gray', important: 'amber', urgent: 'red' };
export function PriorityBadge({ priority }) {
  const { t } = useI18n();
  if (!priority || priority === 'normal') return null;
  return <span className={'badge ' + (prColor[priority] || 'gray')}>{t(priority)}</span>;
}

export function TopBar({ title, sub, teal, right, onBack }) {
  const nav = useNavigate();
  return (
    <div className={'topbar' + (teal ? ' teal' : '')}>
      {onBack !== false && (onBack ? <button className="back" onClick={onBack}>‹</button> : <button className="back" onClick={() => nav(-1)}>‹</button>)}
      <div className="grow">
        <h1 className="ellipsis">{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function fmtTime(iso) {
  if (!iso) return '--';
  try { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  catch { return iso; }
}

export function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}

export function Empty({ icon = '📭', text }) {
  return <div className="empty"><div className="ic">{icon}</div><div>{text}</div></div>;
}

// 每周执行日多选 + 快捷按钮（任务清单模块修改版）
export function WeekdayPicker({ value, onChange }) {
  const { t } = useI18n();
  const labels = [t('monS'), t('tueS'), t('wedS'), t('thuS'), t('friS'), t('satS'), t('sunS')];
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
  const quick = [
    [t('everyday'), [1, 2, 3, 4, 5, 6, 7]],
    [t('workdays'), [1, 2, 3, 4, 5]],
    [t('weekend'), [6, 7]],
    [t('clear'), []],
  ];
  return (
    <div>
      <div className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
        {labels.map((lbl, i) => {
          const d = i + 1, on = value.includes(d);
          return (
            <button key={d} onClick={() => toggle(d)} style={{
              flex: 1, height: 44, borderRadius: 12, fontWeight: 700, fontSize: 14,
              border: on ? '1.5px solid var(--teal)' : '1.5px solid var(--line)',
              background: on ? 'var(--teal)' : '#fff', color: on ? '#fff' : 'var(--ink-2)',
            }}>{lbl}</button>
          );
        })}
      </div>
      <div className="chips" style={{ marginTop: 10 }}>
        {quick.map(([lbl, days]) => (
          <button key={lbl} className="chip" onClick={() => onChange([...days])}>{lbl}</button>
        ))}
      </div>
    </div>
  );
}

// 采购两级分类选择（一级 + 食材二级级联，任务清单模块修改版风格）
export function CategoryPicker({ cats, primary, secondary, onChange, compact }) {
  const { t, lang } = useI18n();
  if (!cats) return null;
  const en = lang === 'en';
  const pickPrimary = (pc) => onChange(pc, pc === '食材' ? (secondary || cats.food_sub[0][0]) : null);
  return (
    <div className="field">
      {!compact && <label>{t('primaryCat')} <span className="req">*</span></label>}
      <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
        {cats.primary.map(([zh, enn, ic]) => (
          <button key={zh} className={'chip' + (primary === zh ? ' on' : '')} onClick={() => pickPrimary(zh)}>{ic} {en ? enn : zh}</button>
        ))}
      </div>
      {primary === '食材' && <>
        <label style={{ display: 'block', marginTop: 10 }}>{t('secondaryCat')} <span className="req">*</span></label>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {cats.food_sub.map(([zh, enn, ic]) => (
            <button key={zh} className={'chip' + (secondary === zh ? ' on' : '')} onClick={() => onChange('食材', zh)}>{ic} {en ? enn : zh}</button>
          ))}
        </div>
      </>}
    </div>
  );
}

// 分类中→英展示
export function catLabel(cats, name, lang) {
  if (!name) return '';
  if (lang !== 'en' || !cats) return name;
  const all = [...(cats.primary || []), ...(cats.food_sub || [])];
  const hit = all.find((x) => x[0] === name);
  return hit ? hit[1] : name;
}

// 把 weekdays 数组渲染成简短文字，例如 周一、周三、周五 / 每天
export function weekdaysText(arr, t) {
  if (!arr || arr.length === 0) return '--';
  if (arr.length === 7) return t('everyday');
  if (arr.length === 5 && [1,2,3,4,5].every((d) => arr.includes(d))) return t('workdays');
  if (arr.length === 2 && arr.includes(6) && arr.includes(7)) return t('weekend');
  const names = [t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat'), t('sun')];
  return arr.map((d) => names[d - 1]).join('·');
}
