import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, StatusBadge, fmtTime, Empty, isImgAvatar, ZoomImg, compressAndUploadImage, ReceiptCompare } from '../ui.jsx';
import { useApp } from '../App.jsx';

const GROUPS = ['pending_review', 'to_buy', 'bought', 'out_of_stock', 'sub_requested'];

export default function ShoppingPage({ role, detail }) {
  if (detail) return <ShoppingDetail />;
  return <ShoppingOverview role={role} />;
}

// 女佣每周食材申请卡片：女佣提交/撤回，雇主 review（加入清单 / 线上买 / 拒绝）
function MaidRequestCard({ role, t, lang, showToast, onListsChanged }) {
  const { data: mr, reload } = useAsync(() => api.maidRequests());
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  if (!mr) return null;
  const submit = async () => {
    if (!name.trim()) return;
    await api.addMaidRequest({ name: name.trim(), quantity: +qty || 1 });
    setName(''); setQty(''); showToast(t('maidReqAdd') + ' ✓'); reload();
  };
  const review = async (id, action) => {
    await api.reviewMaidRequest(id, { action });
    showToast('✓'); reload();
    if (action === 'to_list') onListsChanged?.();
  };
  const badge = { pending: ['gray', t('reqPending')], to_list: ['teal', t('reqToList')], online: ['blue', t('reqOnline')], rejected: ['red', t('reqRejected')] };
  if (role === 'employer' && mr.requests.length === 0) return null; // 雇主无申请时不占位
  return (
    <div className="card">
      <div className="spread">
        <span className="bold small">🥬 {t('maidReqTitle')}</span>
        <span className="tiny muted">{t('maidReqDeadline')} {mr.deadline.slice(5)} ({t('friS')})</span>
      </div>
      {role === 'maid' && <div className="tiny muted" style={{ margin: '4px 0 8px' }}>{t('maidReqHint')}</div>}
      {mr.requests.length === 0 && <div className="tiny muted" style={{ padding: '6px 0' }}>{t('maidReqEmpty')}</div>}
      {mr.requests.map((r) => (
        <div key={r.request_id} className="spread" style={{ padding: '6px 0', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <span className="small bold">{pick(lang, r.name, r.name_en)}</span>
            <span className="tiny muted"> ×{r.quantity}{r.unit || ''}</span>
          </div>
          {r.status === 'pending' && role === 'employer'
            ? <div className="row" style={{ gap: 4, flex: 'none' }}>
                <button className="btn sm primary" onClick={() => review(r.request_id, 'to_list')}>➕ {t('reviewToList')}</button>
                <button className="btn sm outline" onClick={() => review(r.request_id, 'online')}>🛒 {t('reviewOnline')}</button>
                <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => review(r.request_id, 'rejected')}>✕</button>
              </div>
            : r.status === 'pending' && role === 'maid'
            ? <div className="row" style={{ gap: 6, flex: 'none', alignItems: 'center' }}>
                <span className={'badge tiny ' + badge[r.status][0]}>{badge[r.status][1]}</span>
                <button className="iconbtn" onClick={async () => { await api.deleteMaidRequest(r.request_id); reload(); }} title={t('withdraw')}>✕</button>
              </div>
            : <span className={'badge tiny ' + badge[r.status][0]} style={{ flex: 'none' }}>{badge[r.status][1]}</span>}
        </div>
      ))}
      {role === 'maid' && (
        <div className="row mt8" style={{ gap: 6 }}>
          <input className="input" style={{ flex: 2 }} placeholder={t('maidReqName')} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" style={{ flex: 1 }} type="number" placeholder={t('itemQty')} value={qty} onChange={(e) => setQty(e.target.value)} />
          <button className="btn sm primary" style={{ flex: 'none' }} onClick={submit}>{t('maidReqAdd')}</button>
        </div>
      )}
    </div>
  );
}

function ShoppingOverview({ role }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { data: lists, reload } = useAsync(() => api.shoppingLists());
  const [trash, setTrash] = useState(null); // null=未展开
  const { showToast } = useApp();
  const toggleTrash = async () => setTrash(trash ? null : await api.trashLists());
  const restore = async (id) => {
    await api.restoreList(id); showToast(t('restoreList') + ' ✓');
    setTrash(await api.trashLists()); reload();
  };
  return (
    <>
      <div className="topbar"><h1>{t('shopping')}</h1>
        {role === 'employer' && <button className="iconbtn" onClick={toggleTrash} title={t('trashBin')} style={trash ? { color: 'var(--teal)' } : undefined}>🗑</button>}
        {role === 'employer' && <button className="iconbtn" onClick={() => nav('/bill-review')} title={t('billReview')}>📒</button>}
        {role === 'employer' && <button className="iconbtn" onClick={() => nav('/expense')} title={t('monthlyExpense')}>📊</button>}
        {role === 'employer' && <button className="iconbtn" onClick={() => nav('/shopping-new')}>＋</button>}
      </div>
      <div className="content">
        <MaidRequestCard role={role} t={t} lang={lang} showToast={showToast} onListsChanged={reload} />
        {trash && (
          <div className="card" style={{ background: 'var(--bg)' }}>
            <div className="bold small" style={{ marginBottom: 6 }}>🗑 {t('trashBin')}</div>
            {trash.length === 0 ? <div className="tiny muted">{t('trashEmpty')}</div> : trash.map((l) => (
              <div key={l.shopping_list_id} className="spread" style={{ padding: '6px 0' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="small bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</div>
                  <div className="tiny muted">{l.items.length} {t('items')} · {t('deletedOn')} {(l.deleted_at || '').slice(0, 10)}</div>
                </div>
                <button className="btn sm outline" style={{ flex: 'none' }} onClick={() => restore(l.shopping_list_id)}>↩ {t('restoreList')}</button>
              </div>
            ))}
          </div>
        )}
        {!lists ? <Empty text="加载中…" /> : <ListGroups lists={lists} t={t} nav={nav} />}
      </div>
    </>
  );
}

// 清单列表：家庭采购 / 女佣食材分组展示（无女佣类清单时不显示分组标题）
function ListGroups({ lists, t, nav }) {
  const fam = lists.filter((l) => (l.list_type || 'family') !== 'maid');
  const maid = lists.filter((l) => l.list_type === 'maid');
  const Card = ({ l }) => (
    <div className="card tap" onClick={() => nav('/shopping-list/' + l.shopping_list_id)}>
      <div className="spread">
        <span className="bold">{l.title}</span>
        <StatusBadge status={l.status} />
      </div>
      <div className="small muted mt4">📍 {l.store_name} · {l.assignee?.name} · ⏰ {fmtTime(l.due_time)}</div>
      <div className="spread mt12">
        <span className="small muted">{l.items.length} {t('items')}</span>
        <span className="bold">{t('budget')} S${l.budget} · <span style={{ color: 'var(--teal)' }}>{t('actualTotal')} S${l.actual_total.toFixed(1)}</span></span>
      </div>
    </div>
  );
  if (!maid.length) return fam.map((l) => <Card key={l.shopping_list_id} l={l} />);
  return (
    <>
      {fam.length > 0 && <><div className="section-title">🏠 {t('familyLists')}</div>{fam.map((l) => <Card key={l.shopping_list_id} l={l} />)}</>}
      <div className="section-title">🥬 {t('maidLists')}</div>
      {maid.map((l) => <Card key={l.shopping_list_id} l={l} />)}
    </>
  );
}

function ShoppingDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { role, showToast } = useApp();
  const { data: l, reload } = useAsync(() => api.shopping(id), [id]);
  const [edit, setEdit] = useState(null); // {id, quantity, unit, specification, image_url}
  const [confirmDelList, setConfirmDelList] = useState(false);
  if (!l) return <><TopBar title={t('shoppingList')} /><div className="empty">加载中…</div></>;

  const mark = async (item, status) => { await api.patchItem(item.shopping_item_id, { status }); showToast('✓'); reload(); };
  const del = async (item) => { await api.deleteItem(item.shopping_item_id); showToast(lang === 'en' ? 'Removed' : '已删除'); reload(); };
  const openEdit = (it) => setEdit({ id: it.shopping_item_id, quantity: it.quantity ?? '', unit: it.unit || '', specification: it.specification || '', image_url: isImgAvatar(it.image_url) ? it.image_url : '' });
  const saveEdit = async () => {
    await api.patchItem(edit.id, { quantity: edit.quantity === '' ? undefined : +edit.quantity, unit: edit.unit, specification: edit.specification, image_url: edit.image_url || undefined });
    setEdit(null); showToast('✓'); reload();
  };
  const onEditImage = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { const url = await compressAndUploadImage(file, { kind: 'item' }); setEdit((p) => ({ ...p, image_url: url })); }
    catch { showToast(lang === 'en' ? 'Upload failed' : '上传失败'); }
    e.target.value = '';
  };
  const delList = async () => {
    await api.deleteList(l.shopping_list_id); showToast(lang === 'en' ? 'List deleted' : '清单已删除');
    nav(role === 'maid' ? '/m/shopping' : '/e/shopping', { replace: true });
  };

  const grouped = GROUPS.map((g) => ({ g, items: l.items.filter((i) => i.status === g || (g === 'bought' && i.status === 'sub_approved')) })).filter((x) => x.items.length);

  return (
    <>
      <TopBar title={l.title} right={role === 'employer' ? <div className="row" style={{ gap: 6 }}>
        <button className="iconbtn" onClick={() => nav('/shopping-list/' + l.shopping_list_id + '/add-item')}>＋</button>
        <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => setConfirmDelList(true)} title={t('deleteList')}>🗑</button>
      </div> : <button className="iconbtn" onClick={() => nav('/shopping-list/' + l.shopping_list_id + '/add-item')}>＋</button>} />
      <div className="content">
        <div className="card">
          <div className="spread"><StatusBadge status={l.status} /><span className="small muted">📍 {l.store_name}</span></div>
          <div className="stat-grid mt12">
            <div><div className="muted small">{t('budget')}</div><div className="bold" style={{ fontSize: 18 }}>S${l.budget}</div></div>
            <div><div className="muted small">{t('estTotal')}</div><div className="bold" style={{ fontSize: 18 }}>S${l.est_total.toFixed(1)}</div></div>
            <div><div className="muted small">{t('actualTotal')}</div><div className="bold" style={{ fontSize: 18, color: 'var(--teal)' }}>S${l.actual_total.toFixed(1)}</div></div>
            <div><div className="muted small">{t('items')}</div><div className="bold" style={{ fontSize: 18 }}>{l.items.length}</div></div>
          </div>
        </div>

        {grouped.map(({ g, items }) => (
          <div key={g}>
            <div className="section-title"><StatusBadge status={g} /></div>
            <div className="card">
              {items.map((it) => (
                <div key={it.shopping_item_id}>
                  <div className="list-item">
                    <div className="thumb">{isImgAvatar(it.image_url)
                      ? <ZoomImg src={it.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} />
                      : it.image_url}</div>
                    <div className="grow">
                      <div className="bold">{pick(lang, it.name, it.name_en)} {it.urgency === 'urgent' && <span className="badge red tiny">{t('urgent')}</span>}</div>
                      <div className="tiny muted">{it.quantity}{it.unit}{it.brand ? ' · ' + it.brand : ''}{it.specification ? ' · ' + it.specification : ''}</div>
                      {it.actual_total != null && <div className="tiny" style={{ color: 'var(--teal)' }}>{t('actualTotal')} S${it.actual_total.toFixed(2)}</div>}
                      {it.status === 'sub_requested' && <div className="tiny" style={{ color: 'var(--amber)' }}>→ {it.sub_name} ({it.sub_reason})</div>}
                    </div>
                    {/* 行内操作 */}
                    {role === 'maid' && it.status === 'to_buy' && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button className="btn sm primary" onClick={() => mark(it, 'bought')}>{t('markBought')}</button>
                      <button className="btn sm outline" onClick={() => mark(it, 'out_of_stock')}>{t('markOOS')}</button>
                    </div>}
                    {role === 'maid' && it.status === 'out_of_stock' && it.allow_substitute &&
                      <button className="btn sm amber" onClick={() => nav('/substitute/' + it.shopping_item_id)}>{t('applySub')}</button>}
                    {role === 'employer' && it.status === 'sub_requested' &&
                      <button className="btn sm amber" onClick={() => nav('/substitute/' + it.shopping_item_id)}>{t('subReview')}</button>}
                    {role === 'employer' && it.status === 'pending_review' && <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button className="btn sm primary" onClick={async () => { await api.reviewItem(it.shopping_item_id, true); showToast('✓'); reload(); }}>✓ {t('approve')}</button>
                      <button className="btn sm outline" onClick={async () => { await api.reviewItem(it.shopping_item_id, false); showToast(t('reject') + ' ✓'); reload(); }}>{t('reject')}</button>
                    </div>}
                    {role === 'employer' && it.status === 'to_buy' && <>
                      <button className="iconbtn" onClick={() => edit?.id === it.shopping_item_id ? setEdit(null) : openEdit(it)}>✏️</button>
                      <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => del(it)}>✕</button>
                    </>}
                  </div>
                  {/* 行内编辑：数量 / 单位 / 规格 / 参考图 */}
                  {edit?.id === it.shopping_item_id && (
                    <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 10, margin: '4px 0 8px' }}>
                      <div className="row" style={{ gap: 6 }}>
                        <input className="input" type="number" style={{ flex: 1 }} placeholder={t('itemQty')} value={edit.quantity} onChange={(e) => setEdit({ ...edit, quantity: e.target.value })} />
                        <input className="input" style={{ flex: 1 }} placeholder={t('itemUnit')} value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
                      </div>
                      <input className="input mt8" placeholder={t('itemSpec') + (lang === 'en' ? ' e.g. 500g bag' : '，如 500g/袋')} value={edit.specification} onChange={(e) => setEdit({ ...edit, specification: e.target.value })} />
                      <div className="row mt8" style={{ gap: 8, alignItems: 'center' }}>
                        <label className="btn sm outline" style={{ cursor: 'pointer' }}>
                          📷 {t('itemPhoto')}<input type="file" accept="image/*" style={{ display: 'none' }} onChange={onEditImage} />
                        </label>
                        {edit.image_url && <img src={edit.image_url} alt="" style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 8 }} />}
                        <div className="grow" />
                        <button className="btn sm outline" onClick={() => setEdit(null)}>{t('cancel')}</button>
                        <button className="btn sm primary" onClick={saveEdit}>{t('save')}</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* 空清单：引导雇主添加商品 */}
        {l.items.length === 0 && (
          <Empty icon="🛒" text={role === 'employer' ? t('addFirstItem') : t('noItems')} />
        )}
        <button className="btn outline block" onClick={() => nav('/shopping-list/' + l.shopping_list_id + '/add-item')}>＋ {t('addItem')}</button>

        {/* 金额核对 / 雇主审核对比（第 8 / 13 节） */}
        {(l.receipt_total != null || l.status === 'pending_confirm' || l.status === 'confirmed') && (
          <>
            <div className="section-title">🧮 {lang === 'en' ? 'Amount Check' : '金额核对'}</div>
            <div className="card">
              {l.subtotal != null && <Cmp label={t('itemsSubtotal')} val={l.subtotal} />}
              {l.gst != null && <Cmp label={t('gst') + '（' + Math.round((l.gst_rate||0.09)*100) + '%）'} val={l.gst} sign />}
              <Cmp label={t('helperTotal')} val={l.helper_total} bold />
              <Cmp label={t('receiptTotal')} val={l.receipt_total} />
              <Cmp label={t('diff')} val={l.amount_difference} sign color={Math.abs(l.amount_difference||0) <= 0.05 ? 'var(--green)' : 'var(--red)'} />
              <Cmp label={t('budget')} val={l.budget} />
              <Cmp label={t('budgetDiff')} val={l.helper_total != null ? +(l.helper_total - l.budget).toFixed(2) : null} sign />
              {l.employer_confirmed_total != null && <Cmp label={t('confirmedTotal')} val={l.employer_confirmed_total} bold />}
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, fontSize: 13,
                background: l.match_status==='matched' ? '#dcfce7' : l.match_status==='mismatch' ? '#fee2e2' : '#f1f5f9',
                color: l.match_status==='matched' ? '#166534' : l.match_status==='mismatch' ? '#b91c1c' : '#475569' }}>
                {l.match_status==='matched' ? '✅ '+t('amtMatched') : l.match_status==='mismatch' ? '⚠️ '+t('amtMismatch') : 'ℹ️ '+t('amtUnrecognized')}
                {l.difference_reason && <div className="tiny" style={{ marginTop: 4 }}>{lang==='en'?'Reason: ':'差异原因：'}{l.difference_reason}</div>}
              </div>
              <div className="row mt12" style={{ gap: 8, flexWrap: 'wrap' }}>
                {l.payment_method && <span className="badge gray">💳 {l.payment_method}</span>}
                {l.reimbursement_status && l.reimbursement_status!=='none' && <span className="badge amber">{l.reimbursement_status==='reimbursed'?t('reimDone'):t('reimTo')}</span>}
              </div>
            </div>
          </>
        )}

        {/* 分类小计（第 13.3 节） */}
        {l.category_breakdown?.length > 0 && (
          <div className="card">
            <div className="bold small" style={{ marginBottom: 8 }}>🏷️ {lang==='en'?'By Category':'分类小计'}</div>
            {l.category_breakdown.map((c) => (
              <div key={c.category} className="spread" style={{ padding: '4px 0' }}>
                <span className="small">{c.category}</span><span className="small bold">S${c.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {/* 小票 */}
        {l.receipt_image && <>
          <div className="section-title">🧾 {lang === 'en' ? 'Receipt' : '小票'}</div>
          <div className="card">
            {isImgAvatar(l.receipt_image)
              ? <ZoomImg src={l.receipt_image} style={{ maxWidth: '100%', maxHeight: 340, borderRadius: 10, display: 'block' }} />
              : <div className="thumb lg">{l.receipt_image}</div>}
            <ReceiptCompare data={l.receipt_items} listItems={l.items} lang={lang} t={t} />
            {l.payment_method && <div className="small muted mt8">{l.payment_method}</div>}
          </div>
        </>}
      </div>

      {/* 底部主操作 */}
      {role === 'maid'
        ? <div className="actionbar"><button className="btn primary block" onClick={() => nav('/shopping-list/' + l.shopping_list_id + '/settle')}>💰 {t('enterPrice')} · {t('settle')}</button></div>
        : <div className="actionbar">
            {l.status === 'pending_confirm' ? <>
              <button className="btn danger" onClick={async () => { await api.shoppingTransition(l.shopping_list_id, { to: 'returned' }); showToast(t('returnEdit') + ' ✓'); reload(); }}>↩ {t('returnEdit')}</button>
              <button className="btn primary" style={{ flex: 2 }} onClick={async () => { await api.shoppingTransition(l.shopping_list_id, { to: 'confirmed' }); showToast(t('confirmAccount') + ' ✓'); reload(); }}>✓ {t('confirmAccount')}</button>
            </> : l.status === 'confirmed' && l.reimbursement_status === 'to_reimburse'
              ? <button className="btn primary block" onClick={async () => { await api.shoppingTransition(l.shopping_list_id, { to: 'reimbursed' }); showToast(t('markReimbursed') + ' ✓'); reload(); }}>💵 {t('markReimbursed')}</button>
              : <button className="btn outline block" onClick={() => nav('/e/shopping')}>{t('viewProgress')}</button>}
          </div>}

      {/* 删除整个清单确认 */}
      {confirmDelList && (
        <div className="sheet-mask" onClick={() => setConfirmDelList(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bold">{t('deleteList')}？</div>
            <div className="tiny muted" style={{ margin: '6px 0 14px' }}>{t('deleteListConfirm')}（{l.items.length} {t('items')}）</div>
            <div className="btn-row">
              <button className="btn outline" onClick={() => setConfirmDelList(false)}>{t('cancel')}</button>
              <button className="btn danger" style={{ flex: 2 }} onClick={delList}>🗑 {t('deleteList')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Cmp({ label, val, sign, bold, color }) {
  return (
    <div className="spread" style={{ padding: '4px 0' }}>
      <span className={'small ' + (bold ? 'bold' : 'muted')}>{label}</span>
      <span className={bold ? 'bold' : 'small'} style={{ color }}>{val == null ? '—' : (sign && val >= 0 ? '+' : '') + 'S$' + (+val).toFixed(2)}</span>
    </div>
  );
}
