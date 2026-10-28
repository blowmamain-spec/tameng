// Helpers for the popup, block page, and options page.
const Tm = {
  async send(msg) {
    const res = await chrome.runtime.sendMessage(msg);
    if (!res?.ok) throw new Error(res?.error || 'Tidak bisa menghubungi ekstensi');
    return res.data;
  },

  CAT_LABEL: {
    judi: 'Judi online',
    porn: 'Konten dewasa',
    malware: 'Malware & phishing',
    phishing: 'Dugaan phishing',
    custom: 'Daftar blokir pribadi',
    keyword: 'Kata kunci URL',
  },

  SRC_LABEL: {
    list: 'Situs ini ada di daftar blokir',
    keyword: 'Alamatnya mengandung kata kunci yang kamu blokir',
    content: 'Isi halamannya cocok dengan kata kunci kategori ini',
    heuristic: 'Alamatnya punya ciri-ciri situs penipuan',
    safebrowsing: 'Ditandai berbahaya oleh Google Safe Browsing',
  },

  el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  },

  timeAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'baru saja';
    if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
    if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
    return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  // Shows a PIN prompt. Resolves with the entered PIN, or null if cancelled.
  askPin(title, error = '') {
    return new Promise((resolve) => {
      const input = Tm.el('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', 'aria-label': 'PIN', required: true });
      const dialog = Tm.el(
        'dialog',
        { 'aria-labelledby': 'pin-title' },
        Tm.el(
          'form',
          { method: 'dialog' },
          Tm.el('h2', { id: 'pin-title' }, title),
          Tm.el('p', { class: 'muted', style: 'margin:0' }, 'Masukkan PIN Tameng untuk melanjutkan.'),
          input,
          Tm.el('p', { class: 'msg error', role: 'alert' }, error),
          Tm.el('div', { class: 'row' },
            Tm.el('button', { type: 'button', class: 'btn quiet', onclick: () => dialog.close('') }, 'Batal'),
            Tm.el('button', { type: 'submit', class: 'btn primary', value: 'ok' }, 'Lanjutkan')
          )
        )
      );
      dialog.addEventListener('close', () => {
        const pin = dialog.returnValue === 'ok' ? input.value.trim() : null;
        dialog.remove();
        resolve(pin || null);
      });
      document.body.append(dialog);
      dialog.showModal();
      input.focus();
    });
  },

  // Runs fn(pin), asking for the PIN first when one is set. Re-asks after a wrong PIN.
  async withPin(hasPin, title, fn) {
    if (!hasPin) return fn(undefined);
    let error = '';
    for (;;) {
      const pin = await Tm.askPin(title, error);
      if (pin == null) return undefined;
      try {
        return await fn(pin);
      } catch (e) {
        if (e.message !== 'PIN salah') throw e;
        error = 'PIN salah, coba lagi.';
      }
    }
  },
};
