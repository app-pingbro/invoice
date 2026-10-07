/**
 * ============================================================
 * API SHIM — google.script.run via fetch() (GAS-PRO-API)
 * ============================================================
 * app.js (seluruh logika InvoisKu, tidak diubah sedikit pun dari versi
 * Apps Script aslinya) memanggil backend dengan gaya:
 *
 *   google.script.run
 *     .withSuccessHandler(function (res) { ... })
 *     .withFailureHandler(function (err) { ... })
 *     .namaFungsiBackend(arg1, arg2, ...);
 *
 * Di Apps Script (HtmlService) itu berjalan lewat jembatan internal Google.
 * Di sini (frontend statis + GAS sebagai REST API), kita tiru persis
 * perilakunya lewat fetch(): setiap panggilan dikirim sebagai
 *   POST { action: 'namaFungsiBackend', args: [arg1, arg2, ...] }
 * ke GAS_URL, lalu hasil JSON dari server diteruskan ke withSuccessHandler
 * (kalau permintaan berhasil sampai & server sempat merespons — termasuk
 * respons { success:false, message:'...' }, karena app.js sendiri yang
 * memeriksa field success) atau withFailureHandler (kalau jaringan/server
 * benar-benar gagal, mis. tidak ada koneksi atau HTTP error).
 *
 * Header 'text/plain;charset=utf-8' WAJIB dipakai (bukan application/json)
 * supaya browser tidak mengirim CORS preflight (OPTIONS) — Apps Script Web
 * App tidak bisa menjawab preflight, jadi kalau ini salah semua panggilan
 * API akan gagal dengan error CORS di Console.
 *
 * ------------------------------------------------------------
 * Perbaikan: "Gagal memuat data awal: HTTP 404 dari server"
 * ------------------------------------------------------------
 * Penyebab paling umum error ini (sudah dikonfirmasi lewat pengecekan
 * ACTION_MAP & routeApi di Kode.gs — keduanya sudah benar):
 *   1. GAS_URL di js/config.js belum diisi / masih placeholder, atau
 *      salah tempel (mis. ada spasi/enter tersisa, pakai URL "/dev"
 *      bukan "/exec", atau URL dari deployment lama yang sudah diganti).
 *   2. Apps Script Web App baru saja di-deploy ulang ("New version") —
 *      Google butuh beberapa detik untuk menyebarkan versi baru ke semua
 *      server-nya, sehingga permintaan yang datang PERSIS di jendela waktu
 *      itu bisa sesaat mendapat 404 walau URL & kode sudah benar. Inilah
 *      sebabnya errornya "sering muncul" tapi tidak selalu.
 * Penanganannya di bawah ini:
 *   - GAS_URL dirapikan (buang spasi/enter & trailing slash) supaya
 *     kesalahan tempel yang tidak terlihat tidak diam-diam jadi 404.
 *   - Kalau GAS_URL masih placeholder, langsung tolak dengan pesan jelas
 *     TANPA sempat memanggil server (bukan 404 palsu).
 *   - Panggilan yang HANYA membaca data (nama fungsi diawali "get" —
 *     termasuk getBootstrapData yang dipanggil setiap aplikasi dibuka)
 *     dicoba ulang otomatis hingga 2x dengan jeda singkat kalau gagal
 *     sementara (404/5xx/jaringan), karena aman diulang (tidak menulis
 *     data). Panggilan yang MENULIS data (simpan-, hapus-, ubah-, unggah-,
 *     doLogin dst.) TIDAK PERNAH dicoba ulang otomatis, supaya tidak
 *     berisiko dobel-submit.
 * ============================================================
 */

/** URL API dirapikan sekali di awal — buang spasi/enter tak sengaja & trailing slash. */
const API_URL = String(typeof GAS_URL !== 'undefined' ? GAS_URL : '').trim().replace(/\/+$/, '');
const API_URL_PLACEHOLDER = 'GANTI_DENGAN_URL_WEB_APP_ANDA';

/** Hanya action pembaca data (nama diawali "get") yang aman dicoba ulang otomatis. */
function amanDicobaUlang(namaAction) {
  return /^get/.test(String(namaAction || ''));
}

function tunda(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* ============================================================
 * SCALE TURBO (Phase 1) — tambahan di sisi browser
 * ------------------------------------------------------------
 * 1. Perf      : catat waktu setiap panggilan. Ketik Perf.table() atau
 *                Perf.summary() di Console browser untuk melihatnya.
 * 2. Dedupe    : permintaan BACA yang identik dan sedang berjalan cukup dikirim
 *                sekali; pemanggil kedua menumpang hasilnya (salinan sendiri).
 *                Setiap aksi TULIS menaikkan "epoch" sehingga baca sesudah simpan
 *                tidak pernah menumpang baca lama (data basi).
 * 3. Warmup    : saat layar login tampil (belum ada token), server diminta
 *                memanaskan cache (GET ?w=pub, maks 1x per 4 menit) supaya
 *                data sudah siap begitu login selesai.
 * Kompatibel dengan backend lama: field ms/v yang belum ada ditampilkan "-",
 * dan GET ?w=pub ke backend lama hanya dijawab pesan "API aktif".
 * ============================================================ */
const Perf = {
  log: [],
  catat: function (action, t0, json, dariDedupe) {
    const total = Math.round(performance.now() - t0);
    const server = json && typeof json.ms === 'number' ? json.ms : null;
    this.log.push({ waktu: new Date().toLocaleTimeString('id-ID'), aksi: action, total_ms: total,
      server_ms: server === null ? '-' : server, jaringan_ms: server === null ? '-' : Math.max(total - server, 0),
      dedupe: dariDedupe ? '✓' : '', versi: (json && json.v) || '-' });
    if (this.log.length > 200) this.log.shift();
  },
  table: function () { console.table(this.log); },
  summary: function () {
    const per = {};
    this.log.forEach(function (r) {
      const p = per[r.aksi] || (per[r.aksi] = { panggilan: 0, total: 0, server: 0, nServer: 0 });
      p.panggilan++; p.total += r.total_ms;
      if (r.server_ms !== '-') { p.server += r.server_ms; p.nServer++; }
    });
    const out = {};
    Object.keys(per).forEach(function (k) {
      const p = per[k];
      out[k] = { panggilan: p.panggilan, rata_total_ms: Math.round(p.total / p.panggilan),
        rata_server_ms: p.nServer ? Math.round(p.server / p.nServer) : '-' };
    });
    console.table(out);
  }
};
window.Perf = Perf;

const _bacaBerjalan = {};
let _epochTulis = 0;

function salinJson(x) {
  try { return JSON.parse(JSON.stringify(x)); } catch (e) { return x; }
}

/** Pintu semua panggilan: dedupe baca + pengukuran. */
function panggilApiTurbo(namaAction, args) {
  const t0 = performance.now();
  if (!amanDicobaUlang(namaAction)) {
    _epochTulis++;
    return panggilApi(namaAction, args, 0).then(function (json) { Perf.catat(namaAction, t0, json, false); return json; });
  }
  let kunci;
  try { kunci = _epochTulis + '|' + namaAction + '|' + JSON.stringify(args); } catch (e) { kunci = null; }
  if (kunci && _bacaBerjalan[kunci]) {
    return _bacaBerjalan[kunci].then(function (json) { Perf.catat(namaAction, t0, json, true); return salinJson(json); });
  }
  const janji = panggilApi(namaAction, args, 0);
  if (kunci) {
    _bacaBerjalan[kunci] = janji;
    const hapus = function () { delete _bacaBerjalan[kunci]; };
    janji.then(hapus, hapus);
  }
  return janji.then(function (json) { Perf.catat(namaAction, t0, json, false); return salinJson(json); });
}

/** Panaskan cache server saat layar login (belum ada token). Tidak mengirim data apa pun. */
(function warmUpServer() {
  try {
    if (!API_URL || API_URL === API_URL_PLACEHOLDER) return;
    if (localStorage.getItem('invoisku-token')) return;          // sudah login: bootstrap sendiri yang memanaskan
    const terakhir = Number(sessionStorage.getItem('invoisku-warm') || 0);
    if (Date.now() - terakhir < 4 * 60 * 1000) return;
    sessionStorage.setItem('invoisku-warm', String(Date.now()));
    fetch(API_URL + '?w=pub', { method: 'GET', mode: 'no-cors' }).catch(function () {});
  } catch (e) { /* storage diblokir — lewati warmup */ }
})();

/** Kirim satu panggilan ke API, dengan percobaan-ulang otomatis untuk action pembaca data. */
function panggilApi(namaAction, args, percobaanKe) {
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: namaAction, args: args })
  })
    .then(function (res) {
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status + ' dari server.');
        err.httpStatus = res.status;
        throw err;
      }
      return res.json();
    })
    .catch(function (err) {
      const statusBolehUlang = !err.httpStatus || err.httpStatus === 404 || err.httpStatus >= 500;
      if (amanDicobaUlang(namaAction) && percobaanKe < 2 && statusBolehUlang) {
        return tunda(500 * (percobaanKe + 1))
          .then(function () { return panggilApi(namaAction, args, percobaanKe + 1); });
      }
      if (err.httpStatus === 404) {
        err.message = 'HTTP 404 dari server. Kemungkinan GAS_URL di js/config.js salah/kedaluwarsa, ' +
          'atau deployment Apps Script baru saja diganti — cek kembali URL Web App Anda ' +
          '(Deploy > Manage deployments) lalu perbarui js/config.js jika perlu.';
      }
      throw err;
    });
}

function buatRunnerGoogleScript() {
  let onSukses = function () {};
  let onGagal = function () {};

  const proxy = new Proxy({}, {
    get: function (target, prop) {
      if (prop === 'withSuccessHandler') {
        return function (fn) { onSukses = fn; return proxy; };
      }
      if (prop === 'withFailureHandler') {
        return function (fn) { onGagal = fn; return proxy; };
      }
      if (prop === 'withUserObject') {
        // Tidak dipakai oleh InvoisKu, disediakan agar rantai pemanggilan tetap kompatibel.
        return function () { return proxy; };
      }

      // Properti lain dianggap NAMA FUNGSI BACKEND, mis: .doLogin('owner','owner123')
      return function () {
        const args = Array.prototype.slice.call(arguments);

        if (!API_URL || API_URL === API_URL_PLACEHOLDER) {
          onGagal({ message: 'GAS_URL belum diisi di js/config.js. Isi dengan URL Web App ' +
            '(diakhiri /exec) hasil deploy Apps Script Anda — lihat PANDUAN-INSTALASI.md.' });
          return proxy;
        }

        panggilApiTurbo(prop, args)
          .then(function (json) { onSukses(json); })
          .catch(function (err) {
            onGagal({ message: (err && err.message) ? err.message : String(err) });
          });

        return proxy;
      };
    }
  });

  return proxy;
}

// `google.script.run` harus selalu berupa rantai BARU setiap kali diakses
// (persis seperti Apps Script asli), makanya dibuat via getter, bukan objek statis.
const google = {
  script: {
    run: undefined
  }
};
Object.defineProperty(google.script, 'run', {
  get: function () { return buatRunnerGoogleScript(); }
});
