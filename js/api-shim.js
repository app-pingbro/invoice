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

/** v3.4: URL API diperiksa & dirapikan sekali di awal (lihat periksaGasUrl di bawah). */
const _KONFIG = periksaGasUrl(typeof GAS_URL !== 'undefined' ? GAS_URL : '');
const API_URL = _KONFIG.url;
const API_URL_PLACEHOLDER = 'GANTI_DENGAN_URL_WEB_APP_ANDA';
if (_KONFIG.galat) console.warn('[InvoisKu] ' + _KONFIG.galat);

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
    return panggilApi(namaAction, args, 0).then(function (json) {
      Perf.catat(namaAction, t0, json, false);
      if (json && json.nq > 0) jadwalkanKirimNotif(args && args[0]);   // v3.2: ada notifikasi WA di antrean
      return json;
    });
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

/* v3.2 — Notifikasi WhatsApp: server hanya memasukkan pesan ke antrean (simpan invoice
 * tetap cepat). Beberapa saat kemudian browser meminta server mengirim antrean itu.
 * Bila halaman keburu ditutup, trigger server (tiap 5 menit) yang mengirimnya. */
let _timerNotif = null;
function jadwalkanKirimNotif(token, ulangKe) {
  if (!token) return;
  clearTimeout(_timerNotif);
  _timerNotif = setTimeout(function () {
    panggilApi('kirimAntrianNotif', [token], 0).then(function (json) {   // aman diulang (rid)
      const sisa = json && json.data ? json.data.sisa : 0;
      if (sisa > 0 && (ulangKe || 0) < 3) jadwalkanKirimNotif(token, (ulangKe || 0) + 1);
    }).catch(function () { /* trigger server akan mengirimnya */ });
  }, 1500);
}

/** Panaskan cache server saat layar login (belum ada token). Tidak mengirim data apa pun. */
(function warmUpServer() {
  try {
    if (!API_URL || API_URL === API_URL_PLACEHOLDER) return;
    if (localStorage.getItem('invoisku-token')) return;          // sudah login: bootstrap sendiri yang memanaskan
    const terakhir = Number(sessionStorage.getItem('invoisku-warm') || 0);
    if (Date.now() - terakhir < 4 * 60 * 1000) return;
    sessionStorage.setItem('invoisku-warm', String(Date.now()));
    fetch(API_URL + '?w=pub', { method: 'GET', mode: 'no-cors', credentials: 'omit' }).catch(function () {});
  } catch (e) { /* storage diblokir — lewati warmup */ }
})();

/* ============================================================
 * v3.4 — KETAHANAN KONEKSI KE APPS SCRIPT
 * ------------------------------------------------------------
 * Cara kerja Web App Apps Script: setiap POST ke .../exec dijawab pengalihan
 * (302) ke script.googleusercontent.com/macros/echo?user_content_key=…, lalu
 * browser mengambil hasilnya di alamat kedua itu. Langkah kedua ini sesekali
 * dijawab "404" oleh Google walaupun URL /exec benar dan fungsi di server
 * SUDAH selesai dijalankan. Itulah "HTTP 404" yang muncul sesekali.
 *
 * Perbaikan di sini:
 *  1. GAS_URL diperiksa saat aplikasi dibuka: URL /dev, URL googleusercontent,
 *     URL editor, atau tanpa /exec ditolak dengan pesan yang jelas. Segmen
 *     akun ganda (/u/1/) otomatis dibuang.
 *  2. Semua permintaan dicoba ulang otomatis (maks 4 kali, jeda bertambah)
 *     bila gagal sementara: 404, 408, 429, 5xx, atau jaringan putus.
 *  3. Permintaan TULIS diberi id unik (rid). Server v3.4 menyimpan hasil
 *     eksekusi pertama, jadi pengulangan TIDAK membuat data dobel. Untuk
 *     berjaga-jaga, aksi tulis hanya diulang bila server sudah terbukti v3.4+.
 *  4. Cookie Google tidak dikirim (credentials: 'omit') supaya browser yang
 *     login ke beberapa akun Google tidak diarahkan ke akun yang salah.
 *  5. Setiap gangguan dicatat (Koneksi.table() di Console) dan dilaporkan ke
 *     server, bisa dilihat pemilik lewat fungsi cekKoneksi() di editor.
 * ============================================================ */

/** Periksa & rapikan GAS_URL. Kembalikan { url, galat }. */
function periksaGasUrl(mentah) {
  let u = String(mentah || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!u || u === 'GANTI_DENGAN_URL_WEB_APP_ANDA') {
    return { url: '', galat: 'GAS_URL belum diisi di js/config.js. Isi dengan URL Web App (diakhiri /exec) dari Deploy > Manage deployments.' };
  }
  u = u.replace(/\/macros\/u\/\d+\/s\//, '/macros/s/');   // URL yang tersalin dari browser dengan beberapa akun Google
  if (/googleusercontent\.com/.test(u)) {
    return { url: '', galat: 'GAS_URL di js/config.js berisi alamat script.googleusercontent.com (alamat hasil sementara). ' +
      'Ganti dengan URL Web App dari Deploy > Manage deployments (diawali https://script.google.com/macros/s/ dan diakhiri /exec).' };
  }
  if (/\/dev$/.test(u)) {
    return { url: '', galat: 'GAS_URL di js/config.js memakai URL /dev (Test deployment) yang hanya bisa dibuka pemilik script saat login, ' +
      'sehingga dari aplikasi selalu gagal. Ganti dengan URL /exec dari Deploy > Manage deployments.' };
  }
  if (/\/edit$|\/d\/[^/]+\/edit|script\.google\.com\/home/.test(u)) {
    return { url: '', galat: 'GAS_URL di js/config.js berisi alamat editor Apps Script, bukan URL Web App. Ambil URL /exec dari Deploy > Manage deployments.' };
  }
  if (!/^https:\/\/script\.google\.com\/(macros|a\/macros\/[^/]+)\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(u)) {
    return { url: u, galat: 'GAS_URL di js/config.js tidak berformat URL Web App (https://script.google.com/macros/s/…/exec). Periksa kembali isinya.' };
  }
  return { url: u, galat: '' };
}

const Koneksi = {
  KUNCI: 'invoisku-koneksi-log',
  sukses: 0,          // jumlah permintaan berhasil di sesi ini
  versiServer: (function () { try { return localStorage.getItem('invoisku-versi-server') || ''; } catch (e) { return ''; } })(),
  baca: function () { try { return JSON.parse(localStorage.getItem(this.KUNCI) || '[]'); } catch (e) { return []; } },
  tulis: function (log) { try { localStorage.setItem(this.KUNCI, JSON.stringify(log.slice(-50))); } catch (e) {} },
  catat: function (o) {
    const log = this.baca();
    o.t = new Date().toISOString(); o.terkirim = false;
    log.push(o); this.tulis(log);
  },
  table: function () { console.table(this.baca()); },
  /** Tes cepat: apakah URL Web App menjawab, versi berapa, dan URL apa yang dilaporkan server. */
  info: function () {
    return fetch(API_URL + '?w=info', { method: 'GET', credentials: 'omit', cache: 'no-store' })
      .then(function (r) { return r.text().then(function (t) { return { status: r.status, url: r.url, isi: t.slice(0, 300) }; }); })
      .then(function (x) { console.log('[InvoisKu] Tes koneksi:', x); return x; },
            function (e) { console.log('[InvoisKu] Tes koneksi gagal:', e.message); return { galat: e.message }; });
  },
  /** Laporkan gangguan yang belum terkirim ke server (diam-diam, setelah ada permintaan yang berhasil). */
  kirim: function () {
    if (this._mengirim || !versiMinimal(this.versiServer, '3.4')) return;
    const token = (function () { try { return localStorage.getItem('invoisku-token'); } catch (e) { return null; } })();
    const log = this.baca();
    const belum = log.filter(function (x) { return !x.terkirim; });
    if (!token || !belum.length) return;
    this._mengirim = true;
    const self = this;
    fetch(API_URL, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'laporGangguanKoneksi', args: [token, belum.slice(0, 20)] }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.success) {
          const tandai = {}; belum.slice(0, 20).forEach(function (x) { tandai[x.t + x.aksi] = true; });
          self.tulis(self.baca().map(function (x) { if (tandai[x.t + x.aksi]) x.terkirim = true; return x; }));
        }
      })
      .catch(function () {})
      .then(function () { self._mengirim = false; });
  }
};
window.Koneksi = Koneksi;

/** '3.10' >= '3.4' dibandingkan per angka, bukan sebagai teks. */
function versiMinimal(v, min) {
  const a = String(v || '').split(/[.-]/).map(Number), b = String(min).split('.').map(Number);
  for (let i = 0; i < b.length; i++) {
    const x = a[i] || 0;
    if (isNaN(x)) return false;
    if (x !== b[i]) return x > b[i];
  }
  return true;
}

function ridBaru() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

const JEDA_ULANG = [700, 1500, 3000];   // percobaan ke-2, 3, 4

function statusSementara(status) {
  return !status || status === 404 || status === 408 || status === 429 || status >= 500;
}

/**
 * Kirim satu panggilan ke API dengan percobaan ulang otomatis.
 * Aksi baca selalu boleh diulang; aksi tulis hanya bila server ≥ v3.4 (paham rid).
 */
function panggilApi(namaAction, args, percobaanKe, rid, gangguan) {
  percobaanKe = percobaanKe || 0;
  const baca = amanDicobaUlang(namaAction);
  if (!baca && !rid) rid = ridBaru();
  const body = { action: namaAction, args: args };
  if (!baca) body.rid = rid;
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // tetap text/plain: tanpa CORS preflight
    body: JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow'
  })
    .then(function (res) {
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status + ' dari server.');
        err.httpStatus = res.status;
        try { err.host = new URL(res.url).host; } catch (e) { err.host = ''; }
        throw err;
      }
      return res.json();
    })
    .then(function (json) {
      Koneksi.sukses++;
      if (json && json.v && json.v !== Koneksi.versiServer) {
        Koneksi.versiServer = String(json.v);
        try { localStorage.setItem('invoisku-versi-server', Koneksi.versiServer); } catch (e) {}
      }
      if (gangguan) Koneksi.catat({ aksi: namaAction, status: gangguan.status, host: gangguan.host, percobaan: percobaanKe + 1, hasil: 'pulih' });
      Koneksi.kirim();
      return json;
    }, function (err) {
      const sementara = statusSementara(err.httpStatus);
      const bolehUlang = baca || versiMinimal(Koneksi.versiServer, '3.4');
      if (sementara && bolehUlang && percobaanKe < JEDA_ULANG.length) {
        const jeda = JEDA_ULANG[percobaanKe] + Math.floor(Math.random() * 300);
        return tunda(jeda).then(function () {
          return panggilApi(namaAction, args, percobaanKe + 1, rid, { status: err.httpStatus || 0, host: err.host || '' });
        });
      }
      Koneksi.catat({ aksi: namaAction, status: err.httpStatus || 0, host: err.host || '', percobaan: percobaanKe + 1, hasil: 'gagal' });
      if (err.httpStatus === 404) {
        err.message = Koneksi.sukses > 0
          ? 'Server Google sedang tidak merespons (HTTP 404' + (err.host ? ' dari ' + err.host : '') + ') setelah ' + (percobaanKe + 1) +
            ' kali dicoba. Ini gangguan sementara dari Google, bukan kesalahan GAS_URL — tunggu sebentar lalu ulangi.'
          : 'HTTP 404 dari server' + (err.host ? ' (' + err.host + ')' : '') + ' sejak permintaan pertama. Kemungkinan URL Web App di js/config.js ' +
            'tidak aktif: buka Deploy > Manage deployments, pastikan deployment Web App aktif (Execute as: Me, Who has access: Anyone) ' +
            'dan URL /exec-nya sama persis dengan GAS_URL.';
      } else if (!err.httpStatus) {
        err.message = 'Tidak bisa terhubung ke server (' + (err.message || 'jaringan') + '). Periksa koneksi internet lalu ulangi.';
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

        if (!API_URL) {   // v3.4: URL kosong / /dev / googleusercontent / editor → pesan jelas, tanpa memanggil server
          onGagal({ message: _KONFIG.galat });
          return proxy;
        }

        panggilApiTurbo(prop, args).then(function (json) {
          // v3.2.2: bila pengguna sudah pindah menu sebelum data datang, penangan tampilan bisa
          // gagal menulis ke elemen yang sudah tidak ada. Itu bukan kegagalan server — cukup
          // dicatat di Console, tidak ditampilkan sebagai pesan "Gagal".
          try { onSukses(json); }
          catch (e) { console.warn('[InvoisKu] Tampilan ' + prop + ' dilewati (halaman sudah berpindah?):', e); }
        }, function (err) {
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
