import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

const EMOJIS = ['🛒','🍅','🥚','🐟','🍚','🎃','🥬','🍗','🥛','🧴','🍶','🧻','🍎','🥦','🧀','🍞'];
const CATS = [['食材', 'Food'], ['宝宝用品', 'Baby'], ['清洁用品', 'Cleaning'], ['日用品', 'Daily']];

export default function ShoppingItemNew() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { showToast } = useApp();
  const empty = { name: '', category: '食材', image_url: '🛒', quantity: 1, unit: lang === 'en' ? 'pc' : '件',
    brand: '', specification: '', estimated_price: '', budget_limit: '', allow_substitute: true, urgency: 'normal', notes: '' };
  const [f, setF] = useState(empty);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const save = async (again) => {
    if (!f.name.trim()) return showToast(lang === 'en' ? 'Enter item name' : '请填写商品名称');
    await api.addItem(id, {
      ...f, estimated_price: +f.estimated_price || 0, budget_limit: +f.budget_limit || 0,
      quantity: +f.quantity || 1, allow_substitute: f.allow_substitute ? 1 : 0,
    });
    showToast(t('addItem') + ' ✓');
    if (again) setF({ ...empty });
    else nav('/shopping-list/' + id, { replace: true });
  };

  return (
    <>
      <TopBar title={t('addItem')} />
      <div className="content">
        {/* 商品图片 */}
        <div className="field">
          <label>{lang === 'en' ? 'Item Image' : '商品图片'}</label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {EMOJIS.map((e) => (
              <button key={e} className={'thumb' + (f.image_url === e ? '' : '')} onClick={() => set('image_url', e)}
                style={{ outline: f.image_url === e ? '2.5px solid var(--teal)' : 'none' }}>{e}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('itemName')} <span className="req">*</span></label>
          <input className="input" value={f.name} placeholder={lang === 'en' ? 'e.g. Tomato' : '例如：番茄'} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label>{t('itemCategory')}</label>
          <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {CATS.map(([zh, en]) => (
              <button key={zh} className={'chip' + (f.category === zh ? ' on' : '')} onClick={() => set('category', zh)}>{lang === 'en' ? en : zh}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field grow"><label>{t('itemQty')}</label><input className="input" type="number" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></div>
          <div className="field grow"><label>{t('itemUnit')}</label><input className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field grow"><label>{t('itemBrand')}</label><input className="input" value={f.brand} placeholder={lang === 'en' ? 'optional' : '可选'} onChange={(e) => set('brand', e.target.value)} /></div>
          <div className="field grow"><label>{t('itemSpec')}</label><input className="input" value={f.specification} placeholder={lang === 'en' ? 'e.g. 500g' : '例如 500g'} onChange={(e) => set('specification', e.target.value)} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field grow"><label>{t('estPrice')} (S$)</label><input className="input" type="number" step="0.1" value={f.estimated_price} onChange={(e) => set('estimated_price', e.target.value)} /></div>
          <div className="field grow"><label>{t('budgetLimit')} (S$)</label><input className="input" type="number" step="0.1" value={f.budget_limit} onChange={(e) => set('budget_limit', e.target.value)} /></div>
        </div>
        <div className="field">
          <label>{t('urgencyLabel')}</label>
          <div className="seg">
            {[['normal', t('normal')], ['urgent', t('urgent')]].map(([k, lbl]) => (
              <button key={k} className={'opt' + (f.urgency === k ? ' on' : '')} onClick={() => set('urgency', k)}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding: '4px 16px' }}>
          <div className="spread" style={{ padding: '12px 0' }}>
            <span className="bold small">{t('allowSub')}</span>
            <div className={'switch' + (f.allow_substitute ? ' on' : '')} onClick={() => set('allow_substitute', !f.allow_substitute)}><i /></div>
          </div>
        </div>
        <div className="field mt12">
          <label>{t('itemNote')}</label>
          <textarea className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>

      <div className="actionbar">
        <button className="btn outline" onClick={() => save(true)}>＋ {t('saveAndContinue')}</button>
        <button className="btn primary" style={{ flex: 2 }} onClick={() => save(false)}>{t('saveItem')}</button>
      </div>
    </>
  );
}
