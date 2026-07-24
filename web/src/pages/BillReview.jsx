import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar, Empty, catLabel } from '../ui.jsx';

// 账单 Review：基于 PurchaseRecord 归档，按月展示家庭/女佣两类清单的分类汇总与月度总额
const TYPE_META = { family: { color: 'var(--teal)', icon: '🏠' }, maid: { color: '#7c5cff', icon: '🥬' } };

export default function BillReview() {
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [cats, setCats] = useState(null);
  useEffect(() => { api.billReview().then(setData); api.categories().then(setCats); }, []);
  if (!data) return <><TopBar title={t('billReview')} /><Empty text="加载中…" /></>;
  const months = data.months;
  if (!months.length) return <><TopBar title={t('billReview')} /><Empty icon="📒" text={t('noData')} /></>;

  const typeLabel = (k) => k === 'maid' ? t('maidLists') : t('familyLists');
  const clbl = (c) => catLabel(cats, c, lang);
  const fmtMonth = (m) => en ? `${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m.slice(5)]} ${m.slice(0, 4)}` : `${m.slice(0, 4)}年${+m.slice(5)}月`;

  // 顶部柱状图：最近 12 个月，家庭/女佣堆叠
  const chart = [...months].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  const max = Math.max(...chart.map((m) => m.total), 0.01);

  return (
    <>
      <TopBar title={t('billReview')} />
      <div className="content">
        {/* 月度总额柱状图 */}
        <div className="card">
          <div className="bold small" style={{ marginBottom: 10 }}>📊 {t('monthTotal2')}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
            {chart.map((m) => {
              const famAmt = m.types.find((x) => x.list_type === 'family')?.total || 0;
              const maidAmt = m.types.find((x) => x.list_type === 'maid')?.total || 0;
              return (
                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
                  <span className="tiny muted" style={{ fontSize: 9 }}>{m.total >= 1000 ? (m.total / 1000).toFixed(1) + 'k' : Math.round(m.total)}</span>
                  <div style={{ width: '100%', maxWidth: 26, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 84 }}>
                    {maidAmt > 0 && <div style={{ height: Math.max(2, maidAmt / max * 84), background: TYPE_META.maid.color, borderRadius: '3px 3px 0 0' }} />}
                    <div style={{ height: Math.max(2, famAmt / max * 84), background: TYPE_META.family.color, borderRadius: maidAmt > 0 ? '0 0 0 0' : '3px 3px 0 0' }} />
                  </div>
                  <span className="tiny muted" style={{ fontSize: 9 }}>{+m.month.slice(5) + (en ? '' : '月')}</span>
                </div>
              );
            })}
          </div>
          <div className="row mt8" style={{ gap: 12, justifyContent: 'center' }}>
            {['family', 'maid'].map((k) => (
              <span key={k} className="tiny muted"><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: TYPE_META[k].color, marginRight: 4 }} />{typeLabel(k)}</span>
            ))}
          </div>
        </div>

        {/* 逐月明细：家庭 / 女佣分开展示 */}
        {months.map((m) => (
          <div key={m.month}>
            <div className="section-title spread">
              <span>📅 {fmtMonth(m.month)}</span>
              <span className="bold" style={{ color: 'var(--teal)' }}>S${m.total.toFixed(2)}</span>
            </div>
            {['family', 'maid'].map((k) => {
              const tp = m.types.find((x) => x.list_type === k);
              if (!tp) return null;
              return (
                <div key={k} className="card" style={{ borderLeft: `3px solid ${TYPE_META[k].color}` }}>
                  <div className="spread">
                    <span className="bold small">{TYPE_META[k].icon} {typeLabel(k)} <span className="tiny muted">{tp.lists} {en ? (tp.lists > 1 ? 'lists' : 'list') : '单'}</span></span>
                    <span className="bold" style={{ color: TYPE_META[k].color }}>S${tp.total.toFixed(2)}</span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {tp.by_category.map((c) => (
                      <div key={c.category} style={{ padding: '4px 0' }}>
                        <div className="spread">
                          <span className="small">{clbl(c.category)}</span>
                          <span className="small"><b>S${c.amount.toFixed(2)}</b> <span className="tiny muted">{tp.total ? (c.amount / tp.total * 100).toFixed(0) : 0}%</span></span>
                        </div>
                        <div style={{ height: 5, borderRadius: 3, background: 'var(--bg)', marginTop: 3 }}>
                          <div style={{ height: '100%', width: (tp.total ? c.amount / tp.total * 100 : 0) + '%', borderRadius: 3, background: TYPE_META[k].color, opacity: 0.75 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        <button className="btn outline block" onClick={() => nav('/expense')}>📈 {t('monthlyExpense')}</button>
      </div>
    </>
  );
}
