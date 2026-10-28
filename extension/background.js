importScripts('lib/domain.js', 'lib/detect.js');

const { domain: D, detect } = self.Tameng;

const DEFAULT_SETTINGS = {
  enabled: true,
  categories: { judi: true, porn: true, malware: true },
  contentScan: true,
  sensitivity: 'normal',
  strictMode: false,
  autoClose: 'off', // 'off' | 'delay' (5 s countdown on the block page) | 'now'
  checkOpenTabs: true,
  safeBrowsingKey: '',
  pin: null, // { salt, hash }
};

const DEFAULT_LISTS = {
  block: [], // domains the user blocks
  white: [], // domains that are never blocked
  urlKeywords: [], // any URL containing one of these is blocked
  pageKeywords: { judi: [], porn: [] }, // words the content scan looks for, per category
};

// Public lists, verified reachable on 2026-10-28. The large international ones start disabled;
// the Indonesian list is large too but is the only one that covers local judol sites.
const DEFAULT_SOURCES = [
  { id: 'tp-id-gambling', cat: 'judi', enabled: true, name: 'Judi Indonesia (TrustPositif Komdigi)', url: 'https://raw.githubusercontent.com/alsyundawy/TrustPositif/main/gambling_indonesia_domainonly.txt', approx: '±1,6 jt domain' },
  { id: 'sb-gambling', cat: 'judi', enabled: true, name: 'StevenBlack: gambling', url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling-only/hosts', approx: '±7 rb domain' },
  { id: 'blp-gambling', cat: 'judi', enabled: false, name: 'Block List Project: gambling', url: 'https://blocklistproject.github.io/Lists/alt-version/gambling-nl.txt', approx: '±280 rb domain' },
  { id: 'sb-porn', cat: 'porn', enabled: true, name: 'StevenBlack: porn', url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts', approx: '±77 rb domain' },
  { id: 'blp-porn', cat: 'porn', enabled: false, name: 'Block List Project: porn', url: 'https://blocklistproject.github.io/Lists/alt-version/porn-nl.txt', approx: '±300 rb domain' },
  { id: 'mf-urlhaus', cat: 'malware', enabled: true, name: 'malware-filter: URLhaus (aktif)', url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains-online.txt', approx: '±2 rb domain' },
  { id: 'mf-phishing', cat: 'malware', enabled: true, name: 'malware-filter: phishing', url: 'https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt', approx: '±25 rb domain' },
  { id: 'blp-scam', cat: 'malware', enabled: false, name: 'Block List Project: scam', url: 'https://blocklistproject.github.io/Lists/alt-version/scam-nl.txt', approx: '±9 rb domain' },
];

const CHUNK = 10000; // domains per DNR rule; keeps a 1.6M-domain list well under the 1000 regex-rule cap
const REMOTE_ID_START = 100000; // rule ids below this are the user's own rules, rebuilt on their own
const LOG_MAX = 200;
const REFRESH_ALARM = 'refresh-sources';

// Never taken from a downloaded list, even if a list contains them: blocking these would take down
// every site on a shared platform or a service most people need. Users can still block them by hand.
const NEVER_FROM_LISTS = new Set([
  'google.com', 'google.co.id', 'youtube.com', 'facebook.com', 'instagram.com', 'whatsapp.com', 'tiktok.com',
  'x.com', 'twitter.com', 't.me', 'telegram.org', 'wikipedia.org', 'github.com', 'microsoft.com', 'apple.com',
  'linktr.ee', 'heylink.me', 'bit.ly', 's.id', 'tinyurl.com', 'cutt.ly', 'shopee.co.id', 'tokopedia.com',
]);

let state = null;
let remoteSets = null; // only for sources DNR refused, see doRebuild
let sessionAllowed = new Set(); // hosts the user chose to open despite a phishing warning, until the browser closes
const sbCache = new Map(); // url -> { at, threat }

// ---------- state ----------

async function loadState() {
  const got = await chrome.storage.local.get(['settings', 'lists', 'sources', 'log', 'dnr']);
  state = {
    settings: { ...DEFAULT_SETTINGS, ...got.settings, categories: { ...DEFAULT_SETTINGS.categories, ...got.settings?.categories } },
    lists: { ...DEFAULT_LISTS, ...got.lists, pageKeywords: { ...DEFAULT_LISTS.pageKeywords, ...got.lists?.pageKeywords } },
    sources: got.sources || [],
    log: got.log || [],
    dnr: { remoteOk: true, error: '', rules: 0, failed: [], ...got.dnr },
  };
  // Lists added in a later version show up for existing installs too.
  for (const def of DEFAULT_SOURCES) {
    if (!state.sources.some((s) => s.id === def.id)) state.sources.push({ ...def, updatedAt: 0, count: 0, error: '' });
  }
  sessionAllowed = new Set((await chrome.storage.session.get('allowed')).allowed || []);
  return state;
}

let ready = loadState();

function save(...keys) {
  const patch = {};
  for (const k of keys) patch[k] = state[k];
  return chrome.storage.local.set(patch);
}

// ---------- PIN ----------

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pinOk(pin) {
  const p = state.settings.pin;
  if (!p) return true;
  if (!pin) return false;
  return (await sha256(p.salt + String(pin))) === p.hash;
}

// ---------- remote lists ----------

// Returns true when the stored domains changed.
async function fetchSource(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  try {
    // Ask the server to skip the download when the list has not changed since last time.
    const headers = src.etag && src.count ? { 'If-None-Match': src.etag } : {};
    const res = await fetch(src.url, { signal: ctrl.signal, cache: 'no-store', headers });
    if (res.status === 304) {
      Object.assign(src, { updatedAt: Date.now(), error: '' });
      return false;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = D.parseDomainList(await res.text());
    const domains = [...parsed].filter((d) => !D.isPublicSuffix(d) && !NEVER_FROM_LISTS.has(d));
    if (!domains.length) throw new Error('Daftar kosong atau formatnya tidak dikenali');
    await chrome.storage.local.set({ ['src:' + src.id]: domains });
    Object.assign(src, { updatedAt: Date.now(), count: domains.length, error: '', etag: res.headers.get('ETag') || '' });
    return true;
  } catch (e) {
    src.error = e.name === 'AbortError' ? 'Waktu habis saat mengunduh' : e.message;
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshSources(ids, { force = false } = {}) {
  const targets = state.sources.filter((s) => s.enabled && (!ids || ids.includes(s.id)));
  const changed = await Promise.all(targets.map(fetchSource));
  await save('sources');
  if (force || changed.some(Boolean)) await rebuildRules('all');
}

async function loadSourceDomains(src) {
  const key = 'src:' + src.id;
  return (await chrome.storage.local.get(key))[key] || [];
}

// ---------- DNR rules ----------

function blockedPage(params) {
  return chrome.runtime.getURL('pages/blocked.html') + '?' + new URLSearchParams(params);
}

function redirectRule(id, params, condition, regexFilter = '^.*$') {
  return {
    id,
    priority: 10,
    action: { type: 'redirect', redirect: { regexSubstitution: blockedPage(params) + '#\\0' } },
    condition: { regexFilter, isUrlFilterCaseSensitive: false, resourceTypes: ['main_frame'], ...condition },
  };
}

// Rebuilds run one at a time. scope 'base' redoes only the user's own rules (cheap);
// 'all' also reloads the downloaded lists, which can mean millions of domains.
let rebuilding = null;
let pendingScope = null;
function rebuildRules(scope = 'base') {
  pendingScope = pendingScope === 'all' || scope === 'all' ? 'all' : 'base';
  if (rebuilding) return rebuilding;
  rebuilding = (async () => {
    while (pendingScope) {
      const next = pendingScope;
      pendingScope = null;
      await doRebuild(next);
    }
    await sweepOpenTabs();
  })().finally(() => (rebuilding = null));
  return rebuilding;
}

async function doRebuild(scope) {
  const { settings, lists } = state;
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const isBase = (r) => r.id < REMOTE_ID_START;
  const base = [];
  let id = 1;

  if (settings.enabled) {
    if (lists.white.length) {
      base.push({ id: id++, priority: 100, action: { type: 'allow' }, condition: { requestDomains: lists.white, resourceTypes: ['main_frame'] } });
    }
    if (lists.block.length) base.push(redirectRule(id++, { cat: 'custom', src: 'list' }, { requestDomains: lists.block }));
    for (const kw of lists.urlKeywords) {
      base.push(redirectRule(id++, { cat: 'keyword', src: 'keyword', kw }, {}, '^.*' + detect.escapeRe(kw) + '.*$'));
    }
  }
  const removeRuleIds = existing.filter((r) => scope === 'all' || isBase(r)).map((r) => r.id);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: base });

  if (scope === 'base') {
    state.dnr.rules = base.length + existing.filter((r) => !isBase(r)).length;
    await save('dnr');
    return;
  }

  // One update per list, so a list the browser refuses does not take the others down with it.
  let remoteId = REMOTE_ID_START;
  let remoteCount = 0;
  const failed = [];
  if (settings.enabled) {
    for (const src of state.sources) {
      if (!src.enabled || !settings.categories[src.cat]) continue;
      const domains = await loadSourceDomains(src);
      const rules = [];
      for (let i = 0; i < domains.length; i += CHUNK) {
        rules.push(redirectRule(remoteId++, { cat: src.cat, src: 'list', list: src.id }, { requestDomains: domains.slice(i, i + CHUNK) }));
      }
      try {
        if (rules.length) await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
        remoteCount += rules.length;
      } catch (e) {
        // That list is checked in onBeforeNavigate instead. Slower, but nothing slips through.
        failed.push({ id: src.id, error: e.message });
      }
    }
  }
  state.dnr = { remoteOk: !failed.length, error: failed[0]?.error || '', failed: failed.map((f) => f.id), rules: base.length + remoteCount };
  remoteSets = null;
  await save('dnr');
}

// DNR only acts on new navigations. This applies the lists to tabs that were already open,
// and asks their content scripts to scan again with the current keywords.
async function sweepOpenTabs() {
  try {
    if (!state.settings.enabled || !state.settings.checkOpenTabs) return;
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    if (!tabs.length) return;
    const listed = await findListed(tabs.map((t) => D.hostOf(t.url)));
    for (const tab of tabs) {
      const verdict = listVerdict(tab.url, listed);
      if (verdict) sendToBlocked(tab.id, tab.url, verdict);
      else chrome.tabs.sendMessage(tab.id, { type: 'rescan' }).catch(() => {}); // tab has no content script yet
    }
  } catch (e) {
    console.warn('Tameng: memeriksa tab yang terbuka gagal', e);
  }
}

// Looks a handful of hosts up in the downloaded lists by streaming through each list once,
// instead of building a Set of millions of domains. Returns Map(listed domain -> category).
async function findListed(hosts) {
  const wanted = new Set();
  for (let h of hosts) {
    while (h) {
      wanted.add(h);
      const dot = h.indexOf('.');
      h = dot < 0 ? '' : h.slice(dot + 1);
    }
  }
  const found = new Map();
  for (const src of state.sources) {
    if (!src.enabled || !state.settings.categories[src.cat]) continue;
    for (const d of await loadSourceDomains(src)) if (wanted.has(d) && !found.has(d)) found.set(d, src.cat);
  }
  return found;
}

// Same decision the DNR rules make, for a URL that is already loaded.
function listVerdict(url, listed) {
  const host = D.hostOf(url);
  const { lists } = state;
  if (!host || D.matchDomain(host, lists.white)) return null;
  if (D.matchDomain(host, lists.block)) return { cat: 'custom', src: 'list' };
  const lower = url.toLowerCase();
  const kw = lists.urlKeywords.find((k) => lower.includes(k));
  if (kw) return { cat: 'keyword', src: 'keyword', kw };
  const hit = D.matchDomain(host, listed);
  return hit ? { cat: listed.get(hit), src: 'list' } : null;
}

// In-memory Sets, built only for lists the browser refused as DNR rules.
async function getRemoteSets() {
  if (remoteSets) return remoteSets;
  remoteSets = {};
  for (const src of state.sources) {
    if (!src.enabled || !state.dnr.failed.includes(src.id)) continue;
    const set = (remoteSets[src.cat] ||= new Set());
    for (const d of await loadSourceDomains(src)) set.add(d);
  }
  return remoteSets;
}

// ---------- navigation checks ----------

async function safeBrowsing(url, key) {
  const hit = sbCache.get(url);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.threat;
  try {
    const res = await fetch('https://safebrowsing.googleapis.com/v4/threatMatches:find?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'tameng-extension', clientVersion: chrome.runtime.getManifest().version },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const threat = data.matches?.[0]?.threatType || null;
    sbCache.set(url, { at: Date.now(), threat });
    return threat;
  } catch {
    return null;
  }
}

const SB_LABEL = {
  MALWARE: 'Google Safe Browsing: menyebarkan malware',
  SOCIAL_ENGINEERING: 'Google Safe Browsing: situs penipuan / phishing',
  UNWANTED_SOFTWARE: 'Google Safe Browsing: perangkat lunak tidak diinginkan',
  POTENTIALLY_HARMFUL_APPLICATION: 'Google Safe Browsing: aplikasi berbahaya',
};

async function judge(url) {
  const host = D.hostOf(url);
  if (!host) return null;
  const { settings, lists } = state;
  if (!settings.enabled || D.matchDomain(host, lists.white)) return null;

  if (state.dnr.failed.length) {
    const sets = await getRemoteSets();
    for (const [cat, set] of Object.entries(sets)) {
      if (settings.categories[cat] && D.matchDomain(host, set)) return { cat, src: 'list' };
    }
  }

  if (settings.categories.malware && !sessionAllowed.has(host)) {
    const p = detect.phishing(url, settings.sensitivity);
    if (p.warn) return { cat: 'phishing', src: 'heuristic', kind: 'warn', why: p.reasons.join('|') };
  }

  if (settings.categories.malware && settings.safeBrowsingKey) {
    const threat = await safeBrowsing(url, settings.safeBrowsingKey);
    if (threat) return { cat: 'malware', src: 'safebrowsing', why: SB_LABEL[threat] || threat };
  }
  return null;
}

function sendToBlocked(tabId, url, verdict) {
  const params = { cat: verdict.cat, src: verdict.src };
  if (verdict.kind) params.kind = verdict.kind;
  if (verdict.kw) params.kw = verdict.kw;
  if (verdict.why) params.why = verdict.why;
  chrome.tabs.update(tabId, { url: blockedPage(params) + '#' + url }).catch(() => {});
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  await ready;
  const verdict = await judge(details.url);
  if (verdict) sendToBlocked(details.tabId, details.url, verdict);
});

// ---------- messages ----------

// Changes that weaken protection need the PIN; changes that strengthen it never do.
function weakens(patch = {}) {
  const s = state.settings;
  if (patch.enabled === false || patch.contentScan === false || patch.strictMode === false || patch.checkOpenTabs === false) return true;
  if (patch.categories && Object.values(patch.categories).some((v) => v === false)) return true;
  const order = { strict: 0, normal: 1, lenient: 2 };
  if (patch.sensitivity && order[patch.sensitivity] > order[s.sensitivity]) return true;
  return typeof patch.safeBrowsingKey === 'string' && patch.safeBrowsingKey.trim() !== s.safeBrowsingKey;
}

const PIN_REQUIRED = new Set(['listRemove:block', 'listRemove:urlKeywords', 'listRemove:pageKeywords', 'listAdd:white', 'sourceToggle', 'sourceRemove', 'clearLog', 'import', 'allowSite']);

function publicState() {
  const { pin, ...settings } = state.settings;
  return { settings: { ...settings, hasPin: !!pin }, lists: state.lists, sources: state.sources, log: state.log, dnr: state.dnr };
}

function pushLog(entry) {
  state.log.unshift({ at: Date.now(), ...entry });
  state.log.length = Math.min(state.log.length, LOG_MAX);
  return save('log');
}

function cleanItems(list, items) {
  const arr = [].concat(items || []);
  if (list === 'urlKeywords' || list === 'pageKeywords') {
    return arr.map((s) => String(s).trim().toLowerCase()).filter((s) => s.length >= 2 && s.length <= 80);
  }
  return arr.map((s) => D.normalizeDomain(s, { stripWww: true })).filter(Boolean);
}

function listRef(msg) {
  return msg.list === 'pageKeywords' ? state.lists.pageKeywords[msg.cat] : state.lists[msg.list];
}

const handlers = {
  async state() {
    return publicState();
  },

  async pageConfig(msg) {
    const { settings, lists } = state;
    const host = D.hostOf(msg.url);
    const scan = settings.enabled && settings.contentScan && !!host && !D.matchDomain(host, lists.white);
    return { scan, categories: settings.categories, sensitivity: settings.sensitivity, keywords: lists.pageKeywords };
  },

  async pageFlagged(msg, sender) {
    if (!sender.tab) return false;
    const host = D.hostOf(msg.url);
    if (!state.settings.enabled || D.matchDomain(host, state.lists.white)) return false;
    sendToBlocked(sender.tab.id, msg.url, { cat: msg.cat, src: 'content', why: (msg.reasons || []).join('|') });
    return true;
  },

  async logBlock(msg) {
    await pushLog({ url: msg.url, host: D.hostOf(msg.url), cat: msg.cat, src: msg.src });
    return true;
  },

  async checkPin(msg) {
    return pinOk(msg.pin);
  },

  async setPin(msg) {
    if (!(await pinOk(msg.oldPin))) throw new Error('PIN lama salah');
    if (msg.newPin) {
      if (!/^\d{4,8}$/.test(msg.newPin)) throw new Error('PIN harus 4 sampai 8 angka');
      const salt = crypto.randomUUID();
      state.settings.pin = { salt, hash: await sha256(salt + msg.newPin) };
    } else {
      state.settings.pin = null;
    }
    await save('settings');
    return publicState();
  },

  async saveSettings(msg) {
    const p = msg.patch || {};
    const s = state.settings;
    if ('enabled' in p) s.enabled = !!p.enabled;
    if ('contentScan' in p) s.contentScan = !!p.contentScan;
    if ('strictMode' in p) s.strictMode = !!p.strictMode;
    if ('checkOpenTabs' in p) s.checkOpenTabs = !!p.checkOpenTabs;
    if (['strict', 'normal', 'lenient'].includes(p.sensitivity)) s.sensitivity = p.sensitivity;
    if (['off', 'delay', 'now'].includes(p.autoClose)) s.autoClose = p.autoClose;
    if (typeof p.safeBrowsingKey === 'string') s.safeBrowsingKey = p.safeBrowsingKey.trim();
    if (p.categories) for (const c of Object.keys(s.categories)) if (c in p.categories) s.categories[c] = !!p.categories[c];
    await save('settings');
    if ('enabled' in p || p.categories) await rebuildRules('all');
    else await sweepOpenTabs();
    return publicState();
  },

  async listAdd(msg) {
    const list = listRef(msg);
    if (!list) throw new Error('Daftar tidak dikenal');
    const items = cleanItems(msg.list, msg.items);
    if (!items.length) throw new Error(msg.list.endsWith('eywords') ? 'Kata kunci minimal 2 huruf' : 'Alamat situs tidak valid');
    for (const it of items) if (!list.includes(it)) list.push(it);
    if (msg.list === 'white') state.lists.block = state.lists.block.filter((d) => !items.includes(d));
    if (msg.list === 'block') state.lists.white = state.lists.white.filter((d) => !items.includes(d));
    await save('lists');
    if (msg.list === 'pageKeywords') await sweepOpenTabs();
    else await rebuildRules();
    return publicState();
  },

  async listRemove(msg) {
    const list = listRef(msg);
    if (!list) throw new Error('Daftar tidak dikenal');
    const remove = new Set([].concat(msg.items));
    const kept = list.filter((x) => !remove.has(x));
    if (msg.list === 'pageKeywords') state.lists.pageKeywords[msg.cat] = kept;
    else state.lists[msg.list] = kept;
    await save('lists');
    if (msg.list !== 'pageKeywords') await rebuildRules();
    return publicState();
  },

  async allowSite(msg) {
    const host = D.normalizeDomain(D.hostOf(msg.url), { stripWww: true });
    if (!host) throw new Error('Alamat tidak valid');
    if (state.settings.strictMode) throw new Error('Mode ketat aktif. Matikan dulu di pengaturan.');
    return handlers.listAdd({ list: 'white', items: [host] });
  },

  // Closing the last tab would close the whole window, so that one goes to a new tab page instead.
  async closeTab(msg, sender) {
    if (!sender.tab) return false;
    const siblings = await chrome.tabs.query({ windowId: sender.tab.windowId });
    if (siblings.length > 1) await chrome.tabs.remove(sender.tab.id);
    else await chrome.tabs.update(sender.tab.id, { url: 'chrome://newtab/' });
    return true;
  },

  async proceed(msg) {
    const host = D.hostOf(msg.url);
    if (host) {
      sessionAllowed.add(host);
      await chrome.storage.session.set({ allowed: [...sessionAllowed] });
    }
    return true;
  },

  async sourceToggle(msg) {
    const src = state.sources.find((s) => s.id === msg.id);
    if (!src) throw new Error('Sumber tidak ditemukan');
    src.enabled = !!msg.enabled;
    await save('sources');
    if (src.enabled && !src.updatedAt) await refreshSources([src.id], { force: true });
    else await rebuildRules('all');
    return publicState();
  },

  async sourceAdd(msg) {
    let url;
    try {
      url = new URL(msg.url);
    } catch {
      throw new Error('URL daftar tidak valid');
    }
    if (url.protocol !== 'https:') throw new Error('URL daftar harus memakai https://');
    if (!state.settings.categories.hasOwnProperty(msg.cat)) throw new Error('Pilih kategori');
    const src = { id: 'user-' + Date.now().toString(36), cat: msg.cat, enabled: true, name: (msg.name || url.hostname).slice(0, 60), url: url.href, approx: '', updatedAt: 0, count: 0, error: '' };
    state.sources.push(src);
    await save('sources');
    await refreshSources([src.id]);
    return publicState();
  },

  async sourceRemove(msg) {
    state.sources = state.sources.filter((s) => s.id !== msg.id);
    await chrome.storage.local.remove('src:' + msg.id);
    await save('sources');
    await rebuildRules('all');
    return publicState();
  },

  async sourcesRefresh() {
    await refreshSources(undefined, { force: true });
    return publicState();
  },

  async clearLog() {
    state.log = [];
    await save('log');
    return publicState();
  },

  async exportData() {
    const { pin, ...settings } = state.settings;
    return { app: 'tameng', version: 1, settings, lists: state.lists, sources: state.sources.map(({ updatedAt, count, error, ...s }) => s) };
  },

  async import(msg) {
    const data = msg.data;
    if (!data || data.app !== 'tameng') throw new Error('Berkas ini bukan cadangan Tameng');
    const { pin } = state.settings;
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings, categories: { ...DEFAULT_SETTINGS.categories, ...data.settings?.categories }, pin };
    state.lists = {
      block: cleanItems('block', data.lists?.block),
      white: cleanItems('white', data.lists?.white),
      urlKeywords: cleanItems('urlKeywords', data.lists?.urlKeywords),
      pageKeywords: {
        judi: cleanItems('pageKeywords', data.lists?.pageKeywords?.judi),
        porn: cleanItems('pageKeywords', data.lists?.pageKeywords?.porn),
      },
    };
    if (Array.isArray(data.sources)) {
      state.sources = data.sources
        .filter((s) => s && s.id && /^https:\/\//.test(s.url) && s.cat in DEFAULT_SETTINGS.categories)
        .map((s) => ({ ...s, updatedAt: 0, count: 0, error: '' }));
    }
    await save('settings', 'lists', 'sources');
    await refreshSources(undefined, { force: true });
    return publicState();
  },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    await ready;
    const handler = handlers[msg?.type];
    if (!handler) throw new Error('Perintah tidak dikenal');
    const gate = msg.type + (msg.list ? ':' + msg.list : '');
    const guarded = PIN_REQUIRED.has(gate) || PIN_REQUIRED.has(msg.type) || (msg.type === 'saveSettings' && weakens(msg.patch));
    if (guarded && !(await pinOk(msg.pin))) {
      throw new Error('PIN salah');
    }
    return handler(msg, sender);
  })()
    .then((data) => reply({ ok: true, data }))
    .catch((e) => reply({ ok: false, error: e.message || String(e) }));
  return true;
});

// ---------- lifecycle ----------

chrome.runtime.onInstalled.addListener(async () => {
  await ready;
  await save('settings', 'lists', 'sources');
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 24 * 60 });
  await refreshSources(undefined, { force: true });
});

chrome.runtime.onStartup.addListener(async () => {
  await ready;
  if (!(await chrome.alarms.get(REFRESH_ALARM))) chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 24 * 60 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  await ready;
  await refreshSources();
});
