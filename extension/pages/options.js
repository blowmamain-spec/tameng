(async () => {
  const $ = (id) => document.getElementById(id);
  let state;
  let pin; // kept in memory after unlocking, sent with every request

  function say(target, text, kind = 'ok') {
    const node = typeof target === 'string' ? $(target) : target;
    if (!node) return;
    node.className = 'msg ' + kind;
    node.textContent = text;
  }

  async function call(msg, msgTarget) {
    try {
      const next = await Tm.send({ ...msg, pin });
      if (next && next.settings) {
        state = next;
        render();
      }
      return next;
    } catch (e) {
      say(msgTarget, e.message, 'error');
      render(); // put controls back to the stored values
      return null;
    }
  }

  // ---------- render ----------

  function renderChips(key, items, isDomain) {
    const ul = document.querySelector(`[data-render="${key}"]`);
    ul.replaceChildren();
    if (!items.length) {
      ul.append(Tm.el('li', { class: 'empty' }, isDomain ? 'Belum ada situs.' : 'Belum ada kata kunci.'));
      return;
    }
    const [list, cat] = key.split(':');
    for (const item of [...items].sort()) {
      ul.append(
        Tm.el('li', {},
          Tm.el('span', { class: 'stamp' + (list === 'block' ? ' blocked' : '') }, item),
          Tm.el('button', {
            type: 'button',
            'aria-label': 'Hapus ' + item,
            title: 'Hapus',
            onclick: async () => {
              const next = await call({ type: 'listRemove', list, cat, items: [item] }, document.querySelector(`[data-msg="${key}"]`));
              if (next) say(document.querySelector(`[data-msg="${key}"]`), `"${item}" dihapus.`);
            },
          }, '×')
        )
      );
    }
  }

  function describeSource(s) {
    if (!s.enabled) return Tm.el('span', { class: 'muted' }, s.approx || 'Tidak aktif');
    if (s.error) return Tm.el('span', { class: 'err' }, 'Gagal: ' + s.error);
    if (!s.updatedAt) return Tm.el('span', { class: 'muted' }, 'Belum diunduh');
    return Tm.el('span', {}, `${s.count.toLocaleString('id-ID')} domain`, Tm.el('br'), Tm.el('span', { class: 'muted' }, 'diperbarui ' + Tm.timeAgo(s.updatedAt)));
  }

  function renderSources() {
    const body = $('sources-body');
    body.replaceChildren();
    for (const s of state.sources) {
      const toggle = Tm.el('input', {
        type: 'checkbox',
        checked: s.enabled,
        'aria-label': 'Aktifkan ' + s.name,
        onchange: async (ev) => {
          const enabled = ev.target.checked;
          say('msg-sources', enabled ? `Mengunduh ${s.name}…` : `Mematikan ${s.name}…`, 'ok');
          const next = await call({ type: 'sourceToggle', id: s.id, enabled }, 'msg-sources');
          if (next) say('msg-sources', enabled ? `${s.name} aktif.` : `${s.name} dimatikan.`);
        },
      });
      body.append(
        Tm.el('tr', {},
          Tm.el('td', {}, Tm.el('label', { class: 'switch' }, toggle, Tm.el('span', { class: 'track' }))),
          Tm.el('td', {}, Tm.el('span', { class: 'src-name' }, s.name), Tm.el('span', { class: 'src-url' }, s.url)),
          Tm.el('td', {}, Tm.CAT_LABEL[s.cat] || s.cat),
          Tm.el('td', {}, describeSource(s)),
          Tm.el('td', {},
            s.id.startsWith('user-')
              ? Tm.el('button', {
                  class: 'btn small quiet',
                  onclick: async () => {
                    const next = await call({ type: 'sourceRemove', id: s.id }, 'msg-sources');
                    if (next) say('msg-sources', `${s.name} dihapus.`);
                  },
                }, 'Hapus')
              : null
          )
        )
      );
    }
    if (!state.dnr.remoteOk) {
      say('msg-sources', 'Browser menolak sebagian aturan blokir cepat (' + state.dnr.error + '). Daftar tetap diperiksa, hanya sedikit lebih lambat.', 'error');
    }
  }

  function renderLog() {
    const ol = $('log');
    ol.replaceChildren();
    if (!state.log.length) {
      ol.append(Tm.el('li', { class: 'empty' }, 'Belum ada situs yang diblokir. Setiap pemblokiran akan muncul di sini.'));
      $('clear-log').hidden = true;
      return;
    }
    $('clear-log').hidden = false;
    for (const e of state.log) {
      ol.append(
        Tm.el('li', {},
          Tm.el('span', { class: 'stamp blocked' }, e.host || e.url),
          Tm.el('time', { datetime: new Date(e.at).toISOString() }, Tm.timeAgo(e.at)),
          Tm.el('span', { class: 'why' }, (Tm.CAT_LABEL[e.cat] || e.cat) + ' · ' + (Tm.SRC_LABEL[e.src] || e.src))
        )
      );
    }
  }

  function render() {
    const { settings, lists } = state;
    $('enabled').checked = settings.enabled;
    $('perlindungan').classList.toggle('off', !settings.enabled);
    $('status-title').textContent = settings.enabled ? 'Perlindungan aktif' : 'Perlindungan mati';
    const active = Object.entries(settings.categories).filter(([, on]) => on).map(([c]) => Tm.CAT_LABEL[c]);
    $('status-detail').textContent = settings.enabled
      ? active.length ? 'Memblokir: ' + active.join(', ') + '.' : 'Semua kategori dimatikan. Hanya daftar blokir pribadimu yang berlaku.'
      : 'Tidak ada situs yang diperiksa atau diblokir sampai kamu menyalakannya lagi.';

    for (const input of document.querySelectorAll('[data-cat]')) {
      if (input.type === 'checkbox') input.checked = !!settings.categories[input.dataset.cat];
    }
    $('contentScan').checked = settings.contentScan;
    $('sensitivity').value = settings.sensitivity;
    $('strictMode').checked = settings.strictMode;
    $('checkOpenTabs').checked = settings.checkOpenTabs;
    $('autoClose').value = settings.autoClose;
    $('sb-key').placeholder = settings.safeBrowsingKey ? 'Key tersimpan (isi untuk mengganti)' : 'API key';

    renderChips('block', lists.block, true);
    renderChips('white', lists.white, true);
    renderChips('urlKeywords', lists.urlKeywords, false);
    renderChips('pageKeywords:judi', lists.pageKeywords.judi, false);
    renderChips('pageKeywords:porn', lists.pageKeywords.porn, false);
    const need = { strict: 1, normal: 2, lenient: 3 }[settings.sensitivity];
    $('kw-note').textContent = `Dengan kepekaan sekarang, halaman diblokir jika memuat ${need} kata kunci berbeda dari satu kategori (atau ${Math.max(need - 1, 1)} jika salah satunya ada di judul). Hindari kata umum agar artikel berita tidak ikut terblokir.`;

    $('pin-state').textContent = settings.hasPin
      ? 'PIN aktif. PIN diminta untuk mematikan perlindungan, menghapus blokir, dan membuka situs yang diblokir.'
      : 'Belum ada PIN. Siapa pun yang memakai browser ini bisa mengubah pengaturan.';
    $('old-pin-field').hidden = !settings.hasPin;
    $('pin-remove').hidden = !settings.hasPin;
    $('pin-save').textContent = settings.hasPin ? 'Ganti PIN' : 'Pasang PIN';

    renderSources();
    renderLog();
  }

  // ---------- events ----------

  function wire() {
    $('enabled').addEventListener('change', (ev) => call({ type: 'saveSettings', patch: { enabled: ev.target.checked } }, 'msg-perlindungan'));
    for (const input of document.querySelectorAll('input[data-cat]')) {
      input.addEventListener('change', () => call({ type: 'saveSettings', patch: { categories: { [input.dataset.cat]: input.checked } } }, 'msg-perlindungan'));
    }
    $('contentScan').addEventListener('change', (ev) => call({ type: 'saveSettings', patch: { contentScan: ev.target.checked } }, 'msg-perlindungan'));
    $('sensitivity').addEventListener('change', (ev) => call({ type: 'saveSettings', patch: { sensitivity: ev.target.value } }, 'msg-perlindungan'));
    $('checkOpenTabs').addEventListener('change', (ev) => call({ type: 'saveSettings', patch: { checkOpenTabs: ev.target.checked } }, 'msg-perlindungan'));
    $('autoClose').addEventListener('change', async (ev) => {
      const next = await call({ type: 'saveSettings', patch: { autoClose: ev.target.value } }, 'msg-perlindungan');
      if (next) say('msg-perlindungan', ev.target.options[ev.target.selectedIndex].text + '.');
    });
    $('strictMode').addEventListener('change', (ev) => call({ type: 'saveSettings', patch: { strictMode: ev.target.checked } }, 'msg-pin'));

    $('sb-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const key = $('sb-key').value.trim();
      const next = await call({ type: 'saveSettings', patch: { safeBrowsingKey: key } }, 'msg-perlindungan');
      if (next) {
        $('sb-key').value = '';
        say('msg-perlindungan', key ? 'API key disimpan. Safe Browsing aktif.' : 'Safe Browsing dimatikan.');
      }
    });

    for (const form of document.querySelectorAll('form[data-list]')) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const field = form.querySelector('input, textarea');
        const raw = field.value;
        const items = form.hasAttribute('data-bulk') ? raw.split(/[\n,]+/) : [raw];
        if (!raw.trim()) return field.focus();
        const { list, cat } = form.dataset;
        const key = cat ? `${list}:${cat}` : list;
        const target = document.querySelector(`[data-msg="${key}"]`);
        const next = await call({ type: 'listAdd', list, cat, items }, target);
        if (next) {
          field.value = '';
          say(target, items.length > 1 ? 'Daftar ditambahkan.' : 'Ditambahkan.');
        }
      });
    }

    $('refresh').addEventListener('click', async () => {
      $('refresh').disabled = true;
      say('msg-sources', 'Mengunduh semua daftar aktif. Ini bisa makan waktu hingga satu menit…');
      const next = await call({ type: 'sourcesRefresh' }, 'msg-sources');
      $('refresh').disabled = false;
      if (next) {
        const failed = next.sources.filter((s) => s.enabled && s.error);
        say('msg-sources', failed.length ? `${failed.length} daftar gagal diunduh. Lihat keterangan di tabel.` : 'Semua daftar sudah terbaru.', failed.length ? 'error' : 'ok');
      }
    });

    $('source-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      say('msg-sources', 'Mengunduh daftar baru…');
      const next = await call({ type: 'sourceAdd', name: $('src-name').value, url: $('src-url').value, cat: $('src-cat').value }, 'msg-sources');
      if (next) {
        ev.target.reset();
        const added = next.sources[next.sources.length - 1];
        say('msg-sources', added.error ? 'Daftar ditambahkan tapi gagal diunduh: ' + added.error : `Daftar ditambahkan: ${added.count.toLocaleString('id-ID')} domain.`, added.error ? 'error' : 'ok');
      }
    });

    $('pin-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const newPin = $('new-pin').value.trim();
      if (!/^\d{4,8}$/.test(newPin)) return say('msg-pin', 'PIN harus 4 sampai 8 angka.', 'error');
      try {
        state = await Tm.send({ type: 'setPin', oldPin: $('old-pin').value.trim() || pin, newPin });
        pin = newPin;
        ev.target.reset();
        render();
        say('msg-pin', 'PIN disimpan. Jangan sampai lupa: PIN tidak bisa dipulihkan.');
      } catch (e) {
        say('msg-pin', e.message, 'error');
      }
    });

    $('pin-remove').addEventListener('click', async () => {
      try {
        state = await Tm.send({ type: 'setPin', oldPin: $('old-pin').value.trim() || pin, newPin: null });
        pin = undefined;
        $('pin-form').reset();
        render();
        say('msg-pin', 'PIN dihapus.');
      } catch (e) {
        say('msg-pin', e.message, 'error');
      }
    });

    $('clear-log').addEventListener('click', () => call({ type: 'clearLog' }, 'msg-backup'));

    $('export').addEventListener('click', async () => {
      try {
        const data = await Tm.send({ type: 'exportData' });
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = Tm.el('a', { href: URL.createObjectURL(blob), download: `tameng-cadangan-${new Date().toISOString().slice(0, 10)}.json` });
        a.click();
        URL.revokeObjectURL(a.href);
        say('msg-backup', 'Cadangan diunduh.');
      } catch (e) {
        say('msg-backup', e.message, 'error');
      }
    });

    $('import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        return say('msg-backup', 'File tidak bisa dibaca sebagai JSON.', 'error');
      }
      say('msg-backup', 'Memulihkan dan mengunduh ulang daftar online…');
      const next = await call({ type: 'import', data }, 'msg-backup');
      if (next) say('msg-backup', 'Pengaturan dipulihkan dari cadangan.');
    });
  }

  // ---------- start ----------

  try {
    state = await Tm.send({ type: 'state' });
  } catch (e) {
    document.body.replaceChildren(Tm.el('p', { class: 'msg error', style: 'padding:24px' }, 'Pengaturan tidak bisa dimuat: ' + e.message));
    return;
  }

  function open() {
    $('lock').hidden = true;
    $('app').hidden = false;
    wire();
    render();
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }

  if (!state.settings.hasPin) return open();

  $('lock').hidden = false;
  $('lock-pin').focus();
  $('lock-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const tryPin = $('lock-pin').value.trim();
    if (await Tm.send({ type: 'checkPin', pin: tryPin })) {
      pin = tryPin;
      open();
    } else {
      say('lock-msg', 'PIN salah.', 'error');
      $('lock-pin').select();
    }
  });
})();
