/* متتبع برامج المؤشرات ١٤٤٨ — تطبيق PWA
   Talks to the Google Sheet through the Apps Script JSON API (see API.gs). */
'use strict';
const S = { token: '', me: null, scope: undefined, boot: null, programs: [], dash: null, filter: 'all', dirty: {}, online: navigator.onLine, installEvt: null, loadedAt: '' };
const STATUS_COLOR = { 'لم يبدأ': 'var(--wait)', 'قيد التنفيذ': 'var(--run)', 'مكتمل': 'var(--ok)', 'مؤجل': 'var(--hold)', 'ملغى': 'var(--off)' };
const ERR = { PIN_WRONG: 'رمز الدخول غير صحيح', LOCKED: 'تم إيقاف المحاولات مؤقتاً (15 دقيقة) بعد 5 محاولات خاطئة', NOT_FOUND: 'الاسم غير موجود في قائمة المسؤولين', NO_PIN: 'لم يُحدَّد رمز دخول لهذا الاسم بعد — اطلب من المدير تشغيل «إعداد التطبيق»', PIN_FORMAT: 'رمز الدخول يجب أن يكون ٤ أرقام', FORBIDDEN: 'لا تملك صلاحية هذا التعديل (يمكنك تعديل برامجك فقط)', BAD_KEY: 'إعداد التطبيق غير مطابق للملف — راجع مشرف المتتبع', UNKNOWN_ACTION: 'طلب غير معروف', BAD_JSON: 'طلب غير صالح', AUTH: 'انتهت الجلسة — سجّل الدخول مجدداً', AUTH_EXPIRED: 'انتهت صلاحية الجلسة — سجّل الدخول مجدداً', ONLY_IN_SHEET: 'هذا الإجراء يُنفَّذ من داخل ملف Google Sheets (قائمة «متتبع البرامج»)' };
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, ms = 2600) => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms); };
const fmtD = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const isAdmin = () => !!(S.me && S.me.appRole === 'مدير');
const myName = () => (S.me && S.me.name) || '';
const nkey = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْ]/g, '');
/* same rule as owns_() in the sheet: exact مسؤول البرنامج / مسؤول المؤشر, or my name inside a multi-person «المكلف» cell */
const owns = (name, presp, iresp) => { const n = nkey(name); if (!n) return false; const p = nkey(presp); return p === n || nkey(iresp) === n || (n.split(' ').length >= 2 && p.indexOf(n) >= 0); };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };

// ------------------------------------------------------------ API
async function api(action, payload = {}, { timeout = 60000 } = {}) {
  if (!S.online) throw new Error('لا يوجد اتصال بالإنترنت');
  if (!CONFIG.API_URL || CONFIG.API_URL.startsWith('__')) throw new Error('لم يُضبط رابط الخادم في config.js');
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    r = await fetch(CONFIG.API_URL, { method: 'POST', redirect: 'follow', signal: ctrl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: CONFIG.APP_KEY, action, token: S.token || undefined, ...payload }) });
  } catch (e) { clearTimeout(tm); throw new Error(e.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم' : 'تعذّر الاتصال بالخادم'); }
  clearTimeout(tm);
  let j; try { j = await r.json(); } catch (e) { throw new Error('رد غير متوقع من الخادم (' + r.status + ')'); }
  if (!j.ok) {
    const code = String(j.error || '');
    if (code === 'AUTH' || code === 'AUTH_EXPIRED') { logout(true); }
    const base = code.split(':')[0];
    const err = new Error(ERR[base] || code); err.code = base; err.left = j.left; throw err;
  }
  return j;
}

// ------------------------------------------------------------ navigation
function go(v) {
  if (!S.me && !['login', 'loading'].includes(v)) v = 'login';
  if (v === 'people' && !isAdmin()) v = 'me';
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v !== 'mine') $('mineList').innerHTML = ''; if (v !== 'all') $('allList').innerHTML = '';   // cards share ids → only one list in the DOM
  window.scrollTo(0, 0);
  if (v === 'mine') renderMine(); if (v === 'quick') renderQuick(); if (v === 'all') renderAll(); if (v === 'dash') loadDash(false); if (v === 'people') renderPeople(); if (v === 'me') renderMe();
}
function applyRole() {
  const adm = isAdmin();
  document.querySelectorAll('[data-admin]').forEach(el => { el.hidden = !adm; });
  if (S.boot && S.boot.standalone) document.querySelectorAll('[data-sheet-only]').forEach(el => { el.hidden = true; });
  $('nav').hidden = !S.me;
  $('userChip').textContent = S.me ? ('👤 ' + S.me.name + (adm ? ' · مدير' : '')) : '👤 تسجيل الدخول';
}

// ------------------------------------------------------------ boot
async function init() {
  window.addEventListener('online', () => { S.online = true; $('offlineBar').hidden = true; if (S.me) refresh(true); });
  window.addEventListener('offline', () => { S.online = false; $('offlineBar').hidden = false; });
  $('offlineBar').hidden = S.online;
  setupInstall();
  S.token = store.get('tr_token', '');
  S.me = store.get('tr_me', null);
  const cache = store.get('tr_cache', null);
  if (S.token && S.me && cache) { S.boot = cache.boot; S.programs = cache.programs; S.loadedAt = cache.at; fillSelects(); applyRole(); go('mine'); }
  if (S.token && S.me) {
    try { await refresh(false); } catch (e) { if (!S.boot) { toast(e.message, 6000); go('login'); loadNames(); } else toast('تعذّر التحديث: ' + e.message, 5000); }
  } else { applyRole(); go('login'); loadNames(); }
}
async function loadNames() {
  const sel = $('loginName'); const saved = store.get('tr_lastName', '');
  const cached = store.get('tr_names', []);
  const fill = names => { sel.innerHTML = '<option value="">— اختر الاسم —</option>' + names.map(n => `<option ${n.name === saved ? 'selected' : ''}>${esc(n.name)}</option>`).join(''); };
  if (cached.length) fill(cached);
  try { const r = await api('names'); store.set('tr_names', r.names); fill(r.names); $('loginHint').textContent = ''; }
  catch (e) { $('loginHint').textContent = cached.length ? '' : ('⚠️ ' + e.message); }
}
async function refresh(silent) {
  const [b, p] = await Promise.all([api('bootstrap'), api('programs')]);
  S.boot = b; S.me = b.me; S.programs = p.programs; S.loadedAt = p.at;
  store.set('tr_me', S.me); store.set('tr_cache', { boot: b, programs: p.programs, at: p.at });
  fillSelects(); applyRole();
  const cur = document.querySelector('.view.on'); const v = cur ? cur.id.slice(2) : 'mine';
  go(['loading', 'login'].includes(v) ? 'mine' : v);
  if (!silent) toast('✅ تم التحديث');
}
function fillSelects() {
  const names = S.boot.people.map(p => p.name).filter(Boolean);
  const stOpts = S.boot.stages.map(s => `<option>${esc(s)}</option>`).join('');
  $('qStage').innerHTML = stOpts; $('nStage').innerHTML = stOpts; $('fStage').innerHTML = '<option value="">كل المراحل</option>' + stOpts;
  $('fStatus').innerHTML = '<option value="">كل الحالات</option>' + S.boot.statuses.map(s => `<option>${esc(s)}</option>`).join('') + '<option value="__nodate">بلا تواريخ</option><option value="__late">متأخر</option>';
  $('nResp').innerHTML = names.map(n => `<option ${n === myName() ? 'selected' : ''}>${esc(n)}</option>`).join('');
  fillQInd(false); fillNInd();
}

// ------------------------------------------------------------ login / logout
async function login() {
  const name = $('loginName').value, pin = $('loginPin').value.replace(/\D/g, '');
  if (!name) return toast('اختر الاسم أولاً');
  if (pin.length !== 4) return toast('أدخل رمز الدخول (٤ أرقام)');
  const btn = $('loginBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> جارٍ الدخول…';
  try {
    const r = await api('login', { name, pin });
    S.token = r.token; S.me = r.me; store.set('tr_token', S.token); store.set('tr_me', S.me); store.set('tr_lastName', name);
    $('loginPin').value = '';
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-loading'));
    await refresh(true);
    toast('مرحباً ' + S.me.name + ' 👋');
  } catch (e) {
    toast('❌ ' + e.message + (e.left != null && e.code === 'PIN_WRONG' ? ` (المتبقي ${e.left} محاولات)` : ''), 5000);
    go('login');
  } finally { btn.disabled = false; btn.textContent = 'دخول'; }
}
function logout(silent) {
  S.token = ''; S.me = null; S.boot = null; S.programs = []; S.dash = null; S.scope = undefined;
  ['tr_token', 'tr_me', 'tr_cache'].forEach(store.del);
  applyRole(); go('login'); loadNames();
  if (!silent) toast('تم تسجيل الخروج');
}

// ------------------------------------------------------------ cards
function canEdit(p) { return isAdmin() || owns(myName(), p.presp, p.iresp); }
function alertClass(a) { if (!a) return ''; if (a.startsWith('⛔')) return 'late'; if (/^(⏰|🚀|🏁|🔔)/.test(a)) return 'soon'; if (a.startsWith('⚠')) return 'nodate'; return ''; }
function card(p) {
  const pct = p.status === 'مكتمل' ? 100 : p.pct, ed = canEdit(p);
  return `<div class="card ${ed ? '' : 'ro'}" id="c-${esc(p.id)}">
    <div class="row between" style="align-items:flex-start">
      <div class="grow"><h3>${esc(p.program)}</h3>
        <div class="meta">${esc(p.stage)} · <span class="tag">${esc(p.icode)}</span> ${esc(p.ind)} · المسؤول: <b>${esc(p.presp || p.iresp || '—')}</b></div></div>
      <span class="status s-${esc(p.status).replace(/ /g, '-')}">${esc(p.status)}</span>
    </div>
    <div class="row between" style="margin-top:6px">
      <span class="meta">📅 ${fmtD(p.start)} ← ${fmtD(p.end)}</span>
      <span class="alert ${alertClass(p.alert)}">${esc(p.alert)}</span>
    </div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="row" style="margin-top:10px">
      ${ed ? `<button class="btn sm" onclick="openEdit('${esc(p.id)}')">✏️ تعديل</button>` : ''}
      ${ed && p.status === 'لم يبدأ' ? `<button class="btn sm run" onclick="quickStatus('${esc(p.id)}','قيد التنفيذ')">▶ ابدأ الآن</button>` : ''}
      ${ed && p.status !== 'مكتمل' && p.status !== 'ملغى' ? `<button class="btn sm ok" onclick="quickStatus('${esc(p.id)}','مكتمل')">✅ اكتمل</button>` : ''}
      ${p.evid ? `<a class="btn sm" href="${esc(p.evid)}" target="_blank" rel="noopener">📎 الشواهد</a>` : ''}
      <span class="mini" style="margin-inline-start:auto">${p.upd ? 'آخر تحديث ' + esc(p.upd) : ''}</span>
    </div>
    <div id="e-${esc(p.id)}"></div>
  </div>`;
}
function openEdit(id) {
  const p = S.programs.find(x => x.id === id); const box = $('e-' + id); if (!box || !p) return;
  if (box.innerHTML) { box.innerHTML = ''; return; }
  const names = S.boot.people.map(x => x.name).filter(Boolean);
  box.innerHTML = `<div class="edit">
    <div class="grid2">
      <div><label class="f">تاريخ البداية</label><input type="date" id="s-${id}" value="${p.start}"></div>
      <div><label class="f">تاريخ النهاية</label><input type="date" id="d-${id}" value="${p.end}"></div>
      <div><label class="f">الحالة</label><div class="seg" id="st-${id}" data-v="${esc(p.status)}">${S.boot.statuses.map(s => `<button type="button" class="${s === p.status ? 'on' : ''}" style="${s === p.status ? 'background:' + STATUS_COLOR[s] : ''}" onclick="pickStatus('${id}','${s}')">${s}</button>`).join('')}</div></div>
      <div><label class="f">نسبة الإنجاز: <b id="pv-${id}">${p.pct}%</b></label><input type="range" min="0" max="100" step="5" id="p-${id}" value="${p.pct}" oninput="$('pv-${id}').textContent=this.value+'%'" style="width:100%"></div>
      <div><label class="f">مسؤول البرنامج</label><select id="r-${id}" ${isAdmin() ? '' : 'disabled'}>${names.map(n => `<option ${n === (p.presp || p.iresp) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div><label class="f">رابط الشواهد</label><input type="url" id="v-${id}" value="${esc(p.evid)}" placeholder="https://…"></div>
      <div style="grid-column:1/-1"><label class="f">ملاحظات</label><textarea id="n-${id}" rows="2">${esc(p.notes)}</textarea></div>
    </div>
    <div class="row" style="margin-top:10px"><button class="btn p" onclick="saveEdit('${id}')">💾 حفظ</button><button class="btn" onclick="openEdit('${id}')">إلغاء</button></div>
  </div>`;
}
function pickStatus(id, s) { const seg = $('st-' + id); [...seg.children].forEach(b => { const on = b.textContent === s; b.classList.toggle('on', on); b.style.background = on ? STATUS_COLOR[s] : ''; }); seg.dataset.v = s; if (s === 'مكتمل') { $('p-' + id).value = 100; $('pv-' + id).textContent = '100%'; } if (s === 'لم يبدأ') { $('p-' + id).value = 0; $('pv-' + id).textContent = '0%'; } }
async function saveEdit(id) {
  const seg = $('st-' + id); const status = seg.dataset.v;
  const payload = { id, start: $('s-' + id).value, end: $('d-' + id).value, status, pct: +$('p-' + id).value, evid: $('v-' + id).value.trim(), notes: $('n-' + id).value.trim() };
  if (isAdmin()) payload.presp = $('r-' + id).value;
  if (payload.start && payload.end && payload.end < payload.start) return toast('تاريخ النهاية قبل البداية!');
  await persist([payload]);
}
async function quickStatus(id, status) {
  const p = S.programs.find(x => x.id === id); const payload = { id, status };
  if (status === 'قيد التنفيذ' && !p.start) payload.start = todayISO();
  if (status === 'مكتمل') { payload.pct = 100; if (!p.end) payload.end = todayISO(); if (!p.start) payload.start = todayISO(); }
  await persist([payload]);
}
async function persist(list) {
  toast('جارٍ الحفظ…', 15000);
  try {
    const res = await api('saveMany', { list });
    const fresh = await api('programs'); S.programs = fresh.programs; S.loadedAt = fresh.at; S.dash = null;
    store.set('tr_cache', { boot: S.boot, programs: S.programs, at: S.loadedAt });
    toast(`✅ تم الحفظ (${res.changed} تغيير)`);
    const v = document.querySelector('.view.on').id.slice(2); go(v);
  } catch (e) { toast('❌ ' + e.message, 6000); }
}

// ------------------------------------------------------------ mine
function ownSet() { return S.programs.filter(p => owns(myName(), p.presp || p.iresp, p.iresp)); }
function mineSet() { if (isAdmin() && S.scope === undefined) S.scope = ownSet().length ? 'mine' : 'all'; return isAdmin() && S.scope === 'all' ? S.programs : ownSet(); }
function applyFilter(list, f) {
  switch (f) {
    case 'nodate': return list.filter(p => !p.start && !p.end && p.status !== 'مكتمل' && p.status !== 'ملغى');
    case 'soon': return list.filter(p => /^(⏰|🚀|🏁|🔔)/.test(p.alert || ''));
    case 'run': return list.filter(p => p.status === 'قيد التنفيذ');
    case 'late': return list.filter(p => (p.alert || '').startsWith('⛔'));
    case 'done': return list.filter(p => p.status === 'مكتمل'); default: return list;
  }
}
function renderMine() {
  if (!S.me) { go('login'); return; }
  const mine = mineSet(); $('mineName').textContent = isAdmin() && S.scope === 'all' ? 'جميع المسؤولين' : myName();
  const counts = { all: mine.length, nodate: applyFilter(mine, 'nodate').length, soon: applyFilter(mine, 'soon').length, run: applyFilter(mine, 'run').length, late: applyFilter(mine, 'late').length, done: applyFilter(mine, 'done').length };
  const labels = { all: 'الكل', nodate: '⚠ بلا تواريخ', soon: '🔔 قريبة', run: '▶ قيد التنفيذ', late: '⛔ متأخرة', done: '✅ مكتملة' };
  const scopeBtn = isAdmin() ? `<button class="scope" onclick="S.scope=S.scope==='all'?'mine':'all';renderMine()">${S.scope === 'all' ? '👤 برامجي فقط (' + ownSet().length + ')' : '👥 جميع المسؤولين (' + S.programs.length + ')'}</button>` : '';
  $('mineChips').innerHTML = scopeBtn + Object.keys(labels).map(k => `<button class="${S.filter === k ? 'on' : ''}" onclick="S.filter='${k}';renderMine()">${labels[k]} (${counts[k]})</button>`).join('');
  const list = applyFilter(mine, S.filter);
  $('mineCount').textContent = `${list.length} برنامجاً`;
  $('mineList').innerHTML = list.length ? list.map(card).join('') : `<div class="empty">${mine.length ? 'لا توجد برامج في هذا التصنيف 🎉' : 'لا توجد برامج مسندة إليك حالياً — راجع «كل البرامج» أو اطلب من المدير إسناد البرامج'}</div>`;
}

// ------------------------------------------------------------ quick
function indsFor(stage) { return S.boot.indicators.filter(i => i.stage === stage); }
function quickPool() { return isAdmin() ? S.programs : S.programs.filter(canEdit); }
function fillQInd(render = true) {
  const st = $('qStage').value, pool = quickPool();
  const inds = indsFor(st).map(i => ({ ...i, n: pool.filter(p => p.stage === st && p.icode === i.code).length })).filter(i => isAdmin() || i.n);
  $('qInd').innerHTML = inds.map(i => `<option value="${esc(i.code)}">${esc(i.code)} – ${esc(i.name)} (${i.n})</option>`).join('');
  $('quickHint').textContent = isAdmin() ? 'اختر المرحلة ثم المؤشر، عبّئ تواريخ عدة برامج دفعة واحدة واضغط «حفظ الكل».' : 'تظهر هنا برامجك فقط. عبّئ التواريخ والحالة ثم اضغط «حفظ الكل».';
  if (render) renderQuick();
}
function fillNInd() { const st = $('nStage').value; $('nInd').innerHTML = indsFor(st).map(i => `<option value="${esc(i.code)}">${esc(i.code)} – ${esc(i.name)}</option>`).join(''); }
function renderQuick() {
  const st = $('qStage').value, code = $('qInd').value; S.dirty = {};
  const list = quickPool().filter(p => p.stage === st && p.icode === code);
  $('quickActions').hidden = !list.length;
  $('quickList').innerHTML = list.length ? list.map(p => `<div class="qrow">
      <div class="pn"><b>${esc(p.program)}</b><div class="mini">${esc(p.id)} · ${esc(p.presp || p.iresp || '')} · <span class="alert ${alertClass(p.alert)}">${esc(p.alert)}</span></div></div>
      <div><label class="f">البداية</label><input type="date" value="${p.start}" onchange="mark('${esc(p.id)}','start',this.value)"></div>
      <div><label class="f">النهاية</label><input type="date" value="${p.end}" onchange="mark('${esc(p.id)}','end',this.value)"></div>
      <div><label class="f">الحالة</label><select onchange="mark('${esc(p.id)}','status',this.value)">${S.boot.statuses.map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    </div>`).join('') : '<div class="empty">لا توجد برامج لهذا المؤشر</div>';
}
function mark(id, k, v) { S.dirty[id] = S.dirty[id] || { id }; S.dirty[id][k] = v; }
async function saveQuick() { const list = Object.values(S.dirty); if (!list.length) return toast('لا توجد تغييرات'); for (const x of list) { if (x.start && x.end && x.end < x.start) return toast('تاريخ النهاية قبل البداية في ' + x.id); } await persist(list); }
async function addProgram() {
  const p = { stage: $('nStage').value, icode: $('nInd').value, program: $('nName').value.trim(), presp: $('nResp').value, start: $('nStart').value, end: $('nEnd').value };
  if (!p.program) return toast('اكتب اسم البرنامج');
  toast('جارٍ الإضافة…', 15000);
  try { const r = await api('addProgram', { p }); const fresh = await api('programs'); S.programs = fresh.programs; store.set('tr_cache', { boot: S.boot, programs: S.programs, at: fresh.at }); toast('✅ أُضيف البرنامج ' + r.id); $('nName').value = ''; fillQInd(); } catch (e) { toast('❌ ' + e.message, 6000); }
}

// ------------------------------------------------------------ all
function renderAll() {
  const q = ($('q').value || '').trim().toLowerCase(), st = $('fStage').value, fs = $('fStatus').value;
  let list = S.programs.filter(p => (!st || p.stage === st));
  if (fs === '__nodate') list = list.filter(p => !p.start && !p.end); else if (fs === '__late') list = list.filter(p => (p.alert || '').startsWith('⛔')); else if (fs) list = list.filter(p => p.status === fs);
  if (q) list = list.filter(p => [p.program, p.ind, p.icode, p.presp, p.iresp, p.id].join(' ').toLowerCase().includes(q));
  $('allCount').textContent = `${list.length} من ${S.programs.length} برنامجاً`;
  $('allList').innerHTML = list.slice(0, 120).map(card).join('') + (list.length > 120 ? `<div class="empty">عرض أول 120 — ضيّق البحث لرؤية البقية</div>` : '');
}

// ------------------------------------------------------------ dashboard
async function loadDash(force) {
  if (S.dash && !force) { renderDash(); return; }
  $('kpis').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
  try { const r = await api('dashboard'); S.dash = r.dashboard; renderDash(); } catch (e) { $('kpis').innerHTML = ''; toast('❌ ' + e.message, 6000); }
}
function renderDash() {
  const d = S.dash; const k = d.kpis;
  $('kpis').innerHTML = [['إجمالي البرامج', k.total, ''], ['مكتمل', k.done, 'ok'], ['قيد التنفيذ', k.running, 'run'], ['لم يبدأ', k.notStarted, ''], ['متأخر', k.late, 'late'], ['بلا تواريخ', k.noDates, ''], ['يبدأ خلال 7 أيام', k.startWeek, ''], ['متوسط الإنجاز', k.avg + '%', '']].map(x => `<div class="kpi ${x[2]}"><b>${x[1]}</b><span>${x[0]}</span></div>`).join('');
  $('stageBars').innerHTML = d.stages.map(s => `<div style="margin:8px 0"><div class="row between"><b>${esc(s.name)}</b><span class="mini">${s.done}/${s.total} مكتمل · ${s.running} قيد التنفيذ · ${s.late} متأخر</span></div><div class="bar" style="height:10px"><i style="width:${s.total ? Math.round(100 * s.done / s.total) : 0}%;background:var(--ok)"></i></div></div>`).join('');
  const item = e => `<div class="card" style="padding:10px 12px;margin:0"><b>${esc(e.program)}</b> <span class="tag">${esc(e.icode)}</span><div class="mini">${esc(e.stage)} · ${esc(e.resp)} · ${esc(e.when)}</div></div>`;
  $('todayList').innerHTML = d.today.length ? d.today.map(item).join('') : '<div class="empty">لا توجد تنبيهات اليوم</div>';
  $('lateList').innerHTML = d.late.length ? d.late.map(item).join('') : '<div class="empty">لا توجد برامج متأخرة 👍</div>';
  $('weekList').innerHTML = d.week.length ? d.week.map(item).join('') : '<div class="empty">لا شيء خلال الأسبوع القادم</div>';
  $('dashNotice').innerHTML = (isAdmin() && d.missingContacts) ? `<div class="notice">⚠️ ${d.missingContacts} مسؤولاً بلا بريد إلكتروني — لن تصلهم التنبيهات. ${d.mgmtMissing ? '<b>ولم يُحدَّد بريد مدير المدرسة/الوكيل الأكاديمي بعد.</b>' : ''} <a href="#" onclick="go('people');return false">افتح جهات الاتصال</a></div>` : '';
  $('dashMeta').textContent = `آخر مزامنة: ${d.lastSync || '—'} · آخر فحص تنبيهات: ${d.lastCheck || '—'} · البريد: ${d.emailEnabled ? 'مفعّل' : 'معطّل'} · واتساب: ${d.waEnabled ? 'مفعّل' : 'معطّل'}`;
}
async function runSync() { toast('جارٍ المزامنة…', 30000); try { const r = (await api('runSync', {}, { timeout: 180000 })).result; const fresh = await api('programs'); S.programs = fresh.programs; toast(`✅ مزامنة: ${r.total} برنامجاً، جديد ${r.added}، محذوف ${r.removed}، تغيّر مسؤول ${r.respChanged}`, 6000); loadDash(true); } catch (e) { toast('❌ ' + e.message, 6000); } }
async function runCheck() { if (!confirm('سيُرسل الآن كل تنبيهات اليوم المستحقة (بريد/واتساب) لمن لديهم بيانات اتصال. متابعة؟')) return; toast('جارٍ الإرسال…', 30000); try { const r = (await api('runCheck', {}, { timeout: 180000 })).result; toast(`✅ أُرسل ${r.sent} · متخطى ${r.skipped} · أخطاء ${r.errors}`, 6000); loadDash(true); } catch (e) { toast('❌ ' + e.message, 6000); } }
async function sendTest() { toast('جارٍ الإرسال…', 15000); try { const r = await api('sendTest'); toast('✅ ' + r.result, 6000); } catch (e) { toast('❌ ' + e.message, 6000); } }

// ------------------------------------------------------------ people (admin)
function renderPeople() {
  const ppl = S.boot.people; const withMail = ppl.filter(p => p.email).length;
  $('peopleCount').textContent = `${withMail} من ${ppl.length} لديهم بريد إلكتروني · ${ppl.filter(p => p.phone).length} لديهم واتساب · ${ppl.filter(p => p.hasPin).length} لديهم رمز دخول`;
  $('peopleList').innerHTML = ppl.map((p, i) => `<div class="prow" style="${p.role === 'مدير المدرسة' || p.role === 'وكيل الشؤون الأكاديمية' ? 'border-color:#f1d98a;background:#fffdf3' : ''}">
      <div class="nm"><input type="text" id="pn-${i}" value="${esc(p.name)}" placeholder="الاسم"><div class="mini">${esc(p.role)} · ${esc(p.stage)} · ${S.programs.filter(x => owns(p.name, x.presp || x.iresp, '')).length} برنامج · ${p.appRole === 'مدير' ? '🛡 مدير' : 'مسؤول'} · ${p.hasPin ? '🔑' : '⚠️ بلا رمز'}</div></div>
      <div><input type="email" id="pe-${i}" value="${esc(p.email || '')}" placeholder="البريد الإلكتروني"></div>
      <div><input type="tel" id="pp-${i}" value="${esc(p.phone || '')}" placeholder="9665xxxxxxxx"></div>
      <label class="mini"><input type="checkbox" id="pm-${i}" ${p.emailOn ? 'checked' : ''}> بريد</label>
      <label class="mini"><input type="checkbox" id="pw-${i}" ${p.waOn ? 'checked' : ''}> واتساب</label>
      <div class="row" style="gap:4px"><button class="btn sm p" onclick="savePerson(${i})" title="حفظ">💾</button><button class="btn sm" onclick="adminPin(${i})" title="تعيين رمز دخول">🔑</button></div>
    </div>`).join('');
}
async function savePerson(i) {
  const p = S.boot.people[i];
  const payload = { row: p.row, name: $('pn-' + i).value.trim(), email: $('pe-' + i).value.trim(), phone: $('pp-' + i).value.replace(/\D/g, ''), emailOn: $('pm-' + i).checked, waOn: $('pw-' + i).checked };
  if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) return toast('البريد غير صحيح');
  if (payload.phone && !/^\d{10,15}$/.test(payload.phone)) return toast('رقم الواتساب يجب أن يكون بالصيغة الدولية مثل 9665xxxxxxxx');
  toast('جارٍ الحفظ…', 15000);
  try { await api('savePerson', { p: payload }); const b = await api('bootstrap'); S.boot = b; renderPeople(); toast('✅ تم الحفظ'); } catch (e) { toast('❌ ' + e.message, 6000); }
}
async function adminPin(i) {
  const p = S.boot.people[i]; const np = prompt(`رمز دخول جديد (٤ أرقام) لـ ${p.name || p.role}:`); if (np == null) return;
  if (!/^\d{4}$/.test(np.trim())) return toast('الرمز يجب أن يكون ٤ أرقام');
  try { await api('adminSetPin', { row: p.row, newPin: np.trim() }); const b = await api('bootstrap'); S.boot = b; renderPeople(); toast('✅ تم تعيين الرمز — أبلغه به'); } catch (e) { toast('❌ ' + e.message, 6000); }
}
async function addPerson() {
  const payload = { name: $('pName').value.trim(), role: $('pRole').value, email: $('pEmail').value.trim(), phone: $('pPhone').value.replace(/\D/g, ''), emailOn: true, waOn: true };
  if (!payload.name) return toast('اكتب الاسم');
  toast('جارٍ الإضافة…', 15000);
  try { await api('savePerson', { p: payload }); const b = await api('bootstrap'); S.boot = b; renderPeople(); $('pName').value = $('pEmail').value = $('pPhone').value = ''; toast('✅ أُضيف — عيّن له رمز دخول بزر 🔑'); } catch (e) { toast('❌ ' + e.message, 6000); }
}

// ------------------------------------------------------------ me
function renderMe() {
  if (!S.me) return;
  $('meName').textContent = '👤 ' + S.me.name; $('meRole').textContent = (S.me.role || '') + (isAdmin() ? ' · صلاحية مدير' : ' · صلاحية مسؤول');
  $('meEmail').value = S.me.email || ''; $('mePhone').value = S.me.phone || ''; $('meEmailOn').checked = !!S.me.emailOn; $('meWaOn').checked = !!S.me.waOn;
  $('sheetLinkWrap').innerHTML = S.boot && S.boot.sheetUrl ? `<a href="${esc(S.boot.sheetUrl)}" target="_blank" rel="noopener">فتح الملف</a>` : 'متاح للمدراء فقط';
  $('aboutMeta').textContent = `${S.boot ? S.boot.school + ' · ' + S.boot.year : ''} · آخر تحميل للبيانات: ${S.loadedAt ? new Date(S.loadedAt).toLocaleString('ar-SA') : '—'} · الإصدار ${CONFIG.VERSION}`;
  showInstallCard('installCard2', 'installHint2', 'installBtn2');
}
async function saveMe() {
  const payload = { row: S.me.row, email: $('meEmail').value.trim(), phone: $('mePhone').value.replace(/\D/g, ''), emailOn: $('meEmailOn').checked, waOn: $('meWaOn').checked };
  if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) return toast('البريد غير صحيح');
  if (payload.phone && !/^\d{10,15}$/.test(payload.phone)) return toast('رقم الواتساب بالصيغة الدولية مثل 9665xxxxxxxx');
  toast('جارٍ الحفظ…', 15000);
  try { await api('savePerson', { p: payload }); await refresh(true); go('me'); toast('✅ تم حفظ بياناتك'); } catch (e) { toast('❌ ' + e.message, 6000); }
}
async function changePin() {
  const o = $('pinOld').value.replace(/\D/g, ''), n = $('pinNew').value.replace(/\D/g, '');
  if (o.length !== 4 || n.length !== 4) return toast('الرمزان يجب أن يكونا ٤ أرقام');
  try { const r = await api('setPin', { oldPin: o, newPin: n }); S.token = r.token; store.set('tr_token', S.token); $('pinOld').value = $('pinNew').value = ''; toast('✅ تم تغيير رمز الدخول'); } catch (e) { toast('❌ ' + e.message, 6000); }
}

// ------------------------------------------------------------ install / service worker
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function setupInstall() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; showInstallCard('installCard', 'installHint', 'installBtn'); });
  window.addEventListener('appinstalled', () => { S.installEvt = null; toast('✅ تم تثبيت التطبيق'); ['installCard', 'installCard2'].forEach(id => $(id).hidden = true); });
  showInstallCard('installCard', 'installHint', 'installBtn');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => { const nw = reg.installing; nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) $('updateBar').hidden = false; }); });
    }).catch(() => {});
  }
}
function showInstallCard(cardId, hintId, btnId) {
  const card = $(cardId), hint = $(hintId), btn = $(btnId); if (!card) return;
  if (isStandalone()) { card.hidden = true; return; }
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), android = /Android/.test(ua), edge = /Edg\//.test(ua), win = /Windows/.test(ua);
  card.hidden = false; btn.hidden = !S.installEvt;
  if (S.installEvt) hint.textContent = 'اضغط «تثبيت التطبيق» ليظهر بأيقونته على ' + (android ? 'الشاشة الرئيسية' : win ? 'سطح المكتب وقائمة ابدأ' : 'جهازك') + ' ويعمل بملء الشاشة.';
  else if (ios) hint.textContent = 'على الآيفون: افتح الرابط في Safari ثم زر المشاركة (المربع والسهم) ← «إضافة إلى الشاشة الرئيسية».';
  else if (android) hint.textContent = 'على أندرويد: من قائمة Chrome (⋮) اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».';
  else if (win) hint.textContent = 'على ويندوز: في ' + (edge ? 'Edge' : 'Chrome') + ' اضغط أيقونة التثبيت في شريط العنوان، أو من القائمة (⋮) ← «تثبيت التطبيق».';
  else hint.textContent = 'من قائمة المتصفح اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».';
}
async function installApp() { if (!S.installEvt) return; S.installEvt.prompt(); try { await S.installEvt.userChoice; } catch (e) {} S.installEvt = null; ['installBtn', 'installBtn2'].forEach(id => $(id).hidden = true); }

init();
