# InvoisKu Web (Frontend)

Ini adalah frontend statis InvoisKu — hasil migrasi dari versi Apps Script
HtmlService ke situs statis (untuk dihosting di GitHub Pages) yang
berkomunikasi ke backend Google Apps Script lewat REST API (fetch).

Semua fitur, tampilan, dan alur kerja **sama persis** dengan versi
sebelumnya. Yang berubah hanyalah cara frontend berbicara ke server:
dulu lewat `google.script.run` (hanya bisa jalan di dalam Apps Script),
sekarang lewat `fetch()` ke URL Web App Apps Script — sehingga situs ini
bisa dihosting di mana saja (termasuk GitHub Pages) secara terpisah dari
backend-nya.

## Struktur folder

```
index.html          <- halaman utama (SPA)
css/style.css        <- seluruh gaya tampilan (tidak diubah dari versi asli)
js/app.js             <- seluruh logika aplikasi (tidak diubah dari versi asli)
js/api-shim.js        <- lapisan kompatibilitas: meniru google.script.run via fetch()
js/config.js           <- SATU-SATUNYA file yang perlu Anda ubah: isi URL backend Anda
README.md
PANDUAN-INSTALASI.md  <- panduan lengkap langkah demi langkah
```

## Langkah cepat

1. Deploy backend (`Kode.gs`) ke Google Apps Script sebagai Web App —
   lihat `PANDUAN-INSTALASI.md`.
2. Salin URL `/exec` hasil deploy, tempel ke `GAS_URL` di `js/config.js`.
3. Upload folder ini ke GitHub, aktifkan GitHub Pages — lihat
   `PANDUAN-INSTALASI.md`.

## Keamanan

Login (username/password) dan token sesi tetap wajib seperti sebelumnya.
Semua data (pelanggan, invoice, keuangan) tetap terlindungi token sesi
yang divalidasi oleh server pada setiap permintaan — meskipun URL API
diketahui orang lain, data tidak bisa diakses tanpa login yang sah.
