# Panduan Instalasi — InvoisKu Web (Backend GAS + Frontend GitHub Pages)

Panduan ini menjelaskan cara memasang ulang InvoisKu dengan arsitektur baru:
- **Backend**: tetap di Google Apps Script, tapi sekarang berupa REST API murni (`Kode.gs`).
- **Frontend**: situs statis terpisah (folder ini), dihosting di GitHub Pages.

Login, token sesi, dan seluruh fitur (Order, SPK, Deadline, Dashboard, Invoice,
Gabung Invoice, dll) **tidak berubah** — hanya cara frontend berbicara ke server yang berbeda.

---

## BAGIAN 1 — Pasang Backend (Google Apps Script)

1. Buka https://script.google.com → **New project**.
2. Hapus semua isi file `Code.gs` bawaan, lalu tempel **seluruh isi file `Kode.gs`**
   yang dikirimkan terpisah (bukan dari dalam ZIP frontend ini).
3. Simpan project (beri nama, misalnya "InvoisKu Backend API").
4. Di dropdown fungsi (bagian atas editor), pilih fungsi **`setupAppEnvironment`**,
   lalu klik **Run** (▶). Ini hanya dijalankan **SATU KALI** — fungsi ini otomatis
   membuat Google Sheet database dan folder Drive untuk InvoisKu.
   - Saat pertama kali Run, Google akan meminta izin akses (Authorize access) —
     pilih akun Anda, klik **Advanced** → **Go to (nama project) (unsafe)** →
     **Allow**. Ini normal untuk script buatan sendiri.
5. Klik **Deploy** → **New deployment**.
   - Klik ikon gerigi di samping "Select type" → pilih **Web app**.
   - **Execute as**: `Me` (akun Anda).
   - **Who has access**: `Anyone`.
     (Ini WAJIB agar frontend bisa menghubungi API. Data tetap aman karena
     setiap permintaan tetap wajib menyertakan token sesi login yang sah —
     "Anyone" di sini hanya berarti siapa saja boleh *menghubungi* alamat API-nya,
     bukan siapa saja bisa melihat data tanpa login.)
   - Klik **Deploy**, lalu **Authorize access** lagi jika diminta.
6. Setelah selesai, akan muncul **Web app URL** yang diakhiri `/exec`. **Salin URL ini.**

> Jika suatu saat Anda mengubah/mengupdate isi `Kode.gs`, jangan buat deployment baru —
> gunakan **Deploy → Manage deployments → (klik ikon pensil) → Version: New → Deploy**,
> supaya URL `/exec` yang sama tetap berlaku dan otomatis memakai kode terbaru.

---

## BAGIAN 2 — Atur Frontend

1. Buka file `js/config.js` di folder frontend ini.
2. Ganti baris:
   ```js
   const GAS_URL = 'GANTI_DENGAN_URL_WEB_APP_ANDA';
   ```
   dengan URL `/exec` yang Anda salin di Bagian 1, contoh:
   ```js
   const GAS_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```
3. Simpan file.

---

## BAGIAN 3 — Publikasikan Frontend ke GitHub Pages

Ikuti panduan langkah demi langkah yang akan dipandu langsung di percakapan
(karena Anda sudah punya Git & akun GitHub terpasang, kita akan mulai dari
langkah membuat repository baru). Secara umum tahapannya:

1. Buat repository baru di GitHub (Public, tanpa README/gitignore/license).
2. Pastikan folder frontend ini — dengan `index.html` **tepat di posisi teratas**
   (bukan di dalam subfolder) — menjadi folder yang di-`git init`.
3. `git init`, `git add .`, `git commit`, `git branch -M main`,
   `git remote add origin <url-repo-anda>`, `git push -u origin main`.
4. Di GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root)**.
5. Tunggu beberapa menit, lalu buka URL yang diberikan GitHub
   (biasanya `https://<username>.github.io/<nama-repo>/`).

---

## Uji Coba

1. Buka URL GitHub Pages Anda.
2. Coba login dengan akun InvoisKu Anda seperti biasa.
3. Coba buka Dashboard, buat Invoice baru, cetak/kirim WA — pastikan semua
   berjalan seperti versi sebelumnya.

Jika ada error di layar, buka **Console** browser (klik kanan → Inspect →
tab Console) — pesan error biasanya menunjukkan apakah masalah ada di
`GAS_URL` (salah/salah ketik) atau di izin deployment Apps Script
(Execute as / Who has access).
