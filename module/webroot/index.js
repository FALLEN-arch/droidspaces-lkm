// Droidspaces LKM 模块页（四页签：主页 / 路线 / 诊断 / 关于）
// 页面结构、样式与逻辑均为本项目独立编写。
// 与系统交互只走管理器注入的全局 ksu.exec。

const MOD = '/data/adb/modules/droidspaces_lkm';
const LOG = '/data/adb/droidspaces_lkm.log';
const PACK5 = 'https://github.com/misaka5202/Droidspaces-rootfs-Desktop-builder';
const PACK6 = 'https://github.com/misaka5202/droidspaces-anland6-rootfs';

const ROUTES = ['auto', 'anland6', 'desktop5'];
const MODULES = [
  'lkm4ctr', 'devtmpfs_lkm', 'ip6table_nat', 'macvlan',
  'droid_lkm_pids', 'droid_lkm_cpu', 'uart_guard', 'mali_nsfix', 'vkms'
];

const STATE = '/data/adb/droidspaces_lkm.d';
// 开机选项：开关 = 模块目录下对应标志文件是否存在（只在下次开机生效，不会热卸载任何模块）
const FLAGS = [
  { file: 'enable_vkms',        key: 'boot.vkms' },
  { file: 'disable_pids',       key: 'boot.pids' },
  { file: 'disable_cpu',        key: 'boot.cpu' },
  { file: 'disable_uart_guard', key: 'boot.uart' },
  { file: 'disable_mali',       key: 'boot.mali' },
  { file: 'mali_nsfix_dryrun',  key: 'boot.dryrun' }
];

const $ = (id) => document.getElementById(id);

/* ======================= shell 桥接 ======================= */

let cbSeq = 0;

function sh(cmd, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const cb = `__dsl_${(cbSeq++).toString(36)}`;
    let timer = 0;
    let settled = false;

    const settle = (errno, stdout, stderr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete window[cb];
      resolve({ errno, stdout: stdout ?? '', stderr: stderr ?? '' });
    };

    window[cb] = settle;
    timer = setTimeout(() => settle(124, '', 'timeout'), timeoutMs);

    try {
      if (typeof ksu !== 'undefined' && typeof ksu.exec === 'function') {
        ksu.exec(cmd, '{}', cb);
      } else {
        settle(1, '', 'ksu API not found');
      }
    } catch (e) {
      settle(1, '', String(e?.message ?? e));
    }
  });
}

/* ======================= i18n =======================
 * 新增语言：在 locales/ 放一份 <code>.json，并在 LANGS 里登记一行。
 * 缺失的键自动回退到英文，再回退到键名本身。
 */

const LANGS = [
  { code: 'en',    name: 'English',          htmlLang: 'en' },
  { code: 'zh',    name: '简体中文',          htmlLang: 'zh-CN' },
  { code: 'zh-TW', name: '繁體中文',          htmlLang: 'zh-TW' },
  { code: 'ja',    name: '日本語',            htmlLang: 'ja' },
  { code: 'ko',    name: '한국어',            htmlLang: 'ko' },
  { code: 'ru',    name: 'Русский',          htmlLang: 'ru' },
  { code: 'uk',    name: 'Українська',       htmlLang: 'uk' },
  { code: 'es',    name: 'Español',          htmlLang: 'es' },
  { code: 'pt-BR', name: 'Português (Brasil)', htmlLang: 'pt-BR' },
  { code: 'de',    name: 'Deutsch',          htmlLang: 'de' },
  { code: 'fr',    name: 'Français',         htmlLang: 'fr' },
  { code: 'it',    name: 'Italiano',         htmlLang: 'it' },
  { code: 'tr',    name: 'Türkçe',           htmlLang: 'tr' },
  { code: 'pl',    name: 'Polski',           htmlLang: 'pl' },
  { code: 'id',    name: 'Bahasa Indonesia', htmlLang: 'id' },
  { code: 'vi',    name: 'Tiếng Việt',       htmlLang: 'vi' },
  { code: 'th',    name: 'ไทย',              htmlLang: 'th' },
  { code: 'hi',    name: 'हिन्दी',             htmlLang: 'hi' },
  { code: 'ar',    name: 'العربية',          htmlLang: 'ar', rtl: true }
];
const LANG_STORE = 'dsl_locale';
const FALLBACK = 'en';

let lang = FALLBACK;
let dict = {};

function matchLang(tag) {
  const p = String(tag || '').toLowerCase();
  if (!p) return null;
  if (/^zh-(tw|hk|mo|hant)/.test(p)) return 'zh-TW';
  const exact = LANGS.find((l) => l.code.toLowerCase() === p);
  if (exact) return exact.code;
  const base = p.split('-')[0];
  const hit = LANGS.find((l) => l.code.toLowerCase().split('-')[0] === base);
  return hit ? hit.code : null;
}

function pickLang() {
  let saved = null;
  try { saved = localStorage.getItem(LANG_STORE); } catch { /* 存储不可用 */ }
  // 'system' 是「跟随系统」：不用缓存，每次按 navigator 重新检测
  if (saved !== 'system' && LANGS.some((l) => l.code === saved)) return saved;
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const p of prefs) {
    const hit = matchLang(p);
    if (hit) return hit;
  }
  return FALLBACK;
}

const localeCache = new Map();

function fetchLocale(code) {
  if (!localeCache.has(code)) {
    localeCache.set(code, (async () => {
      try {
        const r = await fetch(`./locales/${code}.json`);
        return r.ok ? await r.json() : {};
      } catch {
        return {};
      }
    })());
  }
  return localeCache.get(code);
}

// 打开语言菜单时在后台预取全部语言，选中后切换不再等网络
let localesPrefetched = false;
function prefetchLocales() {
  if (localesPrefetched) return;
  localesPrefetched = true;
  LANGS.forEach((l) => fetchLocale(l.code));
}

function t(key, vars) {
  let s = dict[key];
  if (s === undefined) {
    console.warn('[i18n] missing key:', key);
    s = key;
  }
  return vars ? s.replace(/{{\s*(\w+)\s*}}/g, (_, k) => vars[k] ?? '') : s;
}

async function setLang(code) {
  const wantSystem = code === 'system';
  const next = wantSystem ? pickLang()
                          : (LANGS.some((l) => l.code === code) ? code : FALLBACK);
  const [base, cur] = await Promise.all([
    fetchLocale(FALLBACK),
    next === FALLBACK ? {} : fetchLocale(next)
  ]);
  dict = { ...base, ...cur };
  lang = next;
  // 记住「跟随系统」这个选择本身，而不是记住当时解析出的语言
  try { localStorage.setItem(LANG_STORE, wantSystem ? 'system' : lang); } catch { /* 忽略 */ }
  const meta = LANGS.find((l) => l.code === lang);
  document.documentElement.lang = meta.htmlLang;
  document.documentElement.dir = meta.rtl ? 'rtl' : 'ltr';
}

// data-i18n="key" 写文本；data-i18n-attr="aria-label:key;title:key" 写属性
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  document.title = t('app.title');
}

const routeName = (r) => (dict[`route.short.${r}`] ?? r);

/* ======================= 数据命令 ======================= */

// 一次读取 /proc/modules，替代原先每个模块一次 grep（每次 grep 都是一个进程）
const HOME_CMD = [
  `echo "route=$(cat ${MOD}/route 2>/dev/null || echo auto)"`,
  `echo "kernel=$(uname -r)"`,
  `echo "model=$(getprop ro.product.model 2>/dev/null)"`,
  `echo "version=$(grep -m1 '^version=' ${MOD}/module.prop 2>/dev/null | cut -d= -f2)"`,
  `[ -e /dev/mali0 ] && echo mali0=yes || echo mali0=no`,
  `[ -e /dev/dri/renderD128 ] && echo render=yes || echo render=no`,
  `echo "mods=$(cut -d' ' -f1 /proc/modules 2>/dev/null | tr '\\n' ' ')"`,
  `echo "blacklist=$(tr '\\n' ' ' < ${STATE}/blacklist 2>/dev/null)"`,
  `for f in ${FLAGS.map((x) => x.file).join(' ')}; do [ -f ${MOD}/$f ] && echo "flag:$f=1"; done`,
  `echo "end=1"`
].join('; ');

// 诊断分两段：快的部分先出，慢的 dmesg 后补
const DIAG_FAST_CMD = [
  `echo "route=$(cat ${MOD}/route 2>/dev/null || echo auto)"`,
  `echo "kernel=$(uname -r)"`,
  `echo "model=$(getprop ro.product.model 2>/dev/null)"`,
  `echo`,
  `echo "[modules]"`,
  `grep -E '^(${MODULES.join('|')}) ' /proc/modules`,
  `echo`,
  `echo "[mali_nsfix]"`,
  ...['nshf_active', 'nshf_probe_ok', 'nshf_layout_valid', 'nshf_driver', 'nshf_seen', 'nshf_hits']
    .map((p) => `echo "${p}=$(cat /sys/module/mali_nsfix/parameters/${p} 2>/dev/null)"`),
  `echo`,
  `echo "[nodes]"`,
  `[ -e /dev/mali0 ] && echo mali0=yes || echo mali0=no`,
  `[ -e /dev/dri/renderD128 ] && echo renderD128=yes || echo renderD128=no`,
  `echo`,
  `echo "[state]"`,
  `echo "bootcount=$(cat /data/adb/droidspaces_lkm.bootcount 2>/dev/null || echo 0)"`,
  `[ -f ${MOD}/disable ] && echo "disabled=yes" || echo "disabled=no"`,
  `echo "blacklist=$(tr '\\n' ' ' < ${STATE}/blacklist 2>/dev/null)"`,
  `echo "last_crash_module=$(cat ${STATE}/crash-module.txt 2>/dev/null)"`,
  `[ -f ${STATE}/hang-report.txt ] && echo "hang_report=yes" || echo "hang_report=no"`,
  `echo "flags=$(for f in ${FLAGS.map((x) => x.file).join(' ')}; do [ -f ${MOD}/$f ] && printf '%s ' $f; done)"`,
  `echo`,
  `echo "[log tail]"`,
  `tail -n 40 ${LOG} 2>/dev/null`
].join('; ');

const DIAG_SLOW_CMD =
  `dmesg 2>/dev/null | grep -aE 'mali_nsfix|vkms|droid_lkm' | tail -n 20`;

function parseKv(stdout) {
  const out = {};
  String(stdout).split('\n').forEach((line) => {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return out;
}

/* ======================= 渲染 ======================= */

let lastHome = null;
let selectedRoute = 'auto';

function setNode(id, on, yesKey, noKey) {
  const el = $(id);
  el.textContent = t(on ? yesKey : noKey);
  el.classList.toggle('ok', on);
}

function renderBlacklist(d) {
  const list = String(d.blacklist || '').trim();
  $('bl-warn').hidden = !list;
  $('bl-text').textContent = list ? t('home.blacklist', { mods: list.split(/\s+/).join(', ') }) : '';
}

function renderFlags(d) {
  FLAGS.forEach((f) => {
    const sw = document.querySelector(`.switch[data-flag="${f.file}"]`);
    if (sw) sw.setAttribute('aria-checked', d[`flag:${f.file}`] === '1' ? 'true' : 'false');
  });
}

function buildFlags() {
  const box = $('flag-rows');
  box.replaceChildren(...FLAGS.map((f) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="k" data-i18n="${f.key}"></span>` +
      `<button type="button" class="switch" role="switch" aria-checked="false" data-flag="${f.file}" data-i18n-attr="aria-label:${f.key}"><span class="switch-knob"></span></button>`;
    row.querySelector('.switch').addEventListener('click', (e) => toggleFlag(f.file, e.currentTarget));
    return row;
  }));
}

async function toggleFlag(file, sw) {
  const on = sw.getAttribute('aria-checked') !== 'true';
  sw.setAttribute('aria-checked', on ? 'true' : 'false');      // 先乐观更新
  const r = await sh(on ? `touch ${MOD}/${file}` : `rm -f ${MOD}/${file}`);
  if (r.errno !== 0) sw.setAttribute('aria-checked', on ? 'false' : 'true');
  toast(t(r.errno === 0 ? 'toast.optSaved' : 'toast.optFailed'));
  refreshHome(true, true);
}

function renderHome(d) {
  lastHome = d;
  const route = ROUTES.includes(d.route) ? d.route : 'auto';
  renderBlacklist(d);
  renderFlags(d);
  const loaded = new Set(String(d.mods || '').split(/\s+/).filter(Boolean));
  const anyLoaded = MODULES.some((m) => loaded.has(m));

  $('routeNow').textContent = routeName(route);
  $('routeText').textContent = routeName(route);
  $('status-title').textContent = t(anyLoaded ? 'state.running' : 'state.idle');
  $('status-indicator').textContent =
    `${t('info.route')}: ${routeName(route)} · ${t('info.kernel')}: ${d.kernel || '?'}`;
  $('hero').classList.toggle('is-bad', !anyLoaded);
  $('hero-icon').setAttribute('href', anyLoaded ? '#i-ok' : '#i-warn');

  $('kernel-version').textContent = d.kernel || '…';
  $('device-model').textContent = d.model || '…';
  $('about-version').textContent = d.version || '…';

  setNode('node-mali0', d.mali0 === 'yes', 'state.yes', 'state.no');
  setNode('node-kbase', loaded.has('mali_kbase'), 'state.loaded', 'state.notLoaded');
  setNode('node-render', d.render === 'yes', 'state.yes', 'state.no');

  $('module-list').innerHTML = MODULES.map((m) => {
    const on = loaded.has(m);
    return `<span class="chip ${on ? 'on' : 'off'}">${m}</span>`;
  }).join('');
}

function markSelected(route) {
  selectedRoute = route;
  document.querySelectorAll('.opt').forEach((el) => {
    const on = el.dataset.route === route;
    el.classList.toggle('is-on', on);
    const chip = el.querySelector('[data-chip]');
    if (chip) {
      chip.textContent = on ? t('route.selected') : '—';
      chip.className = `chip ${on ? 'on' : 'off'}`;
    }
  });
}

function buildLangSelect() {
  const btn = $('lang-select');
  const menu = $('lang-menu');

  menu.removeAttribute('hidden');
  // 「跟随系统」置顶；选中后清掉语言缓存，按 navigator 重新解析
  const sysLabel = t('about.language.system') || 'System default';
  const items = [{ code: 'system', name: sysLabel }, ...LANGS];
  menu.replaceChildren(...items.map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'md-menu-item';
    b.setAttribute('role', 'option');
    b.dataset.lang = l.code;
    b.style.setProperty('--i', String(items.indexOf(l)));
    b.innerHTML = `<span>${l.name}</span><svg class="ic ic-check" aria-hidden="true"><use href="#i-check"/></svg>`;
    b.addEventListener('click', () => {
      closeLangMenu();
      changeLang(l.code);
    });
    return b;
  }));

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('is-open')) closeLangMenu(); else openLangMenu();
  });
  // 点外部 / Esc 关闭；不会和底栏、页面点击抢事件
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('is-open') && !menu.contains(e.target) && !btn.contains(e.target)) closeLangMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLangMenu();
  });

  markLang();
}

function openLangMenu() {
  const menu = $('lang-menu');
  prefetchLocales();
  menu.classList.add('is-open');
  $('lang-select').setAttribute('aria-expanded', 'true');
  // 让当前语言出现在可视范围内
  requestAnimationFrame(() => {
    const cur = menu.querySelector('.md-menu-item.is-on');
    if (cur) menu.scrollTop = Math.max(0, cur.offsetTop - menu.clientHeight / 2 + cur.offsetHeight / 2);
  });
}

function closeLangMenu() {
  $('lang-menu').classList.remove('is-open');
  $('lang-select').setAttribute('aria-expanded', 'false');
}

function markLang() {
  const meta = LANGS.find((l) => l.code === lang);
  $('lang-label').textContent = meta ? meta.name : lang;
  $('lang-select').setAttribute('aria-label', t('about.language'));
  document.querySelectorAll('.md-menu-item').forEach((el) => {
    const on = el.dataset.lang === lang;
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

/* 界面风格：md3 / miuix */

const UIS = ['md3', 'miuix'];
const UI_STORE = 'dsl_ui';

function pickUi() {
  try {
    const s = localStorage.getItem(UI_STORE);
    if (UIS.includes(s)) return s;
  } catch { /* 忽略 */ }
  return 'md3';
}

/* 主题切换：优先用 View Transitions 做整页交叉淡入；
 * 不支持时给全页临时加颜色过渡类，结束后移除（避免常驻 transition 拖慢滚动） */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
let themingTimer = 0;

function smoothly(change) {
  if (REDUCED.matches) { change(); return; }
  if (typeof document.startViewTransition === 'function') {
    try { document.startViewTransition(change); return; } catch { /* 回退 */ }
  }
  const root = document.documentElement;
  root.classList.add('theming');
  change();
  clearTimeout(themingTimer);
  themingTimer = setTimeout(() => root.classList.remove('theming'), 420);
}

function applyUi(ui, animate = false) {
  if (animate) { smoothly(() => applyUi(ui, false)); return; }
  const name = UIS.includes(ui) ? ui : 'md3';
  document.documentElement.dataset.ui = name;
  // 「莫奈取色」开关只对 MIUIx 有意义（Material 3 本来就跟随莫奈）
  const row = $('monet-row');
  if (row) row.hidden = name !== 'miuix';
  try { localStorage.setItem(UI_STORE, name); } catch { /* 忽略 */ }
  document.querySelectorAll('#ui-switch .seg-btn').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.ui === name);
  });
  requestAnimationFrame(() => {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = getComputedStyle(document.body).backgroundColor;
  });
}

/* MIUIx 莫奈取色：开启后 MIUIx 配色改用管理器注入的 --md-sys-color-* */
const MONET_STORE = 'dsl_monet';

function monetOn() {
  try { return localStorage.getItem(MONET_STORE) === '1'; } catch { return false; }
}

function applyMonet(on, animate = false) {
  if (animate) { smoothly(() => applyMonet(on, false)); return; }
  document.documentElement.dataset.monet = on ? 'on' : 'off';
  const sw = $('monet-switch');
  if (sw) sw.setAttribute('aria-checked', on ? 'true' : 'false');
  try { localStorage.setItem(MONET_STORE, on ? '1' : '0'); } catch { /* 忽略 */ }
  requestAnimationFrame(() => {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = getComputedStyle(document.body).backgroundColor;
  });
}

/* ======================= 数据刷新 ======================= */

const HOME_CACHE = 'dsl_home_cache';
const DIAG_CACHE = 'dsl_diag_cache';
const FRESH_MS = 5000;

function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function cacheSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 忽略 */ }
}

/* 顶部细进度条：请求超过 400ms 才出现，避免闪烁 */
let busyN = 0;
let busyTimer = 0;
function busy(on) {
  const bar = $('busybar');
  busyN = Math.max(0, busyN + (on ? 1 : -1));
  if (busyN > 0) {
    if (!busyTimer) busyTimer = setTimeout(() => bar.classList.add('is-on'), 400);
  } else {
    clearTimeout(busyTimer);
    busyTimer = 0;
    bar.classList.remove('is-on');
  }
}

/* 首页错误横幅：保留上次的缓存内容，只在顶部提示 */
let homeErr = null;
function showHomeErr(kind) {
  homeErr = kind;
  const box = $('home-err');
  box.hidden = !kind;
  if (kind) $('home-err-text').textContent = t(kind === 'timeout' ? 'err.timeout' : 'err.bridge');
}

let homeBusy = null;
let homeAt = 0;

// force=false 时 5 秒内不重复执行 shell；同时只跑一次
function refreshHome(force = true, silent = false) {
  if (homeBusy) return homeBusy;
  if (!force && Date.now() - homeAt < FRESH_MS) return Promise.resolve();
  homeBusy = (async () => {
    if (!silent) busy(true);
    let r;
    try { r = await sh(HOME_CMD); } finally { if (!silent) busy(false); }
    const d = parseKv(r.stdout);
    if (r.errno !== 0 && !r.stdout.trim()) {
      showHomeErr(r.errno === 124 ? 'timeout' : 'bridge');
      return;
    }
    showHomeErr(null);
    if (d.kernel || d.route) {
      homeAt = Date.now();
      cacheSet(HOME_CACHE, d);
    }
    renderHome(d);
    markSelected(ROUTES.includes(d.route) ? d.route : 'auto');
  })().finally(() => { homeBusy = null; });
  return homeBusy;
}

let diagBusy = null;
let diagAt = 0;

function refreshDiag(force = true) {
  if (diagBusy) return diagBusy;
  if (!force && Date.now() - diagAt < FRESH_MS) return Promise.resolve();
  const out = $('diag-out');
  if (!cacheGet(DIAG_CACHE)) out.textContent = t('diag.loading');
  const cached = cacheGet(DIAG_CACHE);
  // 先立刻显示上次结果（或占位），再后台刷新
  if (cached) out.textContent = cached.fast + '\n\n[dmesg]\n' + cached.slow;
  diagBusy = (async () => {
    busy(true);
    const fastP = sh(DIAG_FAST_CMD).finally(() => busy(false));
    const slowP = sh(DIAG_SLOW_CMD, 20000);
    const f = await fastP;
    const fast = f.stdout || f.stderr || t('diag.execFailed', { code: f.errno });
    if (currentView === 'view-diag' || !cached) {
      out.textContent = fast + '\n\n[dmesg]\n' + (cached ? cached.slow : '…');
    }
    const s = await slowP;
    const slow = s.stdout.trim();
    out.textContent = fast + '\n\n[dmesg]\n' + slow;
    diagAt = Date.now();
    cacheSet(DIAG_CACHE, { fast, slow });
  })().finally(() => { diagBusy = null; });
  return diagBusy;
}

/* ======================= 交互 ======================= */

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function applyRoute() {
  if (!ROUTES.includes(selectedRoute)) return;
  const r = await sh(`mkdir -p ${MOD} && printf '%s\\n' '${selectedRoute}' > ${MOD}/route`);
  toast(t(r.errno === 0 ? 'toast.saved' : 'toast.saveFailed'));
  if (r.errno === 0) {
    const rb = $('reboot-route');
    rb.classList.add('pulse');
    setTimeout(() => rb.classList.remove('pulse'), 3000);
  }
  await refreshHome();
}

async function copyDiag() {
  const text = $('diag-out').textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    toast(t('toast.copied'));
    return;
  } catch { /* 非安全上下文时走回退 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* 忽略 */ }
  ta.remove();
  toast(t(ok ? 'toast.copied' : 'toast.copyFailed'));
}

/* 重启：第一次点击进入「再点一次确认」，4 秒内再点才执行 */
const armTimers = new WeakMap();

function rebootLabel(btn) { return btn.querySelector('[data-i18n]'); }

function disarmReboot(btn) {
  clearTimeout(armTimers.get(btn));
  btn.classList.remove('is-armed');
  const lb = rebootLabel(btn);
  if (lb) lb.textContent = t(lb.dataset.i18n);
}

// 通用「再点一次确认」：第一次点击只进入确认态
function confirmTap(btn) {
  if (btn.classList.contains('is-armed')) { disarmReboot(btn); return true; }
  btn.classList.add('is-armed');
  rebootLabel(btn).textContent = t('action.rebootConfirm');
  armTimers.set(btn, setTimeout(() => disarmReboot(btn), 4000));
  return false;
}

async function clearBlacklist(btn) {
  if (!confirmTap(btn)) return;
  const r = await sh(`rm -f ${STATE}/blacklist ${STATE}/crash-module.txt`);
  toast(t(r.errno === 0 ? 'toast.cleared' : 'toast.optFailed'));
  await refreshHome(true, true);
}

async function onReboot(btn) {
  if (!confirmTap(btn)) return;
  const r = await sh('svc power reboot || reboot', 6000);
  // 真正重启时命令不会返回，超时(124)视为成功
  if (r.errno !== 0 && r.errno !== 124) toast(t('action.rebootFailed'));
}

async function openLink(url) {
  const r = await sh(`am start -a android.intent.action.VIEW -d '${url}'`);
  if (r.errno !== 0) toast(t('toast.openFailed'));
}

function syncAppbar() {
  $('appbar').classList.toggle('is-on', $('scroller').scrollTop > 48);
}

let currentView = 'view-home';

function switchView(target) {
  currentView = target;
  document.querySelectorAll('.page').forEach((el) => {
    el.classList.toggle('is-active', el.id === target);
  });
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.target === target);
  });
  $('appbar-title').textContent = t(`tab.${target.replace('view-', '')}`);
  $('scroller').scrollTop = 0;
  syncAppbar();
  if (target === 'view-diag') refreshDiag(false);
  if (target === 'view-home') refreshHome(false);
}

// 切换语言只重绘文本，不重新执行 shell 命令
async function changeLang(code) {
  if (code === lang) return;
  const fade = $('scroller');
  const bar = $('tabbar');
  const quick = !REDUCED.matches;
  // 先淡出 → 换文案（语言包已预取，几乎瞬间）→ 再淡入，避免文字闪跳
  if (quick) { fade.classList.add('swap'); bar.classList.add('swap'); }
  await Promise.all([setLang(code), new Promise((r) => setTimeout(r, quick ? 110 : 0))]);
  applyI18n();
  markLang();
  markSelected(selectedRoute);
  if (lastHome) renderHome(lastHome);
  showHomeErr(homeErr);
  $('appbar-title').textContent = t(`tab.${currentView.replace('view-', '')}`);
  requestAnimationFrame(() => { fade.classList.remove('swap'); bar.classList.remove('swap'); });
}

/* ======================= 平台判定 =======================
 * 非 MTK（含高通等）隐藏「切换路线」底栏：路线只对 Mali 有意义，
 * 装到别的平台只会让人误以为可以切换。
 */
const MTK_RE = /mtk|mediatek|(^|[^a-z])mt[0-9]/;
async function platformIsMtk() {
  const r = await sh('getprop ro.board.platform; getprop ro.soc.model; getprop ro.hardware');
  const s = String(r.stdout || '').toLowerCase();
  return MTK_RE.test(s);
}

function hideRouteTabIfNotMtk() {
  const tab = document.querySelector('.tab[data-target="view-route"]');
  if (tab) tab.remove();
}

/* ======================= 启动 ======================= */

(async function boot() {
  await setLang(pickLang());
  buildFlags();
  applyI18n();
  buildLangSelect();
  document.querySelectorAll('#ui-switch .seg-btn').forEach((b) => {
    b.addEventListener('click', () => { if (b.dataset.ui !== document.documentElement.dataset.ui) applyUi(b.dataset.ui, true); });
  });
  const monetSw = $('monet-switch');
  monetSw.addEventListener('click', () => applyMonet(!monetOn(), true));
  applyMonet(monetOn());
  applyUi(pickUi());

  document.querySelectorAll('.tab').forEach((el) => {
    el.addEventListener('click', () => switchView(el.dataset.target));
  });
  document.querySelectorAll('.opt').forEach((el) => {
    el.addEventListener('click', () => markSelected(el.dataset.route));
  });
  $('scroller').addEventListener('scroll', syncAppbar, { passive: true });
  $('apply-route').addEventListener('click', applyRoute);
  $('copy-diag').addEventListener('click', copyDiag);
  $('reboot-route').addEventListener('click', () => onReboot($('reboot-route')));
  $('reboot-about').addEventListener('click', () => onReboot($('reboot-about')));
  $('bl-clear').addEventListener('click', () => clearBlacklist($('bl-clear')));
  $('home-retry').addEventListener('click', () => refreshHome(true));
  $('pack5').addEventListener('click', () => openLink(PACK5));
  $('pack6').addEventListener('click', () => openLink(PACK6));

  $('appbar-title').textContent = t('tab.home');

  // 先用缓存秒开，不等 shell
  const cachedHome = cacheGet(HOME_CACHE);
  if (cachedHome) {
    renderHome(cachedHome);
    markSelected(ROUTES.includes(cachedHome.route) ? cachedHome.route : 'auto');
  }
  document.body.classList.remove('booting');

  // 平台判定、首页数据并行；判定结果缓存，下次直接决定是否显示「路线」页签
  const mtkCached = cacheGet('dsl_is_mtk');
  if (mtkCached === false) hideRouteTabIfNotMtk();
  platformIsMtk().then((mtk) => {
    cacheSet('dsl_is_mtk', mtk);
    if (!mtk) hideRouteTabIfNotMtk();
  });
  // 首页在前台时每 8 秒静默刷新；切回应用立即刷新一次
  setInterval(() => {
    if (document.visibilityState === 'visible' && currentView === 'view-home') refreshHome(true, true);
  }, 8000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (currentView === 'view-home') refreshHome(false, true);
      else if (currentView === 'view-diag') refreshDiag(false);
    }
  });
  await refreshHome();
  // 空闲时预取诊断，之后切到诊断页即可看到内容
  setTimeout(() => refreshDiag(true), 300);
})();
