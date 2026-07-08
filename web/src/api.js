const base = '/api';
async function req(path, opts) {
  const r = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    let body = {};
    try { body = await r.json(); } catch {}
    const err = new Error(body.error || ('API ' + r.status));
    err.status = r.status; err.code = body.error; err.body = body;
    throw err;
  }
  return r.json();
}
export const api = {
  bootstrap: () => req('/bootstrap'),
  members: () => req('/members'),
  addMember: (body) => req('/members', { method: 'POST', body }),
  removeMember: (id) => req(`/members/${id}/remove`, { method: 'POST' }),
  regenInvite: () => req('/family/invite-code', { method: 'POST' }),
  join: (body) => req('/join', { method: 'POST', body }),
  dashEmployer: () => req('/dashboard/employer'),
  dashMaid: () => req('/dashboard/maid'),
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
  recommendedTemplates: () => req('/auth/recommended-templates'),
  recipes: (type = 'all') => req('/recipes?type=' + type),
  recipe: (id) => req('/recipes/' + id),
  favorite: (id) => req(`/recipes/${id}/favorite`, { method: 'POST' }),
  meals: () => req('/meals'),
  meal: (id) => req('/meals/' + id),
  mealTransition: (id, body) => req(`/meals/${id}/transition`, { method: 'POST', body }),
  shoppingLists: () => req('/shopping'),
  shopping: (id) => req('/shopping/' + id),
  createList: (body) => req('/shopping', { method: 'POST', body }),
  patchList: (id, body) => req(`/shopping/${id}`, { method: 'PATCH', body }),
  addItem: (listId, body) => req(`/shopping/${listId}/items`, { method: 'POST', body }),
  deleteItem: (id) => req(`/items/${id}`, { method: 'DELETE' }),
  shoppingTransition: (id, body) => req(`/shopping/${id}/transition`, { method: 'POST', body }),
  patchItem: (id, body) => req(`/items/${id}`, { method: 'PATCH', body }),
  reviewSub: (id, approve) => req(`/items/${id}/substitute/review`, { method: 'POST', body: { approve } }),
  notifications: (role) => req('/notifications?role=' + role),
};
