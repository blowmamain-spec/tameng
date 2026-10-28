// Scans the visible text of each top-level page. Many sites render late, so it rescans a few times
// while the DOM keeps changing, then stops. The background asks for a fresh scan when keywords change.
(() => {
  if (window.top !== window) return;
  const { detect } = globalThis.Tameng;

  let cfg = null;
  let done = false;
  let observer = null;

  function collect() {
    const hasKeywords = Object.values(cfg.keywords || {}).some((list) => list.length);
    const rating = [...document.querySelectorAll('meta[name="rating" i]')].map((m) => m.content).join(' ');
    return {
      title: document.title || '',
      rating,
      text: hasKeywords ? (document.body?.innerText || '').slice(0, 80000) : '',
    };
  }

  function scan() {
    if (done || !cfg) return;
    const verdict = detect.evaluatePage(collect(), cfg.categories, cfg.keywords, cfg.sensitivity);
    if (!verdict) return;
    done = true;
    observer?.disconnect();
    chrome.runtime.sendMessage({ type: 'pageFlagged', url: location.href, ...verdict }).catch(() => {});
  }

  function watch() {
    let timer = null;
    let rescans = 0;
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (timer || rescans >= 4) return;
      timer = setTimeout(() => {
        timer = null;
        rescans++;
        scan();
      }, 1500);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => observer.disconnect(), 20000);
  }

  async function start() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'pageConfig', url: location.href });
      cfg = res?.ok && res.data.scan ? res.data : null;
    } catch {
      return; // extension reloaded or unavailable
    }
    if (!cfg) return;
    done = false;
    scan();
    if (!done && document.body) watch();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'rescan') start();
  });

  start();
})();
