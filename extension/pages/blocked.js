(async () => {
  const params = new URLSearchParams(location.search);
  const cat = params.get('cat') || '';
  const src = params.get('src') || '';
  const kind = params.get('kind') === 'warn' ? 'warn' : 'block';
  const why = (params.get('why') || '').split('|').filter(Boolean);
  const url = location.hash.slice(1);
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();

  const $ = (id) => document.getElementById(id);
  const msg = $('msg');
  const showError = (e) => {
    msg.className = 'msg error';
    msg.textContent = e.message;
  };

  $('gate').dataset.kind = kind;
  if (host) $('host').textContent = host;
  if (url) {
    $('full-url').textContent = url;
    $('full-url-box').hidden = false;
  }

  const catLabel = Tm.CAT_LABEL[cat] || 'tidak diketahui';
  if (kind === 'warn') {
    document.title = 'Situs mencurigakan, Tameng';
    $('title').textContent = 'Hati-hati, situs ini mencurigakan';
    $('host').className = 'stamp blocked';
    $('lead').textContent = 'Alamat ini mirip situs penipuan yang biasa dipakai untuk mencuri akun atau saldo. Jangan masukkan kata sandi, PIN, atau kode OTP di sini.';
    $('back').textContent = 'Kembali ke tempat aman';
  } else {
    $('lead').append('Tameng menutup halaman ini karena masuk kategori ', Tm.el('strong', {}, catLabel), '.');
  }

  const reasons = [];
  if (Tm.SRC_LABEL[src] && kind !== 'warn') reasons.push(Tm.SRC_LABEL[src]);
  if (src === 'keyword' && params.get('kw')) reasons.push(`Kata kunci: "${params.get('kw')}"`);
  reasons.push(...why);
  for (const r of reasons) $('reasons').append(Tm.el('li', {}, r));

  $('back').addEventListener('click', async () => {
    if (history.length > 1) {
      history.back();
      return;
    }
    const tab = await chrome.tabs.getCurrent();
    chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
  });

  // Log once per block, not again on reload.
  const logKey = 'logged:' + location.href;
  let logged = Promise.resolve();
  if (url && !sessionStorage.getItem(logKey)) {
    sessionStorage.setItem(logKey, '1');
    logged = Tm.send({ type: 'logBlock', url, cat, src }).catch(() => {});
  }

  let state;
  try {
    state = await Tm.send({ type: 'state' });
  } catch (e) {
    showError(e);
    return;
  }

  if (!url) return;

  if (kind === 'warn') {
    $('proceed').hidden = false;
    $('proceed').addEventListener('click', async () => {
      await Tm.send({ type: 'proceed', url });
      location.replace(url);
    });
    return;
  }

  // Phishing warnings never auto-close: the user may need to choose to continue.
  if (state.settings.autoClose !== 'off') {
    const close = async () => {
      await logged;
      Tm.send({ type: 'closeTab' }).catch(showError);
    };
    if (state.settings.autoClose === 'now') {
      close();
    } else {
      let left = 5;
      const tick = () => ($('closing-text').textContent = `Tab ini ditutup otomatis dalam ${left} detik.`);
      tick();
      $('closing').hidden = false;
      const timer = setInterval(() => {
        left--;
        if (left > 0) return tick();
        clearInterval(timer);
        $('closing-text').textContent = 'Menutup tab…';
        $('keep-open').hidden = true;
        close();
      }, 1000);
      $('keep-open').addEventListener('click', () => {
        clearInterval(timer);
        $('closing-text').textContent = 'Tab dibiarkan terbuka.';
        $('keep-open').hidden = true;
      });
    }
  }

  if (state.settings.strictMode) {
    $('footnote').textContent = 'Mode ketat aktif: situs yang diblokir tidak bisa dibuka dari halaman ini.';
    return;
  }

  $('allow').hidden = false;
  $('allow').addEventListener('click', async () => {
    try {
      const done = await Tm.withPin(state.settings.hasPin, 'Izinkan ' + host + '?', (pin) => Tm.send({ type: 'allowSite', url, pin }));
      if (done) location.replace(url);
    } catch (e) {
      showError(e);
    }
  });
})();
