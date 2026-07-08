import db from './db.js';

// 清空（保证可重复执行）
const tables = ['Notification','ShoppingItem','ShoppingList','MealOrder','RecipeStep','RecipeIngredient','Recipe',
  'DailyTaskLog','DailyTaskAttachment','DailyTaskChecklist','DailyTask','TaskTemplateChecklist','TaskTemplate',
  'HelperRestDay','TaskLog','TaskAttachment','TaskChecklist','Task','Area','FamilyMember','User','Family'];
db.exec('PRAGMA foreign_keys = OFF;');
for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
db.exec(`DELETE FROM sqlite_sequence;`);
db.exec('PRAGMA foreign_keys = ON;');

const today = new Date();
const iso = (d) => d.toISOString().slice(0,10);
const at = (h,m=0) => {
  const d = new Date(today); d.setHours(h,m,0,0); return d.toISOString();
};
const todayStr = iso(today);

// ---- 家庭 ----
const fam = db.prepare(`INSERT INTO Family (family_name, country, timezone, address, default_language, invite_code, creator_user_id) VALUES (?,?,?,?,?,?,?)`)
  .run('陈先生家 · Chen Family', '新加坡', 'Asia/Singapore', 'Orchard Road 88', 'zh', 'HOME-8821', 1);
const familyId = fam.lastInsertRowid;

// ---- 用户 ----
const employer = db.prepare(`INSERT INTO User (name, avatar, role, preferred_language) VALUES (?,?,?,?)`).run('陈先生', '👨🏻‍💼', 'employer', 'zh').lastInsertRowid;
const maid = db.prepare(`INSERT INTO User (name, avatar, role, preferred_language) VALUES (?,?,?,?)`).run('Siti', '👩🏽‍🦱', 'maid', 'en').lastInsertRowid;
const member = db.prepare(`INSERT INTO User (name, avatar, role, preferred_language) VALUES (?,?,?,?)`).run('陈太太', '👩🏻', 'member', 'zh').lastInsertRowid;

db.prepare(`INSERT INTO FamilyMember (family_id, user_id, role) VALUES (?,?,?)`).run(familyId, employer, 'employer');
db.prepare(`INSERT INTO FamilyMember (family_id, user_id, role) VALUES (?,?,?)`).run(familyId, maid, 'maid');
db.prepare(`INSERT INTO FamilyMember (family_id, user_id, role) VALUES (?,?,?)`).run(familyId, member, 'member');

// ---- 区域 ----
const areas = [
  ['客厅','Living Room','🛋️'],['厨房','Kitchen','🍳'],['主卧','Master Bedroom','🛏️'],
  ['宝宝房','Baby Room','🧸'],['卫生间','Bathroom','🚿'],['阳台','Balcony','🪴'],
];
const areaIds = {};
for (const [n,en,icon] of areas) {
  areaIds[n] = db.prepare(`INSERT INTO Area (family_id, name, name_en, icon) VALUES (?,?,?,?)`).run(familyId, n, en, icon).lastInsertRowid;
}

// ---- 任务清单模块（修改版）：固定任务模板 + 当天实例 ----
const DAILY = [1,2,3,4,5,6,7];
const isoWeekday = (d) => { const x = d.getDay(); return x === 0 ? 7 : x; }; // 1=周一 … 7=周日
const todayWd = isoWeekday(today);

let tplSort = 0;
function addTemplate(t, checklist = []) {
  const id = db.prepare(`INSERT INTO TaskTemplate
    (family_id,task_name,task_name_en,description,area_id,assignee_id,priority,estimated_duration,weekdays,require_photo,minimum_photo_count,require_note,require_approval,notify_employer,sort_order,status,creator_id)
    VALUES (@family_id,@task_name,@task_name_en,@description,@area_id,@assignee_id,@priority,@estimated_duration,@weekdays,@require_photo,@minimum_photo_count,@require_note,@require_approval,@notify_employer,@sort_order,@status,@creator_id)`)
    .run({ family_id: familyId, creator_id: employer, assignee_id: maid, description:'', area_id:null,
      priority:'normal', estimated_duration:30, weekdays: JSON.stringify(t.weekdays || DAILY),
      require_photo:0, minimum_photo_count:1, require_note:0, require_approval:0, notify_employer:1,
      sort_order: tplSort++, status:'active', ...t, weekdays: JSON.stringify(t.weekdays || DAILY) }).lastInsertRowid;
  checklist.forEach(([n,en,req],i) => db.prepare(`INSERT INTO TaskTemplateChecklist (task_template_id,title,title_en,required,sort_order) VALUES (?,?,?,?,?)`).run(id,n,en,req?1:0,i));
  return id;
}

// 每日类（每天出现）
const tplLiving  = addTemplate({ task_name:'打扫客厅', task_name_en:'Clean Living Room', description:'吸尘、擦茶几、整理沙发抱枕。', area_id:areaIds['客厅'], estimated_duration:30, require_photo:1, require_approval:1, weekdays:DAILY },
  [['吸尘','Vacuum',1],['擦茶几','Wipe table',1],['整理抱枕','Arrange cushions',1]]);
const tplBath    = addTemplate({ task_name:'清洁主卫', task_name_en:'Clean Master Bathroom', description:'清洁洗手台、镜子、马桶、地漏，最后拖地。', area_id:areaIds['卫生间'], priority:'important', estimated_duration:40, require_photo:1, minimum_photo_count:2, require_approval:1, weekdays:[1,3,5] },
  [['清洁洗手台','Clean sink',1],['清洁镜子','Clean mirror',1],['清洁马桶','Clean toilet',1],['清理地漏毛发','Clear floor drain',1],['拖地','Mop floor',1]]);
const tplBaby    = addTemplate({ task_name:'给宝宝房消毒', task_name_en:'Disinfect Baby Room', description:'玩具、地板、门把手消毒擦拭。', area_id:areaIds['宝宝房'], priority:'urgent', estimated_duration:25, require_photo:1, require_approval:1, weekdays:DAILY });
const tplWater   = addTemplate({ task_name:'阳台浇花', task_name_en:'Water Balcony Plants', description:'所有盆栽浇水，多肉少量。', area_id:areaIds['阳台'], estimated_duration:10, weekdays:DAILY });
const tplLaundry = addTemplate({ task_name:'晾收衣物', task_name_en:'Hang & Collect Laundry', description:'上午晾晒，傍晚收回叠好。', area_id:areaIds['阳台'], estimated_duration:20, weekdays:DAILY });
const tplKitchen = addTemplate({ task_name:'整理厨房橱柜', task_name_en:'Organize Kitchen Cabinets', description:'按分类整理，过期食品挑出。', area_id:areaIds['厨房'], estimated_duration:45, require_approval:1, weekdays:DAILY });
// 指定星期类（用于演示星期切换栏）
addTemplate({ task_name:'更换床单', task_name_en:'Change Bedsheets', description:'更换主卧床单被套。', area_id:areaIds['主卧'], estimated_duration:20, weekdays:[1] });
addTemplate({ task_name:'清洁洗衣机', task_name_en:'Clean Washing Machine', description:'倒入清洁剂空转一次。', area_id:areaIds['厨房'], estimated_duration:30, weekdays:[3] });
addTemplate({ task_name:'深度清洁厕所', task_name_en:'Deep Clean Toilet', description:'除垢、消毒、通风。', area_id:areaIds['卫生间'], priority:'important', estimated_duration:50, require_photo:1, require_approval:1, weekdays:[2,6] });

// 生成"今日"实例（演示用，含多种状态）
function genDaily(tplId, status) {
  const tpl = db.prepare('SELECT * FROM TaskTemplate WHERE task_template_id=?').get(tplId);
  const id = db.prepare(`INSERT INTO DailyTask
    (task_template_id,family_id,task_date,assignee_id,task_name_snapshot,task_name_en_snapshot,description_snapshot,area_id,priority,estimated_duration,require_photo,minimum_photo_count,require_note,require_approval,sort_order,status,started_at,submitted_at,completed_at)
    VALUES (@tpl,@fam,@date,@assignee,@name,@name_en,@desc,@area,@priority,@dur,@rp,@minp,@rn,@ra,@sort,@status,@started,@submitted,@completed)`)
    .run({ tpl:tplId, fam:familyId, date:todayStr, assignee:maid, name:tpl.task_name, name_en:tpl.task_name_en,
      desc:tpl.description, area:tpl.area_id, priority:tpl.priority, dur:tpl.estimated_duration,
      rp:tpl.require_photo, minp:tpl.minimum_photo_count, rn:tpl.require_note, ra:tpl.require_approval, sort:tpl.sort_order,
      status, started: status==='today_todo'?null:at(8,0), submitted: ['pending_review','done'].includes(status)?at(9,0):null,
      completed: status==='done'?at(9,10):null }).lastInsertRowid;
  // 复制子任务
  const cls = db.prepare('SELECT * FROM TaskTemplateChecklist WHERE task_template_id=? ORDER BY sort_order').all(tplId);
  cls.forEach((c,i) => {
    let st = 'todo';
    if (status==='done') st='done';
    else if (status==='in_progress' && i < 2) st='done'; // 进行中演示部分完成
    db.prepare(`INSERT INTO DailyTaskChecklist (daily_task_id,title,title_en,required,sort_order,status) VALUES (?,?,?,?,?,?)`).run(id,c.title,c.title_en,c.required,i,st);
  });
  return id;
}
const dLiving = genDaily(tplLiving, 'done');
genDaily(tplWater, 'done');
const dBath = genDaily(tplBath, 'in_progress');
const dBaby = genDaily(tplBaby, 'today_todo');
genDaily(tplLaundry, 'today_todo');
const dKitchen = genDaily(tplKitchen, 'pending_review');

// 演示附件 & 操作日志（打扫客厅）
db.prepare(`INSERT INTO DailyTaskAttachment (daily_task_id,uploader_id,file_type,file_url) VALUES (?,?,?,?)`).run(dLiving, maid, 'image', '🛋️');
db.prepare(`INSERT INTO DailyTaskLog (daily_task_id,actor_id,action,from_status,to_status) VALUES (?,?,?,?,?)`).run(dLiving, maid, '完成任务', 'in_progress', 'pending_review');
db.prepare(`INSERT INTO DailyTaskLog (daily_task_id,actor_id,action,from_status,to_status) VALUES (?,?,?,?,?)`).run(dLiving, employer, '确认完成', 'pending_review', 'done');
db.prepare(`INSERT INTO DailyTaskLog (daily_task_id,actor_id,action,from_status,to_status) VALUES (?,?,?,?,?)`).run(dBath, maid, '开始任务', 'today_todo', 'in_progress');
// 供后面通知引用
const t1 = dLiving, t3 = dBaby, t5 = dKitchen;

// ---- 女佣休息日（本月所有周日）----
const pad2 = (n) => String(n).padStart(2, '0');
const yy = today.getFullYear(), mm = today.getMonth() + 1;
const daysInMonth = new Date(yy, mm, 0).getDate();
for (let d = 1; d <= daysInMonth; d++) {
  const dObj = new Date(yy, mm - 1, d);
  if (isoWeekday(dObj) !== 7) continue; // 周日
  const ds = `${yy}-${pad2(mm)}-${pad2(d)}`;
  db.prepare(`INSERT INTO HelperRestDay (family_id,helper_user_id,rest_date,weekday,month,year,note,status,created_by,notified_at)
    VALUES (?,?,?,?,?,?,?, 'ACTIVE', ?, datetime('now'))`)
    .run(familyId, maid, ds, 7, mm, yy, '本月周日休息', employer);
}
// 休息日当天不生成/清理普通任务（若种子已生成的当天实例落在休息日则取消）
db.prepare(`UPDATE DailyTask SET status='canceled' WHERE assignee_id=? AND task_date IN
  (SELECT rest_date FROM HelperRestDay WHERE helper_user_id=? AND status='ACTIVE') AND status IN ('today_todo','in_progress')`).run(maid, maid);

// ---- 菜谱 ----
function addRecipe(rc, ingredients, steps) {
  const id = db.prepare(`INSERT INTO Recipe (family_id,name,name_en,recipe_type,category,cover_image,servings,duration,difficulty,suitable_age,allergen_info,notes,favorite,creator_id)
    VALUES (@family_id,@name,@name_en,@recipe_type,@category,@cover_image,@servings,@duration,@difficulty,@suitable_age,@allergen_info,@notes,@favorite,@creator_id)`)
    .run({ family_id:familyId, creator_id:employer, recipe_type:'adult', category:'家常菜', cover_image:'🍲', servings:3, duration:30, difficulty:'normal', suitable_age:'', allergen_info:'', notes:'', favorite:0, ...rc }).lastInsertRowid;
  ingredients.forEach(([name,en,qty,unit,req,sub]) => db.prepare(`INSERT INTO RecipeIngredient (recipe_id,name,name_en,quantity,unit,required,substitute) VALUES (?,?,?,?,?,?,?)`).run(id,name,en,qty,unit,req?1:0,sub||''));
  steps.forEach((s,i)=> db.prepare(`INSERT INTO RecipeStep (recipe_id,step_number,instruction,instruction_en,duration,notes) VALUES (?,?,?,?,?,?)`).run(id,i+1,s.zh,s.en,s.t||0,s.note||''));
  return id;
}

const rc1 = addRecipe(
  { name:'番茄炒蛋', name_en:'Tomato & Scrambled Eggs', recipe_type:'adult', category:'家常菜', cover_image:'🍅', servings:3, duration:15, difficulty:'easy', favorite:1 },
  [['鸡蛋','Eggs','3','个',1,''],['番茄','Tomato','2','个',1,''],['葱','Spring onion','1','根',0,''],['盐','Salt','适量','',1,''],['糖','Sugar','1','勺',0,'']],
  [{zh:'番茄切块，鸡蛋打散加少许盐。',en:'Dice tomatoes; beat eggs with a pinch of salt.',t:3},
   {zh:'热油先炒鸡蛋至凝固盛出。',en:'Scramble eggs in hot oil until set, then set aside.',t:3},
   {zh:'下番茄翻炒出汁，加糖。',en:'Stir-fry tomatoes until juicy, add sugar.',t:4},
   {zh:'倒入鸡蛋翻炒均匀，撒葱花。',en:'Return eggs, toss, garnish with spring onion.',t:2}]
);

const rc2 = addRecipe(
  { name:'清蒸鲈鱼', name_en:'Steamed Sea Bass', recipe_type:'adult', category:'海鲜', cover_image:'🐟', servings:3, duration:25, difficulty:'normal' },
  [['鲈鱼','Sea bass','1','条',1,''],['姜','Ginger','5','片',1,''],['葱','Spring onion','2','根',1,''],['蒸鱼豉油','Steamed fish soy','适量','',1,'生抽']],
  [{zh:'鱼身两面划刀，铺姜片。',en:'Score the fish, lay ginger slices.',t:5},
   {zh:'水开后大火蒸 8 分钟。',en:'Steam over high heat for 8 minutes.',t:8},
   {zh:'倒掉汤汁，铺葱丝淋热油。',en:'Drain, top with scallion, pour hot oil.',t:2},
   {zh:'淋蒸鱼豉油即可。',en:'Drizzle steamed-fish soy sauce.',t:1}]
);

const rc3 = addRecipe(
  { name:'南瓜米糊', name_en:'Pumpkin Rice Puree', recipe_type:'baby', category:'宝宝辅食', cover_image:'🎃', servings:1, duration:20, difficulty:'easy', suitable_age:'7个月+', allergen_info:'无', notes:'无盐无糖，泥状' },
  [['南瓜','Pumpkin','50','g',1,''],['大米','Rice','20','g',1,''],['水','Water','适量','',1,'']],
  [{zh:'南瓜去皮切小块，焯水。',en:'Peel & dice pumpkin, blanch.',t:5,note:'需焯水'},
   {zh:'大米与南瓜同煮成软烂。',en:'Cook rice with pumpkin until very soft.',t:12},
   {zh:'用辅食机打成细腻泥状。',en:'Blend into a smooth puree.',t:3,note:'泥状'}]
);

// ---- 菜谱订单（今日菜单） ----
const mo1 = db.prepare(`INSERT INTO MealOrder (family_id,recipe_id,meal_date,meal_type,servings,start_time,due_time,assignee_id,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(familyId, rc1, todayStr, 'lunch', 3, at(11,0), at(12,0), maid, 'ingredients_ready', '少放盐').lastInsertRowid;
const mo2 = db.prepare(`INSERT INTO MealOrder (family_id,recipe_id,meal_date,meal_type,servings,start_time,due_time,assignee_id,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(familyId, rc2, todayStr, 'dinner', 3, at(17,30), at(18,30), maid, 'ingredients_short', '鲈鱼要新鲜').lastInsertRowid;
const mo3 = db.prepare(`INSERT INTO MealOrder (family_id,recipe_id,meal_date,meal_type,servings,start_time,due_time,assignee_id,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(familyId, rc3, todayStr, 'lunch', 1, at(10,30), at(11,0), maid, 'done', '宝宝午餐').lastInsertRowid;

// ---- 采购清单 ----
const sl1 = db.prepare(`INSERT INTO ShoppingList (family_id,title,assignee_id,budget,store_name,due_time,status,creator_id) VALUES (?,?,?,?,?,?,?,?)`)
  .run(familyId, '今日生鲜采购', maid, 80, 'NTUC FairPrice', at(16,0), 'buying', employer).lastInsertRowid;

function addItem(it){
  return db.prepare(`INSERT INTO ShoppingItem
    (shopping_list_id,name,name_en,category,image_url,quantity,unit,brand,specification,estimated_price,budget_limit,allow_substitute,urgency,notes,source_recipe_id,status,actual_quantity,actual_unit_price,discount,actual_total,sub_name,sub_brand,sub_spec,sub_price,sub_reason)
    VALUES (@shopping_list_id,@name,@name_en,@category,@image_url,@quantity,@unit,@brand,@specification,@estimated_price,@budget_limit,@allow_substitute,@urgency,@notes,@source_recipe_id,@status,@actual_quantity,@actual_unit_price,@discount,@actual_total,@sub_name,@sub_brand,@sub_spec,@sub_price,@sub_reason)`)
    .run({ shopping_list_id:sl1, name_en:'', category:'食材', image_url:'🛒', quantity:1, unit:'份', brand:'', specification:'', estimated_price:0, budget_limit:0, allow_substitute:1, urgency:'normal', notes:'', source_recipe_id:null, status:'to_buy', actual_quantity:null, actual_unit_price:null, discount:0, actual_total:null, sub_name:'', sub_brand:'', sub_spec:'', sub_price:null, sub_reason:'', ...it }).lastInsertRowid;
}

addItem({ name:'番茄', name_en:'Tomato', image_url:'🍅', quantity:6, unit:'个', estimated_price:3.0, budget_limit:5, status:'bought', actual_quantity:6, actual_unit_price:0.5, actual_total:3.0, source_recipe_id:rc1 });
addItem({ name:'鸡蛋', name_en:'Eggs', image_url:'🥚', quantity:1, unit:'盒', specification:'10个装', estimated_price:4.5, budget_limit:6, status:'bought', actual_quantity:1, actual_unit_price:4.2, discount:0.3, actual_total:4.2, source_recipe_id:rc1 });
addItem({ name:'鲈鱼', name_en:'Sea Bass', image_url:'🐟', quantity:1, unit:'条', specification:'约600g', estimated_price:12, budget_limit:15, status:'out_of_stock', notes:'要新鲜', source_recipe_id:rc2 });
addItem({ name:'蒸鱼豉油', name_en:'Steamed Fish Soy', image_url:'🍶', quantity:1, unit:'瓶', brand:'李锦记', estimated_price:5, budget_limit:6, allow_substitute:1, status:'sub_requested', sub_name:'生抽', sub_brand:'海天', sub_spec:'500ml', sub_price:4.5, sub_reason:'蒸鱼豉油缺货，生抽可替代', source_recipe_id:rc2 });
addItem({ name:'南瓜', name_en:'Pumpkin', image_url:'🎃', quantity:1, unit:'个', specification:'小', estimated_price:2.5, budget_limit:4, status:'bought', actual_quantity:1, actual_unit_price:2.3, actual_total:2.3, source_recipe_id:rc3 });
addItem({ name:'宝宝大米', name_en:'Baby Rice', image_url:'🍚', quantity:1, unit:'包', brand:'有机', estimated_price:8, budget_limit:10, status:'to_buy', urgency:'urgent', source_recipe_id:rc3 });

// ---- 通知 ----
const notis = [
  ['task','宝宝房消毒待开始','11:30 前需完成宝宝房消毒','task',t3,'maid'],
  ['meal','晚餐食材不足','清蒸鲈鱼缺少：鲈鱼','meal',mo2,'employer'],
  ['shopping','替代申请待处理','Siti 申请用「生抽」替代「蒸鱼豉油」','shopping',sl1,'employer'],
  ['task','任务待确认','整理厨房橱柜已完成，等待确认','task',t5,'employer'],
  ['task','任务已完成','打扫客厅已确认完成','task',t1,'maid'],
];
for (const [type,title,content,rt,rid,role] of notis)
  db.prepare(`INSERT INTO Notification (family_id,type,title,content,ref_type,ref_id,to_role) VALUES (?,?,?,?,?,?,?)`).run(familyId,type,title,content,rt,rid,role);

console.log('✅ 种子数据写入完成');
console.log(`   家庭: ${familyId}  雇主: ${employer}  女佣: ${maid}`);
console.log(`   固定任务模板 ${db.prepare('SELECT COUNT(*) c FROM TaskTemplate').get().c} 个, 今日实例 ${db.prepare('SELECT COUNT(*) c FROM DailyTask').get().c} 条, 菜谱 ${db.prepare('SELECT COUNT(*) c FROM Recipe').get().c} 个, 采购商品 ${db.prepare('SELECT COUNT(*) c FROM ShoppingItem').get().c} 项`);
