import { createContext, useContext, useState } from 'react';

const dict = {
  zh: {
    appName: 'HomeFlow 家务管家',
    employer: '雇主', maid: '女佣', member: '家庭成员',
    // tabs
    home: '首页', tasks: '任务', recipes: '菜谱', shopping: '采购', me: '我的',
    today: '今日', cooking: '做饭',
    // dashboard
    todayTasks: '今日任务', todayMenu: '今日菜单', purchase: '采购', alerts: '异常提醒', activity: '最新动态',
    total: '总数', done: '已完成', inProgress: '进行中', overdue: '逾期', pendingReview: '待确认', todo: '未开始',
    viewAll: '查看全部', newTask: '新建任务', handleReview: '处理待确认',
    lunch: '午餐', dinner: '晚餐', breakfast: '早餐', baby: '宝宝', adult: '大人',
    toBuy: '待采购', subPending: '待替代确认', estAmount: '预计金额', monthTotal: '本月采购',
    arrangeMenu: '安排菜谱', viewProgress: '查看进度', handleSub: '处理替代申请',
    // maid today
    workday: '工作日', restday: '休息日', nextTask: '下一项任务', todayList: '今日任务清单', todayCook: '今日做饭', todayBuy: '今日采购',
    startTask: '开始任务', viewDetail: '查看详情', submitIssue: '提交问题', start: '开始', complete: '完成', viewInstr: '查看说明',
    ingredientsReady: '食材齐全', ingredientsShort: '缺少食材', startCook: '开始准备', finishCook: '完成做饭',
    budget: '预算', items: '件商品', viewList: '查看清单', startBuy: '开始采购', submitBuy: '提交采购',
    // task list
    filter: '筛选', daily: '每日', weekly: '每周', monthly: '每月', temp: '临时',
    area: '区域', assignee: '执行人', priority: '优先级', allStatus: '全部状态',
    // 任务清单模块（修改版）
    thisWeek: '本周', prevWeek: '上一周', nextWeek: '下一周', manageTemplates: '管理固定任务', batchAdjust: '批量调整', viewUndone: '查看未完成',
    todayDone: '今日已完成', completedSection: '已完成', incompleteSection: '今日未完成', byArea: '按区域', weekdayRun: '每周执行日',
    everyday: '每天', workdays: '工作日', weekend: '周末', clear: '清空', atLeastOneDay: '请至少选择一天',
    fixedTasks: '固定任务管理', enabled: '启用', paused: '已暂停', pause: '暂停', resume: '恢复', duplicate: '复制', edit: '编辑', deleteTpl: '删除',
    weekStats: '每周任务统计', completionRate: '完成率', taskCount: '任务数',
    mon: '周一', tue: '周二', wed: '周三', thu: '周四', fri: '周五', sat: '周六', sun: '周日',
    monS: '一', tueS: '二', wedS: '三', thuS: '四', friS: '五', satS: '六', sunS: '日',
    // 日历 + 休息日
    calendar: '日历', monthView: '月', weekView: '周', prevMonth: '上个月', nextMonth: '下个月', backToday: '回到今天', thisMonth: '回到本月',
    restDay: '休息日', restDays: '休息日', restDaySettings: '休息日设置', monthRest: '本月休息日', restCount: '休息日',
    nextRest: '下一个休息日', todayIsRest: '今天是你的休息日', noRestThisMonth: '本月暂未设置休息日', viewMonthRest: '查看本月休息日', viewTomorrow: '查看明日任务',
    todayTaskCount: '今日任务', restDayHint: '休息日当天默认不安排任务', pendingConfirmCount: '待确认',
    setRest: '设为休息日', cancelRest: '取消休息日', selectDates: '选择休息日期', saveRest: '保存休息日', restSaved: '休息日已保存',
    allSundays: '所有周日', allSaturdays: '所有周六', allMondays: '所有周一', firstSunday: '每月第一个周日', clearMonth: '清空本月',
    existingTasksTitle: '当天已有任务', existingTasksMsg: '所选日期已有任务，设为休息日后如何处理？', cancelDayTasks: '取消当天任务', keepDayTasks: '保留任务', notifyHelper: '通知女佣',
    restSpecialTask: '休息日特别任务', selected: '已选', manageRest: '休息日管理',
    // task detail
    taskInfo: '任务信息', subtasks: '子任务', notes: '注意事项', attachments: '附件', creator: '创建人', opLog: '操作记录',
    confirmReceive: '确认收到', uploadPhoto: '上传照片', markDone: '标记完成', applySkip: '申请跳过',
    editTask: '编辑任务', confirmDone: '确认完成', returnRedo: '退回重做', reassign: '重新分配', cancelTask: '取消任务',
    needPhotoHint: '此任务需上传照片才能提交',
    // new task
    taskName: '任务名称', taskDesc: '任务说明', taskImage: '任务图片', repeat: '是否重复', repeatFreq: '重复频率',
    requirePhoto: '必须上传照片', requireApproval: '需要雇主审核', minDuration: '预计时长(分钟)',
    startTime: '开始时间', dueTime: '截止时间', saveDraft: '保存草稿', publishTask: '发布任务', preview: '预览女佣端',
    normal: '普通', important: '重要', urgent: '紧急', addSubtask: '添加子任务',
    // recipe
    recipeType: '类型', ingredients: '食材', steps: '烹饪步骤', servings: '份数', duration: '制作时间', difficulty: '难度', easy: '简单', hard: '复杂',
    addToCart: '加入采购清单', arrangeToMenu: '安排到菜单', favorite: '收藏', requiredIng: '必需', optionalIng: '可选',
    confirmRead: '确认已阅读',
    // meal order
    mealOrder: '菜谱订单', mealDate: '用餐日期', mealType: '餐次', diners: '用餐人数', missingIng: '缺少食材', resultPhoto: '完成照片', maidNote: '女佣备注',
    received: '已收到', markMissing: '标记缺少食材', uploadResult: '上传成品照片', cookDone: '做饭完成',
    confirmMeal: '确认完成', returnMeal: '退回', redoMeal: '再做一次', editOrder: '修改订单',
    // shopping
    shoppingList: '采购清单', store: '购买地点', addItem: '添加商品', genFromRecipe: '从菜谱生成', setBudget: '设置预算', assignBuyer: '指派采购人',
    newList: '新建采购清单', listTitle: '清单名称', itemName: '商品名称', itemCategory: '分类', itemQty: '数量', itemUnit: '单位', itemBrand: '指定品牌', itemSpec: '规格',
    estPrice: '预计单价', budgetLimit: '预算上限', allowSub: '是否允许替换', urgencyLabel: '紧急程度', itemNote: '备注', saveAndContinue: '保存并继续添加', saveItem: '保存商品',
    receiptUploaded: '小票已上传', addFirstItem: '先添加第一件商品', noItems: '还没有商品',
    markBought: '标记已购买', markOOS: '标记缺货', applySub: '申请替代', enterPrice: '填写价格', uploadReceipt: '上传小票', submitPurchase: '提交采购',
    bought: '已购买', outOfStock: '缺货', subRequested: '替代申请中', subApproved: '替代已批准', subRejected: '替代被拒绝',
    // settle
    settle: '采购结算', actualQty: '实际数量', actualPrice: '实际单价', discount: '折扣', actualTotal: '实际总价', otherFee: '其他费用',
    estTotal: '预计总额', diff: '差额', overBudget: '超出预算', confirmAccount: '确认账目', returnEdit: '退回修改', markReimbursed: '标记已报销', exportRecord: '导出记录',
    // 采购模块（分类 + Receipt核对 + 月度账目）
    primaryCat: '一级分类', secondaryCat: '二级分类', selectCat: '选择分类', foodSubRequired: '食材需选二级分类',
    receiptTotal: 'Receipt金额', helperTotal: '录入金额', scanReceipt: '模拟识别', enterReceiptTotal: '填写Receipt总额',
    itemsSubtotal: '商品小计', gst: '消费税',
    amtMatched: '金额核对成功', amtMismatch: '金额不一致', amtUnrecognized: 'Receipt未识别', diffReason: '差异原因',
    submitToEmployer: '提交给雇主确认', confirmedTotal: '雇主确认金额', budgetDiff: '与预算差额', paymentMethod: '付款方式',
    reimbursement: '报销状态', reimNone: '不需要报销', reimTo: '待报销', reimDone: '已报销',
    monthlyExpense: '月度账目', monthTotal2: '本月采购总额', pendingConfirm: '待确认金额', reimbursedAmt: '已报销', purchaseCount: '采购次数', avgPerPurchase: '平均每次',
    catShare: '一级分类占比', foodDetail: '食材明细', pctOfTotal: '占总支出', pctOfFood: '占食材', records: '采购记录', countedIn: '计入统计',
    diffReasons: '漏录商品|商品金额填写错误|Receipt识别错误|Receipt含非家庭物品|使用优惠券或积分|有购物袋费用|有税费或服务费|部分为女佣个人购买|其他原因',
    payMethods: '雇主现金|雇主银行卡|雇主二维码付款|女佣垫付|线上支付|其他',
    // substitute
    substitute: '替代商品', origItem: '原商品', subItem: '替代商品', subReason: '替代原因', subReview: '替代商品确认',
    approve: '同意购买', reject: '拒绝', requestOther: '要求其他选择', subBrand: '品牌', subSpec: '规格', subPrice: '单价',
    // notification
    notifications: '消息中心', markAllRead: '全部已读', noData: '暂无数据',
    // me
    familyInfo: '家庭资料', members: '家庭成员', langSetting: '语言设置', notifySetting: '通知设置', logout: '退出登录', myProfile: '个人资料', workSchedule: '工作日程', purchaseHistory: '采购记录',
    // members / invite
    memberMgmt: '成员管理', maidMgmt: '女佣管理', inviteCode: '邀请码', inviteHint: '把邀请码发给女佣，她注册时输入即可加入家庭', regenCode: '重新生成', copyCode: '复制', copied: '已复制',
    addMaid: '添加女佣', addMember: '添加成员', addDirectly: '直接添加', viaInvite: '邀请码加入', memberName: '姓名', memberLang: '默认语言', memberRole: '角色',
    avatar: '头像', gender: '性别', male: '男', female: '女', notSet: '不填', birthDate: '出生日期', age: '年龄', uploadPhotoBtn: '上传图片',
    removeMember: '移出家庭', removeConfirm: '移出后该成员将立即失去家庭数据访问权限', joined: '已加入', removed: '已移出', active: '在职',
    // misc
    min: '分钟', confirm: '确认', cancel: '取消', save: '保存', submit: '提交', back: '返回', all: '全部',
    autoTranslated: '自动翻译',
    statusMap: {
      draft:'草稿', todo:'未开始', today_todo:'今日待完成', received:'已收到', in_progress:'进行中', paused:'已暂停', pending_review:'待确认', returned:'已退回', done:'已完成', overdue:'已逾期', incomplete:'今日未完成', skip_requested:'申请跳过', skipped:'已跳过', canceled:'已取消', active:'启用',
      to_receive:'待接收', checking:'待检查食材', ingredients_ready:'食材齐全', ingredients_short:'食材不足', to_start:'待开始', preparing:'准备中', cooking:'烹饪中',
      to_buy:'待采购', buying:'采购中', partial:'部分完成', sub_pending:'待替代确认', to_settle:'待结算', pending_confirm:'待确认', confirmed:'已确认', reimbursed:'已报销',
      bought:'已购买', out_of_stock:'缺货', sub_requested:'替代申请中', sub_approved:'替代已批准', sub_rejected:'替代被拒绝',
    },
  },
  en: {
    appName: 'HomeFlow', employer: 'Employer', maid: 'Helper', member: 'Member',
    home: 'Home', tasks: 'Tasks', recipes: 'Recipes', shopping: 'Shopping', me: 'Me', today: 'Today', cooking: 'Cooking',
    todayTasks: "Today's Tasks", todayMenu: "Today's Menu", purchase: 'Shopping', alerts: 'Alerts', activity: 'Activity',
    total: 'Total', done: 'Done', inProgress: 'Ongoing', overdue: 'Overdue', pendingReview: 'To Confirm', todo: 'To Do',
    viewAll: 'View All', newTask: 'New Task', handleReview: 'Review',
    lunch: 'Lunch', dinner: 'Dinner', breakfast: 'Breakfast', baby: 'Baby', adult: 'Adult',
    toBuy: 'To Buy', subPending: 'Substitutes', estAmount: 'Est. Amount', monthTotal: 'This Month',
    arrangeMenu: 'Arrange', viewProgress: 'Progress', handleSub: 'Substitutes',
    workday: 'Workday', restday: 'Rest Day', nextTask: 'Next Task', todayList: "Today's Tasks", todayCook: "Today's Cooking", todayBuy: "Today's Shopping",
    startTask: 'Start', viewDetail: 'Details', submitIssue: 'Report', start: 'Start', complete: 'Complete', viewInstr: 'Instructions',
    ingredientsReady: 'All Ready', ingredientsShort: 'Missing', startCook: 'Start Cooking', finishCook: 'Finish',
    budget: 'Budget', items: 'items', viewList: 'View List', startBuy: 'Start', submitBuy: 'Submit',
    filter: 'Filter', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', temp: 'Temp',
    area: 'Area', assignee: 'Assignee', priority: 'Priority', allStatus: 'All',
    thisWeek: 'This Week', prevWeek: 'Prev', nextWeek: 'Next', manageTemplates: 'Fixed Tasks', batchAdjust: 'Batch', viewUndone: 'Undone',
    todayDone: 'Done today', completedSection: 'Completed', incompleteSection: 'Incomplete', byArea: 'By Area', weekdayRun: 'Repeat On',
    everyday: 'Every Day', workdays: 'Weekdays', weekend: 'Weekend', clear: 'Clear', atLeastOneDay: 'Select at least one day',
    fixedTasks: 'Fixed Tasks', enabled: 'Active', paused: 'Paused', pause: 'Pause', resume: 'Resume', duplicate: 'Duplicate', edit: 'Edit', deleteTpl: 'Delete',
    weekStats: 'Weekly Stats', completionRate: 'Completion', taskCount: 'Tasks',
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
    monS: 'M', tueS: 'T', wedS: 'W', thuS: 'T', friS: 'F', satS: 'S', sunS: 'S',
    calendar: 'Calendar', monthView: 'Month', weekView: 'Week', prevMonth: 'Prev', nextMonth: 'Next', backToday: 'Today', thisMonth: 'This Month',
    restDay: 'Rest Day', restDays: 'Rest Days', restDaySettings: 'Rest Day Settings', monthRest: 'Rest Days This Month', restCount: 'Rest Days',
    nextRest: 'Next Rest Day', todayIsRest: "Today is your rest day", noRestThisMonth: 'No rest days set this month', viewMonthRest: "View this month's rest days", viewTomorrow: "View tomorrow's tasks",
    todayTaskCount: "Today's Tasks", restDayHint: 'No tasks are scheduled on rest days by default', pendingConfirmCount: 'To Confirm',
    setRest: 'Set as Rest Day', cancelRest: 'Cancel Rest Day', selectDates: 'Select rest dates', saveRest: 'Save Rest Days', restSaved: 'Rest days saved',
    allSundays: 'All Sundays', allSaturdays: 'All Saturdays', allMondays: 'All Mondays', firstSunday: 'First Sunday', clearMonth: 'Clear Month',
    existingTasksTitle: 'Tasks exist that day', existingTasksMsg: 'Selected dates already have tasks. How to handle them after setting rest day?', cancelDayTasks: 'Cancel tasks', keepDayTasks: 'Keep tasks', notifyHelper: 'Notify helper',
    restSpecialTask: 'Rest-day Special Task', selected: 'Selected', manageRest: 'Rest Days',
    taskInfo: 'Task Info', subtasks: 'Subtasks', notes: 'Notes', attachments: 'Attachments', creator: 'Created by', opLog: 'Activity Log',
    confirmReceive: 'Confirm', uploadPhoto: 'Upload Photo', markDone: 'Mark Done', applySkip: 'Request Skip',
    editTask: 'Edit', confirmDone: 'Confirm Done', returnRedo: 'Return', reassign: 'Reassign', cancelTask: 'Cancel',
    needPhotoHint: 'Photo required before submitting',
    taskName: 'Task Name', taskDesc: 'Description', taskImage: 'Images', repeat: 'Repeat', repeatFreq: 'Frequency',
    requirePhoto: 'Require Photo', requireApproval: 'Require Approval', minDuration: 'Duration (min)',
    startTime: 'Start Time', dueTime: 'Due Time', saveDraft: 'Save Draft', publishTask: 'Publish', preview: 'Preview',
    normal: 'Normal', important: 'Important', urgent: 'Urgent', addSubtask: 'Add Subtask',
    recipeType: 'Type', ingredients: 'Ingredients', steps: 'Steps', servings: 'Servings', duration: 'Time', difficulty: 'Difficulty', easy: 'Easy', hard: 'Hard',
    addToCart: 'Add to Shopping', arrangeToMenu: 'Arrange', favorite: 'Favorite', requiredIng: 'Required', optionalIng: 'Optional',
    confirmRead: 'Mark as Read',
    mealOrder: 'Meal Order', mealDate: 'Date', mealType: 'Meal', diners: 'Diners', missingIng: 'Missing', resultPhoto: 'Result Photo', maidNote: 'Helper Note',
    received: 'Received', markMissing: 'Mark Missing', uploadResult: 'Upload Photo', cookDone: 'Done Cooking',
    confirmMeal: 'Confirm', returnMeal: 'Return', redoMeal: 'Redo', editOrder: 'Edit Order',
    shoppingList: 'Shopping List', store: 'Store', addItem: 'Add Item', genFromRecipe: 'From Recipe', setBudget: 'Set Budget', assignBuyer: 'Assign',
    newList: 'New Shopping List', listTitle: 'List Name', itemName: 'Item Name', itemCategory: 'Category', itemQty: 'Qty', itemUnit: 'Unit', itemBrand: 'Brand', itemSpec: 'Spec',
    estPrice: 'Est. Price', budgetLimit: 'Budget Limit', allowSub: 'Allow Substitute', urgencyLabel: 'Urgency', itemNote: 'Note', saveAndContinue: 'Save & Add More', saveItem: 'Save Item',
    receiptUploaded: 'Receipt uploaded', addFirstItem: 'Add the first item', noItems: 'No items yet',
    markBought: 'Bought', markOOS: 'Out of Stock', applySub: 'Substitute', enterPrice: 'Enter Price', uploadReceipt: 'Receipt', submitPurchase: 'Submit',
    bought: 'Bought', outOfStock: 'Out of Stock', subRequested: 'Sub Pending', subApproved: 'Sub Approved', subRejected: 'Sub Rejected',
    settle: 'Settlement', actualQty: 'Qty', actualPrice: 'Unit Price', discount: 'Discount', actualTotal: 'Total', otherFee: 'Other Fee',
    estTotal: 'Estimated', diff: 'Difference', overBudget: 'Over Budget', confirmAccount: 'Confirm', returnEdit: 'Return', markReimbursed: 'Reimbursed', exportRecord: 'Export',
    primaryCat: 'Category', secondaryCat: 'Subcategory', selectCat: 'Select category', foodSubRequired: 'Food needs a subcategory',
    receiptTotal: 'Receipt Total', helperTotal: 'Entered Total', scanReceipt: 'Demo scan', enterReceiptTotal: 'Enter receipt total',
    itemsSubtotal: 'Subtotal', gst: 'GST',
    amtMatched: 'Amounts match', amtMismatch: 'Amounts differ', amtUnrecognized: 'Receipt not recognized', diffReason: 'Difference reason',
    submitToEmployer: 'Submit to employer', confirmedTotal: 'Confirmed amount', budgetDiff: 'vs Budget', paymentMethod: 'Payment method',
    reimbursement: 'Reimbursement', reimNone: 'No reimbursement', reimTo: 'To reimburse', reimDone: 'Reimbursed',
    monthlyExpense: 'Monthly Account', monthTotal2: 'Month Total', pendingConfirm: 'Pending', reimbursedAmt: 'Reimbursed', purchaseCount: 'Trips', avgPerPurchase: 'Avg/Trip',
    catShare: 'Category Share', foodDetail: 'Food Breakdown', pctOfTotal: '% of total', pctOfFood: '% of food', records: 'Records', countedIn: 'Counted',
    diffReasons: 'Missed item|Wrong price entered|Receipt OCR error|Receipt has non-family items|Coupon or points used|Bag fee|Tax or service fee|Partly helper personal|Other',
    payMethods: "Employer cash|Employer card|Employer QR pay|Helper paid|Online pay|Other",
    substitute: 'Substitute', origItem: 'Original', subItem: 'Substitute', subReason: 'Reason', subReview: 'Substitute Review',
    approve: 'Approve', reject: 'Reject', requestOther: 'Request Other', subBrand: 'Brand', subSpec: 'Spec', subPrice: 'Price',
    notifications: 'Messages', markAllRead: 'Mark All Read', noData: 'No data',
    familyInfo: 'Family Info', members: 'Members', langSetting: 'Language', notifySetting: 'Notifications', logout: 'Log Out', myProfile: 'Profile', workSchedule: 'Schedule', purchaseHistory: 'Purchases',
    memberMgmt: 'Members', maidMgmt: 'Helper Management', inviteCode: 'Invite Code', inviteHint: 'Share this code with your helper to join the family at sign-up', regenCode: 'Regenerate', copyCode: 'Copy', copied: 'Copied',
    addMaid: 'Add Helper', addMember: 'Add Member', addDirectly: 'Add Directly', viaInvite: 'Via Invite Code', memberName: 'Name', memberLang: 'Language', memberRole: 'Role',
    avatar: 'Avatar', gender: 'Gender', male: 'Male', female: 'Female', notSet: 'N/A', birthDate: 'Date of birth', age: 'Age', uploadPhotoBtn: 'Upload',
    removeMember: 'Remove', removeConfirm: 'They will immediately lose access to family data', joined: 'Joined', removed: 'Removed', active: 'Active',
    min: 'min', confirm: 'Confirm', cancel: 'Cancel', save: 'Save', submit: 'Submit', back: 'Back', all: 'All',
    autoTranslated: 'Auto-translated',
    statusMap: {
      draft:'Draft', todo:'To Do', today_todo:'To Do', received:'Received', in_progress:'Ongoing', paused:'Paused', pending_review:'To Confirm', returned:'Returned', done:'Done', overdue:'Overdue', incomplete:'Incomplete', skip_requested:'Skip Req.', skipped:'Skipped', canceled:'Canceled', active:'Active',
      to_receive:'To Receive', checking:'Checking', ingredients_ready:'Ready', ingredients_short:'Missing', to_start:'To Start', preparing:'Preparing', cooking:'Cooking',
      to_buy:'To Buy', buying:'Buying', partial:'Partial', sub_pending:'Sub Pending', to_settle:'To Settle', pending_confirm:'To Confirm', confirmed:'Confirmed', reimbursed:'Reimbursed',
      bought:'Bought', out_of_stock:'Out of Stock', sub_requested:'Sub Pending', sub_approved:'Sub Approved', sub_rejected:'Sub Rejected',
    },
  },
};

const I18nCtx = createContext(null);
export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem('hf_lang') || 'zh'; } catch { return 'zh'; }
  });
  const setLang = (l) => { try { localStorage.setItem('hf_lang', l); } catch {} setLangState(l); };
  const t = (k) => dict[lang][k] ?? k;
  const st = (s) => dict[lang].statusMap[s] ?? s;
  return <I18nCtx.Provider value={{ lang, setLang, t, st }}>{children}</I18nCtx.Provider>;
}
export const useI18n = () => useContext(I18nCtx);
// 数据双语：根据语言挑字段
export const pick = (lang, zh, en) => (lang === 'en' && en ? en : zh);
