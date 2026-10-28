# Tameng

Ekstensi browser gratis (Chrome, Edge, Brave, Opera) untuk memblokir situs judi online, konten dewasa, malware, dan phishing, plus daftar blokir pribadi.

## Pasang

1. Buka `chrome://extensions` (Edge: `edge://extensions`).
2. Nyalakan **Developer mode**.
3. Klik **Load unpacked**, pilih folder `extension/` di proyek ini.
4. Tunggu sekitar satu menit: saat pertama dipasang, Tameng mengunduh daftar domain publik (±110 ribu domain).
5. Supaya ikut bekerja di jendela Incognito: buka **Details** ekstensi, nyalakan **Allow in Incognito**.

## Cara kerja

| Lapisan | Apa yang diperiksa | Kapan |
|---|---|---|
| Aturan `declarativeNetRequest` | Daftar online, blokir mandiri, kata kunci URL, daftar putih | Sebelum halaman dimuat, tanpa jeda |
| Pemeriksa navigasi (`background.js`) | Ciri alamat phishing (nama bank/e-wallet palsu, punycode, alamat IP, dll.), Google Safe Browsing jika diisi API key | Saat navigasi dimulai |
| Pemindai halaman (`content.js`) | Label `rating: adult` di situs, kata kunci isi halaman per kategori | Setelah halaman tampil, diulang sampai 20 detik untuk situs yang memuat konten belakangan |

Daftar online bawaan (dicek tiap 24 jam, diunduh ulang hanya kalau isinya berubah):

- **Judi Indonesia (TrustPositif Komdigi)**, aktif: ±1,6 juta domain judol lokal dari [kompilasi alsyundawy/TrustPositif](https://github.com/alsyundawy/TrustPositif) (lisensi MIT). Unduhan pertama ±26 MB. Daftar internasional seperti StevenBlack hampir tidak memuat situs judol Indonesia, jadi daftar inilah yang menangkap situs lokal.
- StevenBlack gambling & porn (aktif)
- malware-filter URLhaus & phishing (aktif)
- Block List Project gambling, porn, scam (mati, karena besar: ratusan ribu domain)

Domain platform bersama (misalnya `vercel.app`, `r2.dev`, `github.io`, `heylink.me`, `s.id`) tidak pernah diambil dari daftar online, karena memblokirnya berarti memblokir semua situs di platform itu. Daftar TrustPositif sempat memuat `vercel.app` dan `r2.dev`. Kalau perlu, kamu tetap bisa memblokirnya lewat blokir mandiri.

Kamu bisa menambah daftar sendiri dari URL `https://` (format hosts, satu domain per baris, atau `||domain^`).

## Yang perlu kamu isi sendiri

**Kata kunci isi halaman masih kosong.** Situs judi sering ganti domain setiap hari, jadi daftar domain saja tidak cukup. Buka **Pengaturan → Kata kunci** dan isi kata/frasa khas situs yang ingin diblokir untuk kategori judi dan dewasa. Halaman diblokir kalau memuat beberapa kata kunci berbeda dari satu kategori (jumlahnya tergantung tingkat kepekaan). Pakai frasa yang spesifik agar artikel berita tentang topik yang sama tidak ikut terblokir.

## Tab yang diblokir

Di **Pengaturan → Perlindungan**:

- **Tab yang diblokir**: biarkan terbuka (bawaan), tutup otomatis setelah 5 detik (bisa dibatalkan dengan "Jangan tutup"), atau langsung ditutup. Kalau itu tab terakhir di jendela, tab diganti halaman tab baru supaya jendelanya tidak ikut tertutup. Peringatan phishing tidak pernah ditutup otomatis karena kamu perlu memilih lanjut atau kembali.
- **Periksa juga tab yang sudah terbuka** (bawaan: nyala): setiap kali daftar blokir, kata kunci, atau pengaturan berubah, tab yang sedang terbuka ikut diperiksa dan dipindah ke halaman blokir bila cocok. Mematikan opsi ini butuh PIN.

## PIN dan mode ketat

- **PIN** diminta untuk mematikan perlindungan, menghapus blokir, menambah daftar putih, dan membuka situs yang diblokir. Menambah blokir tidak butuh PIN.
- **Mode ketat** menyembunyikan tombol "Izinkan situs ini" di halaman blokir.
- Batasannya: siapa pun yang bisa membuka `chrome://extensions` tetap bisa mencopot ekstensi. Untuk perangkat anak, gabungkan dengan kontrol orang tua di akun (Google Family Link) atau DNS keluarga.

## Struktur

```
extension/
  manifest.json
  background.js      aturan blokir, daftar online, PIN, pesan dari halaman
  content.js         pemindai isi halaman
  lib/domain.js      normalisasi domain, parser daftar
  lib/detect.js      deteksi phishing & pencocokan kata kunci
  pages/             popup, halaman blokir, pengaturan
dev/
  test-logic.mjs     tes logika deteksi (node dev/test-logic.mjs)
  serve.mjs          pratinjau UI tanpa memasang ekstensi
  chrome-mock.js     tiruan API chrome untuk pratinjau
  make-icons.ps1     membuat ulang ikon (ikon saat ini placeholder)
```

## Pengembangan

```bash
node dev/test-logic.mjs
```

```bash
node dev/serve.mjs
```

Lalu buka `http://localhost:5179/pages/options.html`. Pratinjau menjalankan `background.js` yang asli dengan API chrome tiruan; aturan blokir sungguhan hanya bisa diuji dengan memasang ekstensinya.
