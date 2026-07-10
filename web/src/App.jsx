import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Routes, Route, NavLink, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useI18n } from './i18n.jsx';
import { Toast } from './ui.jsx';

import EmployerHome from './pages/EmployerHome.jsx';
import MaidToday from './pages/MaidToday.jsx';
import TaskList from './pages/TaskList.jsx';
import TaskNew from './pages/TaskNew.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import Templates from './pages/Templates.jsx';
import MaidCalendar from './pages/MaidCalendar.jsx';
import RestDaySettings from './pages/RestDaySettings.jsx';
import Register from './pages/Register.jsx';
import EmployerAuth from './pages/EmployerAuth.jsx';
import JoinPage from './pages/JoinPage.jsx';
import MaidBind from './pages/MaidBind.jsx';
import MaidLogin from './pages/MaidLogin.jsx';
import { api } from './api.js';
import RecipeList from './pages/RecipeList.jsx';
import RecipeDetail from './pages/RecipeDetail.jsx';
import RecipeNew from './pages/RecipeNew.jsx';
import MealOrder from './pages/MealOrder.jsx';
import ShoppingPage from './pages/ShoppingPage.jsx';
import ShoppingListNew from './pages/ShoppingListNew.jsx';
import ShoppingItemNew from './pages/ShoppingItemNew.jsx';
import ShoppingSettle from './pages/ShoppingSettle.jsx';
import SubstituteReview from './pages/SubstituteReview.jsx';
import MonthlyExpense from './pages/MonthlyExpense.jsx';
import Notifications from './pages/Notifications.jsx';
import Members from './pages/Members.jsx';
import Me from './pages/Me.jsx';
import Subscribe from './pages/Subscribe.jsx';
import SubscribePay from './pages/SubscribePay.jsx';
import MaidLocked from './pages/MaidLocked.jsx';
import AdminConsole from './pages/AdminConsole.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const EMP_TABS = [
  { to: '/e/home', key: 'home', ic: '🏠' },
  { to: '/e/tasks', key: 'tasks', ic: '🧹' },
  { to: '/e/recipes', key: 'recipes', ic: '🍳' },
  { to: '/e/shopping', key: 'shopping', ic: '🛒' },
  { to: '/e/me', key: 'me', ic: '👤' },
];
const MAID_TABS = [
  { to: '/m/today', key: 'today', ic: '☀️' },
  { to: '/m/tasks', key: 'tasks', ic: '🧹' },
  { to: '/m/cooking', key: 'cooking', ic: '🍳' },
  { to: '/m/shopping', key: 'shopping', ic: '🛒' },
  { to: '/m/me', key: 'me', ic: '👤' },
];

function TabBar({ role }) {
  const { t } = useI18n();
  const tabs = role === 'employer' ? EMP_TABS : MAID_TABS;
  return (
    <nav className="tabbar">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className={({ isActive }) => 'tab' + (isActive ? ' on' : '')}>
          <span className="ic">{tab.ic}</span>
          <span>{t(tab.key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Clock() {
  return <>9:41</>;
}

export default function App() {
  const { lang, setLang, t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const [toast, setToast] = useState('');
  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 1600); }, []);

  // 角色「粘性」：仅在 /m/ 或 /e/ 底部导航下更新并记住；共享详情页（/meal、/members、/task、/shopping-list 等）沿用上次角色
  // 注意必须带斜杠判断——否则 /meal、/members 会被 startsWith('/m') 误判为女佣路由
  const [role, setRole] = useState(() => { try { return localStorage.getItem('hf_role') || 'employer'; } catch { return 'employer'; } });
  useEffect(() => {
    let r = null;
    if (loc.pathname.startsWith('/m/')) r = 'maid';
    else if (loc.pathname.startsWith('/e/')) r = 'employer';
    if (r) { setRole(r); try { localStorage.setItem('hf_role', r); } catch {} }
  }, [loc.pathname]);
  const showTabs = /^\/(e|m)\//.test(loc.pathname) && loc.pathname !== '/m/bind';

  const switchRole = (r) => nav(r === 'employer' ? '/e/home' : '/m/today');

  // 服务器是否启用了 Google 登录（决定是否强制女佣绑定）
  const [googleOn, setGoogleOn] = useState(null);
  useEffect(() => { api.runtimeConfig().then((c) => setGoogleOn(!!c?.google_client_id)).catch(() => setGoogleOn(false)); }, []);

  // 登录门禁：未登录必须先注册/登录（雇主）或用邀请码加入（女佣）才能使用
  const authed = (r) => {
    try { return !!JSON.parse(localStorage.getItem(r === 'maid' ? 'hf_maid' : 'hf_employer') || 'null')?.user_id; }
    catch { return false; }
  };
  // 女佣已加入但未绑定 Google（用于「加入后必须绑定」门禁）
  const maidUnbound = () => { try { const m = JSON.parse(localStorage.getItem('hf_maid') || 'null'); return !!m?.user_id && !m?.email; } catch { return false; } };
  useEffect(() => {
    const p = loc.pathname;
    if (['/register', '/login', '/register-wizard', '/join', '/m/login', '/admin'].includes(p)) return;   // 公共页
    if (p === '/') {
      if (authed('employer')) nav('/e/home', { replace: true });
      else if (authed('maid')) nav('/m/today', { replace: true });
      else nav('/login', { replace: true });
      return;
    }
    let need = null;
    if (p.startsWith('/m/')) need = 'maid';
    else if (p.startsWith('/e/')) need = 'employer';
    else need = role;                 // 共享详情页按当前粘性角色判定
    if (need && !authed(need)) { nav(need === 'maid' ? '/join' : '/login', { replace: true }); return; }
    // 女佣加入后必须绑定 Google：未绑定则拦到绑定页（仅当服务器启用了 Google，避免锁死）
    if (googleOn && need === 'maid' && authed('maid') && maidUnbound() && p !== '/m/bind') {
      nav('/m/bind', { replace: true });
    }
  }, [loc.pathname, role, googleOn]);

  // 管理员后台：桌面工具，全屏渲染（不套手机外壳）
  if (loc.pathname === '/admin') return (
    <AppCtx.Provider value={{ showToast, role }}>
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }}><AdminConsole /></div>
      <Toast msg={toast} />
    </AppCtx.Provider>
  );

  return (
    <AppCtx.Provider value={{ showToast, role }}>
      <div className="stage">
        {/* 桌面预览：左侧角色 / 语言切换工具栏（手机端隐藏） */}
        <div className="role-toolbar desk-only">
          <div className="ttl">{t('appName')}</div>
          <div className="ttl" style={{ marginTop: 6 }}>角色 Role</div>
          <button className={role === 'employer' ? 'on' : ''} onClick={() => switchRole('employer')}>👨🏻‍💼 {t('employer')}</button>
          <button className={role === 'maid' ? 'on' : ''} onClick={() => switchRole('maid')}>👩🏽‍🦱 {t('maid')}</button>
          <div className="ttl" style={{ marginTop: 6 }}>语言 Language</div>
          <button className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')}>🇨🇳 简体中文</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>🇬🇧 English</button>
          <div className="hint">在手机上访问时为全屏 App，可“添加到主屏幕”作为 PWA 安装。此侧栏仅桌面预览可见，用于切换演示角色。</div>
        </div>

        <div className="phone">
          <div className="notch desk-only" />
          <div className="statusbar desk-only">
            <Clock />
            <span>📶 🔋 100%</span>
          </div>
          <div className="screen">
            <Routes>
              <Route path="/" element={null} />
              <Route path="/e/home" element={<EmployerHome />} />
              <Route path="/e/tasks" element={<TaskList role="employer" />} />
              <Route path="/e/recipes" element={<RecipeList />} />
              <Route path="/e/shopping" element={<ShoppingPage role="employer" />} />
              <Route path="/e/me" element={<Me role="employer" />} />
              <Route path="/m/today" element={<MaidToday />} />
              <Route path="/m/tasks" element={<MaidCalendar />} />
              <Route path="/m/cooking" element={<RecipeList cooking />} />
              <Route path="/m/shopping" element={<ShoppingPage role="maid" />} />
              <Route path="/m/me" element={<Me role="maid" />} />
              <Route path="/register" element={<EmployerAuth />} />
              <Route path="/login" element={<EmployerAuth />} />
              <Route path="/register-wizard" element={<Register />} />
              <Route path="/join" element={<JoinPage />} />
              <Route path="/m/bind" element={<MaidBind />} />
              <Route path="/m/login" element={<MaidLogin />} />
              <Route path="/task-new" element={<TaskNew />} />
              <Route path="/task-new/:id" element={<TaskNew />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/rest-days" element={<RestDaySettings />} />
              <Route path="/task/:id" element={<TaskDetail />} />
              <Route path="/recipe/:id" element={<RecipeDetail />} />
              <Route path="/recipe-new" element={<RecipeNew />} />
              <Route path="/recipe-edit/:id" element={<RecipeNew />} />
              <Route path="/meal/:id" element={<MealOrder />} />
              <Route path="/shopping-new" element={<ShoppingListNew />} />
              <Route path="/shopping-list/:id" element={<ShoppingPage detail />} />
              <Route path="/shopping-list/:id/add-item" element={<ShoppingItemNew />} />
              <Route path="/shopping-list/:id/settle" element={<ShoppingSettle />} />
              <Route path="/substitute/:itemId" element={<SubstituteReview />} />
              <Route path="/expense" element={<MonthlyExpense />} />
              <Route path="/members" element={<Members />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/subscribe" element={<Subscribe />} />
              <Route path="/subscribe/pay/:order_no" element={<SubscribePay />} />
              <Route path="/locked" element={<MaidLocked />} />
              <Route path="/admin" element={<AdminConsole />} />
            </Routes>
          </div>
          {showTabs && <TabBar role={role} />}
          <Toast msg={toast} />
        </div>
      </div>
    </AppCtx.Provider>
  );
}
