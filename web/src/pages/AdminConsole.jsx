import { useState, useEffect } from 'react';
import { adminApi } from '../api.js';

// 管理员后台（MVP：单超级管理员，密钥 ADMIN_KEY）
export default function AdminConsole() {
  const [key, setKey] = useState(localStorage.getItem('hf_admin_key') || '');
  const [authed, setAuthed] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('dashboard');
  useEffect(() => { if (key) adminApi.ping().then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  const login = async () => {
    localStorage.setItem('hf_admin_key', key);
    try { await adminApi.ping(); setAuthed(true); setErr(''); } catch { setErr('密钥错误或后台未启用（需在服务器设置 ADMIN_KEY）'); setAuthed(false); }
  };
  if (!authed) return (
    <div style={{ maxWidth: 380, margin: '80px auto', padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>🔐 管理员后台</h2>
      <div className="field"><label>管理员密钥 (ADMIN_KEY)</label>
        <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} /></div>
      {err && <div className="tiny" style={{ color: 'var(--red)', marginTop: 6 }}>{err}</div>}
      <button className="btn primary block mt12" onClick={login}>进入</button>
    </div>
  );
  const tabs = [['dashboard', '📊 看板'], ['orders', '💳 待确认订单'], ['subs', '📅 订阅'], ['users', '👤 用户'], ['config', '🏦 收款码'], ['audit', '📝 审计']];
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <div className="spread"><h2>管理员后台</h2>
        <button className="btn sm outline" onClick={() => { localStorage.removeItem('hf_admin_key'); setAuthed(false); }}>退出</button></div>
      <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', margin: '12px 0' }}>
        {tabs.map(([k, l]) => <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'dashboard' && <Dash />}
      {tab === 'orders' && <Orders />}
      {tab === 'subs' && <Subs />}
      {tab === 'users' && <Users />}
      {tab === 'config' && <Config />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

const money = (n) => 'S$' + (+(n || 0)).toFixed(2);
const Scroll = ({ children }) => <div style={{ overflowX: 'auto' }}>{children}</div>;
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: 13, borderTop: '1px solid var(--line)', whiteSpace: 'nowrap' };

function Dash() {
  const [d, setD] = useState(null);
  useEffect(() => { adminApi.dashboard().then(setD).catch(() => {}); }, []);
  if (!d) return <div className="empty">加载中…</div>;
  const cell = (label, val, color) => (
    <div className="card" style={{ textAlign: 'center', padding: '14px 8px' }}>
      <div className="bold" style={{ fontSize: 22, color }}>{val}</div><div className="tiny muted">{label}</div>
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10 }}>
      {cell('用户总数', d.users_total)}{cell('雇主', d.employers)}{cell('女佣', d.maids)}{cell('家庭总数', d.families_total)}
      {cell('试用中', d.trial, 'var(--teal)')}{cell('月度订阅', d.monthly, 'var(--teal)')}{cell('年度订阅', d.yearly, 'var(--teal)')}{cell('即将到期', d.expiring_soon, 'var(--amber)')}
      {cell('已到期', d.expired, 'var(--red)')}{cell('待确认订单', d.pending_orders, 'var(--amber)')}
      {cell('今日收入', money(d.revenue_today), 'var(--teal)')}{cell('本月收入', money(d.revenue_month), 'var(--teal)')}{cell('累计收入', money(d.revenue_total), 'var(--teal)')}
    </div>
  );
}

function Orders() {
  const [rows, setRows] = useState([]); const [filter, setFilter] = useState('');
  const load = () => adminApi.orders(filter || undefined).then(setRows).catch(() => {});
  useEffect(() => { load(); }, [filter]);
  const confirm = async (no) => { if (!window.confirm('确认已收到该笔款项并开通订阅？')) return; try { await adminApi.confirmOrder(no); load(); } catch (e) { alert('失败: ' + e.code); } };
  const reject = async (no) => { const r = prompt('拒绝原因（可空）', ''); if (r === null) return; try { await adminApi.rejectOrder(no, r); load(); } catch {} };
  const setAmt = async (o) => {
    const v = prompt(`修改实收金额（打折/更正）\n当前 S$${(+o.amount).toFixed(2)}，改后收入统计会同步`, (+o.amount).toFixed(2));
    if (v === null) return; const reason = prompt('原因（如：老友8折）', '') || '';
    try { await adminApi.setOrderAmount(o.order_no, +v, reason); load(); } catch (e) { alert('失败：' + (e.code === 'invalid_amount' ? '金额无效' : e.code || '')); }
  };
  return (
    <div>
      <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginBottom: 10 }}>
        {[['', '全部'], ['SUBMITTED', '待确认'], ['PENDING', '未付款'], ['PAID', '已开通'], ['CANCELLED', '已拒绝']].map(([v, l]) =>
          <button key={v} className={'chip' + (filter === v ? ' on' : '')} onClick={() => setFilter(v)}>{l}</button>)}
      </div>
      <Scroll><table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['订单号', '家庭', '付款人', '套餐', '金额', '状态', '创建', '操作'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.order_no}>
              <td style={td}>{o.order_no}</td><td style={td}>{o.family_name}</td><td style={td}>{o.payer_name || '-'}</td>
              <td style={td}>{o.plan_id}</td><td style={td}>{money(o.amount)}</td>
              <td style={td}><span className={'badge ' + (o.status === 'PAID' ? 'green' : o.status === 'SUBMITTED' ? 'amber' : o.status === 'CANCELLED' ? 'red' : 'gray')}>{o.status}</span></td>
              <td style={td}>{(o.created_at || '').slice(0, 16)}</td>
              <td style={td}>
                {['PENDING', 'SUBMITTED'].includes(o.status) && <><button className="btn sm primary" onClick={() => confirm(o.order_no)}>确认开通</button> <button className="btn sm outline" onClick={() => reject(o.order_no)}>拒绝</button> </>}
                <button className="btn sm outline" onClick={() => setAmt(o)}>改金额</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={8}>无订单</td></tr>}
        </tbody>
      </table></Scroll>
    </div>
  );
}

function Subs() {
  const [rows, setRows] = useState([]);
  const load = () => adminApi.subscriptions().then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  const extend = async (fid) => { const days = prompt('延长天数', '7'); if (!days) return; const reason = prompt('原因（必填）', ''); if (!reason) return; try { await adminApi.extend(fid, { days: +days, reason }); load(); } catch (e) { alert('失败: ' + e.code); } };
  const lock = async (fid) => { if (!window.confirm('锁定该家庭？')) return; try { await adminApi.lock(fid, prompt('原因', '') || ''); load(); } catch {} };
  const unlock = async (fid) => { try { await adminApi.unlock(fid, prompt('原因', '') || ''); load(); } catch {} };
  return (
    <Scroll><table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead><tr>{['FID', '家庭', '主雇主', '套餐', '状态', '到期', '剩余', '累计付费', '操作'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.family_id}>
            <td style={td}>{r.family_id}</td><td style={td}>{r.family_name}</td><td style={td}>{r.owner_name || '-'}</td>
            <td style={td}>{r.plan_id}</td>
            <td style={td}><span className={'badge ' + (r.status === 'ACTIVE' ? 'green' : r.status === 'TRIAL_ACTIVE' ? 'blue' : r.status === 'EXPIRING_SOON' ? 'amber' : 'red')}>{r.status}</span></td>
            <td style={td}>{(r.expire_at || '').slice(0, 10)}</td><td style={td}>{r.remaining_days}天</td><td style={td}>{money(r.total_paid)}</td>
            <td style={td}>
              <button className="btn sm outline" onClick={() => extend(r.family_id)}>延长</button>{' '}
              {r.access_status === 'LOCKED' ? <button className="btn sm primary" onClick={() => unlock(r.family_id)}>解锁</button>
                : <button className="btn sm danger" onClick={() => lock(r.family_id)}>锁定</button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table></Scroll>
  );
}

// 通用「下拉多选 + 可输入」筛选器
function MultiFilter({ label, options, value, onChange, searchable }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const roleName = { employer: '雇主', maid: '女佣', member: '家庭成员' };
  const opts = (searchable ? options.filter((o) => o && o.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 60);
  const toggle = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div style={{ position: 'relative' }}>
      <button className={'btn sm ' + (value.length ? 'primary' : 'outline')} onClick={() => setOpen(!open)}>{label}{value.length ? `(${value.length})` : ''} ▾</button>
      {open && <>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9 }} />
        <div style={{ position: 'absolute', zIndex: 10, marginTop: 4, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: 8, minWidth: 180, maxHeight: 300, overflow: 'auto', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }}>
          {searchable && <input className="input" placeholder="输入筛选…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ marginBottom: 6 }} />}
          {opts.map((o) => (
            <label key={o} style={{ display: 'flex', gap: 8, padding: '6px 4px', cursor: 'pointer', fontSize: 13 }}>
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} /> {searchable ? o : (roleName[o] || o)}
            </label>
          ))}
          {opts.length === 0 && <div className="tiny muted" style={{ padding: 6 }}>无匹配</div>}
          {value.length > 0 && <button className="btn sm outline block" style={{ marginTop: 6 }} onClick={() => onChange([])}>清除</button>}
        </div>
      </>}
    </div>
  );
}

function Users() {
  const [rows, setRows] = useState([]); const [kw, setKw] = useState('');
  const [roleF, setRoleF] = useState([]); const [nameF, setNameF] = useState([]);
  const load = () => adminApi.users(kw || undefined).then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  const names = [...new Set(rows.map((u) => u.name).filter(Boolean))];
  const filtered = rows.filter((u) => (roleF.length === 0 || roleF.includes(u.role)) && (nameF.length === 0 || nameF.includes(u.name)));
  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="搜索：用户名/姓名/邮箱/家庭/ID" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn sm outline" style={{ flex: 'none' }} onClick={load}>搜索</button>
        <span className="tiny muted">筛选:</span>
        <MultiFilter label="角色" options={['employer', 'maid', 'member']} value={roleF} onChange={setRoleF} />
        <MultiFilter label="姓名" options={names} value={nameF} onChange={setNameF} searchable />
        {(roleF.length > 0 || nameF.length > 0) && <span className="tiny muted">已筛出 {filtered.length} / {rows.length}</span>}
      </div>
      <Scroll><table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{['ID', '姓名', '角色', '手机/邮箱', '家庭', '订阅', '到期', '个人付费', '最后登录'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {filtered.map((u) => (
            <tr key={u.user_id}>
              <td style={td}>{u.user_id}</td><td style={td}>{u.name}</td>
              <td style={td}>{u.role === 'employer' ? '雇主' : u.role === 'maid' ? '女佣' : u.role === 'member' ? '家庭成员' : u.role}</td>
              <td style={td}>{u.email || u.phone || '-'}</td><td style={td}>{u.family_name || '-'}</td>
              <td style={td}>{u.sub_status ? <span className={'badge ' + (u.sub_status === 'EXPIRED' ? 'red' : u.sub_status === 'TRIAL_ACTIVE' ? 'blue' : 'green')}>{u.sub_status}</span> : '-'}</td>
              <td style={td}>{(u.expire_at || '').slice(0, 10)}</td><td style={td}>{money(u.personal_paid)}</td><td style={td}>{(u.last_login_at || '').slice(0, 16)}</td>
            </tr>
          ))}
        </tbody>
      </table></Scroll>
      <div className="tiny muted mt8">🔒 手机号/邮箱已脱敏；后台不存储、不显示任何明文密码。</div>
    </div>
  );
}

function Config() {
  const [cfg, setCfg] = useState({});
  useEffect(() => { adminApi.getConfig().then(setCfg).catch(() => {}); }, []);
  const set = (k, v) => setCfg((p) => ({ ...p, [k]: v }));
  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const dataUrl = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(f); });
    const r = await adminApi.setConfig({ image_base64: dataUrl, media_type: f.type }); setCfg(r); e.target.value = '';
  };
  const savePrice = async () => {
    try { const r = await adminApi.setConfig({ orig_monthly: cfg.orig_monthly, disc_monthly: cfg.disc_monthly, orig_yearly: cfg.orig_yearly, disc_yearly: cfg.disc_yearly, promo_text: cfg.promo_text }); setCfg(r); alert('已保存，对所有用户实时生效'); }
    catch (e) { alert('失败：' + (e.code === 'invalid_price' ? '价格无效' : e.code === 'invalid_discount' ? '折扣需 0–100' : e.code || '')); }
  };
  const saveName = async () => { const r = await adminApi.setConfig({ paynow_name: cfg.paynow_name }); setCfg(r); alert('已保存'); };
  const finalPrice = (o, d) => { const p = (+o || 0) * (1 - (+d || 0) / 100); return isFinite(p) ? p.toFixed(2) : '—'; };
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))' }}>
      <div className="card">
        <div className="bold" style={{ marginBottom: 8 }}>💵 套餐价格与折扣 (S$)</div>
        <div className="tiny muted" style={{ marginBottom: 12 }}>设原价与折扣%，用户看到<b>原价划掉、折后价加粗</b>；实收=折后价。修改<b>对所有用户实时生效</b>，已购用户当前周期不变。</div>
        {[['monthly', '月度订阅 /月'], ['yearly', '年度订阅 /年']].map(([id, lbl]) => (
          <div key={id} style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 6 }}>
            <div className="bold small" style={{ marginBottom: 6 }}>{lbl}</div>
            <div className="row" style={{ gap: 8 }}>
              <div className="field grow" style={{ margin: 0 }}><label>原价</label>
                <input className="input" type="number" step="0.01" min="0" value={cfg['orig_' + id] ?? ''} onChange={(e) => set('orig_' + id, e.target.value)} /></div>
              <div className="field grow" style={{ margin: 0 }}><label>折扣 % off</label>
                <input className="input" type="number" step="1" min="0" max="100" value={cfg['disc_' + id] ?? ''} onChange={(e) => set('disc_' + id, e.target.value)} /></div>
            </div>
            <div className="tiny muted mt4">实收价：<b style={{ color: 'var(--teal)' }}>S${finalPrice(cfg['orig_' + id], cfg['disc_' + id])}</b>{+cfg['disc_' + id] > 0 && <> （原价 <span style={{ textDecoration: 'line-through' }}>S${(+cfg['orig_' + id] || 0).toFixed(2)}</span>）</>}</div>
          </div>
        ))}
        <div className="field" style={{ marginTop: 12 }}><label>促销文案（如「限时折扣，8折优惠」，留空则不显示）</label>
          <input className="input" value={cfg.promo_text ?? ''} maxLength={120} placeholder="限时折扣 · 新用户首月立减" onChange={(e) => set('promo_text', e.target.value)} /></div>
        <button className="btn primary mt12" onClick={savePrice}>保存价格 / 折扣 / 文案</button>
      </div>
      <div className="card">
        <div className="bold" style={{ marginBottom: 8 }}>🏦 PayNow 收款码</div>
        <div className="tiny muted" style={{ marginBottom: 12 }}>上传你的个人 PayNow 收款二维码，用户付款页会显示它。</div>
        {cfg.paynow_qr_url && <img src={cfg.paynow_qr_url} alt="qr" style={{ width: 160, height: 160, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 10, display: 'block', marginBottom: 10 }} />}
        <label className="btn outline" style={{ cursor: 'pointer' }}>📷 上传收款码<input type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} /></label>
        <div className="field" style={{ marginTop: 12 }}><label>收款方名称（可选）</label>
          <input className="input" value={cfg.paynow_name || ''} onChange={(e) => setCfg({ ...cfg, paynow_name: e.target.value })} /></div>
        <button className="btn primary mt12" onClick={saveName}>保存名称</button>
      </div>
    </div>
  );
}

function Audit() {
  const [rows, setRows] = useState([]);
  useEffect(() => { adminApi.audit().then(setRows).catch(() => {}); }, []);
  return (
    <Scroll><table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead><tr>{['时间', '管理员', '操作', '家庭', '用户', '原因'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.audit_log_id}>
            <td style={td}>{(a.created_at || '').slice(0, 16)}</td><td style={td}>{a.admin_id}</td><td style={td}>{a.action_type}</td>
            <td style={td}>{a.target_family_id || '-'}</td><td style={td}>{a.target_user_id || '-'}</td><td style={td}>{a.reason || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table></Scroll>
  );
}
