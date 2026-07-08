import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n, pick } from '../i18n.jsx';
import { TopBar, StatusBadge, Empty, catLabel } from '../ui.jsx';

// 采购月度账目汇总 + 分类占比统计（采购模块设计文档 第 14–17 节）
// 分类配色（占比图用）
const CAT_COLORS = ['#16a085', '#7c5cff', '#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#64748b', '#0ea5e9', '#f97316'];

export default function MonthlyExpense() {
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const nav = useNavigate();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [data, setData] = useState(null);
  const [cats, setCats] = useState(null);
  const [showFood, setShowFood] = useState(false);

  useEffect(() => { api.categories().then(setCats); }, []);
  useEffect(() => { setData(null); api.monthlyExpense(ym.y, ym.m).then(setData); }, [ym]);
  const shift = (d) => { let { y, m } = ym; m += d; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } setYm({ y, m }); };

  const title = en ? `${enMonth(ym.m)} ${ym.y}` : `${ym.y}年${ym.m}月`;
  if (!data) return <><TopBar title={t('monthlyExpense')} /><Empty text="加载中…" /></>;
  const s = data.summary;
  const clbl = (c) => catLabel(cats, c, lang);

  return (
    <>
      <TopBar title={t('monthlyExpense')} sub={title} />
      <div className="content">
        {/* 月份导航 */}
        <div className="spread" style={{ marginBottom: 8 }}>
          <button className="chip" onClick={() => shift(-1)}>‹ {t('prevMonth')}</button>
          <span className="bold">{title}</span>
          <button className="chip" onClick={() => shift(1)}>{t('nextMonth')} ›</button>
        </div>

        {/* 指标卡片（第 14.3 节） */}
        <div className="card">
          <div className="spread"><span className="muted small">{t('monthTotal2')}</span>
            <span className="bold" style={{ fontSize: 24, color: 'var(--teal)' }}>S${s.total_confirmed.toFixed(2)}</span></div>
          <div className="mini-grid mt12">
            <div className="mini"><div className="n">{s.count}</div><div className="l">{t('purchaseCount')}</div></div>
            <div className="mini"><div className="n">S${s.average.toFixed(0)}</div><div className="l">{t('avgPerPurchase')}</div></div>
            <div className="mini"><div className="n" style={{ color: 'var(--amber)' }}>S${s.pending.toFixed(0)}</div><div className="l">{t('pendingConfirm')}</div></div>
            <div className="mini"><div className="n" style={{ color: 'var(--green)' }}>S${s.reimbursed.toFixed(0)}</div><div className="l">{t('reimbursedAmt')}</div></div>
          </div>
          {s.to_reimburse > 0 && <div className="tiny" style={{ color: 'var(--amber)', marginTop: 8 }}>💵 {t('reimTo')}：S${s.to_reimburse.toFixed(2)}</div>}
        </div>

        {/* 一级分类占比（第 15.1 节） */}
        <div className="section-title">🏷️ {t('catShare')}</div>
        {data.primary.length === 0 ? <Empty icon="📊" text={t('noData')} /> : (
          <div className="card">
            {/* 占比条形图 */}
            <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 12 }}>
              {data.primary.map((c, i) => <div key={c.category} title={clbl(c.category)} style={{ width: c.pct + '%', background: CAT_COLORS[i % CAT_COLORS.length] }} />)}
            </div>
            {data.primary.map((c, i) => (
              <div key={c.category} className={'spread' + (c.category === '食材' ? ' tap' : '')} style={{ padding: '7px 0', cursor: c.category === '食材' ? 'pointer' : 'default' }}
                onClick={() => c.category === '食材' && setShowFood(!showFood)}>
                <span className="small"><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: CAT_COLORS[i % CAT_COLORS.length], marginRight: 6 }} />{clbl(c.category)}{c.category === '食材' && <span className="muted"> {showFood ? '▾' : '▸'}</span>}</span>
                <span className="small"><b>S${c.amount.toFixed(2)}</b> <span className="muted">{c.pct}%</span></span>
              </div>
            ))}
          </div>
        )}

        {/* 食材二级分类占比（第 15.2 节） */}
        {showFood && data.food.length > 0 && (
          <div className="card" style={{ borderLeft: '3px solid var(--teal)' }}>
            <div className="bold small" style={{ marginBottom: 8 }}>🥩 {t('foodDetail')} · {en ? 'Food total' : '食材合计'} S${s.food_total.toFixed(2)}</div>
            <div className="row" style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <span className="grow">{en ? 'Sub' : '分类'}</span><span style={{ width: 64, textAlign: 'right' }}>{en ? 'Amount' : '金额'}</span>
              <span style={{ width: 60, textAlign: 'right' }}>{t('pctOfFood')}</span><span style={{ width: 60, textAlign: 'right' }}>{t('pctOfTotal')}</span>
            </div>
            {data.food.map((c) => (
              <div key={c.category} className="row" style={{ padding: '6px 0' }}>
                <span className="grow small">{clbl(c.category)}</span>
                <span style={{ width: 64, textAlign: 'right' }} className="small bold">S${c.amount.toFixed(2)}</span>
                <span style={{ width: 60, textAlign: 'right' }} className="tiny muted">{c.pct_of_food}%</span>
                <span style={{ width: 60, textAlign: 'right' }} className="tiny muted">{c.pct_of_total}%</span>
              </div>
            ))}
          </div>
        )}

        {/* 月度采购记录列表（第 16 节） */}
        <div className="section-title">🧾 {t('records')} <span className="muted">{data.records.length}</span></div>
        {data.records.length === 0 ? <Empty icon="🛒" text={t('noData')} /> :
          data.records.map((r) => (
            <div key={r.shopping_list_id} className="card tap" onClick={() => nav('/shopping-list/' + r.shopping_list_id)}>
              <div className="spread">
                <span className="bold ellipsis">{r.title}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="tiny muted mt4">📍 {r.store_name} · {r.assignee} · {r.item_count} {t('items')} · {r.purchase_date || '—'}</div>
              <div className="spread mt8">
                <span className="small">
                  {r.match_status === 'matched' ? <span className="badge green tiny">✓ {t('amtMatched')}</span>
                    : r.match_status === 'mismatch' ? <span className="badge red tiny">≠ {t('amtMismatch')}</span> : null}
                  {!r.counted && <span className="badge gray tiny" style={{ marginLeft: 4 }}>{en ? 'Not counted' : '未计入'}</span>}
                </span>
                <span className="bold" style={{ color: 'var(--teal)' }}>S${r.amount.toFixed(2)}</span>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}

function enMonth(m) { return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]; }
