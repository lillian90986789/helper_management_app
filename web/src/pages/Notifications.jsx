import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync } from '../hooks.js';
import { useI18n } from '../i18n.jsx';
import { TopBar, fmtTime, Empty } from '../ui.jsx';
import { useApp } from '../App.jsx';

const ICON = { task: '🧹', meal: '🍽️', shopping: '🛒', system: '⚙️' };

export default function Notifications() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { role } = useApp();
  const { data } = useAsync(() => api.notifications(role), [role]);

  const go = (n) => {
    if (n.ref_type === 'task') nav('/task/' + n.ref_id);
    else if (n.ref_type === 'meal') nav('/meal/' + n.ref_id);
    else if (n.ref_type === 'shopping') nav('/shopping-list/' + n.ref_id);
  };

  return (
    <>
      <TopBar title={t('notifications')} right={<button className="iconbtn" style={{ fontSize: 13, width: 'auto', padding: '0 10px' }}>{t('markAllRead')}</button>} />
      <div className="content">
        {!data ? <Empty text="加载中…" /> : data.length === 0 ? <Empty icon="🔔" text={t('noData')} /> :
          data.map((n) => (
            <div key={n.notification_id} className="card tap" onClick={() => go(n)} style={{ opacity: n.is_read ? .6 : 1 }}>
              <div className="row">
                <div className="thumb" style={{ background: n.is_read ? 'var(--bg)' : 'var(--teal-l)' }}>{ICON[n.type] || '🔔'}</div>
                <div className="grow">
                  <div className="spread">
                    <span className="bold small">{n.title}</span>
                    {!n.is_read && <span className="dot" style={{ background: 'var(--red)' }} />}
                  </div>
                  <div className="tiny muted mt4">{n.content}</div>
                  <div className="tiny muted mt4">{fmtTime(n.created_at)}</div>
                </div>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}
