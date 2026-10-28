// Heuristics that need no keyword dictionary: brand-lookalike/phishing URLs, adult rating labels,
// and scoring page text against the keywords the user entered per category.
(function (root) {
  const T = (root.Tameng = root.Tameng || {});
  const D = T.domain;

  T.CATEGORIES = {
    judi: 'Judi online',
    porn: 'Konten dewasa',
    malware: 'Malware & phishing',
  };

  // Brand token -> registrable domains that legitimately carry it.
  const BRANDS = {
    paypal: ['paypal.com'], apple: ['apple.com'], icloud: ['icloud.com'], google: ['google.com', 'google.co.id'],
    gmail: ['gmail.com'], microsoft: ['microsoft.com'], outlook: ['outlook.com', 'live.com'], office365: ['office.com'],
    facebook: ['facebook.com', 'fb.com'], instagram: ['instagram.com'], whatsapp: ['whatsapp.com', 'whatsapp.net'],
    telegram: ['telegram.org', 't.me'], tiktok: ['tiktok.com'], netflix: ['netflix.com'], steam: ['steampowered.com'],
    steamcommunity: ['steamcommunity.com'], binance: ['binance.com'], metamask: ['metamask.io'],
    bca: ['bca.co.id', 'klikbca.com'], klikbca: ['klikbca.com'], bri: ['bri.co.id'], brimo: ['bri.co.id'],
    mandiri: ['bankmandiri.co.id'], livin: ['bankmandiri.co.id'], bni: ['bni.co.id'], btn: ['btn.co.id'],
    bsi: ['bankbsi.co.id'], cimb: ['cimbniaga.co.id'], danamon: ['danamon.co.id'], permata: ['permatabank.com'],
    jenius: ['jenius.com'], dana: ['dana.id'], ovo: ['ovo.id'], gopay: ['gojek.com', 'gopay.co.id'], shopeepay: ['shopee.co.id'],
    shopee: ['shopee.co.id', 'shopee.com'], tokopedia: ['tokopedia.com'], lazada: ['lazada.co.id'],
    bukalapak: ['bukalapak.com'], blibli: ['blibli.com'], traveloka: ['traveloka.com'], telkomsel: ['telkomsel.com'],
    indihome: ['indihome.co.id'], pln: ['pln.co.id'], bpjs: ['bpjs-kesehatan.go.id', 'bpjsketenagakerjaan.go.id'],
  };

  const CHEAP_TLDS = new Set(['xyz', 'top', 'click', 'site', 'online', 'icu', 'buzz', 'rest', 'cfd', 'sbs', 'cyou', 'monster', 'shop', 'live', 'lol', 'quest', 'bond', 'tk', 'ml', 'ga', 'cf', 'gq']);
  const LURE_WORDS = /(login|signin|sign-in|verify|verifikasi|secure|account|akun|update|wallet|klaim|claim|hadiah|reward|unlock|suspend|blokir)/;
  const RESTRICTED_SUFFIX = /\.(go|ac|sch|mil)\.id$/;

  const PHISH_THRESHOLD = { strict: 3, normal: 4, lenient: 5 };

  // Scores a URL for lookalike/phishing traits. Returns { warn, score, reasons }.
  function phishing(url, sensitivity = 'normal') {
    const reasons = [];
    let score = 0;
    let u;
    try {
      u = new URL(url);
    } catch {
      return { warn: false, score: 0, reasons };
    }
    const host = u.hostname.toLowerCase();
    const reg = D.registrableDomain(host);
    const tld = host.split('.').pop();

    if (D.isIPv4(host)) {
      score += 2;
      reasons.push('Alamat berupa IP, bukan nama domain');
    }
    if (host.split('.').some((l) => l.startsWith('xn--'))) {
      score += 2;
      reasons.push('Nama domain memakai huruf mirip (punycode)');
    }
    if (u.username || /^[^/]*@/.test(url.replace(/^https?:\/\//, ''))) {
      score += 3;
      reasons.push('Alamat menyembunyikan tujuan dengan tanda @');
    }
    if (!RESTRICTED_SUFFIX.test(host)) {
      const tokens = host.split(/[.-]/);
      for (const [brand, official] of Object.entries(BRANDS)) {
        if (tokens.includes(brand) && !official.includes(reg)) {
          score += 3;
          reasons.push(`Memakai nama "${brand}" tapi bukan domain resminya`);
          break;
        }
      }
    }
    if (CHEAP_TLDS.has(tld)) {
      score += 1;
      reasons.push(`Akhiran domain .${tld} sering dipakai situs sekali pakai`);
    }
    if (D.FREE_HOSTING.has(D.publicSuffixOf(host))) {
      score += 1;
      reasons.push('Dihosting di layanan gratis');
    }
    if ((reg.match(/-/g) || []).length >= 3) {
      score += 1;
      reasons.push('Banyak tanda hubung di nama domain');
    }
    if (host.split('.').length >= 5) {
      score += 1;
      reasons.push('Subdomain berlapis-lapis');
    }
    if (LURE_WORDS.test(host + u.pathname.toLowerCase())) {
      score += 1;
      reasons.push('Ada kata pancingan seperti login/verifikasi/hadiah');
      if (u.protocol === 'http:') score += 1;
    }
    return { warn: score >= (PHISH_THRESHOLD[sensitivity] || 4), score, reasons };
  }

  // How many distinct keywords must appear in the page before it counts as a match.
  const TEXT_HITS = { strict: 1, normal: 2, lenient: 3 };

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function keywordRegex(kw) {
    return new RegExp('(?:^|[^\\p{L}\\p{N}])' + escapeRe(kw.toLowerCase()) + '(?=$|[^\\p{L}\\p{N}])', 'u');
  }

  // page: { title, text, rating }. keywords: { judi: [...], porn: [...] } from settings.
  // Returns { cat, reasons } for the first category that matches, or null.
  function evaluatePage(page, categories, keywords, sensitivity = 'normal') {
    if (categories.porn && /\b(adult|mature|rta-5042-1996-1400-1577-rta)\b/i.test(page.rating || '')) {
      return { cat: 'porn', reasons: ['Situs menandai dirinya sendiri sebagai konten dewasa (meta rating)'] };
    }
    const need = TEXT_HITS[sensitivity] || 2;
    const title = (page.title || '').toLowerCase();
    const text = title + '\n' + (page.text || '').toLowerCase();
    for (const cat of Object.keys(keywords || {})) {
      if (!categories[cat]) continue;
      const hits = [];
      for (const kw of keywords[cat] || []) {
        if (kw && keywordRegex(kw).test(text)) hits.push(kw);
      }
      // A keyword in the page title is a stronger signal than one buried in the body.
      const inTitle = hits.some((kw) => keywordRegex(kw).test(title));
      if (hits.length >= need || (inTitle && hits.length >= need - 1 && hits.length > 0)) {
        return { cat, reasons: [`Halaman memuat kata kunci: ${hits.slice(0, 5).join(', ')}`] };
      }
    }
    return null;
  }

  T.detect = { phishing, evaluatePage, keywordRegex, escapeRe };
})(globalThis);
