(async () => {
  const D = Tameng.domain;
  const $ = (id) => document.getElementById(id);
  const msg = $('msg');

  const say = (text, kind = 'ok') => {
    msg.className = 'msg ' + kind;
    msg.textContent = text;
  };

  let state;
  let host = '';

  function render() {
    const { settings, lists, log } = state;
    $('enabled').checked = settings.enabled;
    document.body.classList.toggle('off', !settings.enabled);

    const today = new Date().toDateString();
    const todayCount = log.filter((e) => new Date(e.at).toDateString() === today).length;
    $('count').textContent = log.length ? `Diblokir hari ini: ${todayCount}` : 'Belum ada yang diblokir';

    const stamp = $('host');
    if (!host) {
      stamp.textContent = 'halaman browser';
      stamp.className = 'stamp';
      $('status').textContent = 'Halaman bawaan browser dan ekstensi tidak diperiksa.';
      $('actions').hidden = true;
      return;
    }
    stamp.textContent = host;
    $('actions').hidden = false;

    const white = D.matchDomain(host, lists.white);
    const blocked = D.matchDomain(host, lists.block);
    $('allow').hidden = !!white;
    $('unallow').hidden = !white;
    $('block').hidden = !!blocked;

    if (!settings.enabled) {
      stamp.className = 'stamp';
      $('status').textContent = 'Perlindungan sedang mati. Tidak ada situs yang diperiksa.';
    } else if (white) {
      stamp.className = 'stamp';
      $('status').textContent = `Ada di daftar putih (${white}), jadi tidak diperiksa.`;
    } else if (blocked) {
      stamp.className = 'stamp blocked';
      $('status').textContent = `Ada di daftar blokir pribadimu (${blocked}).`;
    } else {
      stamp.className = 'stamp safe';
      $('status').textContent = 'Diperiksa: daftar blokir, ciri phishing, dan isi halaman.';
    }
  }

  async function act(fn) {
    try {
      const next = await fn();
      if (next) {
        state = next;
        render();
      }
      return next;
    } catch (e) {
      say(e.message, 'error');
    }
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    host = D.hostOf(tab?.url || '');
    state = await Tm.send({ type: 'state' });
    render();
  } catch (e) {
    $('host').textContent = 'tidak tersedia';
    say('Tameng belum siap: ' + e.message, 'error');
    return;
  }

  $('enabled').addEventListener('change', async (ev) => {
    const enabled = ev.target.checked;
    ev.target.checked = !enabled; // stays put until the change is confirmed
    const next = await act(() =>
      Tm.withPin(enabled ? false : state.settings.hasPin, 'Matikan perlindungan?', (pin) => Tm.send({ type: 'saveSettings', patch: { enabled }, pin }))
    );
    if (next) say(enabled ? 'Perlindungan aktif.' : 'Perlindungan dimatikan.');
  });

  $('block').addEventListener('click', async () => {
    const next = await act(() => Tm.send({ type: 'listAdd', list: 'block', items: [host] }));
    if (!next) return;
    say('Diblokir.');
    // With checkOpenTabs on, the background has already sent this tab to the block page.
    if (!next.settings.checkOpenTabs) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      chrome.tabs.reload(tab.id).catch(() => {});
    }
  });

  $('allow').addEventListener('click', async () => {
    const next = await act(() =>
      Tm.withPin(state.settings.hasPin, 'Izinkan ' + host + '?', (pin) => Tm.send({ type: 'listAdd', list: 'white', items: [host], pin }))
    );
    if (next) say('Masuk daftar putih.');
  });

  $('unallow').addEventListener('click', async () => {
    const entry = D.matchDomain(host, state.lists.white);
    const next = await act(() => Tm.send({ type: 'listRemove', list: 'white', items: [entry] }));
    if (next) say('Dihapus dari daftar putih.');
  });
})();
