const base = '/api';
// 当前登录女佣 id：加入后存于 localStorage(hf_maid)，演示默认种子女佣 Siti(id 2)
export const currentMaidId = () => {
  try { return JSON.parse(localStorage.getItem('hf_maid') || 'null')?.user_id || 2; } catch { return 2; }
};
// 当前登录令牌（按当前角色取对应身份的签名 token），作为 X-Auth-Token 头
const currentToken = () => {
  try {
    const emp = JSON.parse(localStorage.getItem('hf_employer') || 'null');
    const maid = JSON.parse(localStorage.getItem('hf_maid') || 'null');
    const role = localStorage.getItem('hf_role');
    if (role === 'maid') return maid?.token || emp?.token || '';
    return emp?.token || maid?.token || '';
  } catch { return ''; }
};
const currentLang = () => { try { return localStorage.getItem('hf_lang') || 'zh'; } catch { return 'zh'; } };
async function req(path, opts) {
  const token = currentToken();
  const r = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Lang': currentLang(), ...(token ? { 'X-Auth-Token': token } : {}), ...(opts?.headers || {}) },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) {
    // 未登录或身份失效：回到登录页（登录/注册/加入页本身不跳，避免循环）
    const h = location.hash || '';
    if (!/^#\/(login|register|join)/.test(h)) location.hash = '#/login';
  }
  if (r.status === 402) {
    // 订阅到期：雇主去套餐/续费页，女佣去锁定提示页
    const h = location.hash || '';
    const role = localStorage.getItem('hf_role');
    if (role === 'maid') { if (!/^#\/locked/.test(h)) location.hash = '#/locked'; }
    else if (!/^#\/subscribe/.test(h)) location.hash = '#/subscribe';
  }
  if (!r.ok) {
    let body = {};
    try { body = await r.json(); } catch {}
    const err = new Error(body.error || ('API ' + r.status));
    err.status = r.status; err.code = body.error; err.body = body;
    throw err;
  }
  return r.json();
}
// 管理后台请求：用 localStorage 里的管理员密钥
const adminKey = () => localStorage.getItem('hf_admin_key') || '';
async function areq(path, opts) {
  const r = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey(), ...(opts?.headers || {}) },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) { let b = {}; try { b = await r.json(); } catch {} const e = new Error(b.error || ('API ' + r.status)); e.status = r.status; e.code = b.error; throw e; }
  return r.json();
}
export const adminApi = {
  ping: () => areq('/admin/ping'),
  dashboard: () => areq('/admin/dashboard'),
  orders: (status) => areq('/admin/orders' + (status ? '?status=' + status : '')),
  confirmOrder: (no) => areq(`/admin/orders/${no}/confirm`, { method: 'POST' }),
  rejectOrder: (no, reason) => areq(`/admin/orders/${no}/reject`, { method: 'POST', body: { reason } }),
  setOrderAmount: (no, amount, reason) => areq(`/admin/orders/${no}/amount`, { method: 'POST', body: { amount, reason } }),
  subscriptions: (status) => areq('/admin/subscriptions' + (status ? '?status=' + status : '')),
  extend: (fid, body) => areq(`/admin/families/${fid}/extend`, { method: 'POST', body }),
  lock: (fid, reason) => areq(`/admin/families/${fid}/lock`, { method: 'POST', body: { reason } }),
  unlock: (fid, reason) => areq(`/admin/families/${fid}/unlock`, { method: 'POST', body: { reason } }),
  users: (kw, includeRemoved) => { const q = []; if (kw) q.push('keyword=' + encodeURIComponent(kw)); if (includeRemoved) q.push('include_removed=1'); return areq('/admin/users' + (q.length ? '?' + q.join('&') : '')); },
  deleteUser: (id, reason) => areq(`/admin/users/${id}/delete`, { method: 'POST', body: { reason } }),
  user: (id) => areq('/admin/users/' + id),
  audit: () => areq('/admin/audit'),
  getConfig: () => areq('/admin/config'),
  setConfig: (body) => areq('/admin/config', { method: 'POST', body }),
};

export const api = {
  bootstrap: () => req('/bootstrap'),
  runtimeConfig: () => req('/config'),
  authGoogle: (credential) => req('/auth/google', { method: 'POST', body: { credential } }),
  bindGoogle: (credential) => req('/auth/google/bind', { method: 'POST', body: { credential } }),
  // 订阅与收费
  subPlans: () => req('/subscription/plans'),
  subCurrent: () => req('/subscription/current'),
  createPaymentOrder: (plan_id) => req('/subscription/payment-orders', { method: 'POST', body: { plan_id } }),
  getPaymentOrder: (no) => req('/subscription/payment-orders/' + no),
  claimPayment: (no) => req(`/subscription/payment-orders/${no}/claim`, { method: 'POST' }),
  members: () => req('/members'),
  addMember: (body) => req('/members', { method: 'POST', body }),
  updateUser: (id, body) => req(`/users/${id}`, { method: 'PATCH', body }),
  uploadAvatar: (body) => req('/upload-avatar', { method: 'POST', body }),
  removeMember: (id) => req(`/members/${id}/remove`, { method: 'POST' }),
  regenInvite: () => req('/family/invite-code', { method: 'POST' }),
  join: (body) => req('/join', { method: 'POST', body }),
  googleJoin: (body) => req('/auth/google/join', { method: 'POST', body }),
  maidGoogleLogin: (credential) => req('/auth/google/maid-login', { method: 'POST', body: { credential } }),
  dashEmployer: () => req('/dashboard/employer'),
  dashMaid: (helperId) => req('/dashboard/maid' + (helperId ? '?helper_id=' + helperId : '')),
  // 任务清单模块（修改版）：每日实例
  daily: (date) => req('/daily' + (date ? '?date=' + date : '')),
  dailyTask: (id) => req('/daily/' + id),
  taskTransition: (id, body) => req(`/daily/${id}/transition`, { method: 'POST', body }),
  toggleCheck: (id) => req(`/checklist/${id}/toggle`, { method: 'POST' }),
  addAttachment: (id, body) => req(`/daily/${id}/attachment`, { method: 'POST', body }),
  week: (start) => req('/week' + (start ? '?start=' + start : '')),
  statsWeek: (start) => req('/stats/week' + (start ? '?start=' + start : '')),
  // 日历 + 休息日（任务清单模块：日历查看 + 休息日设置）
  month: (year, mon, helperId) => req(`/month?year=${year}&month=${mon}` + (helperId ? '&helper_id=' + helperId : '')),
  restDays: (year, mon, helperId) => req(`/rest-days?year=${year}&month=${mon}` + (helperId ? '&helper_id=' + helperId : '')),
  restSummary: (helperId) => req('/rest-days/summary' + (helperId ? '?helper_id=' + helperId : '')),
  setRestDays: (body) => req('/rest-days', { method: 'POST', body }),
  cancelRestDay: (id) => req(`/rest-days/${id}`, { method: 'DELETE' }),
  // 固定任务模板
  templates: () => req('/templates'),
  template: (id) => req('/templates/' + id),
  createTemplate: (body) => req('/templates', { method: 'POST', body }),
  updateTemplate: (id, body) => req(`/templates/${id}`, { method: 'PATCH', body }),
  templateOp: (id, op) => req(`/templates/${id}/${op}`, { method: 'POST' }),
  // 雇主注册
  sendCode: (body) => req('/auth/send-code', { method: 'POST', body }),
  verifyCode: (body) => req('/auth/verify-code', { method: 'POST', body }),
  saveDraft: (body) => req('/auth/draft', { method: 'POST', body }),
  getDraft: (contact) => req('/auth/draft?contact=' + encodeURIComponent(contact)),
  register: (body) => req('/auth/register', { method: 'POST', body }),
  // 雇主用户名密码 注册 / 登录
  employerRegister: (body) => req('/auth/employer/register', { method: 'POST', body }),
  employerLogin: (body) => req('/auth/employer/login', { method: 'POST', body }),
  recommendedTemplates: () => req('/auth/recommended-templates'),
  recipes: (type = 'all') => req('/recipes?type=' + type),
  recipe: (id) => req('/recipes/' + id),
  favorite: (id) => req(`/recipes/${id}/favorite`, { method: 'POST' }),
  createRecipe: (body) => req('/recipes', { method: 'POST', body }),
  updateRecipe: (id, body) => req(`/recipes/${id}`, { method: 'PATCH', body }),
  deleteRecipe: (id) => req(`/recipes/${id}`, { method: 'DELETE' }),
  recipeToShopping: (id) => req(`/recipes/${id}/to-shopping`, { method: 'POST' }),
  recipeToMeal: (id, body) => req(`/recipes/${id}/to-meal`, { method: 'POST', body }),
  meals: () => req('/meals'),
  meal: (id) => req('/meals/' + id),
  mealTransition: (id, body) => req(`/meals/${id}/transition`, { method: 'POST', body }),
  deleteMeal: (id) => req(`/meals/${id}`, { method: 'DELETE' }),
  shoppingLists: () => req('/shopping'),
  shopping: (id) => req('/shopping/' + id),
  createList: (body) => req('/shopping', { method: 'POST', body }),
  patchList: (id, body) => req(`/shopping/${id}`, { method: 'PATCH', body }),
  addItem: (listId, body) => req(`/shopping/${listId}/items`, { method: 'POST', body }),
  deleteItem: (id) => req(`/items/${id}`, { method: 'DELETE' }),
  shoppingTransition: (id, body) => req(`/shopping/${id}/transition`, { method: 'POST', body }),
  patchItem: (id, body) => req(`/items/${id}`, { method: 'PATCH', body }),
  reviewSub: (id, approve) => req(`/items/${id}/substitute/review`, { method: 'POST', body: { approve } }),
  // 采购模块：分类 + 月度账目 + 小票识别
  categories: () => req('/categories'),
  monthlyExpense: (year, mon) => req(`/expense/monthly?year=${year}&month=${mon}`),
  scanReceipt: (listId, body) => req(`/shopping/${listId}/receipt-scan`, { method: 'POST', body }),
  saveFamilySettings: (body) => req('/family/settings', { method: 'POST', body }),
  notifications: (role) => req('/notifications?role=' + role),
};
