// Checks the pure detection helpers without a browser. Run: node dev/test-logic.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ctx = vm.createContext({ URL, console });
ctx.globalThis = ctx;
for (const f of ['domain.js', 'detect.js']) {
  vm.runInContext(readFileSync(new URL('../extension/lib/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
}
const { domain: D, detect } = ctx.Tameng;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok  ' + name);
}

test('normalizeDomain handles URLs, www, IDN, junk', () => {
  assert.equal(D.normalizeDomain('https://www.Example.com/path?q=1', { stripWww: true }), 'example.com');
  assert.equal(D.normalizeDomain('*.foo.co.id'), 'foo.co.id');
  assert.equal(D.normalizeDomain('bücher.de'), 'xn--bcher-kva.de');
  assert.equal(D.normalizeDomain('localhost'), '');
  assert.equal(D.normalizeDomain('not a domain'), '');
  assert.equal(D.normalizeDomain(''), '');
});

test('registrableDomain respects multi-part and hosting suffixes', () => {
  assert.equal(D.registrableDomain('a.b.example.co.id'), 'example.co.id');
  assert.equal(D.registrableDomain('login.bca.co.id'), 'bca.co.id');
  assert.equal(D.registrableDomain('x.user.github.io'), 'user.github.io');
  assert.equal(D.registrableDomain('www.google.com'), 'google.com');
});

test('matchDomain walks up to parent domains', () => {
  const set = new Set(['blocked.com']);
  assert.equal(D.matchDomain('a.b.blocked.com', set), 'blocked.com');
  assert.equal(D.matchDomain('notblocked.com', set), null);
});

test('parseDomainList reads hosts, adblock, plain, and URL lines', () => {
  const text = [
    '# comment',
    '0.0.0.0 one.example',
    '127.0.0.1 localhost',
    '||two.example^',
    'three.example # trailing comment',
    'https://four.example/login',
    '! adblock comment',
    '1.2.3.4',
    '',
  ].join('\n');
  assert.deepEqual([...D.parseDomainList(text)].sort(), ['1.2.3.4', 'four.example', 'one.example', 'three.example', 'two.example']);
});

test('phishing flags brand lookalikes, not the real sites', () => {
  assert.equal(detect.phishing('https://bca-login-verifikasi.xyz/akun').warn, true);
  assert.equal(detect.phishing('http://paypal.com.secure-update.top/signin').warn, true);
  assert.equal(detect.phishing('https://www.klikbca.com/').warn, false);
  assert.equal(detect.phishing('https://www.paypal.com/signin').warn, false);
  assert.equal(detect.phishing('https://shopee.co.id/user/account').warn, false);
  assert.equal(detect.phishing('https://toko-mandiri.com/').warn, false); // common Indonesian word, no other signals
  assert.equal(detect.phishing('https://bpjs-kesehatan.go.id/login').warn, false);
  assert.equal(detect.phishing('https://github.com/login').warn, false);
});

test('phishing sensitivity changes the threshold', () => {
  const url = 'https://dana-bantuan.com/'; // brand token only: score 3
  assert.equal(detect.phishing(url, 'normal').warn, false);
  assert.equal(detect.phishing(url, 'strict').warn, true);
  assert.equal(detect.phishing('https://dana-hadiah.site/', 'normal').warn, true);
});

test('evaluatePage: adult meta rating blocks without keywords', () => {
  const v = detect.evaluatePage({ title: 'x', text: '', rating: 'adult' }, { porn: true }, { porn: [] });
  assert.equal(v.cat, 'porn');
  assert.equal(detect.evaluatePage({ title: 'x', text: '', rating: 'adult' }, { porn: false }, {}), null);
});

test('evaluatePage: user keywords need enough distinct hits', () => {
  const kw = { judi: ['alpha', 'beta gamma', 'delta'] };
  const cats = { judi: true };
  const page = (title, text) => ({ title, text, rating: '' });
  assert.equal(detect.evaluatePage(page('Berita', 'hanya alpha di sini'), cats, kw, 'normal'), null);
  assert.equal(detect.evaluatePage(page('Berita', 'alpha dan beta gamma'), cats, kw, 'normal').cat, 'judi');
  assert.equal(detect.evaluatePage(page('Alpha', 'teks biasa'), cats, kw, 'normal').cat, 'judi');
  assert.equal(detect.evaluatePage(page('Berita', 'alpha saja'), cats, kw, 'strict').cat, 'judi');
  assert.equal(detect.evaluatePage(page('Berita', 'alphabet bukan kata kunci'), cats, kw, 'strict'), null);
  assert.equal(detect.evaluatePage(page('Berita', 'alpha beta gamma'), { judi: false }, kw, 'strict'), null);
});

console.log(`\n${passed} tes lulus`);
