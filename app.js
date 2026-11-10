/* متتبع برامج المؤشرات ١٤٤٨ — تطبيق PWA
   Talks to the Google Sheet through the Apps Script JSON API (see API.gs). */
'use strict';
const S = { lang: 'ar', role: 'all', token: '', me: null, scope: undefined, boot: null, programs: [], dash: null, filter: 'all', dirty: {}, online: navigator.onLine, installEvt: null, loadedAt: '' };
const STATUS_COLOR = { 'لم يبدأ': 'var(--wait)', 'قيد التنفيذ': 'var(--run)', 'مكتمل': 'var(--ok)', 'مؤجل': 'var(--hold)', 'ملغى': 'var(--off)' };
/* ---- language */
const t = (k, v) => { let x = (I18N[S.lang] && I18N[S.lang][k]); if (x == null) x = I18N.ar[k]; if (x == null) return k; return v ? String(x).replace(/\{(\w+)\}/g, (m, a) => v[a] == null ? '' : v[a]) : x; };
const errText = code => (I18N[S.lang].err[code] || I18N.ar.err[code] || code);
const EN = () => S.lang === 'en';
const tStatus = s => EN() ? (DATA_EN.status[s] || s) : s;
const tAlert = a => EN() ? (DATA_EN.alert[a] || a) : a;
const tRole = r => EN() ? (DATA_EN.role[r] || r) : r;
const tStage = s => EN() ? String(s || '').replace('ابتدائي بنين', 'Primary Boys').replace('متوسط بنين', 'Intermediate Boys').replace('أهلي', 'National').replace('عالمي', 'International').replace(/ \/ /g, ' / ') : s;
const tInd = (code, name) => EN() ? (DATA_EN.ind[code] || name) : name;
const tWhen = w => { if (!EN()) return w; w = String(w || '');
  let m = /^متأخر (\d+) يوم \(النهاية (.+)\)$/.exec(w); if (m) return `Overdue by ${m[1]} d (ended ${m[2]})`;
  m = /^(يبدأ|ينتهي) (اليوم|غداً|خلال (\d+) أيام)( — المسؤول \+ الإدارة| — المسؤول)?$/.exec(w);
  if (m) return (m[1] === 'يبدأ' ? 'Starts ' : 'Ends ') + (m[2] === 'اليوم' ? 'today' : m[2] === 'غداً' ? 'tomorrow' : 'in ' + m[3] + ' days') + (m[4] ? (m[4].includes('+') ? ' — owner + management' : ' — owner') : '');
  return w; };
function applyI18n() {
  document.documentElement.lang = S.lang; document.documentElement.dir = EN() ? 'ltr' : 'rtl'; document.title = t('appTitle');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-role]').forEach(el => { el.textContent = tRole(el.value); });
  const lb = $('langBtn'); if (lb) lb.textContent = '🌐 ' + t('langBtn');
  const ls = $('langSel'); if (ls) ls.value = S.lang;
}
function setLang(l) {
  S.lang = l === 'en' ? 'en' : 'ar'; store.set('tr_lang', S.lang); applyI18n();
  if (S.boot) fillSelects(); applyRole();
  const cur = document.querySelector('.view.on'); const v = cur ? cur.id.slice(2) : '';
  if (v === 'login') { loadNames(); showInstallCard('installCard', 'installHint', 'installBtn'); } else if (v && v !== 'loading') go(v);
}
/* password policy (same rule on the server): ≥ 8 characters, English letter + digit + symbol, no spaces */
const pwOk = s => typeof s === 'string' && s.length >= 8 && s.length <= 64 && /[A-Za-z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9\s]/.test(s) && !/\s/.test(s);
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, ms = 2600) => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms); };
const fmtD = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const isAdmin = () => !!(S.me && S.me.appRole === 'مدير');
const isOwner = () => !!(S.me && S.me.owner);
const myName = () => (S.me && S.me.name) || '';
const nkey = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْ]/g, '');
/* same rule as owns_() in the sheet: exact مسؤول البرنامج / مسؤول المؤشر, or my name inside a multi-person «المكلف» cell */
const owns = (name, presp, iresp) => { const n = nkey(name); if (!n) return false; const p = nkey(presp); return p === n || nkey(iresp) === n || (n.split(' ').length >= 2 && p.indexOf(n) >= 0); };
/* the two roles on a program: المنفّذ = مسؤول التنفيذ (المكلف) · المتابع = مسؤول المؤشر */
const isExec = (name, p) => owns(name, p.presp || p.iresp, '');
const isFollow = (name, p) => { const n = nkey(name); return !!n && nkey(p.iresp) === n; };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };

// ------------------------------------------------------------ API
async function api(action, payload = {}, { timeout = 60000 } = {}) {
  if (!S.online) throw new Error(t('netNone'));
  if (!CONFIG.API_URL || CONFIG.API_URL.startsWith('__')) throw new Error(t('netCfg'));
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    r = await fetch(CONFIG.API_URL, { method: 'POST', redirect: 'follow', signal: ctrl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: CONFIG.APP_KEY, action, token: S.token || undefined, ...payload }) });
  } catch (e) { clearTimeout(tm); throw new Error(e.name === 'AbortError' ? t('netTimeout') : t('netFail')); }
  clearTimeout(tm);
  let j; try { j = await r.json(); } catch (e) { throw new Error(t('netBad', { s: r.status })); }
  if (!j.ok) {
    const code = String(j.error || '');
    if (code === 'AUTH' || code === 'AUTH_EXPIRED') { logout(true); }
    const base = code.split(':')[0];
    const err = new Error(errText(base)); err.code = base; err.left = j.left; throw err;
  }
  return j;
}

// ------------------------------------------------------------ navigation
function go(v) {
  if (!S.me && !['login', 'loading'].includes(v)) v = 'login';
  if ((v === 'people' || v === 'send') && !isAdmin()) v = 'me';
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v !== 'mine') $('mineList').innerHTML = ''; if (v !== 'all') $('allList').innerHTML = '';   // cards share ids → only one list in the DOM
  window.scrollTo(0, 0);
  if (v === 'mine') renderMine(); if (v === 'quick') renderQuick(); if (v === 'all') renderAll(); if (v === 'dash') loadDash(false); if (v === 'people') renderPeople(); if (v === 'send') renderSend(); if (v === 'me') renderMe();
}
function applyRole() {
  const adm = isAdmin();
  document.querySelectorAll('[data-admin]').forEach(el => { el.hidden = !adm; });
  if (S.boot && S.boot.standalone) document.querySelectorAll('[data-sheet-only]').forEach(el => { el.hidden = true; });
  $('nav').hidden = !S.me;
  $('userChip').textContent = S.me ? ('👤 ' + S.me.name + (adm ? ' · ' + t('adminTag') : '')) : t('signIn');
}

// ------------------------------------------------------------ boot
async function init() {
  window.addEventListener('online', () => { S.online = true; $('offlineBar').hidden = true; if (S.me) refresh(true); });
  window.addEventListener('offline', () => { S.online = false; $('offlineBar').hidden = false; });
  $('offlineBar').hidden = S.online;
  S.lang = store.get('tr_lang', '') === 'en' ? 'en' : 'ar'; applyI18n();   // Arabic unless the user chose English
  setupInstall();
  S.token = store.get('tr_token', '');
  S.me = store.get('tr_me', null);
  const cache = store.get('tr_cache', null);
  if (S.token && S.me && cache) { S.boot = cache.boot; S.programs = cache.programs; S.loadedAt = cache.at; fillSelects(); applyRole(); go('mine'); }
  if (S.token && S.me) {
    try { await refresh(false); } catch (e) { if (!S.boot) { toast(e.message, 6000); go('login'); loadNames(); } else toast(t('updateFail', { m: e.message }), 5000); }
  } else { applyRole(); go('login'); loadNames(); }
}
async function loadNames() {
  const sel = $('loginName'); const saved = store.get('tr_lastName', '');
  const cached = store.get('tr_names', []);
  const fill = names => { sel.innerHTML = `<option value="">${t('pickName')}</option>` + names.map(n => `<option ${n.name === saved ? 'selected' : ''}>${esc(n.name)}</option>`).join(''); };
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
  if (!silent) toast(t('updated'));
}
function fillSelects() {
  const names = S.boot.people.map(p => p.name).filter(Boolean);
  const keep = id => $(id).value;
  const kq = keep('qStage'), kn = keep('nStage'), kf = keep('fStage'), ks = keep('fStatus');
  const stOpts = S.boot.stages.map(s => `<option value="${esc(s)}">${esc(tStage(s))}</option>`).join('');
  $('qStage').innerHTML = stOpts; $('nStage').innerHTML = stOpts; $('fStage').innerHTML = `<option value="">${t('allStages')}</option>` + stOpts;
  $('fStatus').innerHTML = `<option value="">${t('allStatuses')}</option>` + S.boot.statuses.map(s => `<option value="${esc(s)}">${esc(tStatus(s))}</option>`).join('') + `<option value="__nodate">${t('noDates')}</option><option value="__late">${t('late')}</option>`;
  if (kq) $('qStage').value = kq; if (kn) $('nStage').value = kn; $('fStage').value = kf || ''; $('fStatus').value = ks || '';
  $('nResp').innerHTML = names.map(n => `<option ${n === myName() ? 'selected' : ''}>${esc(n)}</option>`).join('');
  fillQInd(false); fillNInd();
}

// ------------------------------------------------------------ login / logout
async function login() {
  const name = $('loginName').value, pin = $('loginPin').value.trim();
  if (!name) return toast(t('pickNameFirst'));
  if (!pin) return toast(t('needPw'));
  const btn = $('loginBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + t('loggingIn');
  try {
    const r = await api('login', { name, pin });
    S.token = r.token; S.me = r.me; store.set('tr_token', S.token); store.set('tr_me', S.me); store.set('tr_lastName', name);
    $('loginPin').value = '';
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-loading'));
    await refresh(true);
    toast(t('welcome', { n: S.me.name }));
  } catch (e) {
    toast('❌ ' + e.message + (e.left != null && e.code === 'PIN_WRONG' ? t('left', { n: e.left }) : ''), 5000);
    go('login');
  } finally { btn.disabled = false; btn.textContent = t('loginBtn'); }
}
function logout(silent) {
  S.token = ''; S.me = null; S.boot = null; S.programs = []; S.dash = null; S.scope = undefined;
  ['tr_token', 'tr_me', 'tr_cache'].forEach(store.del);
  applyRole(); go('login'); loadNames();
  if (!silent) toast(t('loggedOut'));
}

// ------------------------------------------------------------ cards
function canEdit(p) { return isAdmin() || owns(myName(), p.presp, p.iresp); }
function alertClass(a) { if (!a) return ''; if (a.startsWith('⛔')) return 'late'; if (/^(⏰|🚀|🏁|🔔)/.test(a)) return 'soon'; if (a.startsWith('⚠')) return 'nodate'; return ''; }
function myRoleBadge(p) {
  const e = isExec(myName(), p), f = isFollow(myName(), p);
  if (!e && !f) return '';
  return `<span class="rolebadge ${e ? 'ex' : 'fo'}">${t(e && f ? 'youBoth' : e ? 'youExec' : 'youFollow')}</span>`;
}
function card(p) {
  const pct = p.status === 'مكتمل' ? 100 : p.pct, ed = canEdit(p);
  return `<div class="card ${ed ? '' : 'ro'}" id="c-${esc(p.id)}">
    <div class="row between" style="align-items:flex-start">
      <div class="grow"><h3>${esc(p.program)}</h3>
        <div class="meta">${esc(tStage(p.stage))} · <span class="tag">${esc(p.icode)}</span> ${esc(tInd(p.icode, p.ind))}</div>
        <div class="meta">🛠 ${t('executor')}: <b>${esc(p.presp || p.iresp || '—')}</b></div>
        <div class="meta">👁 ${t('follower')}: <b>${esc(p.iresp || '—')}</b> ${myRoleBadge(p)}</div></div>
      <span class="status s-${esc(p.status).replace(/ /g, '-')}">${esc(tStatus(p.status))}</span>
    </div>
    <div class="row between" style="margin-top:6px">
      <span class="meta">📅 ${fmtD(p.start)} ${EN() ? '→' : '←'} ${fmtD(p.end)}</span>
      <span class="alert ${alertClass(p.alert)}">${esc(tAlert(p.alert))}</span>
    </div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="row" style="margin-top:10px">
      ${ed ? `<button class="btn sm" onclick="openEdit('${esc(p.id)}')">${t('edit')}</button>` : ''}
      ${ed && p.status === 'لم يبدأ' ? `<button class="btn sm run" onclick="quickStatus('${esc(p.id)}','قيد التنفيذ')">${t('startNow')}</button>` : ''}
      ${ed && p.status !== 'مكتمل' && p.status !== 'ملغى' ? `<button class="btn sm ok" onclick="quickStatus('${esc(p.id)}','مكتمل')">${t('markDone')}</button>` : ''}
      ${p.evid ? `<a class="btn sm" href="${esc(p.evid)}" target="_blank" rel="noopener">${t('evidence')}</a>` : ''}
      <span class="mini" style="margin-inline-start:auto">${p.upd ? t('lastUpd', { t: esc(p.upd) }) : ''}</span>
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
      <div><label class="f">${t('startDate')}</label><input type="date" id="s-${id}" value="${p.start}"></div>
      <div><label class="f">${t('endDate')}</label><input type="date" id="d-${id}" value="${p.end}"></div>
      <div><label class="f">${t('status')}</label><div class="seg" id="st-${id}" data-v="${esc(p.status)}">${S.boot.statuses.map(s => `<button type="button" data-s="${esc(s)}" class="${s === p.status ? 'on' : ''}" style="${s === p.status ? 'background:' + STATUS_COLOR[s] : ''}" onclick="pickStatus('${id}','${s}')">${esc(tStatus(s))}</button>`).join('')}</div></div>
      <div><label class="f">${t('progress')}: <b id="pv-${id}">${p.pct}%</b></label><input type="range" min="0" max="100" step="5" id="p-${id}" value="${p.pct}" oninput="$('pv-${id}').textContent=this.value+'%'" style="width:100%"></div>
      <div><label class="f">${t('progExec')}</label><select id="r-${id}" ${isAdmin() ? '' : 'disabled'}>${(names.includes(p.presp || p.iresp) ? names : [p.presp || p.iresp].concat(names)).map(n => `<option ${n === (p.presp || p.iresp) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div><label class="f">${t('evidLink')}</label><input type="url" id="v-${id}" value="${esc(p.evid)}" placeholder="https://…"></div>
      <div style="grid-column:1/-1"><label class="f">${t('notes')}</label><textarea id="n-${id}" rows="2">${esc(p.notes)}</textarea></div>
    </div>
    <div class="row" style="margin-top:10px"><button class="btn p" onclick="saveEdit('${id}')">${t('save')}</button><button class="btn" onclick="openEdit('${id}')">${t('cancel')}</button></div>
  </div>`;
}
function pickStatus(id, s) { const seg = $('st-' + id); [...seg.children].forEach(b => { const on = b.dataset.s === s; b.classList.toggle('on', on); b.style.background = on ? STATUS_COLOR[s] : ''; }); seg.dataset.v = s; if (s === 'مكتمل') { $('p-' + id).value = 100; $('pv-' + id).textContent = '100%'; } if (s === 'لم يبدأ') { $('p-' + id).value = 0; $('pv-' + id).textContent = '0%'; } }
async function saveEdit(id) {
  const seg = $('st-' + id); const status = seg.dataset.v;
  const payload = { id, start: $('s-' + id).value, end: $('d-' + id).value, status, pct: +$('p-' + id).value, evid: $('v-' + id).value.trim(), notes: $('n-' + id).value.trim() };
  if (isAdmin()) { const p0 = S.programs.find(x => x.id === id), nv = $('r-' + id).value; if (p0 && nv !== (p0.presp || p0.iresp)) payload.presp = nv; }
  if (payload.start && payload.end && payload.end < payload.start) return toast(t('endBeforeStart'));
  await persist([payload]);
}
async function quickStatus(id, status) {
  const p = S.programs.find(x => x.id === id); const payload = { id, status };
  if (status === 'قيد التنفيذ' && !p.start) payload.start = todayISO();
  if (status === 'مكتمل') { payload.pct = 100; if (!p.end) payload.end = todayISO(); if (!p.start) payload.start = todayISO(); }
  await persist([payload]);
}
async function persist(list) {
  toast(t('saving'), 15000);
  try {
    const res = await api('saveMany', { list });
    const fresh = await api('programs'); S.programs = fresh.programs; S.loadedAt = fresh.at; S.dash = null;
    store.set('tr_cache', { boot: S.boot, programs: S.programs, at: S.loadedAt });
    toast(t('saved', { n: res.changed }));
    const v = document.querySelector('.view.on').id.slice(2); go(v);
  } catch (e) { toast('❌ ' + e.message, 6000); }
}

// ------------------------------------------------------------ mine
function ownSet() { const n = myName(); return S.programs.filter(p => S.role === 'exec' ? isExec(n, p) : S.role === 'follow' ? isFollow(n, p) : (isExec(n, p) || isFollow(n, p))); }
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
  const everyone = isAdmin() && S.scope === 'all';
  const mine = mineSet(); $('mineName').textContent = everyone ? t('everyone') : myName();
  const counts = { all: mine.length, nodate: applyFilter(mine, 'nodate').length, soon: applyFilter(mine, 'soon').length, run: applyFilter(mine, 'run').length, late: applyFilter(mine, 'late').length, done: applyFilter(mine, 'done').length };
  const labels = { all: t('fAll'), nodate: t('fNoDate'), soon: t('fSoon'), run: t('fRun'), late: t('fLate'), done: t('fDone') };
  const n = myName(), nE = S.programs.filter(p => isExec(n, p)).length, nF = S.programs.filter(p => isFollow(n, p)).length, nA = S.programs.filter(p => isExec(n, p) || isFollow(n, p)).length;
  const scopeBtn = isAdmin() ? `<button class="scope" onclick="S.scope=S.scope==='all'?'mine':'all';renderMine()">${S.scope === 'all' ? t('scopeMine', { n: nA }) : t('scopeAll', { n: S.programs.length })}</button>` : '';
  const roleBtns = everyone ? '' : [['all', t('roleAll'), nA], ['exec', t('roleExec'), nE], ['follow', t('roleFollow'), nF]].map(x => `<button class="rolechip ${S.role === x[0] ? 'on' : ''}" onclick="S.role='${x[0]}';renderMine()">${x[1]} (${x[2]})</button>`).join('');
  $('mineRoles').innerHTML = scopeBtn + roleBtns;
  $('mineChips').innerHTML = Object.keys(labels).map(k => `<button class="${S.filter === k ? 'on' : ''}" onclick="S.filter='${k}';renderMine()">${labels[k]} (${counts[k]})</button>`).join('');
  const list = applyFilter(mine, S.filter);
  $('mineCount').textContent = t('nProg', { n: list.length });
  $('mineList').innerHTML = list.length ? list.slice(0, 150).map(card).join('') + (list.length > 150 ? `<div class="empty">${t('first120').replace('120', '150')}</div>` : '') : `<div class="empty">${mine.length ? t('emptyCat') : t('emptyMine')}</div>`;
}

// ------------------------------------------------------------ quick
function indsFor(stage) { return S.boot.indicators.filter(i => i.stage === stage); }
function quickPool() { return isAdmin() ? S.programs : S.programs.filter(canEdit); }
function fillQInd(render = true) {
  const st = $('qStage').value, pool = quickPool();
  const inds = indsFor(st).map(i => ({ ...i, n: pool.filter(p => p.stage === st && p.icode === i.code).length })).filter(i => isAdmin() || i.n);
  $('qInd').innerHTML = inds.map(i => `<option value="${esc(i.code)}">${esc(i.code)} – ${esc(tInd(i.code, i.name))} (${i.n})</option>`).join('');
  $('quickHint').textContent = t(isAdmin() ? 'quickHintAdmin' : 'quickHintUser');
  if (render) renderQuick();
}
function fillNInd() { const st = $('nStage').value; $('nInd').innerHTML = indsFor(st).map(i => `<option value="${esc(i.code)}">${esc(i.code)} – ${esc(tInd(i.code, i.name))}</option>`).join(''); }
function renderQuick() {
  const st = $('qStage').value, code = $('qInd').value; S.dirty = {};
  const list = quickPool().filter(p => p.stage === st && p.icode === code);
  $('quickActions').hidden = !list.length;
  $('quickList').innerHTML = list.length ? list.map(p => `<div class="qrow">
      <div class="pn"><b>${esc(p.program)}</b><div class="mini">${esc(p.id)} · ${esc(p.presp || p.iresp || '')} · <span class="alert ${alertClass(p.alert)}">${esc(tAlert(p.alert))}</span></div></div>
      <div><label class="f">${t('start')}</label><input type="date" value="${p.start}" onchange="mark('${esc(p.id)}','start',this.value)"></div>
      <div><label class="f">${t('end')}</label><input type="date" value="${p.end}" onchange="mark('${esc(p.id)}','end',this.value)"></div>
      <div><label class="f">${t('status')}</label><select onchange="mark('${esc(p.id)}','status',this.value)">${S.boot.statuses.map(s => `<option value="${esc(s)}" ${s === p.status ? 'selected' : ''}>${esc(tStatus(s))}</option>`).join('')}</select></div>
    </div>`).join('') : `<div class="empty">${t('noProgInd')}</div>`;
}
function mark(id, k, v) { S.dirty[id] = S.dirty[id] || { id }; S.dirty[id][k] = v; }
async function saveQuick() { const list = Object.values(S.dirty); if (!list.length) return toast(t('noChanges')); for (const x of list) { if (x.start && x.end && x.end < x.start) return toast(t('endBeforeStartIn', { id: x.id })); } await persist(list); }
async function addProgram() {
  const p = { stage: $('nStage').value, icode: $('nInd').value, program: $('nName').value.trim(), presp: $('nResp').value, start: $('nStart').value, end: $('nEnd').value };
  if (!p.program) return toast(t('needProgName'));
  toast(t('adding'), 15000);
  try { const r = await api('addProgram', { p }); const fresh = await api('programs'); S.programs = fresh.programs; store.set('tr_cache', { boot: S.boot, programs: S.programs, at: fresh.at }); toast(t('progAdded', { id: r.id })); $('nName').value = ''; fillQInd(); } catch (e) { toast('❌ ' + e.message, 6000); }
}

// ------------------------------------------------------------ all
function renderAll() {
  const q = ($('q').value || '').trim().toLowerCase(), st = $('fStage').value, fs = $('fStatus').value;
  let list = S.programs.filter(p => (!st || p.stage === st));
  if (fs === '__nodate') list = list.filter(p => !p.start && !p.end); else if (fs === '__late') list = list.filter(p => (p.alert || '').startsWith('⛔')); else if (fs) list = list.filter(p => p.status === fs);
  if (q) list = list.filter(p => [p.program, p.ind, DATA_EN.ind[p.icode] || '', p.icode, p.presp, p.iresp, p.id].join(' ').toLowerCase().includes(q));
  $('allCount').textContent = t('nOfM', { n: list.length, m: S.programs.length });
  $('allList').innerHTML = list.slice(0, 120).map(card).join('') + (list.length > 120 ? `<div class="empty">${t('first120')}</div>` : '');
}

// ------------------------------------------------------------ dashboard
async function loadDash(force) {
  if (S.dash && !force) { renderDash(); return; }
  $('kpis').innerHTML = `<div class="empty">${t('loading')}</div>`;
  try { const r = await api('dashboard'); S.dash = r.dashboard; renderDash(); } catch (e) { $('kpis').innerHTML = ''; toast('❌ ' + e.message, 6000); }
}
function renderDash() {
  const d = S.dash; const k = d.kpis;
  $('kpis').innerHTML = [[t('kTotal'), k.total, ''], [t('kDone'), k.done, 'ok'], [t('kRun'), k.running, 'run'], [t('kNot'), k.notStarted, ''], [t('kLate'), k.late, 'late'], [t('kNoDate'), k.noDates, ''], [t('kWeek'), k.startWeek, ''], [t('kAvg'), k.avg + '%', '']].map(x => `<div class="kpi ${x[2]}"><b>${x[1]}</b><span>${x[0]}</span></div>`).join('');
  $('stageBars').innerHTML = d.stages.map(s => `<div style="margin:8px 0"><div class="row between"><b>${esc(tStage(s.name))}</b><span class="mini">${t('stageLine', { d: s.done, t: s.total, r: s.running, l: s.late })}</span></div><div class="bar" style="height:10px"><i style="width:${s.total ? Math.round(100 * s.done / s.total) : 0}%;background:var(--ok)"></i></div></div>`).join('');
  const item = e => `<div class="card" style="padding:10px 12px;margin:0"><b>${esc(e.program)}</b> <span class="tag">${esc(e.icode)}</span><div class="mini">${esc(tStage(e.stage))} · ${esc(e.resp)} · ${esc(tWhen(e.when))}</div></div>`;
  $('todayList').innerHTML = d.today.length ? d.today.map(item).join('') : `<div class="empty">${t('noToday')}</div>`;
  $('lateList').innerHTML = d.late.length ? d.late.map(item).join('') : `<div class="empty">${t('noLate')}</div>`;
  $('weekList').innerHTML = d.week.length ? d.week.map(item).join('') : `<div class="empty">${t('noWeek')}</div>`;
  $('dashNotice').innerHTML = (isAdmin() && d.missingContacts) ? `<div class="notice">${t('missing', { n: d.missingContacts })} ${d.mgmtMissing ? '<b>' + t('mgmtMissing') + '</b>' : ''} <a href="#" onclick="go('people');return false">${t('openContacts')}</a></div>` : '';
  $('dashMeta').textContent = t('dashMeta', { s: d.lastSync || '—', c: d.lastCheck || '—', e: t(d.emailEnabled ? 'on' : 'off'), w: t(d.waEnabled ? 'on' : 'off') });
}
async function runSync() { toast(t('syncing'), 30000); try { const r = (await api('runSync', {}, { timeout: 180000 })).result; const fresh = await api('programs'); S.programs = fresh.programs; toast(t('syncDone', { t: r.total, a: r.added, r: r.removed, c: r.respChanged }), 6000); loadDash(true); } catch (e) { toast('❌ ' + e.message, 6000); } }
async function runCheck() { if (!confirm(t('confirmCheck'))) return; toast(t('sending'), 30000); try { const r = (await api('runCheck', {}, { timeout: 180000 })).result; toast(t('checkDone', { s: r.sent, k: r.skipped, e: r.errors }), 6000); loadDash(true); } catch (e) { toast('❌ ' + e.message, 6000); } }
async function sendTest() { toast(t('sending'), 15000); try { const r = await api('sendTest'); toast('✅ ' + r.result, 6000); } catch (e) { toast('❌ ' + e.message, 6000); } }

// ------------------------------------------------------------ people (admin)
function renderPeople() {
  const ppl = S.boot.people; const withMail = ppl.filter(p => p.email).length;
  $('peopleCount').textContent = t('peopleCount', { m: withMail, t: ppl.length, w: ppl.filter(p => p.phone).length, p: ppl.filter(p => p.hasPin).length });
  $('peopleList').innerHTML = ppl.map((p, i) => `<div class="prow" style="${['مدير المدرسة', 'وكيل الشؤون الأكاديمية', 'المشرف الأكاديمي', 'المالك والمطوّر'].includes(p.role) ? 'border-color:#f1d98a;background:#fffdf3' : ''}">
      <div class="nm"><input type="text" id="pn-${i}" value="${esc(p.name)}" placeholder="${t('name')}"><div class="mini">${esc(tRole(p.role))} · ${esc(tStage(p.stage))} · ${t('pplLine', { e: S.programs.filter(x => isExec(p.name, x)).length, f: S.programs.filter(x => isFollow(p.name, x)).length })} · ${p.owner ? '👑 ' + t('ownerTag') : p.appRole === 'مدير' ? t('adminShort') : p.appRole === 'موقوف' ? t('suspendedShort') : t('userShort')} · ${p.hasPin ? '🔑' : t('noPw')}</div>
        ${isOwner() && !p.owner ? `<select class="acc" onchange="setAccess(${i},this)" title="${t('access')}">${[['مدير', 'accAdmin'], ['مسؤول', 'accUser'], ['موقوف', 'accSuspended']].map(a => `<option value="${a[0]}" ${p.appRole === a[0] ? 'selected' : ''}>${t(a[1])}</option>`).join('')}</select>` : ''}</div>
      <div><input type="email" id="pe-${i}" value="${esc(p.email || '')}" placeholder="${t('emailPh')}"></div>
      <div><input type="tel" id="pp-${i}" value="${esc(p.phone || '')}" placeholder="9665xxxxxxxx"></div>
      <label class="mini"><input type="checkbox" id="pm-${i}" ${p.emailOn ? 'checked' : ''}> ${t('email')}</label>
      <label class="mini"><input type="checkbox" id="pw-${i}" ${p.waOn ? 'checked' : ''}> ${t('wa')}</label>
      <div class="row" style="gap:4px"><button class="btn sm p" onclick="savePerson(${i})" title="${t('savedOk')}">💾</button><button class="btn sm" onclick="adminPin(${i})" title="${t('setPwTitle')}">🔑</button><button class="btn sm" onclick="sendToPerson(${i})" title="${t('sendToPerson')}">📤</button></div>
    </div>`).join('');
}
async function savePerson(i) {
  const p = S.boot.people[i];
  const payload = { row: p.row, name: $('pn-' + i).value.trim(), email: $('pe-' + i).value.trim(), phone: $('pp-' + i).value.replace(/\D/g, ''), emailOn: $('pm-' + i).checked, waOn: $('pw-' + i).checked };
  if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) return toast(t('badEmail'));
  if (payload.phone && !/^\d{10,15}$/.test(payload.phone)) return toast(t('badPhone'));
  toast(t('saving'), 15000);
  try { await api('savePerson', { p: payload }); const b = await api('bootstrap'); S.boot = b; renderPeople(); toast(t('savedOk')); } catch (e) { toast('❌ ' + e.message, 6000); }
}
async function adminPin(i) {
  const p = S.boot.people[i]; const np = prompt(t('promptPw', { n: p.name || p.role })); if (np == null) return;
  if (!pwOk(np.trim())) return toast(errText('PIN_FORMAT'), 6000);
  try { await api('adminSetPin', { row: p.row, newPin: np.trim() }); const b = await api('bootstrap'); S.boot = b; renderPeople(); toast(t('pwSet')); } catch (e) { toast('❌ ' + e.message, 6000); }
}
async function addPerson() {
  const payload = { name: $('pName').value.trim(), role: $('pRole').value, email: $('pEmail').value.trim(), phone: $('pPhone').value.replace(/\D/g, ''), emailOn: true, waOn: true };
  if (!payload.name) return toast(t('needName'));
  toast(t('adding'), 15000);
  try { await api('savePerson', { p: payload }); const b = await api('bootstrap'); S.boot = b; renderPeople(); $('pName').value = $('pEmail').value = $('pPhone').value = ''; toast(t('personAdded')); } catch (e) { toast('❌ ' + e.message, 6000); }
}

async function setAccess(i, sel) {
  const p = S.boot.people[i], access = sel.value, lab = sel.options[sel.selectedIndex].textContent;
  if (!confirm(t('confirmAccess', { n: p.name, a: lab }))) { sel.value = p.appRole; return; }
  try { await api('setAccess', { row: p.row, access }); const b = await api('bootstrap'); S.boot = b; renderPeople(); toast(t('accSaved')); }
  catch (e) { sel.value = p.appRole; toast('❌ ' + sendErr(e), 6000); }
}
function sendToPerson(i) { const row = S.boot.people[i].row; S.send.sp = new Set([row]); S.send.pw = new Set([row]); go('send'); }

// ------------------------------------------------------------ send centre (admins)
S.send = { sp: new Set(), pw: new Set(), spChan: 'email', pwChan: 'email', res: {} };
const sendErr = e => e.code === 'UNKNOWN_ACTION' ? t('needServer') : e.message;
const sendable = () => S.boot.people.filter(p => p.name && p.appRole !== 'موقوف');
function renderSend() {
  if (!isAdmin()) return;
  $('sendNeedServer').hidden = (S.boot.api || 0) >= 3;
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const keep = (id, d) => $(id).value || d;
  const kind = keep('sfKind', 'all'), days = keep('sfDays', '7'), stage = $('sfStage').value, detail = keep('sfDetail', 'programs'), mode = keep('sfMode', 'each'), scope = keep('sfScope', 'all');
  $('sfKind').innerHTML = [['all', 'fkAll'], ['late', 'fkLate'], ['done', 'fkDone'], ['upcoming', 'fkUpcoming'], ['ending', 'fkEnding'], ['running', 'fkRunning'], ['notstarted', 'fkNotStarted'], ['nodate', 'fkNoDate'], ['period', 'fkPeriod']].map(x => opt(x[0], t(x[1]), kind)).join('');
  $('sfDays').innerHTML = ['3', '7', '14', '30', '60'].map(n => opt(n, t('nDays', { n }), days)).join('');
  $('sfStage').innerHTML = opt('', t('allStages'), stage) + S.boot.stages.map(x => opt(x, tStage(x), stage)).join('');
  $('sfDetail').innerHTML = opt('programs', t('ctPrograms'), detail) + opt('indicators', t('ctIndicators'), detail);
  $('sfMode').innerHTML = opt('each', t('modeEach'), mode) + opt('list', t('modeList'), mode);
  $('sfScope').innerHTML = [['all', 'rsAll'], ['exec', 'rsExec'], ['follow', 'rsFollow']].map(x => opt(x[0], t(x[1]), scope)).join('');
  [['spChan', 'spChan'], ['pwChan', 'pwChan']].forEach(([el, key]) => { $(el).innerHTML = [['email', 'chEmail'], ['wa', 'chWa'], ['both', 'chBoth']].map(x => `<button type="button" class="${S.send[key] === x[0] ? 'on' : ''}" onclick="S.send.${key}='${x[0]}';renderSend()">${t(x[1])}</button>`).join(''); });
  $('sendWaHint').textContent = S.boot.waEnabled ? '' : t('waHint');
  sendUi(true); drawPicker('sp'); drawPicker('pw');
}
function sendUi(refillInd) {
  const kind = $('sfKind').value, mode = $('sfMode').value;
  $('sfDaysW').hidden = !['upcoming', 'ending'].includes(kind); $('sfFromW').hidden = $('sfToW').hidden = kind !== 'period'; $('sfScopeW').hidden = mode !== 'each';
  if (refillInd) { const st = $('sfStage').value, cur = $('sfInd').value, seen = new Set();
    const inds = S.boot.indicators.filter(i => (!st || i.stage === st) && !seen.has(i.code) && seen.add(i.code));
    $('sfInd').innerHTML = `<option value="">${t('allIndicators')}</option>` + inds.map(i => `<option value="${esc(i.code)}" ${i.code === cur ? 'selected' : ''}>${esc(i.code)} – ${esc(tInd(i.code, i.name))}</option>`).join(''); }
  pickSum('sp');
}
function drawPicker(k) {
  const sel = S.send[k], ppl = sendable();
  $(k + 'Pick').innerHTML = `<div class="tools"><button type="button" class="btn sm" onclick="pickAll('${k}',true)">${t('selectAll')}</button><button type="button" class="btn sm" onclick="pickAll('${k}',false)">${t('clearSel')}</button></div>` +
    ppl.map(p => `<label><input type="checkbox" ${sel.has(p.row) ? 'checked' : ''} onchange="pickOne('${k}',${p.row},this.checked)"> ${esc(p.name)} <span class="mini">${p.email ? '✉️' : ''}${p.phone ? '💬' : ''}</span></label>`).join('');
  pickSum(k);
}
function pickOne(k, row, on) { if (on) S.send[k].add(row); else S.send[k].delete(row); pickSum(k); }
function pickAll(k, on) { S.send[k] = new Set(on ? sendable().map(p => p.row) : []); drawPicker(k); }
function pickSum(k) { const n = S.send[k].size; $(k + 'PickSum').textContent = n ? t('nSelected', { n }) : (k === 'sp' && $('sfMode').value === 'each' ? t('everyoneDefault') : t('nSelected', { n: 0 })); }
function stCell(v) { return v === 'sent' ? t('stSent') : v === 'none' ? t('stNone') : v === 'quota' ? t('stQuota') : v === 'forbidden' ? t('stForbidden') : v === 'suspended' ? t('stSuspended') : v === '-' ? '' : String(v).startsWith('error') ? `<span title="${esc(v)}">${t('stError')}</span>` : esc(v); }
/** results table. WhatsApp «link» rows are sent from the sender's own WhatsApp: one tap opens the chat with the message already
 *  written (the app itself on a phone, so a password never travels in a web address), and a «next» button walks through everyone. */
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function drawResults(el, key, results, secret, showCount) {
  S.send.res[key] = results; S.send.meta = S.send.meta || {}; S.send.meta[key] = { el, secret, showCount, done: new Set() };
  paintResults(key);
}
function paintResults(key) {
  const results = S.send.res[key] || [], mt = S.send.meta[key], links = results.map((r, i) => r.wa === 'link' ? i : -1).filter(i => i >= 0), left = links.filter(i => !mt.done.has(i));
  const e = results.filter(r => r.email === 'sent').length, w = results.filter(r => r.wa === 'sent').length + mt.done.size, n = results.filter(r => r.email !== 'sent' && r.wa !== 'sent' && r.wa !== 'link').length;
  const next = left.length ? `<button class="btn ok wide" style="margin-top:10px" onclick="openWa('${key}',${left[0]})">${t('waNext', { n: esc(results[left[0]].name), i: links.length - left.length + 1, m: links.length })}</button><p class="mini">${t('waTip')}</p>`
    : links.length ? `<div class="sendsum">${t('waAllDone')}</div>` : '';
  $(mt.el).innerHTML = `<div class="sendsum">${t('sendDone', { e, w, n })}</div>${next}<table class="sendres"><tr><th>${t('colName')}</th>${mt.showCount ? `<th>${t('colCount')}</th>` : ''}<th>${t('colEmail')}</th><th>${t('colWa')}</th></tr>` +
    results.map((r, i) => `<tr><td>${esc(r.name)}${r.reset ? ` <span class="tag">${t('newPwNote')}</span>` : ''}</td>${mt.showCount ? `<td>${r.count}</td>` : ''}<td>${stCell(r.email)}</td><td>${r.wa === 'link'
      ? `<button class="btn sm ${mt.done.has(i) ? '' : 'ok'}" onclick="openWa('${key}',${i})">${mt.done.has(i) ? t('waOpened') : t('openWa')}</button>${isMobile() ? '' : ` <a href="#" class="mini" onclick="openWa('${key}',${i},1);return false">${t('waWeb')}</a>`}`
      : stCell(r.wa)}</td></tr>`).join('') + '</table>';
}
async function openWa(key, i, web) {
  const r = (S.send.res[key] || [])[i], mt = S.send.meta[key]; if (!r || !r.phone) return;
  const text = encodeURIComponent(r.text);
  // a copy on the clipboard as a fallback (and the only way a password reaches WhatsApp Web)
  try { await navigator.clipboard.writeText(r.text); } catch (e) { try { const ta = document.createElement('textarea'); ta.value = r.text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } catch (x) {} }
  if (web) { window.open('https://web.whatsapp.com/send?phone=' + r.phone + (mt.secret ? '' : '&text=' + text), '_blank', 'noopener'); if (mt.secret) toast(t('copied'), 6000); }
  else if (isMobile() || mt.secret) { location.href = 'whatsapp://send?phone=' + r.phone + '&text=' + text; if (!isMobile()) toast(t('waDesktopHint'), 7000); }
  else window.open('https://wa.me/' + r.phone + '?text=' + text, '_blank', 'noopener');
  mt.done.add(i); paintResults(key);
}
function sendFilter() { return { kind: $('sfKind').value, days: +$('sfDays').value, from: $('sfFrom').value, to: $('sfTo').value, stage: $('sfStage').value, icode: $('sfInd').value }; }
async function sendPrograms(preview) {
  const mode = $('sfMode').value, rows = [...S.send.sp];
  if (mode === 'list' && !rows.length) { $('spPickW').open = true; return toast(t('pickSomeone')); }
  const payload = { filter: sendFilter(), mode, rows, roleScope: $('sfScope').value, detail: $('sfDetail').value, channel: S.send.spChan };
  const out = $('spOut');
  try {
    out.innerHTML = '<div class="empty"><span class="spin"></span></div>';
    const pv = await api('sendPrograms', { ...payload, preview: true });
    const head = `<div class="sendsum">${esc(t('previewLine', { t: pv.title, m: pv.matched, r: pv.recipients.length }))}${payload.channel !== 'wa' ? '<br><span class="mini">' + t('quotaLine', { q: pv.quota }) + '</span>' : ''}</div>`;
    if (!pv.recipients.length) { out.innerHTML = head + `<div class="empty">${t('noRecipients')}</div>`; return; }
    if (preview) { out.innerHTML = head + `<table class="sendres"><tr><th>${t('colName')}</th><th>${t('colCount')}</th><th>${t('colEmail')}</th><th>${t('colWa')}</th></tr>` + pv.recipients.map(r => `<tr><td>${esc(r.name)}</td><td>${r.count}</td><td>${r.hasEmail ? '✉️ ' + t('stReady') : t('stNone')}</td><td>${r.hasPhone ? '💬 ' + t('stReady') : t('stNone')}</td></tr>`).join('') + '</table>'; return; }
    if (!confirm(t('confirmSend', { r: pv.recipients.length }))) { out.innerHTML = head; return; }
    toast(t('sendingN'), 60000);
    const r = await api('sendPrograms', payload, { timeout: 240000 });
    drawResults('spOut', 'sp', r.results, false, true); toast(t('sendDone', { e: r.results.filter(x => x.email === 'sent').length, w: r.results.filter(x => x.wa === 'sent' || x.wa === 'link').length, n: r.results.filter(x => x.email !== 'sent' && x.wa !== 'sent' && x.wa !== 'link').length }), 5000);
  } catch (e) { out.innerHTML = ''; toast('❌ ' + sendErr(e), 8000); }
}
async function sendPasswords() {
  const rows = [...S.send.pw];
  if (!rows.length) { $('pwPickW').open = true; return toast(t('pickSomeone')); }
  if (!confirm(t('confirmPw', { r: rows.length }))) return;
  try {
    $('pwOut').innerHTML = '<div class="empty"><span class="spin"></span></div>'; toast(t('sendingN'), 60000);
    const r = await api('sendPassword', { rows, channel: S.send.pwChan }, { timeout: 240000 });
    drawResults('pwOut', 'pw', r.results, true, false); toast(t('sendDone', { e: r.results.filter(x => x.email === 'sent').length, w: r.results.filter(x => x.wa === 'sent' || x.wa === 'link').length, n: r.results.filter(x => x.email !== 'sent' && x.wa !== 'sent' && x.wa !== 'link').length }), 5000);
    try { S.boot = await api('bootstrap'); } catch (e) {}
  } catch (e) { $('pwOut').innerHTML = ''; toast('❌ ' + sendErr(e), 8000); }
}

// ------------------------------------------------------------ me
function renderMe() {
  if (!S.me) return;
  $('meName').textContent = '👤 ' + S.me.name; $('meRole').textContent = tRole(S.me.role || '') + ' · ' + t(isAdmin() ? 'permAdmin' : 'permUser');
  $('meEmail').value = S.me.email || ''; $('mePhone').value = S.me.phone || ''; $('meEmailOn').checked = !!S.me.emailOn; $('meWaOn').checked = !!S.me.waOn;
  $('sheetLinkWrap').innerHTML = S.boot && S.boot.sheetUrl ? `<a href="${esc(S.boot.sheetUrl)}" target="_blank" rel="noopener">${t('openFile')}</a>` : t('adminsOnly');
  $('aboutMeta').textContent = t('about', { s: S.boot ? S.boot.school + ' · ' + S.boot.year : '', t: S.loadedAt ? new Date(S.loadedAt).toLocaleString(EN() ? 'en-GB' : 'ar-SA') : '—', v: CONFIG.VERSION });
  showInstallCard('installCard2', 'installHint2', 'installBtn2');
}
async function saveMe() {
  const payload = { row: S.me.row, email: $('meEmail').value.trim(), phone: $('mePhone').value.replace(/\D/g, ''), emailOn: $('meEmailOn').checked, waOn: $('meWaOn').checked };
  if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) return toast(t('badEmail'));
  if (payload.phone && !/^\d{10,15}$/.test(payload.phone)) return toast(t('badPhone'));
  toast(t('saving'), 15000);
  try { await api('savePerson', { p: payload }); await refresh(true); go('me'); toast(t('meSaved')); } catch (e) { toast('❌ ' + e.message, 6000); }
}
async function changePin() {
  const o = $('pinOld').value.trim(), n = $('pinNew').value.trim(), n2 = $('pinNew2').value.trim();
  if (!o) return toast(t('needPw'));
  if (!pwOk(n)) return toast(errText('PIN_FORMAT'), 6000);
  if (n !== n2) return toast(t('pwMismatch'));
  try { const r = await api('setPin', { oldPin: o, newPin: n }); S.token = r.token; store.set('tr_token', S.token); $('pinOld').value = $('pinNew').value = $('pinNew2').value = ''; toast(t('pwChanged')); } catch (e) { toast('❌ ' + e.message, 6000); }
}

// ------------------------------------------------------------ install / service worker
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function setupInstall() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; showInstallCard('installCard', 'installHint', 'installBtn'); });
  window.addEventListener('appinstalled', () => { S.installEvt = null; toast(t('installed')); ['installCard', 'installCard2'].forEach(id => $(id).hidden = true); });
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
  if (S.installEvt) hint.textContent = t('hintPrompt', { where: t(android ? 'whereAndroid' : win ? 'whereWin' : 'whereOther') });
  else if (ios) hint.textContent = t('hintIos');
  else if (android) hint.textContent = t('hintAndroid');
  else if (win) hint.textContent = t('hintWin', { b: edge ? 'Edge' : 'Chrome' });
  else hint.textContent = t('hintOther');
}
async function installApp() { if (!S.installEvt) return; S.installEvt.prompt(); try { await S.installEvt.userChoice; } catch (e) {} S.installEvt = null; ['installBtn', 'installBtn2'].forEach(id => $(id).hidden = true); }

init();
