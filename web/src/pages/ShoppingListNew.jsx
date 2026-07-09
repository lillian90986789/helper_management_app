import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar, Avatar } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function ShoppingListNew() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { showToast } = useApp();
  const [f, setF] = useState({ title: '', store_name: '', budget: '', due_time: '', assignee_id: null });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [maids, setMaids] = useState([]);
  useEffect(() => { api.bootstrap().then((b) => {
    const list = (b.users || []).filter((u) => u.role === 'maid');
    setMaids(list); if (list.length) set('assignee_id', list[0].user_id);
  }); }, []);

  const create = async () => {
    if (!f.title.trim()) return showToast(lang === 'en' ? 'Enter list name' : '请填写清单名称');
    const list = await api.createList({ ...f, budget: +f.budget || 0, assignee_id: f.assignee_id || 2 });
    showToast(t('newList') + ' ✓');
    // 创建后直接进入"添加商品"，方便雇主连续添加
    nav('/shopping-list/' + list.shopping_list_id + '/add-item', { replace: true });
  };

  return (
    <>
      <TopBar title={t('newList')} />
      <div className="content">
        <div className="field">
          <label>{t('listTitle')} <span className="req">*</span></label>
          <input className="input" value={f.title} placeholder={lang === 'en' ? 'e.g. Weekend groceries' : '例如：周末生鲜采购'} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('store')}</label>
          <input className="input" value={f.store_name} placeholder="e.g. NTUC FairPrice" onChange={(e) => set('store_name', e.target.value)} />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field grow"><label>{t('budget')} (S$)</label><input className="input" type="number" step="1" value={f.budget} onChange={(e) => set('budget', e.target.value)} /></div>
          <div className="field grow"><label>{t('dueTime')}</label><input className="input" type="time" value={f.due_time} onChange={(e) => set('due_time', e.target.value)} /></div>
        </div>
        <div className="field">
          <label>{t('assignBuyer')} <span className="req">*</span></label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {maids.length === 0 ? <span className="tiny muted">{lang === 'en' ? 'No helper yet — invite one first' : '还没有女佣，请先邀请'}</span> :
              maids.map((u) => (
                <button key={u.user_id} className={'chip' + (f.assignee_id === u.user_id ? ' on' : '')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => set('assignee_id', u.user_id)}><Avatar value={u.avatar} size={18} style={{ background: 'transparent' }} /> {u.name}</button>
              ))}
          </div>
        </div>
      </div>
      <div className="actionbar">
        <button className="btn outline" onClick={() => nav(-1)}>{t('cancel')}</button>
        <button className="btn primary" style={{ flex: 2 }} onClick={create}>{t('confirm')} · {t('addFirstItem')}</button>
      </div>
    </>
  );
}
