import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n, pick } from './i18n.jsx';
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

// 压缩并上传图片，返回 /uploads/... URL。步骤图等大图必须走这里：
// 手机原图 2-5MB，base64 过 JSON 再膨胀 33%，先在客户端压到 ~1280px/JPEG0.8（约150-300KB）
export async function compressAndUploadImage(file, { maxW = 1280, quality = 0.8, kind = 'image' } = {}) {
  const dataUrl = await new Promise((ok, err) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = err; fr.readAsDataURL(file); });
  const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = dataUrl; });
  const scale = Math.min(1, maxW / (img.width || maxW));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const r = await api.uploadAvatar({ image_base64: canvas.toDataURL('image/jpeg', quality), media_type: 'image/jpeg', kind });
  return r.url;
}

// 菜谱封面：是图片 URL 就渲染成图片填满容器，否则显示 emoji 文本
export function CoverThumb({ value, imgStyle }) {
  if (isImgAvatar(value)) return <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', ...imgStyle }} />;
  return <>{value}</>;
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

// 应用内大图预览：点击图片放大查看，点任意处关闭（避免 window.open 新开标签后回不到应用）
export function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="sheet-mask" style={{ alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 70 }} onClick={onClose}>
      <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.4)' }} />
    </div>
  );
}

// YouTube 链接转嵌入地址（watch?v= / youtu.be / shorts / embed 均可）；非 YouTube 返回 null
export function youtubeEmbed(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1&playsinline=1` : null;
}

// 「观看视频教程」按钮：YouTube 应用内弹层播放（不跳出应用），其他站点当前页打开（返回键可回）。
// 仅对 http(s) 链接渲染，防止 javascript:/data: 等可执行 scheme。无链接时不渲染。
export function VideoButton({ url }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!/^https?:\/\//i.test(url || '')) return null;
  return (
    <>
      <button className="btn sm outline mt12" onClick={() => { if (youtubeEmbed(url)) setOpen(true); else window.location.href = url; }}>
        ▶️ {t('watchVideo')}</button>
      {open && (
        <div className="sheet-mask" style={{ alignItems: 'center', padding: 16, zIndex: 70 }} onClick={() => setOpen(false)}>
          <div style={{ width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#000', borderRadius: 12, overflow: 'hidden' }}>
              <iframe src={youtubeEmbed(url)} title={t('watchVideo')} allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
            </div>
            <button className="btn outline block" style={{ marginTop: 12, background: 'var(--card)' }} onClick={() => setOpen(false)}>✕ {t('close')}</button>
          </div>
        </div>
      )}
    </>
  );
}

// 缩略图 + 点击应用内放大，自带状态，直接替换原来 window.open 的 <img>
export function ZoomImg({ src, className, style }) {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  return (
    <>
      <img src={src} alt="" className={className} onClick={() => setOpen(true)} style={{ cursor: 'zoom-in', ...style }} />
      {open && <Lightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
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

// 本地当天日期 YYYY-MM-DD（与服务端 ymd() 同格式，用于跟本周日期数组比对）
export function localYmd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 本周（周一~周日）7 个日期，与服务端 mondayOf()/ymd() 的"周一起始"规则保持一致
export function currentWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=周日…6=周六
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now); mon.setDate(now.getDate() - diff + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return localYmd(d); });
}

// 本周菜单：顶部 7 天日期胶囊 + 下方选中日的三餐；点击胶囊或在内容区左右滑动切换查看的那一天。
// days: 来自 GET /meals/week 的 days 数组；onDelete 传入则显示删除按钮（雇主端），不传则只读（女佣端）。
export function WeeklyMenu({ days, lang, t, onOpen, onDelete, weekOffset = 0, onWeekOffset }) {
  const todayIdx = days.findIndex((d) => d.isToday);
  const [idx, setIdx] = useState(todayIdx >= 0 ? todayIdx : 0);
  const day = days[idx];
  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx < -40 && idx < 6) setIdx(idx + 1);
    else if (dx > 40 && idx > 0) setIdx(idx - 1);
  };
  const labels = [t('monS'), t('tueS'), t('wedS'), t('thuS'), t('friS'), t('satS'), t('sunS')];
  const weekLabel = weekOffset === 0 ? t('thisWeek') : weekOffset === 1 ? t('nextWeek') : `${days[0].date.slice(5)} ~ ${days[6].date.slice(5)}`;
  return (
    <div>
      {onWeekOffset && (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <button className="iconbtn" onClick={() => onWeekOffset(weekOffset - 1)}>‹</button>
          <span className="small bold" onClick={() => weekOffset !== 0 && onWeekOffset(0)} style={{ cursor: weekOffset !== 0 ? 'pointer' : 'default' }}>
            {weekLabel}{weekOffset !== 0 && <span className="tiny muted"> ({days[0].date.slice(5)}~{days[6].date.slice(5)})</span>}</span>
          <button className="iconbtn" onClick={() => onWeekOffset(weekOffset + 1)}>›</button>
        </div>
      )}
      <div className="row" style={{ gap: 4, justifyContent: 'space-between', marginBottom: 10 }}>
        {days.map((d, i) => (
          <button key={d.date} onClick={() => setIdx(i)} style={{
            flex: 1, padding: '6px 2px', borderRadius: 10, textAlign: 'center', border: 'none',
            background: i === idx ? 'var(--teal)' : 'transparent', color: i === idx ? '#fff' : 'var(--ink-2)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{labels[i]}</div>
            <div style={{ fontSize: 11 }}>{+d.date.slice(8)}{d.meals.length > 0 ? ' ●' : ''}</div>
          </button>
        ))}
      </div>
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {day.meals.length === 0
          ? <div className="empty tiny" style={{ padding: '8px 0' }}>{lang === 'en' ? 'No dishes' : '暂无菜品'}</div>
          : [['breakfast', '🌅'], ['lunch', '🍚'], ['dinner', '🌙']].map(([mt, ic]) => {
            const ms = day.meals.filter((m) => m.meal_type === mt);
            if (!ms.length) return null;
            return (
              <div key={mt}>
                <div className="tiny muted bold" style={{ padding: '8px 0 2px' }}>{ic} {t(mt)}</div>
                {ms.map((m) => (
                  <div key={m.meal_order_id} className="list-item" onClick={() => onOpen(m.meal_order_id)}>
                    <div className="thumb"><CoverThumb value={m.recipe.cover_image} /></div>
                    <div className="grow">
                      <div className="bold">{pick(lang, m.recipe.name, m.recipe.name_en)}
                        <span className={'badge tiny ' + (m.recipe.recipe_type === 'baby' ? 'purple' : 'teal')} style={{ marginLeft: 6 }}>
                          {m.recipe.recipe_type === 'baby' ? t('baby') : t('adult')}</span>
                      </div>
                      <div className="small muted">{m.servings}{lang === 'en' ? ' ppl' : '人'}</div>
                    </div>
                    <StatusBadge status={m.status} />
                    {onDelete && <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={(e) => { e.stopPropagation(); onDelete(m); }} title={lang === 'en' ? 'Remove' : '删除'}>✕</button>}
                  </div>
                ))}
              </div>
            );
          })}
      </div>
    </div>
  );
}
