import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useI18n } from '../i18n.jsx';
import { TopBar } from '../ui.jsx';
import { useApp } from '../App.jsx';

// ===== 雇主注册功能（PRD：雇主注册功能设计） =====
const COUNTRIES = [
  { code: 'SG', name: '新加坡', name_en: 'Singapore', dial: '+65', cur: 'SGD', tz: 'Asia/Singapore' },
  { code: 'CN', name: '中国', name_en: 'China', dial: '+86', cur: 'CNY', tz: 'Asia/Shanghai' },
  { code: 'HK', name: '中国香港', name_en: 'Hong Kong', dial: '+852', cur: 'HKD', tz: 'Asia/Hong_Kong' },
  { code: 'MY', name: '马来西亚', name_en: 'Malaysia', dial: '+60', cur: 'MYR', tz: 'Asia/Kuala_Lumpur' },
  { code: 'US', name: '美国', name_en: 'United States', dial: '+1', cur: 'USD', tz: 'America/New_York' },
];
const LANGS = [['zh', '简体中文 / Chinese'], ['en', 'English'], ['ms', 'Bahasa Melayu'], ['ta', 'தமிழ் / Tamil']];
const CURRENCIES = ['SGD', 'CNY', 'HKD', 'MYR', 'USD', 'IDR', 'PHP'];
const AREA_PRESETS = [
  ['客厅', 'Living Room', '🛋️'], ['厨房', 'Kitchen', '🍳'], ['主卧', 'Master Bedroom', '🛏️'],
  ['宝宝房', 'Baby Room', '🧸'], ['厕所', 'Bathroom', '🚿'], ['阳台', 'Balcony', '🪴'],
  ['储藏间', 'Storage', '📦'], ['餐厅', 'Dining Room', '🍽️'], ['其他', 'Other', '🏠'],
];
const AVATARS = ['👨🏻‍💼', '👩🏻‍💼', '🧑🏽', '👨🏽', '👩🏽', '👵🏻', '👴🏻'];
const FAMILY_ICONS = ['🏠', '🏡', '🏘️', '👨‍👩‍👧', '🌷', '⭐'];

const blank = () => ({
  channel: 'phone', login_method: 'phone',
  country_code: 'SG', dial: '+65', phone: '', email: '', code: '',
  password: '', confirm: '',
  avatar_url: '👨🏻‍💼', full_name: '', gender: '', preferred_language: 'zh', notification_language: 'zh',
  country: 'SG', timezone: 'Asia/Singapore', default_currency: 'SGD', display_name: '',
  family_name: '', family_avatar_url: '🏠', family_country: 'SG', city: '', address: '',
  family_language: 'zh', helper_language: 'en', family_currency: 'SGD', week_start_day: 'mon', family_timezone: 'Asia/Singapore',
  areas: AREA_PRESETS.slice(0, 6).map(([n, en, ic]) => ({ name: n, name_en: en, icon: ic })),
  adults: 2, has_baby: false, baby_count: 1, has_pet: false, has_helper: true,
  recommended_templates: [],
  invite_name: '', invite_phone: '', invite_email: '', invite_lang: 'en', want_invite: true,
});

const STEPS = ['contact', 'password', 'profile', 'family', 'areas', 'household', 'templates', 'invite'];
const LS = 'hf_reg';

export default function Register() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const nav = useNavigate();
  const { showToast } = useApp();

  const [agree, setAgree] = useState(false);
  const [phase, setPhase] = useState('entry');       // entry | wizard | done
  const [step, setStep] = useState(0);
  const [f, setF] = useState(blank);
  const [result, setResult] = useState(null);
  const [hasDraft, setHasDraft] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // 中断恢复（PRD 16）：本地缓存表单 + 服务端草稿记录状态
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS);
      if (raw) { const j = JSON.parse(raw); if (j && j.f) setHasDraft(true); }
    } catch {}
  }, []);
  useEffect(() => {
    if (phase === 'wizard') { try { localStorage.setItem(LS, JSON.stringify({ step, f })); } catch {} }
  }, [phase, step, f]);

  const contact = f.channel === 'email' ? f.email.trim().toLowerCase() : (f.dial + f.phone.trim());
  const tt = (zh, e) => (en ? e : zh);

  const resume = () => {
    try { const j = JSON.parse(localStorage.getItem(LS)); setF({ ...blank(), ...j.f }); setStep(j.step || 0); setPhase('wizard'); }
    catch { setPhase('wizard'); }
  };
  const startOver = () => { localStorage.removeItem(LS); setF(blank()); setStep(0); setHasDraft(false); };

  // 各步保存服务端草稿（带 registration_status）
  const STATUS = { 0: 'CONTACT_VERIFIED', 1: 'PASSWORD_CREATED', 2: 'PROFILE_COMPLETED', 3: 'FAMILY_CREATED', 7: 'HELPER_INVITED' };
  const persist = (s) => {
    if (STATUS[s] && contact) api.saveDraft({ channel: f.channel, contact, registration_status: STATUS[s], data: { step: s } }).catch(() => {});
  };

  const next = async (validate) => {
    if (validate) { const msg = await validate(); if (msg) return showToast(msg); }
    persist(step);
    if (step < STEPS.length - 1) setStep(step + 1);
    else await commit();
  };
  const back = () => { if (step === 0) setPhase('entry'); else setStep(step - 1); };

  const commit = async () => {
    try {
      const body = {
        channel: f.channel, contact, password: f.password, login_method: f.login_method,
        phone_country_code: f.dial,
        full_name: f.full_name, display_name: f.display_name || f.full_name, gender: f.gender, avatar_url: f.avatar_url,
        preferred_language: f.preferred_language, notification_language: f.notification_language,
        country: f.country, timezone: f.timezone, default_currency: f.default_currency,
        family_name: f.family_name, family_avatar_url: f.family_avatar_url, family_country: f.family_country,
        city: f.city, address: f.address, family_language: f.family_language, helper_language: f.helper_language,
        family_currency: f.family_currency, week_start_day: f.week_start_day, family_timezone: f.family_timezone,
        areas: f.areas, recommended_templates: f.recommended_templates,
        invite: (f.has_helper && f.want_invite && (f.invite_phone || f.invite_email || f.invite_name))
          ? { name: f.invite_name, phone: f.invite_phone, email: f.invite_email, preferred_language: f.invite_lang } : null,
      };
      const r = await api.register(body);
      setResult(r); setPhase('done'); localStorage.removeItem(LS);
    } catch (e) {
      if (e.code === 'already_registered') showToast(tt('该账号已注册', 'Account already registered'));
      else showToast(tt('注册失败，请重试', 'Registration failed, please retry') + (e.body?.detail ? '：' + e.body.detail : ''));
    }
  };

  if (phase === 'entry') return <Entry {...{ tt, agree, setAgree, hasDraft, resume, startOver, setPhase, showToast, nav }} />;
  if (phase === 'done') return <Done {...{ tt, en, result, nav }} />;

  // ---- 向导 ----
  const total = STEPS.length;
  return (
    <>
      <TopBar title={tt('创建雇主账号', 'Create Employer Account')} sub={`${tt('步骤', 'Step')} ${step + 1}/${total}`} onBack={back} />
      <div style={{ padding: '0 16px' }}><div className="prog"><i style={{ width: ((step + 1) / total) * 100 + '%' }} /></div></div>
      <div className="content">
        {step === 0 && <StepContact {...{ f, set, tt, en, contact, showToast }} />}
        {step === 1 && <StepPassword {...{ f, set, tt, en, contact }} />}
        {step === 2 && <StepProfile {...{ f, set, tt, en }} />}
        {step === 3 && <StepFamily {...{ f, set, tt, en }} />}
        {step === 4 && <StepAreas {...{ f, set, tt, en, showToast }} />}
        {step === 5 && <StepHousehold {...{ f, set, tt, en }} />}
        {step === 6 && <StepTemplates {...{ f, set, tt, en }} />}
        {step === 7 && <StepInvite {...{ f, set, tt, en }} />}
      </div>
      <div className="actionbar">
        {(step === 4 || step === 5 || step === 6 || (step === 7 && !f.has_helper)) &&
          <button className="btn outline" onClick={() => next()}>{tt('跳过', 'Skip')}</button>}
        <button className="btn primary" style={{ flex: 2 }} onClick={() => next(validators(step, f, contact, tt))}>
          {step === STEPS.length - 1 ? tt('完成注册', 'Finish') : tt('下一步', 'Next')}
        </button>
      </div>
    </>
  );
}

// 各步校验，返回错误文案（无错返回空）
function validators(step, f, contact, tt) {
  if (step === 0) return async () => {
    if (f.channel === 'phone' && !/^\d{6,15}$/.test(f.phone.trim())) return tt('请输入正确的手机号', 'Please enter a valid phone number');
    if (f.channel === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return tt('请输入正确的邮箱', 'Please enter a valid email');
    if (!/^\d{4,6}$/.test(f.code.trim())) return tt('请输入验证码', 'Please enter the code');
    try { await api.verifyCode({ channel: f.channel, contact, code: f.code.trim() }); }
    catch (e) {
      if (e.code === 'code_expired') return tt('验证码已过期，请重新获取', 'Code expired, please resend');
      if (e.code === 'too_many_attempts') return tt('错误次数过多，请稍后再试', 'Too many attempts, try later');
      return tt('验证码错误，请重新输入', 'Wrong code, please retry');
    }
  };
  if (step === 1) return async () => {
    const c = pwdChecks(f.password, contact);
    if (!(c.len && c.letter && c.digit && c.notContact)) return tt('密码不符合要求', 'Password does not meet the rules');
    if (f.password !== f.confirm) return tt('两次密码不一致', 'Passwords do not match');
  };
  if (step === 2) return async () => {
    if (!f.full_name.trim()) return tt('请填写姓名或称呼', 'Please enter your name');
  };
  if (step === 3) return async () => {
    if (!f.family_name.trim()) return tt('请填写家庭名称', 'Please enter a family name');
  };
  return null;
}

const pwdChecks = (pwd, contact) => ({
  len: pwd.length >= 8 && pwd.length <= 32,
  letter: /[A-Za-z]/.test(pwd),
  digit: /\d/.test(pwd),
  notContact: pwd.length > 0 && pwd.trim().length === pwd.length && pwd !== contact,
});

// ================= 入口页（PRD 4） =================
function Entry({ tt, agree, setAgree, hasDraft, resume, startOver, setPhase, showToast }) {
  const go = () => { if (!agree) return showToast(tt('请先同意《用户协议》和《隐私政策》', 'Please agree to the Terms and Privacy Policy')); setPhase('wizard'); };
  return (
    <>
      <TopBar title={tt('创建雇主账号', 'Create Employer Account')} />
      <div className="content" style={{ paddingTop: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 52 }}>🏠</div>
          <h1 style={{ fontSize: 22, margin: '10px 0 6px' }}>HomeFlow</h1>
          <div className="muted small">{tt('用于管理家庭任务、菜谱和采购清单', 'Manage family tasks, recipes and shopping lists')}</div>
        </div>

        {hasDraft && (
          <div className="card" style={{ borderLeft: '3px solid var(--teal)' }}>
            <div className="bold small">⏳ {tt('检测到未完成的注册', 'Unfinished registration found')}</div>
            <div className="tiny muted mt4">{tt('可以继续上次的进度。', 'You can continue where you left off.')}</div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn sm primary" onClick={resume}>{tt('继续注册', 'Resume')}</button>
              <button className="btn sm outline" onClick={startOver}>{tt('重新开始', 'Start over')}</button>
            </div>
          </div>
        )}

        <button className="btn primary block" onClick={go}>📱 {tt('使用手机号注册', 'Sign up with phone')}</button>
        <button className="btn outline block mt12" onClick={() => { setPhase('wizard'); }}>📧 {tt('使用邮箱注册', 'Sign up with email')}</button>
        <button className="btn outline block mt12" onClick={() => showToast(tt('演示版暂未接入第三方登录', 'Third-party login not available in demo'))}> {tt('使用 Apple 账号继续', 'Continue with Apple')}</button>
        <button className="btn outline block mt12" onClick={() => showToast(tt('演示版暂未接入第三方登录', 'Third-party login not available in demo'))}>🔵 {tt('使用 Google 账号继续', 'Continue with Google')}</button>

        <label className="row" style={{ gap: 8, marginTop: 18, alignItems: 'flex-start' }} onClick={() => setAgree(!agree)}>
          <div className={'checkbox' + (agree ? ' on' : '')}>{agree ? '✓' : ''}</div>
          <span className="tiny muted">{tt('我已阅读并同意', 'I have read and agree to the')} 《{tt('用户协议', 'User Agreement')}》 {tt('和', 'and')} 《{tt('隐私政策', 'Privacy Policy')}》</span>
        </label>

        <div className="empty tiny" style={{ paddingTop: 18 }}>{tt('已有账号？', 'Already have an account?')} <a onClick={() => showToast(tt('演示版登录略', 'Login omitted in demo'))} style={{ color: 'var(--teal)' }}>{tt('去登录', 'Log in')}</a></div>
      </div>
    </>
  );
}

// ================= Step0 手机/邮箱 + 验证码（PRD 5/6） =================
function StepContact({ f, set, tt, en, contact, showToast }) {
  const [sent, setSent] = useState(false);
  const [left, setLeft] = useState(0);
  const [dev, setDev] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);

  const sendCode = async () => {
    if (f.channel === 'phone' && !/^\d{6,15}$/.test(f.phone.trim())) return showToast(tt('请输入正确的手机号', 'Enter a valid phone'));
    if (f.channel === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return showToast(tt('请输入正确的邮箱', 'Enter a valid email'));
    try {
      const r = await api.sendCode({ channel: f.channel, contact, country_code: f.dial });
      setSent(true); setDev(r.dev_code); setLeft(r.ttl_seconds > 120 ? 60 : r.ttl_seconds);
      clearInterval(timer.current);
      timer.current = setInterval(() => setLeft((s) => { if (s <= 1) { clearInterval(timer.current); return 0; } return s - 1; }), 1000);
    } catch (e) {
      if (e.code === 'already_registered') showToast(tt('该账号已注册，请直接登录', 'Already registered, please log in'));
      else showToast(tt('验证码发送失败，请稍后重试', 'Failed to send code, try later'));
    }
  };

  const country = COUNTRIES.find((c) => c.code === f.country_code) || COUNTRIES[0];
  return (
    <>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button className={'opt' + (f.channel === 'phone' ? ' on' : '')} onClick={() => { set('channel', 'phone'); set('login_method', 'phone'); }}>📱 {tt('手机号', 'Phone')}</button>
        <button className={'opt' + (f.channel === 'email' ? ' on' : '')} onClick={() => { set('channel', 'email'); set('login_method', 'email'); }}>📧 {tt('邮箱', 'Email')}</button>
      </div>

      {f.channel === 'phone' ? (
        <>
          <div className="field">
            <label>{tt('国家或地区', 'Country / Region')} <span className="req">*</span></label>
            <select className="select" value={f.country_code} onChange={(e) => {
              const c = COUNTRIES.find((x) => x.code === e.target.value);
              set('country_code', c.code); set('dial', c.dial);
            }}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{en ? c.name_en : c.name}（{c.dial}）</option>)}
            </select>
          </div>
          <div className="field">
            <label>{tt('手机号', 'Phone number')} <span className="req">*</span></label>
            <div className="row" style={{ gap: 8 }}>
              <span className="chip" style={{ flex: 'none' }}>{country.dial}</span>
              <input className="input" inputMode="numeric" value={f.phone} placeholder={tt('不含区号', 'Without area code')}
                onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
        </>
      ) : (
        <div className="field">
          <label>{tt('邮箱地址', 'Email address')} <span className="req">*</span></label>
          <input className="input" type="email" value={f.email} placeholder="name@example.com" onChange={(e) => set('email', e.target.value)} />
        </div>
      )}

      <div className="field">
        <label>{tt('验证码', 'Verification code')} <span className="req">*</span></label>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" inputMode="numeric" value={f.code} placeholder={tt('4–6 位', '4–6 digits')}
            onChange={(e) => set('code', e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <button className="btn sm outline" style={{ flex: 'none', whiteSpace: 'nowrap' }} disabled={left > 0} onClick={sendCode}>
            {left > 0 ? left + 's' : (sent ? tt('重新发送', 'Resend') : tt('获取验证码', 'Get code'))}
          </button>
        </div>
        {dev && <div className="hint" style={{ marginTop: 8, color: 'var(--teal)' }}>🔑 {tt('演示验证码', 'Demo code')}：<b>{dev}</b>（{tt('实际场景通过短信/邮件下发', 'sent via SMS/email in production')}）</div>}
      </div>
    </>
  );
}

// ================= Step1 密码（PRD 7） =================
function StepPassword({ f, set, tt, en, contact }) {
  const [show, setShow] = useState(false);
  const c = pwdChecks(f.password, contact);
  const Rule = ({ ok, label }) => <div className="tiny" style={{ color: ok ? 'var(--green)' : 'var(--muted)' }}>{ok ? '✓' : '○'} {label}</div>;
  return (
    <>
      <div className="field">
        <label>{tt('设置密码', 'Set password')} <span className="req">*</span></label>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" type={show ? 'text' : 'password'} value={f.password} onChange={(e) => set('password', e.target.value)} />
          <button className="btn sm outline" style={{ flex: 'none' }} onClick={() => setShow(!show)}>{show ? tt('隐藏', 'Hide') : tt('显示', 'Show')}</button>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
          <Rule ok={c.len} label={tt('8–32 个字符', '8–32 characters')} />
          <Rule ok={c.letter} label={tt('包含字母', 'Contains a letter')} />
          <Rule ok={c.digit} label={tt('包含数字', 'Contains a number')} />
          <Rule ok={c.notContact} label={tt('不与账号相同、非全空格', 'Different from account, not all spaces')} />
        </div>
      </div>
      <div className="field">
        <label>{tt('确认密码', 'Confirm password')} <span className="req">*</span></label>
        <input className="input" type={show ? 'text' : 'password'} value={f.confirm} onChange={(e) => set('confirm', e.target.value)} />
        {f.confirm && f.confirm !== f.password && <div className="tiny" style={{ color: 'var(--red)', marginTop: 6 }}>{tt('两次密码不一致', 'Passwords do not match')}</div>}
      </div>
    </>
  );
}

// ================= Step2 雇主基本资料（PRD 8） =================
function StepProfile({ f, set, tt, en }) {
  return (
    <>
      <div className="section-title">{tt('完善个人资料', 'Complete your profile')}</div>
      <div className="field">
        <label>{tt('头像', 'Avatar')}</label>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {AVATARS.map((a) => <button key={a} className={'chip' + (f.avatar_url === a ? ' on' : '')} style={{ fontSize: 20 }} onClick={() => set('avatar_url', a)}>{a}</button>)}
        </div>
      </div>
      <Text label={tt('姓名或称呼', 'Name')} req v={f.full_name} on={(v) => set('full_name', v)} ph={tt('女佣端可见', 'Visible to helper')} />
      <Text label={tt('对女佣显示的称呼', 'Name shown to helper')} v={f.display_name} on={(v) => set('display_name', v)} ph="e.g. Madam Gao" />
      <div className="field">
        <label>{tt('性别', 'Gender')}</label>
        <div className="seg">
          {[['', tt('不填', 'N/A')], ['male', tt('男', 'Male')], ['female', tt('女', 'Female')]].map(([v, l]) =>
            <button key={v} className={'opt' + (f.gender === v ? ' on' : '')} onClick={() => set('gender', v)}>{l}</button>)}
        </div>
      </div>
      <Select label={tt('常用语言', 'Preferred language')} req v={f.preferred_language} on={(v) => set('preferred_language', v)} opts={LANGS} />
      <Select label={tt('消息通知语言', 'Notification language')} req v={f.notification_language} on={(v) => set('notification_language', v)} opts={LANGS} />
      <div className="field">
        <label>{tt('所在国家或地区', 'Country / Region')} <span className="req">*</span></label>
        <select className="select" value={f.country} onChange={(e) => {
          const c = COUNTRIES.find((x) => x.code === e.target.value);
          set('country', c.code); set('timezone', c.tz); set('default_currency', c.cur);
        }}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{en ? c.name_en : c.name}</option>)}
        </select>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field grow"><label>{tt('时区', 'Timezone')}</label><input className="input" value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></div>
        <div className="field" style={{ width: 120 }}><label>{tt('默认货币', 'Currency')}</label>
          <select className="select" value={f.default_currency} onChange={(e) => set('default_currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
      </div>
    </>
  );
}

// ================= Step3 创建家庭（PRD 9） =================
function StepFamily({ f, set, tt, en }) {
  const suggested = f.full_name ? (en ? `${f.full_name} Family` : `${f.full_name}家`) : '';
  return (
    <>
      <div className="section-title">{tt('创建你的家庭', 'Create your family')}</div>
      <div className="field">
        <label>{tt('家庭头像', 'Family icon')}</label>
        <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {FAMILY_ICONS.map((a) => <button key={a} className={'chip' + (f.family_avatar_url === a ? ' on' : '')} style={{ fontSize: 20 }} onClick={() => set('family_avatar_url', a)}>{a}</button>)}
        </div>
      </div>
      <div className="field">
        <label>{tt('家庭名称', 'Family name')} <span className="req">*</span></label>
        <input className="input" value={f.family_name} placeholder={suggested || 'Gao Family'} onChange={(e) => set('family_name', e.target.value)} />
        {!f.family_name && suggested && <button className="chip" style={{ marginTop: 8 }} onClick={() => set('family_name', suggested)}>{tt('使用', 'Use')} “{suggested}”</button>}
      </div>
      <div className="field">
        <label>{tt('国家或地区', 'Country / Region')} <span className="req">*</span></label>
        <select className="select" value={f.family_country} onChange={(e) => {
          const c = COUNTRIES.find((x) => x.code === e.target.value);
          set('family_country', c.code); set('family_timezone', c.tz); set('family_currency', c.cur);
        }}>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{en ? c.name_en : c.name}</option>)}
        </select>
      </div>
      <Text label={tt('城市', 'City')} v={f.city} on={(v) => set('city', v)} ph="Singapore" />
      <Text label={tt('家庭地址', 'Address')} v={f.address} on={(v) => set('address', v)} ph={tt('选填', 'Optional')} />
      <Select label={tt('默认语言', 'Default language')} req v={f.family_language} on={(v) => set('family_language', v)} opts={LANGS} />
      <Select label={tt('女佣显示语言', 'Helper language')} req v={f.helper_language} on={(v) => set('helper_language', v)} opts={LANGS} />
      <div className="row" style={{ gap: 10 }}>
        <div className="field grow">
          <label>{tt('每周起始日', 'Week starts on')} <span className="req">*</span></label>
          <div className="seg">
            <button className={'opt' + (f.week_start_day === 'mon' ? ' on' : '')} onClick={() => set('week_start_day', 'mon')}>{tt('周一', 'Mon')}</button>
            <button className={'opt' + (f.week_start_day === 'sun' ? ' on' : '')} onClick={() => set('week_start_day', 'sun')}>{tt('周日', 'Sun')}</button>
          </div>
        </div>
        <div className="field" style={{ width: 120 }}><label>{tt('默认货币', 'Currency')}</label>
          <select className="select" value={f.family_currency} onChange={(e) => set('family_currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
      </div>
    </>
  );
}

// ================= Step4 家庭区域初始化（PRD 10） =================
function StepAreas({ f, set, tt, en, showToast }) {
  const has = (name) => f.areas.some((a) => a.name === name);
  const toggle = (preset) => {
    const [n, e, ic] = preset;
    set('areas', has(n) ? f.areas.filter((a) => a.name !== n) : [...f.areas, { name: n, name_en: e, icon: ic }]);
  };
  const addCustom = () => {
    const name = window.prompt(tt('输入区域名称', 'Enter area name'));
    if (name && name.trim()) set('areas', [...f.areas, { name: name.trim(), name_en: name.trim(), icon: '🏠' }]);
  };
  const selectAll = () => set('areas', AREA_PRESETS.map(([n, e, ic]) => ({ name: n, name_en: e, icon: ic })));
  return (
    <>
      <div className="section-title">{tt('选择家庭区域', 'Choose home areas')}</div>
      <div className="muted tiny" style={{ marginBottom: 10 }}>{tt('这些区域将用于创建任务时分类。', 'These areas are used to categorize tasks.')}</div>
      <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
        {AREA_PRESETS.map((p) => <button key={p[0]} className={'chip' + (has(p[0]) ? ' on' : '')} onClick={() => toggle(p)}>{p[2]} {en ? p[1] : p[0]}</button>)}
      </div>
      {f.areas.filter((a) => !AREA_PRESETS.some((p) => p[0] === a.name)).map((a) => (
        <span key={a.name} className="chip on" style={{ marginTop: 8, marginRight: 6 }} onClick={() => set('areas', f.areas.filter((x) => x.name !== a.name))}>{a.icon} {a.name} ✕</span>
      ))}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn sm outline" onClick={selectAll}>{tt('全选', 'Select all')}</button>
        <button className="btn sm outline" onClick={addCustom}>＋ {tt('添加区域', 'Add area')}</button>
      </div>
      <div className="muted tiny" style={{ marginTop: 10 }}>{tt('已选', 'Selected')} {f.areas.length}</div>
    </>
  );
}

// ================= Step5 家庭成员情况（PRD 11） =================
function StepHousehold({ f, set, tt }) {
  const Stepper = ({ label, v, on, min = 0 }) => (
    <div className="spread" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="small">{label}</span>
      <div className="row" style={{ gap: 12 }}>
        <button className="iconbtn" onClick={() => on(Math.max(min, v - 1))}>−</button>
        <span className="bold" style={{ minWidth: 18, textAlign: 'center' }}>{v}</span>
        <button className="iconbtn" onClick={() => on(v + 1)}>＋</button>
      </div>
    </div>
  );
  const Sw = ({ label, on, click }) => (
    <div className="spread" style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="small">{label}</span>
      <div className={'switch' + (on ? ' on' : '')} onClick={click}><i /></div>
    </div>
  );
  return (
    <>
      <div className="section-title">{tt('家庭情况', 'Household')}</div>
      <div className="muted tiny" style={{ marginBottom: 6 }}>{tt('用于初始化任务和菜谱，可全部跳过。', 'Used to initialize tasks and recipes. All optional.')}</div>
      <div className="card" style={{ padding: '4px 16px' }}>
        <Stepper label={tt('家庭成人数量', 'Adults')} v={f.adults} on={(v) => set('adults', v)} min={1} />
        <Sw label={tt('是否有宝宝或儿童', 'Has baby / children')} on={f.has_baby} click={() => set('has_baby', !f.has_baby)} />
        {f.has_baby && <Stepper label={tt('宝宝数量', 'Number of babies')} v={f.baby_count} on={(v) => set('baby_count', v)} min={1} />}
        <Sw label={tt('是否有宠物', 'Has pets')} on={f.has_pet} click={() => set('has_pet', !f.has_pet)} />
        <Sw label={tt('是否已经有女佣', 'Already have a helper')} on={f.has_helper} click={() => set('has_helper', !f.has_helper)} />
      </div>
    </>
  );
}

// ================= Step6 推荐任务模板（PRD 18） =================
function StepTemplates({ f, set, tt }) {
  const [list, setList] = useState([]);
  useEffect(() => { api.recommendedTemplates().then(setList).catch(() => setList([])); }, []);
  const has = (k) => f.recommended_templates.includes(k);
  const toggle = (k) => set('recommended_templates', has(k) ? f.recommended_templates.filter((x) => x !== k) : [...f.recommended_templates, k]);
  return (
    <>
      <div className="section-title">{tt('推荐家庭任务模板', 'Recommended task templates')}</div>
      <div className="muted tiny" style={{ marginBottom: 10 }}>{tt('选择后系统会按所选星期自动生成每日任务，稍后可在「固定任务」中调整。', 'Selected templates auto-generate daily tasks on chosen weekdays; adjust later in Fixed Tasks.')}</div>
      {list.map((tpl) => (
        <div key={tpl.task_name} className="checkrow" onClick={() => toggle(tpl.task_name)}>
          <div className={'checkbox' + (has(tpl.task_name) ? ' on' : '')}>{has(tpl.task_name) ? '✓' : ''}</div>
          <div className="grow"><div className="bold small">{tt(tpl.task_name, tpl.task_name_en)}</div>
            <div className="tiny muted">{tpl.area} · {tpl.estimated_duration} min</div></div>
        </div>
      ))}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn sm outline" onClick={() => set('recommended_templates', list.map((x) => x.task_name))}>{tt('全部添加', 'Add all')}</button>
        <button className="btn sm outline" onClick={() => set('recommended_templates', [])}>{tt('清空', 'Clear')}</button>
      </div>
    </>
  );
}

// ================= Step7 邀请女佣（PRD 12） =================
function StepInvite({ f, set, tt }) {
  if (!f.has_helper) return (
    <div className="empty" style={{ paddingTop: 40 }}>
      <div className="ic">🧹</div>
      <div>{tt('你还没有女佣', 'No helper yet')}</div>
      <div className="tiny muted" style={{ marginTop: 6 }}>{tt('可在注册完成后随时邀请。点击「跳过」继续。', 'You can invite a helper anytime after registration. Tap Skip to continue.')}</div>
    </div>
  );
  return (
    <>
      <div className="section-title">{tt('邀请女佣', 'Invite your helper')}</div>
      <div className="muted tiny" style={{ marginBottom: 10 }}>{tt('完成注册后将生成邀请码与链接（有效期 7 天）。', 'An invite code & link (valid 7 days) will be generated after registration.')}</div>
      <Text label={tt('女佣姓名', 'Helper name')} v={f.invite_name} on={(v) => set('invite_name', v)} ph={tt('可稍后补充', 'Optional')} />
      <Text label={tt('手机号', 'Phone')} v={f.invite_phone} on={(v) => set('invite_phone', v)} ph={tt('用于发送邀请', 'For sending the invite')} />
      <Text label={tt('邮箱', 'Email')} v={f.invite_email} on={(v) => set('invite_email', v)} ph={tt('用于发送邀请', 'For sending the invite')} />
      <Select label={tt('默认语言', 'Helper language')} v={f.invite_lang} on={(v) => set('invite_lang', v)} opts={LANGS} />
    </>
  );
}

// ================= 完成页（PRD 14） =================
function Done({ tt, en, result, nav }) {
  const { showToast } = useApp();
  const fam = result?.family || {};
  const inv = result?.invitation;
  const code = result?.invite_code;
  const copy = () => { try { navigator.clipboard.writeText(code); showToast(tt('已复制', 'Copied')); } catch { showToast(code); } };
  return (
    <>
      <div className="topbar teal" style={{ paddingTop: 18, paddingBottom: 22 }}>
        <div className="grow"><h1 style={{ fontSize: 20 }}>🎉 {tt('家庭创建完成', 'Family created')}</h1>
          <div className="sub">{tt('欢迎使用 HomeFlow', 'Welcome to HomeFlow')}</div></div>
      </div>
      <div className="content">
        <div className="card">
          <div className="row" style={{ gap: 12 }}>
            <div className="thumb" style={{ fontSize: 26 }}>{result?.user?.avatar || '👨🏻‍💼'}</div>
            <div className="grow"><div className="bold">{result?.user?.display_name || result?.user?.name}</div>
              <div className="tiny muted">{fam.family_avatar_url} {fam.family_name}</div></div>
          </div>
          <div className="stat-grid" style={{ marginTop: 12 }}>
            <div className="stat"><div className="n">{result?.area_count ?? 0}</div><div className="l">{tt('家庭区域', 'Areas')}</div></div>
            <div className="stat"><div className="n">{inv ? 1 : 0}</div><div className="l">{tt('女佣邀请', 'Helper invites')}</div></div>
          </div>
          <div className="tiny muted" style={{ marginTop: 10 }}>
            {tt('默认语言', 'Language')}：{fam.default_language?.toUpperCase()} · {tt('默认货币', 'Currency')}：{fam.default_currency}
          </div>
        </div>

        {code && (
          <div className="card">
            <div className="bold small">🔗 {tt('女佣邀请码', 'Helper invite code')}</div>
            <div className="spread" style={{ marginTop: 8 }}>
              <span className="bold" style={{ fontSize: 22, letterSpacing: 2 }}>{code}</span>
              <button className="btn sm outline" onClick={copy}>{tt('复制', 'Copy')}</button>
            </div>
            {inv && <div className="tiny muted mt8">{tt('状态', 'Status')}：{tt('待接受', 'Pending')} · {tt('有效期 7 天', 'Valid 7 days')}{inv.invitee_name ? ' · ' + inv.invitee_name : ''}</div>}
          </div>
        )}

        <div className="section-title">{tt('推荐下一步', 'Next steps')}</div>
        <button className="btn primary block" onClick={() => nav('/e/home')}>🏠 {tt('进入首页', 'Go to home')}</button>
        <button className="btn outline block mt12" onClick={() => nav('/task-new')}>＋ {tt('创建第一个任务', 'Create first task')}</button>
        <button className="btn outline block mt12" onClick={() => nav('/members')}>🧹 {tt('邀请女佣', 'Invite helper')}</button>
      </div>
    </>
  );
}

// ---- 小型表单控件 ----
function Text({ label, v, on, ph, req }) {
  return (
    <div className="field">
      <label>{label} {req && <span className="req">*</span>}</label>
      <input className="input" value={v} placeholder={ph} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
function Select({ label, v, on, opts, req }) {
  return (
    <div className="field">
      <label>{label} {req && <span className="req">*</span>}</label>
      <select className="select" value={v} onChange={(e) => on(e.target.value)}>
        {opts.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
      </select>
    </div>
  );
}
