import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from './i18n.jsx';
import { api } from './api.js';

// 头像值是否为图片 URL（上传的本地图片 / data / http），否则视为 emoji
export const isImgAvatar = (v) => typeof v === 'string' && (v.startsWith('/uploads') || v.startsWith('data:') || v.startsWith('http'));

// 通用头像：URL 渲染成圆形图片，emoji 渲染成居中字符
export function Avatar({ value, size = 44, style }) {
  const s = { width: size, height: size, borderRadius: '50%', flex: 'none', ...style };
  if (isImgAvatar(value)) return <img src={value} alt="" style={{ ...s, objectFit: 'cover' }} />;
  return <span style={{ ...s, display: 'grid', placeItems: 'center', fontSize: Math.round(size * 0.52), background: 'var(--teal-l)' }}>{value || '👤'}</span>;
}

// 头像选择：一组 emoji + 「上传本地图片」
export function AvatarPicker({ value, onChange, emojis, showToast }) {
  const { lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((ok, err) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = err; fr.readAsDataURL(file); });
      const r = await api.uploadAvatar({ image_base64: dataUrl, media_type: file.type });
      onChange(r.url);
    } catch { showToast?.(lang === 'en' ? 'Upload failed' : '上传失败'); }
    setBusy(false); e.target.value = '';
  };
  return (
    <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', alignItems: 'center', gap: 8 }}>
      {isImgAvatar(value) && <img src={value} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', outline: '2.5px solid var(--teal)' }} />}
      {emojis.map((e) => <button key={e} className={'chip' + (value === e ? ' on' : '')} style={{ fontSize: 20 }} onClick={() => onChange(e)}>{e}</button>)}
      <label className="btn sm outline" style={{ cursor: 'pointer', flex: 'none' }}>
        {busy ? '⏳' : '📷 ' + (lang === 'en' ? 'Upload' : '上传图片')}
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} disabled={busy} />
      </label>
    </div>
  );
}

// 根据出生年月日自动算年龄（<2 岁显示月龄）
export function ageFromBirth(birth, lang) {
  if (!birth) return '';
  const b = new Date(birth); if (isNaN(b.getTime())) return '';
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months--;
  if (months < 0) return '';
  if (months < 24) return lang === 'en' ? `${months} mo` : `${months}个月`;
  return lang === 'en' ? `${Math.floor(months / 12)} yr` : `${Math.floor(months / 12)}岁`;
}

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
