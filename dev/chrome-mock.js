// Development-only stand-in for the chrome.* APIs so the extension pages can be previewed in a normal tab.
// It runs the real background.js in the same page, so the message handlers under test are the real ones.
// Injected by dev/serve.mjs; never shipped in the extension folder.
(function () {
  if (globalThis.chrome?.runtime?.id) return;

  const PERSIST = 'tameng-mock-storage';
  const persisted = JSON.parse(localStorage.getItem(PERSIST) || '{}');
  const memory = {}; // big "src:*" lists stay in memory to respect localStorage quota

  function writeBack() {
    localStorage.setItem(PERSIST, JSON.stringify(persisted));
  }

  function area(store, persist) {
    return {
      async get(keys) {
        const all = { ...store };
        if (keys == null) return all;
        const out = {};
        for (const k of [].concat(keys)) if (k in all) out[k] = structuredClone(all[k]);
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) {
          if (persist && !k.startsWith('src:')) persisted[k] = structuredClone(v);
          else memory[k] = structuredClone(v);
        }
        if (persist) writeBack();
      },
      async remove(keys) {
        for (const k of [].concat(keys)) {
          delete persisted[k];
          delete memory[k];
        }
        if (persist) writeBack();
      },
    };
  }

  const local = area(new Proxy({}, {
    ownKeys: () => [...new Set([...Object.keys(persisted), ...Object.keys(memory)])],
    getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: k in persisted ? persisted[k] : memory[k] }),
    get: (_, k) => (k in persisted ? persisted[k] : memory[k]),
    has: (_, k) => k in persisted || k in memory,
  }), true);

  const sessionStore = {};
  const event = () => {
    const ls = [];
    return { addListener: (fn) => ls.push(fn), listeners: ls };
  };

  let dnrRules = [];
  const log = (...a) => console.info('[chrome-mock]', ...a);
  const params = new URLSearchParams(location.search);

  globalThis.chrome = {
    runtime: {
      id: 'mock',
      getURL: (p) => location.origin + '/' + p.replace(/^\//, ''),
      getManifest: () => ({ version: '1.0.0' }),
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      sendMessage(msg) {
        return new Promise((resolve) => {
          const [fn] = chrome.runtime.onMessage.listeners;
          fn(structuredClone(msg), { tab: { id: 1, windowId: 1 } }, resolve);
        });
      },
    },
    storage: { local, session: area(sessionStore, false) },
    declarativeNetRequest: {
      async getDynamicRules() {
        return structuredClone(dnrRules);
      },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        dnrRules = dnrRules.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
        globalThis.__dnrRules = dnrRules;
      },
    },
    alarms: { create: () => {}, get: async () => null, onAlarm: event() },
    webNavigation: { onBeforeNavigate: event() },
    tabs: {
      async query(props = {}) {
        const tab = { id: 1, windowId: 1, url: params.get('tab') || 'https://contoh-situs.com/halaman' };
        // ?tabs=1 simulates a window with only this tab open.
        if (props.windowId && params.get('tabs') !== '1') return [tab, { id: 2, windowId: 1, url: 'https://lain.example/' }];
        return [tab];
      },
      async remove(id) {
        log('tabs.remove', id);
        globalThis.__closed = id;
      },
      async sendMessage(id, msg) {
        log('tabs.sendMessage', id, msg);
      },
      async getCurrent() {
        return { id: 1 };
      },
      async update(id, props) {
        log('tabs.update', id, props);
        globalThis.__updated = props;
        return {};
      },
      async reload(id) {
        log('tabs.reload', id);
      },
    },
  };

  // Load background.js with importScripts resolved against the extension root.
  globalThis.importScripts = (...files) => {
    for (const f of files) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/' + f, false);
      xhr.send();
      (0, eval)(xhr.responseText);
    }
  };
  importScripts('background.js');

  if (!persisted.settings) {
    log('first run: simulating onInstalled');
    setTimeout(() => chrome.runtime.onInstalled.listeners.forEach((fn) => fn({ reason: 'install' })), 0);
  }
})();
