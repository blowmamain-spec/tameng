// Domain helpers shared by the service worker, content script, and extension pages.
(function (root) {
  const T = (root.Tameng = root.Tameng || {});

  // Suffixes where the registrable domain sits one label deeper (example.co.id, not co.id).
  // Free-hosting suffixes are included on purpose: each subdomain belongs to a different owner.
  const PUBLIC_SUFFIXES = new Set([
    'co.id', 'go.id', 'ac.id', 'or.id', 'web.id', 'my.id', 'sch.id', 'mil.id', 'net.id', 'biz.id', 'desa.id', 'ponpes.id',
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'com.sg', 'com.my', 'com.ph',
    'co.in', 'com.br', 'com.cn', 'com.hk', 'com.tw', 'co.th', 'com.vn',
    'blogspot.com', 'github.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
    'herokuapp.com', 'wordpress.com', 'weebly.com', 'wixsite.com', '000webhostapp.com', 'glitch.me', 'repl.co',
    'framer.app', 'square.site', 'webflow.io', 'gitbook.io', 'notion.site', 'carrd.co', 'r2.dev', 'onrender.com',
    'ngrok.io', 'ngrok-free.app', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
    'googleusercontent.com', 'b-cdn.net', 'fly.dev', 'railway.app', 'surge.sh', 'neocities.org', 'tumblr.com',
  ]);

  const FREE_HOSTING = new Set([
    '000webhostapp.com', 'weebly.com', 'wixsite.com', 'glitch.me', 'repl.co', 'framer.app', 'square.site',
    'webflow.io', 'carrd.co', 'r2.dev', 'workers.dev', 'pages.dev', 'netlify.app', 'vercel.app', 'firebaseapp.com', 'web.app',
  ]);

  const IGNORED = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback', '0.0.0.0']);

  const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const HOSTNAME = /^(?=.{1,253}$)([a-z0-9_-]{1,63}\.)+[a-z0-9-]{2,63}$/;

  function isIPv4(host) {
    return IPV4.test(host);
  }

  // Returns the lowercase hostname of an http(s) URL, or '' for anything else.
  function hostOf(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      return '';
    }
  }

  // Turns user input or a list entry into a bare, punycode hostname. Returns '' if invalid.
  function normalizeDomain(input, { stripWww = false } = {}) {
    let s = String(input || '').trim().toLowerCase();
    if (!s) return '';
    if (s.includes('://')) {
      s = hostOf(s);
    } else {
      s = s.replace(/^\*\./, '').split(/[/?#\s]/)[0];
      try {
        s = new URL('http://' + s).hostname;
      } catch {
        return '';
      }
    }
    s = s.replace(/\.$/, '');
    if (stripWww) s = s.replace(/^www\./, '');
    if (!s || IGNORED.has(s)) return '';
    if (isIPv4(s)) return s;
    return HOSTNAME.test(s) ? s : '';
  }

  // example.co.id for a.b.example.co.id, user.github.io for x.user.github.io.
  function registrableDomain(host) {
    if (!host || isIPv4(host)) return host;
    const parts = host.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      if (PUBLIC_SUFFIXES.has(parts.slice(i + 1).join('.'))) return parts.slice(i).join('.');
    }
    return parts.slice(-2).join('.');
  }

  function publicSuffixOf(host) {
    const reg = registrableDomain(host);
    const i = reg.indexOf('.');
    return i < 0 ? reg : reg.slice(i + 1);
  }

  // Finds host or any parent domain in a Set/array. Returns the matching entry or null.
  function matchDomain(host, collection) {
    if (!host || !collection) return null;
    const has = typeof collection.has === 'function' ? (d) => collection.has(d) : (d) => collection.includes(d);
    let h = host;
    while (h) {
      if (has(h)) return h;
      const dot = h.indexOf('.');
      if (dot < 0) return null;
      h = h.slice(dot + 1);
    }
    return null;
  }

  // Parses hosts files, adblock "||domain^" lists, plain domain lists, and URL lists.
  function parseDomainList(text) {
    const out = new Set();
    for (const raw of String(text).split(/\r?\n/)) {
      let line = raw.trim();
      if (!line || line[0] === '!' || line[0] === '[') continue;
      line = line.replace(/\s#.*$/, '').replace(/^#.*$/, '').trim();
      if (!line) continue;
      const tokens = line.split(/\s+/);
      let candidate = tokens.length > 1 && /^(0\.0\.0\.0|127\.0\.0\.1|::1?|::)$/.test(tokens[0]) ? tokens[1] : tokens[0];
      candidate = candidate.replace(/^@@/, '').replace(/^\|\|/, '').replace(/\^.*$/, '').replace(/\$.*$/, '');
      const d = normalizeDomain(candidate);
      if (d) out.add(d);
    }
    return out;
  }

  // True for suffixes shared by many unrelated owners (co.id, vercel.app, ...).
  function isPublicSuffix(d) {
    return PUBLIC_SUFFIXES.has(d);
  }

  T.domain = { hostOf, normalizeDomain, registrableDomain, publicSuffixOf, matchDomain, parseDomainList, isIPv4, isPublicSuffix, FREE_HOSTING };
})(globalThis);
