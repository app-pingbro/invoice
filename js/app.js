/**
 * ============================================================
 * InvoisKu — Frontend (JavaScript.html) v2
 * SPA murni: URL tidak pernah berubah, aman di dalam iframe.
 * ============================================================
 */

// ════════════════════════════════════════════════════════
// BAGIAN 1: STATE APLIKASI
// ════════════════════════════════════════════════════════

const KUNCI_TOKEN = 'invoisku-token';
const KUNCI_DRAFT = 'invoisku-draft';
const KUNCI_TEMA  = 'invoisku-theme';

const AppState = {
  halaman: null,
  token: null,
  peran: null,
  nama: null,
  config: {},
  satuanList: [],
  pelanggan: [],
  nomorBerikutnya: '',
  draft: null,          // isi formulir invoice yang belum disimpan
  editId: '',           // ID invoice bila sedang mode ubah
  invoiceAktif: null,
  previewMode: null,     // 'single' | 'gabungan' — menentukan target Cetak JPG / Kirim WA di modal Pratinjau
  gabunganAktif: null,   // { ids, pelanggan, total, invoiceList, driveUrl } saat pratinjau Gabung Invoice terbuka
  gabungKandidat: [],    // daftar pelanggan (>1 invoice) untuk fitur Gabung Invoice
  cacheInvoice: null,   // hasil terakhir Riwayat Invoice (tampil instan)
  cacheLaporan: null,   // hasil terakhir Laporan (tampil instan, disegarkan di latar)
  filter: { keyword: '', status: 'Semua' },
  chart: {}
};

const MENU = {
  Owner: [
    { id: 'buatInvoice',    ikon: 'bi-file-earmark-plus', label: 'Buat Invoice' },
    { id: 'riwayatInvoice', ikon: 'bi-clock-history',     label: 'Riwayat Invoice' },
    { id: 'pelanggan',      ikon: 'bi-people',            label: 'Pelanggan' },
    { id: 'laporan',        ikon: 'bi-bar-chart',         label: 'Laporan' }
  ],
  Tim: [
    { id: 'buatInvoice',    ikon: 'bi-file-earmark-plus', label: 'Buat Invoice' },
    { id: 'riwayatInvoice', ikon: 'bi-clock-history',     label: 'Riwayat Invoice' },
    { id: 'pelanggan',      ikon: 'bi-people',            label: 'Pelanggan' }
  ]
};


// ════════════════════════════════════════════════════════
// BAGIAN 2: UTILITAS
// ════════════════════════════════════════════════════════

function $(id) { return document.getElementById(id); }

/** Harga & satuan otomatis untuk deskripsi produk/jasa tertentu (Perbaikan #5).
 *  Kunci wajib huruf kecil — dicocokkan dengan deskripsi yang di-trim & di-lowercase. */
const HARGA_OTOMATIS_ITEM = {
  'polyfilm': { harga: 40000, satuan: 'Meter' },
  'hvs':      { harga: 20000, satuan: 'Meter' }
};

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 1250000 -> "1.250.000" */
function rp(n) {
  const num = Math.round(Number(n) || 0);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function rpRingkas(n) {
  const num = Number(n) || 0;
  if (num >= 1e9) return (num / 1e9).toFixed(1).replace('.', ',') + ' M';
  if (num >= 1e6) return (num / 1e6).toFixed(1).replace('.', ',') + ' Jt';
  return rp(num);
}

/** Ambil angka murni dari teks berformat: "1.250.000" -> 1250000 */
function keAngka(teks) {
  const digit = String(teks === null || teks === undefined ? '' : teks).replace(/[^\d]/g, '');
  return digit ? parseInt(digit, 10) : 0;
}

function tglInput(d) {
  const t = d ? new Date(d) : new Date();
  if (isNaN(t.getTime())) return tglInput(null);
  return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
}

function tambahHari(tanggal, jumlah) {
  const d = new Date(tanggal);
  d.setDate(d.getDate() + (Number(jumlah) || 0));
  return d;
}

function kelasStatus(status) {
  if (status === 'Lunas') return 'lunas';
  if (status === 'Jatuh Tempo') return 'overdue';
  return 'belum';
}

function simpanLokal(kunci, nilai) {
  try { localStorage.setItem(kunci, typeof nilai === 'string' ? nilai : JSON.stringify(nilai)); }
  catch (e) { /* localStorage diblokir — abaikan saja */ }
}

function bacaLokal(kunci, sebagaiObjek) {
  try {
    const v = localStorage.getItem(kunci);
    if (!v) return null;
    return sebagaiObjek ? JSON.parse(v) : v;
  } catch (e) { return null; }
}

function hapusLokal(kunci) {
  try { localStorage.removeItem(kunci); } catch (e) {}
}

function showToast(judul, pesan, tipe) {
  tipe = tipe || 'info';
  const el = $('appToast');
  $('toastTitle').textContent = judul;
  $('toastBody').textContent = pesan;
  const ikon = { success: 'bi-check-circle-fill text-success',
                 danger:  'bi-exclamation-octagon-fill text-magenta',
                 warning: 'bi-exclamation-triangle-fill text-warning',
                 info:    'bi-info-circle text-cyan' }[tipe];
  $('toastIcon').className = 'bi me-2 ' + ikon;
  el.className = 'toast align-items-center t-' + tipe;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 4500 }).show();
}

function tombolSibuk(btn, teks) {
  if (!btn) return function () {};
  const asli = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-inline"></span> ' + (teks || 'Memproses...');
  btn.disabled = true;
  return function () { btn.innerHTML = asli; btn.disabled = false; };
}

function skeleton(jumlah) {
  let s = '';
  for (let i = 0; i < (jumlah || 3); i++) s += '<div class="skeleton"></div>';
  return s;
}

/** Tampilkan pesan galat DI DALAM kontainer supaya skeleton tidak menggantung selamanya */
function tampilkanGalat(idWadah, pesan, aksiUlang) {
  const el = $(idWadah);
  if (!el) return;
  el.innerHTML = '<div class="card-x"><div class="empty-state">' +
    '<i class="bi bi-exclamation-triangle"></i>' + esc(pesan) +
    (aksiUlang ? '<div class="mt-3"><button class="btn btn-cyan btn-sm" onclick="' + aksiUlang +
      '"><i class="bi bi-arrow-clockwise"></i> Coba Lagi</button></div>' : '') +
    '</div></div>';
}

function konfirmasi(pesan, aksi) {
  $('confirmMessage').innerHTML = '<p class="mb-0">' + esc(pesan) + '</p>';
  const modal = bootstrap.Modal.getOrCreateInstance($('confirmModal'));
  const btn = $('confirmOkBtn');
  btn.onclick = function () { modal.hide(); aksi(); };
  modal.show();
}

/** Penangan kegagalan terpusat. Mengembalikan true bila sesi habis. */
function tanganiGagal(pesan, idWadah) {
  if (String(pesan).indexOf('SESSION_INVALID') !== -1) {
    keluarPaksa('Sesi berakhir, silakan masuk kembali.');
    return true;
  }
  showToast('Gagal', pesan, 'danger');
  if (idWadah) tampilkanGalat(idWadah, pesan);
  return false;
}

function keluarPaksa(pesan) {
  AppState.token = null; AppState.peran = null; AppState.nama = null;
  hapusLokal(KUNCI_TOKEN);
  sembunyikanNavigasi();
  renderLogin();
  if (pesan) showToast('Sesi Berakhir', pesan, 'warning');
}


// ════════════════════════════════════════════════════════
// BAGIAN 3: ROUTER SPA
// ════════════════════════════════════════════════════════

function navigateTo(halaman) {
  if (halaman !== 'login' && !AppState.token) { renderLogin(); return; }
  if (halaman === 'laporan' && AppState.peran !== 'Owner') {
    showToast('Akses Ditolak', 'Halaman Laporan hanya untuk Owner.', 'warning');
    return;
  }

  // Simpan draf sebelum meninggalkan formulir invoice
  if (AppState.halaman === 'buatInvoice' && halaman !== 'buatInvoice') simpanDraft();

  AppState.halaman = halaman;
  perbaruiNavAktif(halaman);
  window.scrollTo(0, 0);

  switch (halaman) {
    case 'login':          renderLogin();          break;
    case 'buatInvoice':    renderBuatInvoice();    break;
    case 'riwayatInvoice': renderRiwayatInvoice(); break;
    case 'pelanggan':      renderPelanggan();      break;
    case 'laporan':        renderLaporan();        break;
    case 'pengaturan':     renderPengaturan();     break;
    default:               renderRiwayatInvoice();
  }
}

function renderNavigasi(peran) {
  const menu = MENU[peran] || MENU.Tim;

  $('bottomNav').innerHTML = menu.map(function (m) {
    return '<button class="nav-btn" data-page="' + m.id + '" onclick="navigateTo(\'' + m.id + '\')">' +
      '<i class="bi ' + m.ikon + '"></i><span>' + m.label + '</span></button>';
  }).join('');

  $('topNav').innerHTML = menu.map(function (m) {
    return '<button class="nav-item-btn" data-page="' + m.id + '" onclick="navigateTo(\'' + m.id + '\')">' +
      m.label + '</button>';
  }).join('');

  $('appHeader').hidden = false;
  $('bottomNav').hidden = false;
}

function perbaruiNavAktif(halaman) {
  const els = document.querySelectorAll('.nav-btn, .nav-item-btn');
  for (let i = 0; i < els.length; i++) {
    els[i].classList.toggle('active', els[i].dataset.page === halaman);
  }
}

function sembunyikanNavigasi() {
  $('appHeader').hidden = true;
  $('bottomNav').hidden = true;
}


// ════════════════════════════════════════════════════════
// BAGIAN 4: MODE GELAP
// ════════════════════════════════════════════════════════

function toggleDarkMode() {
  const html = document.documentElement;
  const baru = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', baru);
  simpanLokal(KUNCI_TEMA, baru);
  $('themeBtn').innerHTML = baru === 'dark' ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
  perbaruiTemaChart();
}

function warnaTeksChart() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#94A3B8' : '#64748B';
}
function warnaGridChart() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#263349' : '#E2E8F0';
}

function perbaruiTemaChart() {
  Object.keys(AppState.chart).forEach(function (k) {
    const c = AppState.chart[k];
    if (!c || !c.options) return;
    if (c.options.scales) {
      Object.keys(c.options.scales).forEach(function (s) {
        if (c.options.scales[s].ticks) c.options.scales[s].ticks.color = warnaTeksChart();
        if (c.options.scales[s].grid)  c.options.scales[s].grid.color  = warnaGridChart();
      });
    }
    if (c.options.plugins && c.options.plugins.legend && c.options.plugins.legend.labels) {
      c.options.plugins.legend.labels.color = warnaTeksChart();
    }
    c.update();
  });
}


// ════════════════════════════════════════════════════════
// BAGIAN 5: LOGIN & SESI PERSISTEN
// ════════════════════════════════════════════════════════

function renderLogin() {
  AppState.halaman = 'login';
  sembunyikanNavigasi();
  $('app-container').innerHTML =
  '<div class="login-wrap"><div class="login-card">' +
    '<div class="login-strip">' +
      '<span style="background:var(--cmyk-cyan)"></span>' +
      '<span style="background:var(--cmyk-magenta)"></span>' +
      '<span style="background:var(--cmyk-yellow)"></span>' +
      '<span style="background:var(--cmyk-black)"></span>' +
    '</div>' +
    '<div class="p-4">' +
      '<div class="d-flex align-items-center gap-2 mb-1">' +
        '<div class="brand-mark"><span class="dot dot-c"></span><span class="dot dot-m"></span>' +
        '<span class="dot dot-y"></span><span class="dot dot-k"></span></div>' +
        '<div class="brand-name" style="font-size:18px;">InvoisKu</div>' +
      '</div>' +
      '<p class="text-muted-soft mb-4" style="font-size:12.5px;">' +
        'Cukup masuk sekali. Sesi tetap aktif sampai Anda menekan Keluar.</p>' +
      '<form id="formLogin" onsubmit="handleLogin(event)">' +
        '<div class="mb-3">' +
          '<label class="form-label" for="username">Username</label>' +
          '<div class="input-group">' +
            '<span class="input-group-text"><i class="bi bi-person"></i></span>' +
            '<input type="text" class="form-control" id="username" autocomplete="username">' +
          '</div>' +
        '</div>' +
        '<div class="mb-4">' +
          '<label class="form-label" for="password">Password</label>' +
          '<div class="input-group">' +
            '<span class="input-group-text"><i class="bi bi-lock"></i></span>' +
            '<input type="password" class="form-control" id="password" autocomplete="current-password">' +
            '<button class="btn btn-outline-key" type="button" onclick="lihatPassword()" ' +
              'aria-label="Tampilkan password"><i class="bi bi-eye" id="ikonMata"></i></button>' +
          '</div>' +
        '</div>' +
        '<button type="submit" class="btn btn-cyan w-100" id="btnLogin">' +
          '<i class="bi bi-box-arrow-in-right"></i> Masuk</button>' +
      '</form>' +
      '<div class="divider"></div>' +
      '<p class="text-muted-soft mb-0" style="font-size:11px;">' +
        'Akun bawaan: <b>owner / owner123</b> dan <b>tim / tim123</b>. ' +
        'Segera ganti password di menu Pengaturan.</p>' +
    '</div>' +
  '</div></div>';
  setTimeout(function () { const u = $('username'); if (u) u.focus(); }, 120);
}

function lihatPassword() {
  const i = $('password'), ikon = $('ikonMata');
  const tampil = i.type === 'password';
  i.type = tampil ? 'text' : 'password';
  ikon.className = tampil ? 'bi bi-eye-slash' : 'bi bi-eye';
}

function handleLogin(e) {
  e.preventDefault();
  const u = $('username').value.trim();
  const p = $('password').value;
  if (!u || !p) { showToast('Peringatan', 'Isi username dan password.', 'warning'); return; }

  const selesai = tombolSibuk($('btnLogin'), 'Memeriksa...');
  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) { showToast('Gagal Masuk', res.message, 'danger'); return; }
      AppState.token = res.data.token;
      AppState.peran = res.data.peran;
      AppState.nama  = res.data.nama;
      simpanLokal(KUNCI_TOKEN, res.data.token);   // ← sesi bertahan sampai Logout
      terapkanIdentitas();
      renderNavigasi(res.data.peran);
      muatDataAwal(res.data.halamanAwal, true);
    })
    .withFailureHandler(function (err) { selesai(); showToast('Error', err.message, 'danger'); })
    .doLogin(u, p);
}

/** Terapkan nama aplikasi ke header dan judul tab */
function terapkanIdentitasAplikasi() {
  const nama = AppState.config.appName || 'InvoisKu';
  $('brandName').textContent = nama;
  document.title = nama + ' — Invoice Generator';
  terapkanFavicon();
}

/**
 * Perbaikan: Favicon — otomatis memakai Logo Perusahaan (Pengaturan → Logo Perusahaan).
 * Kalau logo belum diunggah, tampilkan lencana inisial (gaya sama seperti di lembar invoice)
 * supaya tab browser tidak kosong. Dipanggil ulang setiap logo diunggah/diganti/dihapus,
 * sehingga favicon selalu mengikuti logo terbaru tanpa perlu reload manual.
 */
function terapkanFavicon() {
  const cfg = AppState.config || {};
  const el = $('appFavicon');
  if (!el) return;
  if (cfg.logoUrl) {
    el.href = cfg.logoUrl;
  } else {
    const inisial = String(cfg.namaPerusahaan || cfg.appName || 'IK').trim().substring(0, 2).toUpperCase();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
      '<circle cx="32" cy="32" r="32" fill="#00AEEF"/>' +
      '<text x="32" y="41" font-family="Arial, sans-serif" font-size="26" font-weight="700" ' +
      'fill="#FFFFFF" text-anchor="middle">' + inisial + '</text></svg>';
    el.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
}

function terapkanIdentitas() {
  $('userName').textContent = AppState.nama || '';
  $('userRole').textContent = AppState.peran || '';
  $('userInitial').textContent = String(AppState.nama || '?').trim().charAt(0).toUpperCase();
}

function muatDataAwal(halamanAwal, sambutan) {
  $('app-container').innerHTML = '<div class="pt-3">' + skeleton(3) + '</div>';
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) {
        if (String(res.message).indexOf('SESSION_INVALID') !== -1) { keluarPaksa(); return; }
        tampilkanGalat('app-container', res.message);
        return;
      }
      AppState.config          = res.data.config || {};
      AppState.satuanList      = res.data.satuanList || [];
      AppState.pelanggan       = res.data.pelanggan || [];
      AppState.nomorBerikutnya = res.data.nomorBerikutnya || '';
      AppState.nama            = res.data.user.nama;
      AppState.peran           = res.data.user.peran;

      terapkanIdentitasAplikasi();
      terapkanIdentitas();
      renderNavigasi(AppState.peran);
      AppState.draft = bacaLokal(KUNCI_DRAFT, true);

      if (sambutan) showToast('Selamat Datang', 'Halo, ' + AppState.nama + '!', 'success');
      navigateTo(halamanAwal || (AppState.peran === 'Owner' ? 'laporan' : 'riwayatInvoice'));
    })
    .withFailureHandler(function (err) {
      tampilkanGalat('app-container', 'Gagal memuat data awal: ' + err.message);
    })
    .getBootstrapData(AppState.token);
}

function handleLogout() {
  konfirmasi('Keluar dari aplikasi sekarang? Draf invoice yang belum disimpan akan dihapus.',
    function () {
      const token = AppState.token;
      AppState.token = null; AppState.peran = null; AppState.nama = null;
      AppState.draft = null; AppState.cacheInvoice = null;
      AppState.cacheLaporan = null; AppState.chart = {};
      hapusLokal(KUNCI_TOKEN);
      hapusLokal(KUNCI_DRAFT);
      google.script.run.doLogout(token);
      sembunyikanNavigasi();
      renderLogin();
      showToast('Sampai Jumpa', 'Anda telah keluar.', 'info');
    });
}


// ════════════════════════════════════════════════════════
// BAGIAN 6: DRAF FORMULIR (ANTI HILANG SAAT PINDAH MENU)
// ════════════════════════════════════════════════════════

function draftKosong() {
  return {
    editId: '', nomor: AppState.nomorBerikutnya,
    tanggal: tglInput(null),
    jatuhTempo: tglInput(tambahHari(new Date(), Number(AppState.config.termin || 14))),
    pelangganId: '',
    items: [{ desk: '', qty: 1, satuan: (AppState.satuanList[0] || 'Pcs'), harga: 0 }],
    diskonTipe: 'persen', diskonInput: 0,
    deposit: 0,
    pajakPersen: Number(AppState.config.pajakPersen || 11),
    catatan: ''
  };
}

/** Baca nilai formulir yang sedang tampil ke dalam AppState.draft */
function serapForm() {
  if (!$('invTanggal')) return;
  const d = AppState.draft || draftKosong();
  d.editId      = $('invID') ? $('invID').value : '';
  d.nomor       = $('invNomor').value;
  d.tanggal     = $('invTanggal').value;
  d.jatuhTempo  = $('invJatuhTempo').value;
  d.pelangganId = $('invPelanggan').value;
  d.diskonTipe  = $('invDiskonTipe').value;
  d.diskonInput = bacaNilaiDiskon();
  d.deposit     = keAngka($('invDeposit').value);
  d.pajakPersen = $('invPajak') ? Number($('invPajak').value) || 0 : 0;
  d.catatan     = $('invCatatan').value;
  AppState.draft = d;
}

function simpanDraft() {
  serapForm();
  const d = AppState.draft;
  if (!d) return;
  // Mode ubah tidak disimpan sebagai draf — supaya tidak tertukar dengan invoice baru
  if (d.editId) return;
  const adaIsi = d.pelangganId || d.catatan ||
    d.items.some(function (it) { return String(it.desk).trim() !== '' || Number(it.harga) > 0; });
  if (adaIsi) simpanLokal(KUNCI_DRAFT, d);
  else hapusLokal(KUNCI_DRAFT);
}

function hapusDraft() {
  AppState.draft = null;
  hapusLokal(KUNCI_DRAFT);
}

function buangDraftUI() {
  konfirmasi('Kosongkan formulir dan buang draf yang tersimpan?', function () {
    hapusDraft();
    renderBuatInvoice();
    showToast('Draf Dibuang', 'Formulir dikosongkan.', 'info');
  });
}


// ════════════════════════════════════════════════════════
// BAGIAN 7: HALAMAN BUAT INVOICE
// ════════════════════════════════════════════════════════

function renderBuatInvoice(dataEdit) {
  const cfg = AppState.config;
  const pajakAktif = String(cfg.pajakAktif || 'Tidak') === 'Ya';

  // Sumber isi form: data edit → draf tersimpan → form kosong
  let d;
  if (dataEdit) {
    d = {
      editId: dataEdit.ID, nomor: dataEdit.NoInvoice,
      tanggal: tglInput(dataEdit.Tanggal), jatuhTempo: tglInput(dataEdit.JatuhTempo),
      pelangganId: dataEdit.PelangganID,
      items: (dataEdit.items && dataEdit.items.length)
        ? dataEdit.items.slice() : [{ desk: '', qty: 1, satuan: AppState.satuanList[0] || 'Pcs', harga: 0 }],
      diskonTipe: dataEdit.DiskonTipe || 'persen',
      diskonInput: dataEdit.DiskonTipe === 'rp' ? dataEdit.DiskonNilai : dataEdit.DiskonPersen,
      deposit: dataEdit.Deposit, pajakPersen: dataEdit.PajakPersen,
      catatan: dataEdit.CatatanPembayaran
    };
  } else {
    d = AppState.draft || draftKosong();
    if (!d.nomor || d.nomor === '') d.nomor = AppState.nomorBerikutnya;
  }
  AppState.draft = d;
  const isEdit = !!d.editId;
  const adaDraf = !isEdit && !!bacaLokal(KUNCI_DRAFT, true);

  const opsiPelanggan = AppState.pelanggan.map(function (p) {
    return '<option value="' + esc(p.ID) + '"' + (d.pelangganId === p.ID ? ' selected' : '') + '>' +
      esc(p.Nama) + '</option>';
  }).join('');

  $('app-container').innerHTML =
  '<div class="page-head d-flex align-items-start justify-content-between flex-wrap gap-2">' +
    '<div><h1>' + (isEdit ? 'Ubah Faktur' : 'Formulir Faktur Penjualan') + '</h1>' +
      '<div class="sub">Nomor otomatis, kalkulasi berjalan langsung saat mengetik.</div></div>' +
    '<div class="d-flex align-items-center gap-2">' +
      (adaDraf ? '<span class="draft-note"><i class="bi bi-cloud-check"></i> Draf tersimpan</span>' : '') +
      (isEdit ? '<span class="badge-status badge-belum">MODE UBAH</span>'
              : '<button class="btn btn-ghost btn-sm" onclick="buangDraftUI()">' +
                '<i class="bi bi-eraser"></i> Form Baru</button>') +
    '</div>' +
  '</div>' +

  '<div class="row g-3">' +

    '<div class="col-lg-8">' +

      '<div class="card-x mb-3"><div class="card-x-head">' +
        '<h2><i class="bi bi-receipt text-cyan"></i> Informasi Faktur</h2></div>' +
        '<div class="card-x-body"><div class="row g-3">' +
          '<div class="col-12 col-md-4">' +
            '<label class="form-label" for="invNomor">Nomor Invoice</label>' +
            '<input type="text" class="form-control" id="invNomor" readonly value="' + esc(d.nomor) + '">' +
          '</div>' +
          '<div class="col-6 col-md-4">' +
            '<label class="form-label" for="invTanggal">Tanggal Terbit</label>' +
            '<input type="date" class="form-control" id="invTanggal" value="' + esc(d.tanggal) + '" ' +
              'onchange="hitungJatuhTempo();simpanDraft()">' +
          '</div>' +
          '<div class="col-6 col-md-4">' +
            '<label class="form-label" for="invJatuhTempo">Jatuh Tempo</label>' +
            '<input type="date" class="form-control" id="invJatuhTempo" value="' + esc(d.jatuhTempo) + '" ' +
              'onchange="simpanDraft()">' +
          '</div>' +
        '</div></div>' +
      '</div>' +

      '<div class="card-x mb-3"><div class="card-x-head">' +
        '<h2><i class="bi bi-person-badge text-cyan"></i> Informasi Pelanggan</h2>' +
        '<button type="button" class="btn btn-ghost btn-sm" onclick="bukaModalPelanggan()">' +
          '<i class="bi bi-plus-lg"></i> Pelanggan Baru</button></div>' +
        '<div class="card-x-body">' +
          '<label class="form-label" for="invPelanggan">Pilih Pelanggan Terdaftar <span class="req">*</span></label>' +
          '<select class="form-select" id="invPelanggan" onchange="tampilkanInfoPelanggan();simpanDraft()">' +
            '<option value="">— Pilih pelanggan —</option>' + opsiPelanggan + '</select>' +
          '<div id="infoPelanggan" class="mt-3"></div>' +
        '</div>' +
      '</div>' +

      '<div class="card-x mb-3"><div class="card-x-head">' +
        '<h2><i class="bi bi-list-columns text-cyan"></i> Rincian Produk &amp; Jasa</h2>' +
        '<div class="d-flex align-items-center gap-2">' +
          '<span class="text-muted-soft" style="font-size:11px;" id="jumlahItem"></span>' +
          '<button type="button" class="btn btn-ghost btn-sm" onclick="bukaModalSatuan()" ' +
            'title="Kelola kategori satuan"><i class="bi bi-tags"></i> Satuan</button>' +
        '</div></div>' +
        '<div class="card-x-body">' +
          '<div id="daftarItem"></div>' +
          '<button type="button" class="btn btn-ghost w-100" onclick="tambahItem()">' +
            '<i class="bi bi-plus-circle"></i> Tambah Baris Item</button>' +
        '</div>' +
      '</div>' +

      '<div class="card-x mb-3"><div class="card-x-head">' +
        '<h2><i class="bi bi-bank text-cyan"></i> Instruksi Pembayaran</h2></div>' +
        '<div class="card-x-body">' +
          '<div class="sum-row"><span>' + esc(cfg.bankNama || '-') + ' — ' + esc(cfg.bankRekening || '-') + '</span>' +
            '<span class="val" style="font-size:11px;">a.n. ' + esc(cfg.bankAtasNama || '-') + '</span></div>' +
          '<label class="form-label mt-2" for="invCatatan">Catatan Tambahan untuk Klien</label>' +
          '<textarea class="form-control" id="invCatatan" rows="2" oninput="simpanDraft()" ' +
            'placeholder="Contoh: cantumkan nomor faktur pada berita transfer.">' + esc(d.catatan || '') + '</textarea>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="col-lg-4">' +
      '<div style="position:sticky;top:76px;">' +
        '<div class="card-x mb-3"><div class="card-x-head">' +
          '<h2><i class="bi bi-calculator text-cyan"></i> Ringkasan Finansial</h2>' +
          '<span class="badge-status badge-lunas">IDR</span></div>' +
          '<div class="card-x-body">' +

            '<div class="sum-row"><span>Subtotal (<span id="ringkasJumlahItem">0</span> item)</span>' +
              '<span class="val" id="ringkasSubtotal">Rp 0</span></div>' +

            // Diskon: bisa % atau Rp
            '<label class="form-label mt-2" for="invDiskon">Diskon Khusus</label>' +
            '<div class="input-group input-group-sm mb-1">' +
              '<select class="form-select" id="invDiskonTipe" style="max-width:74px;" ' +
                'onchange="gantiTipeDiskon()">' +
                '<option value="persen"' + (d.diskonTipe === 'persen' ? ' selected' : '') + '>%</option>' +
                '<option value="rp"' + (d.diskonTipe === 'rp' ? ' selected' : '') + '>Rp</option>' +
              '</select>' +
              '<input type="text" inputmode="numeric" class="form-control text-end num" id="invDiskon" ' +
                'placeholder="0" value="' + nilaiDiskonAwal(d) + '" oninput="onInputDiskon(this)">' +
            '</div>' +
            '<div class="sum-row" id="barisDiskon" style="display:none;"><span>Nilai diskon</span>' +
              '<span class="val text-magenta" id="ringkasDiskon">- Rp 0</span></div>' +

            // Pajak: hanya muncul bila diaktifkan di Pengaturan
            (pajakAktif ?
              '<label class="form-label mt-2" for="invPajak">PPN (Pajak)</label>' +
              '<div class="input-group input-group-sm mb-1">' +
                '<input type="number" class="form-control text-end num" id="invPajak" min="0" max="100" step="0.1" ' +
                  'value="' + (Number(d.pajakPersen) || 0) + '" oninput="hitungTotal();simpanDraft()">' +
                '<span class="input-group-text">%</span></div>' +
              '<div class="sum-row" id="barisPajak" style="display:none;"><span>Nilai PPN</span>' +
                '<span class="val" id="ringkasPajak">Rp 0</span></div>'
              : '') +

            // Deposit / uang muka
            '<label class="form-label mt-2" for="invDeposit">Deposit / Uang Muka</label>' +
            '<div class="input-group input-group-sm mb-1">' +
              '<span class="input-group-text">Rp</span>' +
              '<input type="text" inputmode="numeric" class="form-control text-end num" id="invDeposit" ' +
                'value="' + (Number(d.deposit) ? rp(d.deposit) : '') + '" placeholder="0" ' +
                'oninput="onInputRupiah(this);hitungTotal();simpanDraft()">' +
            '</div>' +
            '<div class="sum-row" id="barisDeposit" style="display:none;"><span>Deposit diterima</span>' +
              '<span class="val" style="color:var(--paid-solid)" id="ringkasDeposit">- Rp 0</span></div>' +

            '<div class="total-box mt-3">' +
              '<div class="d-flex align-items-center justify-content-between">' +
                '<span class="label" id="labelTotal">TOTAL AKHIR TAGIHAN</span>' +
                '<i class="bi bi-patch-check-fill" style="color:var(--cmyk-yellow)"></i></div>' +
              '<div class="value mt-1" id="ringkasTotal">Rp 0</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="card-x"><div class="card-x-head">' +
          '<h2><i class="bi bi-lightning-charge text-cyan"></i> Aksi &amp; Penyimpanan</h2></div>' +
          '<div class="card-x-body d-grid gap-2">' +
            '<button type="button" class="btn btn-cyan" id="btnSimpanCetak" onclick="submitInvoice(\'cetak\')">' +
              '<i class="bi bi-printer"></i> Simpan &amp; Cetak JPG</button>' +
            '<button type="button" class="btn btn-outline-key" id="btnSimpanSaja" onclick="submitInvoice(\'simpan\')">' +
              '<i class="bi bi-save"></i> Simpan Saja</button>' +
            (isEdit ? '<input type="hidden" id="invID" value="' + esc(d.editId) + '">' : '') +
            '<p class="text-muted-soft mb-0 mt-1" style="font-size:11px;">' +
              '<i class="bi bi-shield-check"></i> Isian tersimpan otomatis sebagai draf — aman ' +
              'meski Anda berpindah menu.</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

  '</div>';

  gambarItem();
  tampilkanInfoPelanggan();
}

function gambarItem() {
  const items = AppState.draft.items;
  const satuan = AppState.satuanList.length ? AppState.satuanList : ['Pcs'];

  $('daftarItem').innerHTML = items.map(function (it, i) {
    const opsi = satuan.map(function (s) {
      return '<option' + (it.satuan === s ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
    const opsiLengkap = satuan.indexOf(it.satuan) === -1 && it.satuan
      ? '<option selected>' + esc(it.satuan) + '</option>' + opsi : opsi;

    return '<div class="item-row"><div class="row g-2 align-items-end">' +
      '<div class="col-12">' +
        '<label class="form-label" for="itDesk' + i + '">Deskripsi Produk / Jasa</label>' +
        '<input type="text" class="form-control" id="itDesk' + i + '" value="' + esc(it.desk) + '" ' +
          'placeholder="T-Shirt / Banner / Dll." oninput="ubahItem(' + i + ', \'desk\', this.value)">' +
      '</div>' +
      '<div class="col-4 col-md-2">' +
        '<label class="form-label" for="itQty' + i + '">Qty</label>' +
        '<input type="number" class="form-control num" id="itQty' + i + '" min="1" step="1" ' +
          'value="' + (Number(it.qty) || 1) + '" oninput="ubahItem(' + i + ', \'qty\', this.value)">' +
      '</div>' +
      '<div class="col-4 col-md-3">' +
        '<label class="form-label" for="itSat' + i + '">Satuan</label>' +
        '<select class="form-select" id="itSat' + i + '" onchange="ubahItem(' + i + ', \'satuan\', this.value)">' +
          opsiLengkap + '</select>' +
      '</div>' +
      '<div class="col-4 col-md-3">' +
        '<label class="form-label" for="itHarga' + i + '">Harga (Rp)</label>' +
        '<input type="text" inputmode="numeric" class="form-control num" id="itHarga' + i + '" ' +
          'value="' + (Number(it.harga) ? rp(it.harga) : '') + '" placeholder="0" ' +
          'oninput="onInputHargaItem(' + i + ', this)">' +
      '</div>' +
      '<div class="col-8 col-md-3 text-end">' +
        '<div class="form-label mb-1">Total Baris</div>' +
        '<div class="item-total" id="itTotal' + i + '">Rp ' +
          rp((Number(it.qty) || 0) * (Number(it.harga) || 0)) + '</div>' +
      '</div>' +
      '<div class="col-4 col-md-1 text-end">' +
        '<button type="button" class="btn-hapus-item" onclick="hapusItem(' + i + ')" ' +
          'aria-label="Hapus baris ' + (i + 1) + '"' + (items.length <= 1 ? ' disabled' : '') + '>' +
          '<i class="bi bi-trash3"></i></button>' +
      '</div>' +
    '</div></div>';
  }).join('');

  hitungTotal();
}

function tambahItem() {
  serapForm();
  AppState.draft.items.push({ desk: '', qty: 1, satuan: AppState.satuanList[0] || 'Pcs', harga: 0 });
  gambarItem();
  simpanDraft();
  setTimeout(function () {
    const el = $('itDesk' + (AppState.draft.items.length - 1));
    if (el) el.focus();
  }, 60);
}

function hapusItem(i) {
  if (AppState.draft.items.length <= 1) return;
  serapForm();
  AppState.draft.items.splice(i, 1);
  gambarItem();
  simpanDraft();
}

function ubahItem(i, kunci, nilai) {
  AppState.draft.items[i][kunci] = (kunci === 'qty') ? (Number(nilai) || 0) : nilai;

  // Perbaikan #5: harga & satuan otomatis untuk deskripsi tertentu (Polyfilm, HVS).
  // Produk/jasa lain tetap memakai harga manual seperti biasa.
  if (kunci === 'desk') {
    const cocok = HARGA_OTOMATIS_ITEM[String(nilai || '').trim().toLowerCase()];
    if (cocok) {
      AppState.draft.items[i].harga = cocok.harga;
      AppState.draft.items[i].satuan = cocok.satuan;
      const elHarga = $('itHarga' + i);
      if (elHarga) elHarga.value = rp(cocok.harga);
      const elSatuan = $('itSat' + i);
      if (elSatuan) elSatuan.value = cocok.satuan;
    }
  }

  perbaruiTotalBaris(i);
  hitungTotal();
  simpanDraftDitunda();
}

/** Harga: buang nol di depan, sisipkan titik setiap ribuan sambil mengetik */
function onInputHargaItem(i, el) {
  const angka = keAngka(el.value);
  AppState.draft.items[i].harga = angka;
  el.value = angka ? rp(angka) : '';
  perbaruiTotalBaris(i);
  hitungTotal();
  simpanDraftDitunda();
}

function onInputRupiah(el) {
  const angka = keAngka(el.value);
  el.value = angka ? rp(angka) : '';
}

/** Baca nilai diskon dari form: pecahan untuk %, bilangan bulat untuk Rp */
function bacaNilaiDiskon() {
  const el = $('invDiskon');
  if (!el) return 0;
  if ($('invDiskonTipe').value === 'rp') return keAngka(el.value);
  return parseFloat(el.value) || 0;
}

/** Kolom diskon dibiarkan kosong saat nilainya nol, bukan menampilkan "0" */
function nilaiDiskonAwal(d) {
  const n = Number(d.diskonInput) || 0;
  if (!n) return '';
  return d.diskonTipe === 'rp' ? rp(n) : String(n);
}

function onInputDiskon(el) {
  if ($('invDiskonTipe').value === 'rp') {
    const angka = keAngka(el.value);
    el.value = angka ? rp(angka) : '';
  } else {
    // Buang karakter non-angka, buang nol di depan, batasi 100
    let v = el.value.replace(/[^\d.]/g, '').replace(/^0+(?=\d)/, '');
    if (v === '0') v = '';
    if (Number(v) > 100) v = '100';
    el.value = v;
  }
  hitungTotal();
  simpanDraftDitunda();
}

function gantiTipeDiskon() {
  $('invDiskon').value = '';
  hitungTotal();
  simpanDraft();
}

function perbaruiTotalBaris(i) {
  const it = AppState.draft.items[i];
  const el = $('itTotal' + i);
  if (el) el.textContent = 'Rp ' + rp((Number(it.qty) || 0) * (Number(it.harga) || 0));
}

let timerDraft;
function simpanDraftDitunda() {
  clearTimeout(timerDraft);
  timerDraft = setTimeout(simpanDraft, 600);
}

/** Kalkulasi klien = umpan balik instan; server tetap menghitung ulang saat menyimpan */
function hitungTotal() {
  if (!$('ringkasSubtotal')) return;
  const items = AppState.draft.items;
  const terisi = items.filter(function (it) { return String(it.desk).trim() !== ''; });

  const subtotal = items.reduce(function (s, it) {
    return s + (Number(it.qty) || 0) * (Number(it.harga) || 0);
  }, 0);

  const tipe = $('invDiskonTipe').value;
  const inputDiskon = bacaNilaiDiskon();
  const diskonNilai = tipe === 'rp'
    ? Math.min(inputDiskon, subtotal)
    : Math.round(subtotal * Math.min(inputDiskon, 100) / 100);

  const dasar = subtotal - diskonNilai;
  const pp = $('invPajak') ? (Number($('invPajak').value) || 0) : 0;
  const pajakNilai = Math.round(dasar * pp / 100);
  const total = dasar + pajakNilai;
  const deposit = Math.min(keAngka($('invDeposit').value), total);
  const sisa = total - deposit;

  $('ringkasJumlahItem').textContent = terisi.length;
  $('jumlahItem').textContent = terisi.length + ' item ditambahkan';
  $('ringkasSubtotal').textContent = 'Rp ' + rp(subtotal);

  $('barisDiskon').style.display = diskonNilai ? 'flex' : 'none';
  $('ringkasDiskon').textContent = '- Rp ' + rp(diskonNilai);

  if ($('barisPajak')) {
    $('barisPajak').style.display = pajakNilai ? 'flex' : 'none';
    $('ringkasPajak').textContent = 'Rp ' + rp(pajakNilai);
  }

  $('barisDeposit').style.display = deposit ? 'flex' : 'none';
  $('ringkasDeposit').textContent = '- Rp ' + rp(deposit);

  $('labelTotal').textContent = deposit ? 'SISA TAGIHAN' : 'TOTAL AKHIR TAGIHAN';
  $('ringkasTotal').textContent = 'Rp ' + rp(sisa);
}

function hitungJatuhTempo() {
  const terbit = $('invTanggal').value;
  if (!terbit) return;
  $('invJatuhTempo').value = tglInput(tambahHari(terbit, Number(AppState.config.termin || 14)));
}

function tampilkanInfoPelanggan() {
  const wadah = $('infoPelanggan');
  if (!wadah) return;
  const id = $('invPelanggan').value;
  const p = AppState.pelanggan.filter(function (x) { return x.ID === id; })[0];
  if (!p) { wadah.innerHTML = ''; return; }

  // Urutan sesuai permintaan: Telepon → Alamat → Email
  wadah.innerHTML =
    '<div class="card-x" style="box-shadow:none;background:var(--surface-canvas);">' +
      '<div class="card-x-body py-2">' +
        '<div class="sum-row"><span><i class="bi bi-telephone"></i> Telepon</span>' +
          '<span class="val">' + esc(p.Telepon || '-') + '</span></div>' +
        '<div class="sum-row"><span><i class="bi bi-geo-alt"></i> Alamat</span>' +
          '<span class="val text-end" style="max-width:62%;">' + esc(p.Alamat || '-') + '</span></div>' +
        '<div class="sum-row"><span><i class="bi bi-envelope"></i> Email</span>' +
          '<span class="val">' + esc(p.Email || '-') + '</span></div>' +
      '</div></div>';
}

function submitInvoice(aksi) {
  serapForm();
  const d = AppState.draft;

  if (!d.pelangganId) { showToast('Peringatan', 'Pelanggan wajib dipilih.', 'warning'); $('invPelanggan').focus(); return; }
  if (!d.tanggal || !d.jatuhTempo) { showToast('Peringatan', 'Tanggal terbit dan jatuh tempo wajib diisi.', 'warning'); return; }
  const items = d.items.filter(function (it) { return String(it.desk).trim() !== ''; });
  if (!items.length) { showToast('Peringatan', 'Isi minimal satu baris item.', 'warning'); return; }

  const payload = {
    ID: d.editId || '', Tanggal: d.tanggal, JatuhTempo: d.jatuhTempo,
    PelangganID: d.pelangganId, items: items,
    DiskonTipe: d.diskonTipe, DiskonInput: d.diskonInput,
    PajakPersen: d.pajakPersen, Deposit: d.deposit,
    CatatanPembayaran: d.catatan
  };

  const btn = aksi === 'cetak' ? $('btnSimpanCetak') : $('btnSimpanSaja');
  const selesai = tombolSibuk(btn, 'Menyimpan...');

  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) { tanganiGagal(res.message); return; }
      showToast('Berhasil', res.message, 'success');

      // Bersihkan seluruh state formulir dan siapkan nomor faktur berikutnya
      hapusDraft();
      AppState.cacheInvoice  = null;   // paksa muat ulang Riwayat Invoice
      AppState.cacheLaporan  = null;   // angka laporan sudah berubah
      AppState.nomorBerikutnya = res.data.nomorBerikutnya || AppState.nomorBerikutnya;

      // Formulir kembali kosong seperti layar baru
      AppState.halaman = 'buatInvoice';
      perbaruiNavAktif('buatInvoice');
      renderBuatInvoice();

      if (aksi === 'cetak') bukaPratinjau(res.data.ID, true);
    })
    .withFailureHandler(function (err) { selesai(); showToast('Error', err.message, 'danger'); })
    .simpanInvoice(AppState.token, payload);
}


// ════════════════════════════════════════════════════════
// BAGIAN 8: KELOLA KATEGORI SATUAN
// ════════════════════════════════════════════════════════

function bukaModalSatuan() {
  gambarDaftarSatuan();
  bootstrap.Modal.getOrCreateInstance($('satuanModal')).show();
  setTimeout(function () { const el = $('satuanBaru'); if (el) el.focus(); }, 300);
}

function gambarDaftarSatuan() {
  const list = AppState.satuanList;
  $('daftarSatuan').innerHTML = list.length
    ? list.map(function (s, i) {
        return '<span class="satuan-tag">' + esc(s) +
          '<button type="button" onclick="hapusSatuan(' + i + ')" ' +
          'aria-label="Hapus satuan ' + esc(s) + '"><i class="bi bi-x"></i></button></span>';
      }).join('')
    : '<span class="text-muted-soft" style="font-size:12px;">Belum ada kategori.</span>';
}

function tambahSatuan() {
  const el = $('satuanBaru');
  const nilai = el.value.trim();
  if (!nilai) { showToast('Peringatan', 'Isi nama kategori dulu.', 'warning'); return; }
  if (AppState.satuanList.some(function (s) { return s.toLowerCase() === nilai.toLowerCase(); })) {
    showToast('Peringatan', 'Kategori "' + nilai + '" sudah ada.', 'warning'); return;
  }
  const baru = AppState.satuanList.concat([nilai]);
  simpanSatuanKeServer(baru, 'Kategori "' + nilai + '" ditambahkan.');
  el.value = '';
}

function hapusSatuan(i) {
  if (AppState.satuanList.length <= 1) {
    showToast('Peringatan', 'Minimal satu kategori harus tersisa.', 'warning'); return;
  }
  const nama = AppState.satuanList[i];
  const baru = AppState.satuanList.filter(function (_, idx) { return idx !== i; });
  simpanSatuanKeServer(baru, 'Kategori "' + nama + '" dihapus.');
}

function simpanSatuanKeServer(daftar, pesanSukses) {
  const sebelum = AppState.satuanList.slice();
  AppState.satuanList = daftar;   // perbarui tampilan lebih dulu (optimistik)
  gambarDaftarSatuan();

  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) {
        AppState.satuanList = sebelum;
        gambarDaftarSatuan();
        tanganiGagal(res.message);
        return;
      }
      AppState.satuanList = res.data;
      gambarDaftarSatuan();
      if (AppState.halaman === 'buatInvoice' && $('daftarItem')) gambarItem();
      showToast('Berhasil', pesanSukses, 'success');
    })
    .withFailureHandler(function (err) {
      AppState.satuanList = sebelum;
      gambarDaftarSatuan();
      showToast('Error', err.message, 'danger');
    })
    .simpanDaftarSatuan(AppState.token, daftar);
}


// ════════════════════════════════════════════════════════
// BAGIAN 9: HALAMAN RIWAYAT INVOICE
// ════════════════════════════════════════════════════════

function renderRiwayatInvoice() {
  $('app-container').innerHTML =
  '<div class="page-head d-flex align-items-start justify-content-between flex-wrap gap-2">' +
    '<div><h1>Riwayat Invoice</h1>' +
      '<div class="sub">Pantau transaksi, ubah status pelunasan, dan cetak ulang PDF.</div></div>' +
    '<button class="btn btn-key btn-sm" onclick="bukaGabungInvoice()">' +
      '<i class="bi bi-collection"></i> Gabung Invoice</button>' +
  '</div>' +

  '<div class="row g-2 mb-3" id="ringkasCepat"></div>' +

  '<div class="card-x mb-3"><div class="card-x-body">' +
    '<div class="input-group mb-2">' +
      '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
      '<input type="search" class="form-control" id="cariInvoice" ' +
        'placeholder="Cari no. invoice atau nama pelanggan..." ' +
        'value="' + esc(AppState.filter.keyword) + '" oninput="cariInvoiceDitunda()">' +
    '</div>' +
    '<div class="chip-row" id="chipStatus"></div>' +
  '</div></div>' +

  '<div id="listInvoice"></div>';

  gambarChipStatus();

  // Tampilkan cache lebih dulu agar terasa instan, lalu segarkan di latar
  if (AppState.cacheInvoice) {
    gambarRiwayat(AppState.cacheInvoice);
    muatRiwayat(true);
  } else {
    $('listInvoice').innerHTML = skeleton(3);
    muatRiwayat(false);
  }
}

function gambarChipStatus() {
  const opsi = [
    { id: 'Semua',       label: 'Semua',       kelas: '',           kunci: 'semua' },
    { id: 'Belum Lunas', label: 'Belum Lunas', kelas: 'chip-belum', kunci: 'belumLunas' },
    { id: 'Lunas',       label: 'Lunas',       kelas: 'chip-lunas', kunci: 'lunas' },
    { id: 'Jatuh Tempo', label: 'Jatuh Tempo', kelas: 'chip-over',  kunci: 'overdue' }
  ];
  $('chipStatus').innerHTML = opsi.map(function (o) {
    return '<button class="chip ' + o.kelas + (AppState.filter.status === o.id ? ' active' : '') + '" ' +
      'onclick="setFilterStatus(\'' + o.id + '\')">' + o.label +
      '<span id="hitung-' + o.kunci + '"></span></button>';
  }).join('');
}

function setFilterStatus(status) {
  AppState.filter.status = status;
  gambarChipStatus();
  $('listInvoice').innerHTML = skeleton(2);
  muatRiwayat(false);
}

let timerCari;
function cariInvoiceDitunda() {
  clearTimeout(timerCari);
  timerCari = setTimeout(function () {
    AppState.filter.keyword = $('cariInvoice').value;
    muatRiwayat(false);
  }, 400);
}

/** Satu panggilan server saja: daftar + hitungan chip + KPI */
function muatRiwayat(diamDiam) {
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) {
        if (!tanganiGagal(res.message) && !diamDiam) {
          tampilkanGalat('listInvoice', res.message, 'muatRiwayat(false)');
        }
        return;
      }
      AppState.cacheInvoice = res.data;
      gambarRiwayat(res.data);
    })
    .withFailureHandler(function (err) {
      if (!diamDiam) tampilkanGalat('listInvoice', 'Gagal memuat: ' + err.message, 'muatRiwayat(false)');
    })
    .getDaftarInvoice(AppState.token, AppState.filter);
}

function gambarRiwayat(data) {
  const wadahKpi = $('ringkasCepat');
  if (wadahKpi) {
    wadahKpi.innerHTML =
      kartuKpi('cyan', 'bi-receipt', 'Total Invoice', 'Rp ' + rpRingkas(data.ringkas.totalInvoice),
               data.ringkas.semua + ' dokumen tercatat') +
      kartuKpi('magenta', 'bi-calendar-x', 'Sisa Piutang', 'Rp ' + rpRingkas(data.ringkas.totalPiutang),
               data.ringkas.overdue + ' faktur jatuh tempo', true);
  }

  ['semua', 'belumLunas', 'lunas', 'overdue'].forEach(function (k) {
    const el = $('hitung-' + k);
    if (el) el.textContent = ' (' + data.ringkas[k] + ')';
  });

  const wadah = $('listInvoice');
  if (!wadah) return;

  if (!data.list.length) {
    wadah.innerHTML = '<div class="card-x"><div class="empty-state">' +
      '<i class="bi bi-inbox"></i>Belum ada invoice yang cocok dengan filter ini.' +
      '<div class="mt-3"><button class="btn btn-cyan btn-sm" onclick="navigateTo(\'buatInvoice\')">' +
      '<i class="bi bi-plus-lg"></i> Buat Invoice</button></div></div></div>';
    return;
  }

  const bolehHapus = AppState.peran === 'Owner';

  wadah.innerHTML = data.list.map(function (inv) {
    const st = kelasStatus(inv.StatusTampil);
    let tempo;
    if (inv.StatusTampil === 'Jatuh Tempo') {
      tempo = '<span class="text-magenta"><i class="bi bi-bell"></i> Terlambat ' +
              Math.abs(inv.SelisihHari) + ' hari</span>';
    } else if (inv.StatusTampil === 'Belum Lunas') {
      tempo = '<span style="color:var(--due-text)"><i class="bi bi-clock"></i> ' +
              (inv.SelisihHari === 0 ? 'Tempo hari ini' : 'Sisa ' + inv.SelisihHari + ' hari') + '</span>';
    } else {
      tempo = '<span style="color:var(--paid-text)"><i class="bi bi-check-circle"></i> Sudah dibayar</span>';
    }

    return '<div class="inv-card s-' + st + '">' +
      '<div class="d-flex justify-content-between align-items-start gap-2">' +
        '<div class="flex-grow-1">' +
          '<div class="d-flex align-items-center gap-2 flex-wrap">' +
            '<span class="inv-no">#' + esc(inv.NoInvoice) + '</span>' +
            '<span class="badge-status badge-' + st + '">' + esc(inv.StatusTampil) + '</span>' +
          '</div>' +
          '<div class="inv-nama">' + esc(inv.PelangganNama) + '</div>' +
          '<div class="inv-meta"><i class="bi bi-calendar3"></i> ' + esc(inv.TanggalTampil) +
            ' &nbsp;•&nbsp; Tempo: ' + esc(inv.JatuhTempoTampil) + '</div>' +
        '</div>' +
        '<div class="text-end">' +
          '<div class="inv-meta">Nominal Total</div>' +
          '<div class="inv-total' + (st === 'overdue' ? ' text-magenta' : '') + '">Rp ' + rp(inv.Total) + '</div>' +
          (inv.Dibayar > 0 && inv.Sisa > 0
            ? '<div class="inv-meta">Sisa Rp ' + rp(inv.Sisa) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-2">' +
        '<div class="inv-meta">' + tempo + '</div>' +
        '<div class="inv-actions">' +
          '<button class="btn btn-ghost btn-sm" onclick="ubahStatus(\'' + inv.ID + '\',\'' +
            (inv.Status === 'Lunas' ? 'Belum Lunas' : 'Lunas') + '\')">' +
            '<i class="bi bi-' + (inv.Status === 'Lunas' ? 'arrow-counterclockwise' : 'check2-circle') + '"></i> ' +
            (inv.Status === 'Lunas' ? 'Batal Lunas' : 'Tandai Lunas') + '</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="bukaPratinjau(\'' + inv.ID + '\')">' +
            '<i class="bi bi-eye"></i> View</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="editInvoice(\'' + inv.ID + '\')">' +
            '<i class="bi bi-pencil"></i> Ubah</button>' +
          '<button class="btn btn-key btn-sm" onclick="bukaPratinjau(\'' + inv.ID + '\')">' +
            '<i class="bi bi-image"></i> Cetak JPG</button>' +
          '<button class="btn btn-whatsapp btn-sm" onclick="bukaPratinjau(\'' + inv.ID + '\')">' +
            '<i class="bi bi-whatsapp"></i> Kirim WA</button>' +
          (bolehHapus ? '<button class="btn btn-ghost btn-sm text-magenta" onclick="hapusInvoiceUI(\'' +
            inv.ID + '\',\'' + esc(inv.NoInvoice) + '\')" aria-label="Hapus invoice">' +
            '<i class="bi bi-trash3"></i></button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') +
  (data.adaLagi
    ? '<p class="text-center text-muted-soft" style="font-size:12px;">' +
      'Menampilkan 60 dari ' + data.totalCocok + ' invoice. Gunakan pencarian untuk mempersempit.</p>'
    : '');
}

function kartuKpi(warna, ikon, label, nilai, catatan, magenta) {
  return '<div class="col-6 col-lg-3"><div class="kpi kpi-' + warna + '">' +
    '<div class="kpi-label"><span>' + label + '</span><i class="bi ' + ikon + '"></i></div>' +
    '<div class="kpi-value' + (magenta ? ' magenta' : '') + '">' + nilai + '</div>' +
    '<div class="kpi-foot">' + catatan + '</div></div></div>';
}

function ubahStatus(id, statusBaru) {
  konfirmasi(statusBaru === 'Lunas'
    ? 'Tandai invoice ini sebagai LUNAS?'
    : 'Kembalikan status invoice ini menjadi BELUM LUNAS?', function () {
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res.success) { tanganiGagal(res.message); return; }
        showToast('Berhasil', res.message, 'success');
        AppState.cacheInvoice = null;
        AppState.cacheLaporan = null;
        muatRiwayat(false);
      })
      .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
      .ubahStatusPembayaran(AppState.token, id, statusBaru, null);
  });
}

function editInvoice(id) {
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) { tanganiGagal(res.message); return; }
      AppState.halaman = 'buatInvoice';
      perbaruiNavAktif('buatInvoice');
      renderBuatInvoice(res.data);
    })
    .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
    .getDetailInvoice(AppState.token, id);
}

function hapusInvoiceUI(id, nomor) {
  konfirmasi('Hapus invoice ' + nomor + ' beserta arsip PDF-nya? Tindakan ini tidak bisa dibatalkan.',
    function () {
      google.script.run
        .withSuccessHandler(function (res) {
          if (!res.success) { tanganiGagal(res.message); return; }
          showToast('Terhapus', res.message, 'success');
          AppState.cacheInvoice = null;
          AppState.cacheLaporan = null;
          muatRiwayat(false);
        })
        .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
        .hapusInvoice(AppState.token, id);
    });
}


// ════════════════════════════════════════════════════════
// BAGIAN 10: PRATINJAU & CETAK PDF
// ════════════════════════════════════════════════════════

function bukaPratinjau(id, langsungCetak) {
  AppState.invoiceAktif = id;
  AppState.previewMode = 'single';
  AppState.gabunganAktif = null;
  const modal = bootstrap.Modal.getOrCreateInstance($('previewModal'));
  $('previewContent').innerHTML =
    '<div class="p-5 text-center"><div class="spinner-border text-cyan"></div>' +
    '<p class="mt-3 text-muted-soft">Menyusun lembar A4…</p></div>';
  $('previewDownloadBtn').classList.add('d-none');
  modal.show();

  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) {
        $('previewContent').innerHTML =
          '<div class="empty-state"><i class="bi bi-exclamation-triangle"></i>' + esc(res.message) + '</div>';
        tanganiGagal(res.message);
        return;
      }
      $('previewContent').innerHTML = res.data.html;
      if (langsungCetak) cetakDariPratinjau();
    })
    .withFailureHandler(function (err) {
      $('previewContent').innerHTML =
        '<div class="empty-state"><i class="bi bi-wifi-off"></i>' + esc(err.message) + '</div>';
    })
    .getPratinjauInvoice(AppState.token, id);
}


// ════════════════════════════════════════════════════════
// BAGIAN 10b: GABUNG INVOICE (TAGIHAN GABUNGAN)
// Tidak pernah membuat invoice baru — hanya menyusun beberapa invoice
// milik pelanggan yang sama menjadi satu lembar tagihan untuk penagihan.
// Invoice asli tetap tersimpan apa adanya di server.
// ════════════════════════════════════════════════════════

/** Langkah 1: deteksi pelanggan yang punya lebih dari satu invoice, lalu buka modal pemilihan. */
function bukaGabungInvoice() {
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) { tanganiGagal(res.message); return; }
      const semua = res.data.list;
      const kelompok = {};
      semua.forEach(function (inv) {
        const k = inv.PelangganID;
        if (!kelompok[k]) kelompok[k] = { id: k, nama: inv.PelangganNama, list: [] };
        kelompok[k].list.push(inv);
      });
      const kandidat = Object.keys(kelompok).map(function (k) { return kelompok[k]; })
        .filter(function (x) { return x.list.length > 1; })
        .sort(function (a, b) { return a.nama.localeCompare(b.nama); });

      if (!kandidat.length) {
        showToast('Info', 'Belum ada pelanggan dengan lebih dari satu invoice untuk digabungkan.', 'info');
        return;
      }

      AppState.gabungKandidat = kandidat;
      $('gabungPelanggan').innerHTML = kandidat.map(function (k) {
        return '<option value="' + esc(k.id) + '">' + esc(k.nama) + ' (' + k.list.length + ' invoice)</option>';
      }).join('');
      $('gabungError').classList.add('d-none');
      gambarDaftarInvoiceGabung();
      bootstrap.Modal.getOrCreateInstance($('gabungModal')).show();
    })
    .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
    .getDaftarInvoice(AppState.token, { keyword: '', status: 'Semua', batas: 9999 });
}

/** Langkah 2: tampilkan daftar invoice milik pelanggan yang dipilih, dengan checkbox. */
function gambarDaftarInvoiceGabung() {
  const id = $('gabungPelanggan').value;
  const kandidat = (AppState.gabungKandidat || []).filter(function (k) { return k.id === id; })[0];
  const wadah = $('gabungDaftarInvoice');
  if (!wadah) return;
  if (!kandidat) { wadah.innerHTML = ''; return; }

  wadah.innerHTML = '<div style="overflow-x:auto;"><table class="table-x" style="width:100%;">' +
    '<thead><tr><th style="width:32px;"></th><th>No. Invoice</th><th>Tanggal</th><th>Status</th><th class="num">Sisa Tagihan</th></tr></thead><tbody>' +
    kandidat.list.map(function (inv) {
      return '<tr>' +
        '<td><input type="checkbox" class="form-check-input gabung-chk" value="' + esc(inv.ID) + '"></td>' +
        '<td><b>' + esc(inv.NoInvoice) + '</b></td>' +
        '<td>' + esc(inv.TanggalTampil) + '</td>' +
        '<td><span class="badge-status badge-' + kelasStatus(inv.StatusTampil) + '">' + esc(inv.StatusTampil) + '</span></td>' +
        '<td class="num">Rp ' + rp(inv.Sisa) + '</td>' +
      '</tr>';
    }).join('') + '</tbody></table></div>';
}

/** Langkah 3: validasi pilihan, minta server menyusun HTML gabungan, lalu tampilkan di modal Pratinjau. */
function prosesPratinjauGabungan() {
  const dicentang = Array.prototype.slice.call(document.querySelectorAll('.gabung-chk:checked'));
  const ids = dicentang.map(function (el) { return el.value; });
  const kotakError = $('gabungError');

  if (ids.length < 2) {
    kotakError.textContent = 'Pilih minimal 2 invoice untuk digabungkan.';
    kotakError.classList.remove('d-none');
    return;
  }
  kotakError.classList.add('d-none');

  const selesai = tombolSibuk($('btnPratinjauGabung'), 'Menyusun...');
  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) {
        kotakError.textContent = res.message;
        kotakError.classList.remove('d-none');
        return;
      }
      bootstrap.Modal.getOrCreateInstance($('gabungModal')).hide();

      AppState.previewMode = 'gabungan';
      AppState.invoiceAktif = null;
      AppState.gabunganAktif = {
        ids: ids, pelanggan: res.data.pelanggan,
        total: res.data.totalGabungan, invoiceList: res.data.invoiceList, driveUrl: ''
      };

      $('previewContent').innerHTML = res.data.html;
      $('previewDownloadBtn').classList.add('d-none');
      bootstrap.Modal.getOrCreateInstance($('previewModal')).show();
    })
    .withFailureHandler(function (err) {
      selesai();
      kotakError.textContent = 'Gagal menghubungi server: ' + err.message;
      kotakError.classList.remove('d-none');
    })
    .getPratinjauGabungan(AppState.token, ids);
}

/**
 * Cetak langsung ke printer tanpa membuat file di Drive.
 * Isi lembar disalin ke #printArea; aturan @media print membuat hanya
 * elemen itu yang dikirim ke printer, jadi antarmuka aplikasi tidak ikut tercetak.
 */
function cetakKePrinter() {
  const isi = $('previewContent').innerHTML;
  if (!isi || isi.indexOf('spinner-border') !== -1) {
    showToast('Tunggu Sebentar', 'Lembar invoice masih disusun.', 'warning');
    return;
  }

  const area = $('printArea');
  area.innerHTML = isi;

  // Buang banner "tersimpan di Drive" bila ada, agar tidak ikut tercetak
  const banner = area.querySelector('div[style*="D1FAE5"]');
  if (banner) banner.remove();

  const bersihkan = function () {
    area.innerHTML = '';
    window.removeEventListener('afterprint', bersihkan);
  };
  window.addEventListener('afterprint', bersihkan);

  setTimeout(function () {
    try {
      window.print();
    } catch (e) {
      showToast('Gagal', 'Browser menolak perintah cetak: ' + e.message, 'danger');
      bersihkan();
    }
    // Jaring pengaman bila peristiwa afterprint tidak terpicu
    setTimeout(bersihkan, 3000);
  }, 120);
}

/**
 * Perbaikan #3: hasil cetak sekarang berupa JPG (bukan PDF), 1 lembar penuh.
 * Lembar A4 yang sedang tampil di pratinjau dirender ke kanvas (html2canvas),
 * lalu gambar JPG-nya diunggah ke Google Drive.
 * Berlaku untuk pratinjau invoice tunggal maupun pratinjau Gabung Invoice
 * (AppState.previewMode menentukan target penyimpanannya).
 */
function cetakDariPratinjau() {
  const mode = AppState.previewMode || 'single';
  if (mode === 'gabungan') {
    if (!AppState.gabunganAktif || !AppState.gabunganAktif.ids || !AppState.gabunganAktif.ids.length) return;
  } else if (!AppState.invoiceAktif) {
    return;
  }

  const wadah = $('previewContent');
  if (!wadah || !wadah.firstChild) return;
  if (typeof html2canvas === 'undefined') {
    showToast('Gagal', 'Modul pembuat gambar belum termuat. Muat ulang halaman lalu coba lagi.', 'danger');
    return;
  }

  const selesai = tombolSibuk($('previewPrintBtn'), 'Membuat JPG...');

  html2canvas(wadah, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    windowWidth: wadah.scrollWidth,
    height: wadah.scrollHeight,
    windowHeight: wadah.scrollHeight
  }).then(function (canvas) {
    const base64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];

    const sukses = function (res) {
      selesai();
      if (!res.success) { tanganiGagal(res.message); return; }
      showToast('JPG Siap', res.message, 'success');

      const btn = $('previewDownloadBtn');
      btn.href = res.data.downloadUrl;
      btn.setAttribute('download', res.data.fileName);
      btn.classList.remove('d-none');

      $('previewContent').insertAdjacentHTML('afterbegin',
        '<div class="p-2" style="background:#D1FAE5;color:#065F46;font-size:12px;' +
        'font-weight:600;text-align:center;"><i class="bi bi-cloud-check"></i> ' +
        'Tersimpan di Google Drive: ' + esc(res.data.fileName) + '</div>');

      if (mode === 'gabungan') {
        AppState.gabunganAktif.driveUrl = res.data.openUrl;
      } else {
        AppState.cacheInvoice = null;
        if (AppState.halaman === 'riwayatInvoice') muatRiwayat(true);
      }
    };
    const gagal = function (err) { selesai(); showToast('Error', err.message, 'danger'); };

    if (mode === 'gabungan') {
      const namaPel = (AppState.gabunganAktif.pelanggan && AppState.gabunganAktif.pelanggan.Nama) || '';
      google.script.run.withSuccessHandler(sukses).withFailureHandler(gagal)
        .simpanGambarGabunganInvoice(AppState.token, base64, namaPel);
    } else {
      google.script.run.withSuccessHandler(sukses).withFailureHandler(gagal)
        .simpanGambarInvoice(AppState.token, AppState.invoiceAktif, base64);
    }
  }).catch(function (err) {
    selesai();
    showToast('Gagal', 'Gagal membuat gambar JPG: ' + err.message, 'danger');
  });
}

/**
 * Perbaikan #2: kirim invoice ke WhatsApp pelanggan.
 * Hanya bisa dipanggil dari dalam modal Pratinjau (invoice tunggal atau Gabung Invoice
 * harus sudah terbuka pratinjaunya), sehingga pengguna sudah melihat pratinjau lengkap
 * sebelum invoice/tagihan gabungan benar-benar dikirim.
 */
function kirimInvoiceWA() {
  if ((AppState.previewMode || 'single') === 'gabungan') {
    kirimGabunganWA();
    return;
  }

  if (!AppState.invoiceAktif) {
    showToast('Peringatan', 'Buka pratinjau invoice terlebih dahulu sebelum mengirim ke WhatsApp.', 'warning');
    return;
  }
  const id = AppState.invoiceAktif;
  const selesai = tombolSibuk($('btnKirimWA'), 'Menyiapkan...');

  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) { tanganiGagal(res.message); return; }
      const d = res.data;
      const pel = d.pelanggan || {};

      let telp = String(pel.Telepon || '').replace(/[^\d+]/g, '');
      if (!telp) {
        showToast('Peringatan',
          'Nomor WhatsApp pelanggan belum diisi. Lengkapi dulu di menu Pelanggan.', 'warning');
        return;
      }
      telp = telp.replace(/^\+/, '');
      if (telp.charAt(0) === '0') telp = '62' + telp.slice(1);
      else if (telp.indexOf('62') !== 0) telp = '62' + telp;

      const sisa = Math.max((Number(d.Total) || 0) - (Number(d.Dibayar) || 0), 0);
      const sudahLunas = String(d.Status) === 'Lunas';
      const cfg = AppState.config || {};

      const rincian = (d.items || []).map(function (it) {
        return '• ' + it.desk + ' — ' + it.qty + ' ' + (it.satuan || '') +
          ' × Rp' + rp(it.harga);
      }).join('\n');

      let pesan = 'Halo Kak ' + (pel.Nama || d.PelangganNama) + ' 👋\n\n' +
        'Berikut invoice dari ' + (cfg.namaPerusahaan || cfg.appName || 'InvoisKu') + ':\n' +
        '🧾 Invoice: ' + d.NoInvoice + '\n' +
        '📅 Terbit: ' + d.TanggalTampil + '\n\n' +
        'Rincian:\n' + rincian + '\n' +
        (sudahLunas
          ? '💵 Total Tagihan: Rp' + rp(d.Total) + ' (LUNAS)\n'
          : '💵 Total Tagihan: Rp' + rp(sisa) + '\n') +
        (d.PdfUrl ? '\nLihat/unduh invoice: ' + d.PdfUrl + '\n' : '') +
        '\nPembayaran dapat ditransfer ke:\n' +
        (cfg.bankNama || '-') + ' — An. ' + (cfg.bankAtasNama || '-') + '\n' +
        'Rek: ' + (cfg.bankRekening || '-') + '\n\n' +
        'Terima kasih sudah berbelanja! :)';

      window.open('https://wa.me/' + telp + '?text=' + encodeURIComponent(pesan), '_blank');
    })
    .withFailureHandler(function (err) { selesai(); showToast('Error', err.message, 'danger'); })
    .getDetailInvoice(AppState.token, id);
}

/** Kirim tagihan gabungan (Gabung Invoice) ke WhatsApp — dipanggil dari dalam pratinjau. */
function kirimGabunganWA() {
  const g = AppState.gabunganAktif;
  if (!g || !g.ids || !g.ids.length) {
    showToast('Peringatan', 'Buka pratinjau gabungan terlebih dahulu sebelum mengirim ke WhatsApp.', 'warning');
    return;
  }
  const pel = g.pelanggan || {};
  let telp = String(pel.Telepon || '').replace(/[^\d+]/g, '');
  if (!telp) {
    showToast('Peringatan', 'Nomor WhatsApp pelanggan belum diisi. Lengkapi dulu di menu Pelanggan.', 'warning');
    return;
  }
  telp = telp.replace(/^\+/, '');
  if (telp.charAt(0) === '0') telp = '62' + telp.slice(1);
  else if (telp.indexOf('62') !== 0) telp = '62' + telp;

  const daftarNomor = (g.invoiceList || []).map(function (x) { return x.NoInvoice; }).join(', ');
  const jumlah = (g.invoiceList && g.invoiceList.length) || g.ids.length;

  const pesan = 'Halo ' + (pel.Nama || '') + ',\n\n' +
    'Berikut tagihan gabungan dari ' + jumlah + ' invoice (' + daftarNomor + ').\n' +
    'Total Tagihan Gabungan: Rp ' + rp(g.total || 0) + '\n' +
    (g.driveUrl ? '\nLihat/unduh tagihan: ' + g.driveUrl + '\n' : '') +
    '\nTerima kasih atas kepercayaan Anda menggunakan layanan kami.';

  window.open('https://wa.me/' + telp + '?text=' + encodeURIComponent(pesan), '_blank');
}


// ════════════════════════════════════════════════════════
// BAGIAN 11: HALAMAN PELANGGAN
// ════════════════════════════════════════════════════════

function renderPelanggan() {
  $('app-container').innerHTML =
  '<div class="page-head d-flex align-items-start justify-content-between flex-wrap gap-2">' +
    '<div><h1>Pelanggan</h1><div class="sub">Data klien yang terhubung otomatis ke formulir invoice.</div></div>' +
    '<button class="btn btn-cyan btn-sm" onclick="bukaModalPelanggan()">' +
      '<i class="bi bi-person-plus"></i> Tambah Pelanggan</button>' +
  '</div>' +

  '<div class="card-x mb-3"><div class="card-x-body">' +
    '<div class="input-group">' +
      '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
      '<input type="search" class="form-control" id="cariPelanggan" ' +
        'placeholder="Cari nama, telepon, alamat, email..." oninput="cariPelangganDitunda()">' +
    '</div>' +
  '</div></div>' +

  '<div id="listPelanggan"></div>';

  // Tampilkan data yang sudah ada di memori supaya tidak terasa menggantung
  if (AppState.pelanggan.length) gambarPelanggan(AppState.pelanggan);
  else $('listPelanggan').innerHTML = skeleton(3);

  muatPelanggan();
}

let timerCariPel;
function cariPelangganDitunda() {
  clearTimeout(timerCariPel);
  timerCariPel = setTimeout(muatPelanggan, 400);
}

function muatPelanggan() {
  const kata = $('cariPelanggan') ? $('cariPelanggan').value : '';

  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) {
        if (!tanganiGagal(res.message)) {
          tampilkanGalat('listPelanggan', res.message, 'muatPelanggan()');
        }
        return;
      }
      if (!kata) AppState.pelanggan = res.data;   // segarkan cache dropdown invoice
      gambarPelanggan(res.data);
    })
    .withFailureHandler(function (err) {
      tampilkanGalat('listPelanggan', 'Gagal memuat pelanggan: ' + err.message, 'muatPelanggan()');
    })
    .getPelanggan(AppState.token, kata);
}

function gambarPelanggan(list) {
  const wadah = $('listPelanggan');
  if (!wadah) return;

  if (!list || !list.length) {
    wadah.innerHTML = '<div class="card-x"><div class="empty-state">' +
      '<i class="bi bi-people"></i>Belum ada data pelanggan.' +
      '<div class="mt-3"><button class="btn btn-cyan btn-sm" onclick="bukaModalPelanggan()">' +
      '<i class="bi bi-person-plus"></i> Tambah Pelanggan</button></div></div></div>';
    return;
  }

  const bolehHapus = AppState.peran === 'Owner';

  wadah.innerHTML = list.map(function (p) {
    return '<div class="inv-card" style="--inv-accent:var(--cmyk-cyan)">' +
      '<div class="d-flex justify-content-between align-items-start gap-2">' +
        '<div>' +
          '<div class="inv-nama">' + esc(p.Nama) + '</div>' +
          '<div class="inv-meta mt-1"><i class="bi bi-telephone"></i> ' + esc(p.Telepon || '-') + '</div>' +
          '<div class="inv-meta"><i class="bi bi-geo-alt"></i> ' + esc(p.Alamat || '-') + '</div>' +
          '<div class="inv-meta"><i class="bi bi-envelope"></i> ' + esc(p.Email || '-') + '</div>' +
        '</div>' +
        '<div class="d-flex flex-column gap-1">' +
          '<button class="btn btn-ghost btn-sm" onclick="editPelanggan(\'' + esc(p.ID) + '\')">' +
            '<i class="bi bi-pencil"></i> Ubah</button>' +
          (bolehHapus ? '<button class="btn btn-ghost btn-sm text-magenta" onclick="hapusPelangganUI(\'' +
            esc(p.ID) + '\',\'' + esc(p.Nama).replace(/'/g, '') + '\')">' +
            '<i class="bi bi-trash3"></i> Hapus</button>' : '') +
        '</div>' +
      '</div></div>';
  }).join('');
}

/** Ambil data dari daftar yang sedang tampil (menghindari JSON di atribut HTML) */
function editPelanggan(id) {
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) { tanganiGagal(res.message); return; }
      const p = res.data.filter(function (x) { return x.ID === id; })[0];
      if (!p) { showToast('Gagal', 'Data pelanggan tidak ditemukan.', 'danger'); return; }
      bukaModalPelanggan(p);
    })
    .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
    .getPelanggan(AppState.token, '');
}

function bukaModalPelanggan(data) {
  $('pelID').value      = data ? data.ID : '';
  $('pelNama').value    = data ? (data.Nama || '') : '';
  $('pelTelepon').value = data ? (data.Telepon || '') : '';
  $('pelAlamat').value  = data ? (data.Alamat || '') : '';
  $('pelEmail').value   = data ? (data.Email || '') : '';
  $('pelCatatan').value = data ? (data.Catatan || '') : '';
  $('pelNama').classList.remove('is-invalid');
  $('pelError').classList.add('d-none');
  $('pelangganModalLabel').innerHTML = data
    ? '<i class="bi bi-pencil text-cyan"></i> Ubah Pelanggan'
    : '<i class="bi bi-person-plus text-cyan"></i> Pelanggan Baru';

  bootstrap.Modal.getOrCreateInstance($('pelangganModal')).show();
  setTimeout(function () { $('pelNama').focus(); }, 300);
}

function submitPelanggan() {
  const nama = $('pelNama').value.trim();
  const kotakError = $('pelError');

  if (!nama) {
    $('pelNama').classList.add('is-invalid');
    kotakError.textContent = 'Nama pelanggan wajib diisi.';
    kotakError.classList.remove('d-none');
    $('pelNama').focus();
    return;
  }
  $('pelNama').classList.remove('is-invalid');
  kotakError.classList.add('d-none');

  const payload = {
    ID: $('pelID').value,
    Nama: nama,
    Telepon: $('pelTelepon').value.trim(),
    Alamat: $('pelAlamat').value.trim(),
    Email: $('pelEmail').value.trim(),
    Catatan: $('pelCatatan').value.trim()
  };

  const selesai = tombolSibuk($('btnSimpanPelanggan'), 'Menyimpan...');

  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) {
        // Galat ditampilkan DI DALAM modal supaya jelas kenapa gagal
        kotakError.textContent = res.message;
        kotakError.classList.remove('d-none');
        if (String(res.message).indexOf('SESSION_INVALID') !== -1) keluarPaksa();
        return;
      }
      bootstrap.Modal.getOrCreateInstance($('pelangganModal')).hide();
      showToast('Berhasil', res.message, 'success');
      segarkanPelanggan(res.data.ID);
    })
    .withFailureHandler(function (err) {
      selesai();
      kotakError.textContent = 'Gagal menghubungi server: ' + err.message;
      kotakError.classList.remove('d-none');
    })
    .simpanPelanggan(AppState.token, payload);
}

/** Muat ulang cache pelanggan, lalu perbarui halaman yang sedang terbuka */
function segarkanPelanggan(pilihId) {
  google.script.run
    .withSuccessHandler(function (res) {
      if (!res.success) return;
      AppState.pelanggan = res.data;
      if (AppState.halaman === 'pelanggan') gambarPelanggan(res.data);
      if (AppState.halaman === 'buatInvoice') segarkanDropdownPelanggan(pilihId);
    })
    .withFailureHandler(function () {})
    .getPelanggan(AppState.token, '');
}

function segarkanDropdownPelanggan(pilihId) {
  const sel = $('invPelanggan');
  if (!sel) return;
  const sebelumnya = sel.value;
  sel.innerHTML = '<option value="">— Pilih pelanggan —</option>' +
    AppState.pelanggan.map(function (p) {
      return '<option value="' + esc(p.ID) + '">' + esc(p.Nama) + '</option>';
    }).join('');
  sel.value = pilihId || sebelumnya;
  tampilkanInfoPelanggan();
  simpanDraft();
}

function hapusPelangganUI(id, nama) {
  konfirmasi('Hapus pelanggan "' + nama + '"?', function () {
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res.success) { tanganiGagal(res.message); return; }
        showToast('Terhapus', res.message, 'success');
        segarkanPelanggan();
      })
      .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
      .hapusPelanggan(AppState.token, id);
  });
}


// ════════════════════════════════════════════════════════
// BAGIAN 12: HALAMAN LAPORAN (KHUSUS OWNER)
// ════════════════════════════════════════════════════════

function renderLaporan() {
  $('app-container').innerHTML =
  '<div class="page-head d-flex align-items-start justify-content-between flex-wrap gap-2">' +
    '<div><h1>Laporan Penjualan &amp; Piutang</h1>' +
      '<div class="sub">Ringkasan performa penagihan 12 bulan terakhir.</div></div>' +
    '<button class="btn btn-ghost btn-sm" id="btnSegarkanLaporan" onclick="muatLaporan(false)">' +
      '<i class="bi bi-arrow-clockwise"></i> Segarkan</button>' +
  '</div>' +
  '<div id="isiLaporan"></div>';

  // Tampilkan hasil terakhir dulu supaya halaman langsung terisi,
  // lalu ambil data terbaru diam-diam di latar belakang.
  if (AppState.cacheLaporan) {
    gambarLaporan(AppState.cacheLaporan);
    muatLaporan(true);
  } else {
    $('isiLaporan').innerHTML = skeleton(4);
    muatLaporan(false);
  }
}

function muatLaporan(diamDiam) {
  const selesai = diamDiam ? function () {} : tombolSibuk($('btnSegarkanLaporan'), 'Memuat...');

  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) {
        if (!tanganiGagal(res.message) && !diamDiam) {
          tampilkanGalat('isiLaporan', res.message, 'muatLaporan(false)');
        }
        return;
      }
      AppState.cacheLaporan = res.data;
      gambarLaporan(res.data);
    })
    .withFailureHandler(function (err) {
      selesai();
      if (!diamDiam) {
        tampilkanGalat('isiLaporan', 'Gagal memuat laporan: ' + err.message, 'muatLaporan(false)');
      }
    })
    .getLaporanData(AppState.token);
}

function gambarLaporan(d) {
  const wadah = $('isiLaporan');
  if (!wadah) return;

  wadah.innerHTML =
  '<div class="row g-2 mb-3">' +
    kartuKpi('cyan', 'bi-receipt', 'Total Invoice', 'Rp ' + rpRingkas(d.kpi.totalInvoice),
             d.kpi.jumlahInvoice + ' dokumen aktif') +
    kartuKpi('magenta', 'bi-calendar-x', 'Total Piutang', 'Rp ' + rpRingkas(d.kpi.totalPiutang),
             'Overdue: Rp ' + rpRingkas(d.kpi.nilaiOverdue), true) +
    kartuKpi('green', 'bi-cash-stack', 'Kas Masuk', 'Rp ' + rpRingkas(d.kpi.totalDibayar),
             'Collection rate ' + d.kpi.rasioTertagih + '%') +
    kartuKpi('yellow', 'bi-bell', 'Perlu Ditagih', d.kpi.jumlahOverdue + ' faktur',
             'Melewati tanggal jatuh tempo') +
  '</div>' +

  '<div class="row g-3 mb-3">' +
    '<div class="col-lg-8"><div class="card-x h-100"><div class="card-x-head">' +
      '<h2>Tren Omzet vs Realisasi Kas</h2>' +
      '<span class="text-muted-soft" style="font-size:11px;">12 bulan terakhir</span></div>' +
      '<div class="card-x-body"><canvas id="chartTren" height="230"></canvas></div></div></div>' +
    '<div class="col-lg-4"><div class="card-x h-100"><div class="card-x-head">' +
      '<h2>Status Pembayaran</h2></div>' +
      '<div class="card-x-body"><canvas id="chartStatus" height="210"></canvas></div></div></div>' +
  '</div>' +

  '<div class="insight mb-3"><h3><i class="bi bi-lightbulb"></i> Analisis Otomatis</h3><ul>' +
    d.insights.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></div>' +

  '<div class="row g-3">' +
    '<div class="col-lg-7"><div class="card-x"><div class="card-x-head">' +
      '<h2>Analisis Umur Piutang</h2>' +
      '<span class="text-muted-soft" style="font-size:11px;">' + d.aging.length + ' tagihan aktif</span></div>' +
      '<div class="card-x-body p-0" style="overflow-x:auto;">' +
        (d.aging.length
          ? '<table class="table-x"><thead><tr><th>Pelanggan</th><th>Jatuh Tempo</th>' +
            '<th>Umur</th><th class="num">Nominal</th></tr></thead><tbody>' +
            d.aging.map(function (a) {
              const kelas = a.lewat > 30 ? 'badge-overdue' : a.lewat > 0 ? 'badge-belum' : 'badge-lunas';
              return '<tr onclick="bukaPratinjau(\'' + a.ID + '\')" style="cursor:pointer">' +
                '<td><b>' + esc(a.PelangganNama) + '</b><div class="inv-meta">#' + esc(a.NoInvoice) + '</div></td>' +
                '<td>' + esc(a.JatuhTempoTampil) + '</td>' +
                '<td><span class="badge-status ' + kelas + '">' + esc(a.bucket) + '</span></td>' +
                '<td class="num">Rp ' + rp(a.Sisa) + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<div class="empty-state"><i class="bi bi-emoji-smile"></i>Tidak ada piutang berjalan.</div>') +
      '</div></div></div>' +

    '<div class="col-lg-5"><div class="card-x"><div class="card-x-head">' +
      '<h2>Top 5 Pelanggan</h2></div><div class="card-x-body">' +
      (d.topPelanggan.length
        ? d.topPelanggan.map(function (p, i) {
            const persen = p.total ? Math.round(p.lunas / p.total * 100) : 0;
            return '<div class="mb-3">' +
              '<div class="d-flex justify-content-between align-items-center">' +
                '<div><b>' + (i + 1) + '. ' + esc(p.nama) + '</b>' +
                  '<div class="inv-meta">' + p.jumlah + ' invoice</div></div>' +
                '<div class="text-end"><div class="money" style="font-weight:700">Rp ' + rpRingkas(p.total) + '</div>' +
                  '<div class="inv-meta">' + persen + '% lunas</div></div>' +
              '</div>' +
              '<div style="height:6px;background:var(--surface-subtle);border-radius:999px;margin-top:6px;overflow:hidden;">' +
                '<div style="height:100%;width:' + persen + '%;background:var(--cmyk-cyan);"></div></div></div>';
          }).join('')
        : '<div class="empty-state"><i class="bi bi-people"></i>Belum ada data.</div>') +
    '</div></div></div>' +
  '</div>';

  gambarChartTren(d.chart);
  gambarChartStatus(d.distribusi);
}

function gambarChartTren(c) {
  const ctx = $('chartTren');
  if (!ctx || typeof Chart === 'undefined') return;
  if (AppState.chart.tren) AppState.chart.tren.destroy();

  AppState.chart.tren = new Chart(ctx, {
    type: 'bar',
    data: { labels: c.labels, datasets: [
      { label: 'Invoice Terbit', data: c.terbit, backgroundColor: '#00AEEF', borderRadius: 3 },
      { label: 'Kas Masuk',      data: c.masuk,  backgroundColor: '#111827', borderRadius: 3 }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: warnaTeksChart(), boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: function (t) { return t.dataset.label + ': Rp ' + rp(t.parsed.y); } } }
      },
      scales: {
        x: { ticks: { color: warnaTeksChart(), font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: warnaTeksChart(), font: { size: 10 },
                      callback: function (v) { return rpRingkas(v); } },
             grid: { color: warnaGridChart() } }
      }
    }
  });
}

function gambarChartStatus(dist) {
  const ctx = $('chartStatus');
  if (!ctx || typeof Chart === 'undefined') return;
  if (AppState.chart.status) AppState.chart.status.destroy();

  AppState.chart.status = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['Lunas', 'Belum Lunas', 'Jatuh Tempo'], datasets: [{
      data: [dist['Lunas'] || 0, dist['Belum Lunas'] || 0, dist['Jatuh Tempo'] || 0],
      backgroundColor: ['#10B981', '#FACC15', '#EC008C'], borderWidth: 0
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'bottom',
                  labels: { color: warnaTeksChart(), boxWidth: 10, padding: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: function (t) { return t.label + ': Rp ' + rp(t.parsed); } } }
      }
    }
  });
}


// ════════════════════════════════════════════════════════
// BAGIAN 13: HALAMAN PENGATURAN
// ════════════════════════════════════════════════════════

function renderPengaturan() {
  const c = AppState.config;
  const isOwner = AppState.peran === 'Owner';
  const pajakAktif = String(c.pajakAktif || 'Tidak') === 'Ya';

  $('app-container').innerHTML =
  '<div class="page-head"><h1>Pengaturan</h1>' +
    '<div class="sub">Identitas perusahaan, pajak, logo, dan akun pengguna.</div></div>' +

  (isOwner ?
  '<div class="card-x mb-3"><div class="card-x-head">' +
    '<h2><i class="bi bi-building text-cyan"></i> Identitas Perusahaan</h2></div>' +
    '<div class="card-x-body"><div class="row g-3">' +
      inputTeks('setNamaPerusahaan', 'Nama Perusahaan', c.namaPerusahaan, 'col-md-6') +
      inputTeks('setTagline', 'Tagline', c.taglinePerusahaan, 'col-md-6') +
      inputTeks('setAlamat', 'Alamat', c.alamatPerusahaan, 'col-12') +
      inputTeks('setTelp', 'Telepon', c.telpPerusahaan, 'col-md-6') +
      inputTeks('setEmail', 'Email', c.emailPerusahaan, 'col-md-6') +
      inputTeks('setBankNama', 'Nama Bank', c.bankNama, 'col-md-4') +
      inputTeks('setBankRek', 'No. Rekening', c.bankRekening, 'col-md-4') +
      inputTeks('setBankAn', 'Atas Nama', c.bankAtasNama, 'col-md-4') +
      inputTeks('setTermin', 'Termin Default (hari)', c.termin, 'col-md-6', 'number') +
      '<div class="col-md-6">' +
        '<label class="form-label" for="setPajak">PPN Default (%)</label>' +
        '<input type="number" class="form-control" id="setPajak" min="0" max="100" step="0.1" ' +
          'value="' + esc(c.pajakPersen || 11) + '"></div>' +
      '<div class="col-12">' +
        '<div class="form-check form-switch">' +
          '<input class="form-check-input" type="checkbox" id="setPajakAktif"' +
            (pajakAktif ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="setPajakAktif" style="font-size:13px;">' +
            'Tampilkan kolom PPN di Ringkasan Finansial &amp; lembar PDF</label>' +
        '</div>' +
        '<div class="inv-meta mt-1">Bila dimatikan, invoice baru dibuat tanpa PPN sama sekali.</div>' +
      '</div>' +
    '</div>' +
    '<button type="button" class="btn btn-cyan mt-3" id="btnSimpanSet" onclick="submitPengaturan()">' +
      '<i class="bi bi-check-lg"></i> Simpan Pengaturan</button>' +
    '</div>' +
  '</div>' +

  '<div class="card-x mb-3"><div class="card-x-head">' +
    '<h2><i class="bi bi-app-indicator text-cyan"></i> Identitas Aplikasi</h2></div>' +
    '<div class="card-x-body">' +

      '<div class="row g-3 align-items-end mb-3">' +
        '<div class="col-md-8">' +
          '<label class="form-label" for="setAppName">Nama Aplikasi</label>' +
          '<input type="text" class="form-control" id="setAppName" maxlength="30" ' +
            'value="' + esc(c.appName || 'InvoisKu') + '" placeholder="InvoisKu">' +
          '<div class="inv-meta mt-1">Tampil di header aplikasi, judul tab, dan catatan kaki PDF.</div>' +
        '</div>' +
        '<div class="col-md-4">' +
          '<button class="btn btn-cyan w-100" id="btnSimpanNamaApp" onclick="simpanNamaAplikasi()">' +
            '<i class="bi bi-check-lg"></i> Simpan Nama</button>' +
        '</div>' +
      '</div>' +

      '<div class="divider"></div>' +

      '<label class="form-label">Logo Perusahaan</label>' +
      '<div class="d-flex align-items-center gap-3 flex-wrap">' +
        (c.logoUrl
          ? '<img src="' + esc(c.logoUrl) + '" alt="Logo perusahaan" ' +
            'style="height:56px;border:1px solid var(--border-subtle);border-radius:4px;padding:4px;background:#fff">'
          : '<div class="empty-state p-3 m-0"><i class="bi bi-image"></i>Belum ada logo</div>') +
        '<div class="flex-grow-1" style="min-width:220px">' +
          '<input type="file" class="form-control" id="fileLogo" accept="image/png,image/jpeg,image/webp">' +
          '<div class="inv-meta mt-1">PNG/JPG, maksimal 2 MB. Tampil di setiap lembar PDF.</div></div>' +
        '<div class="d-flex gap-2">' +
          '<button class="btn btn-key" onclick="unggahLogoUI()" id="btnUnggahLogo">' +
            '<i class="bi bi-upload"></i> Ganti Logo</button>' +
          (c.logoUrl ? '<button class="btn btn-ghost text-magenta" onclick="hapusLogoUI()" ' +
            'aria-label="Hapus logo"><i class="bi bi-trash3"></i></button>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>' +

  '<div class="card-x mb-3"><div class="card-x-head">' +
    '<h2><i class="bi bi-tags text-cyan"></i> Kategori Satuan</h2>' +
    '<button class="btn btn-ghost btn-sm" onclick="bukaModalSatuan()">' +
      '<i class="bi bi-pencil"></i> Kelola</button></div>' +
    '<div class="card-x-body"><div class="satuan-wrap" id="pratinjauSatuan"></div></div>' +
  '</div>' +

  '<div class="card-x mb-3"><div class="card-x-head">' +
    '<h2><i class="bi bi-people text-cyan"></i> Akun Pengguna</h2>' +
    '<button class="btn btn-ghost btn-sm" onclick="formPengguna()">' +
      '<i class="bi bi-person-plus"></i> Tambah</button></div>' +
    '<div class="card-x-body p-0" id="listPengguna">' + skeleton(2) + '</div>' +
  '</div>' : '') +

  '<div class="card-x"><div class="card-x-head">' +
    '<h2><i class="bi bi-key text-cyan"></i> Ganti Password Saya</h2></div>' +
    '<div class="card-x-body"><div class="row g-3">' +
      '<div class="col-md-6"><label class="form-label" for="pwLama">Password Lama</label>' +
        '<input type="password" class="form-control" id="pwLama"></div>' +
      '<div class="col-md-6"><label class="form-label" for="pwBaru">Password Baru</label>' +
        '<input type="password" class="form-control" id="pwBaru" minlength="5"></div>' +
    '</div>' +
    '<button type="button" class="btn btn-outline-key mt-3" id="btnGantiPw" onclick="submitGantiPassword()">' +
      '<i class="bi bi-shield-lock"></i> Ganti Password</button>' +
    '</div>' +
  '</div>';

  if (isOwner) {
    $('pratinjauSatuan').innerHTML = AppState.satuanList.map(function (s) {
      return '<span class="satuan-tag" style="padding-right:.7rem">' + esc(s) + '</span>';
    }).join('');
    muatPengguna();
  }
}

function inputTeks(id, label, nilai, kolom, tipe) {
  return '<div class="' + kolom + '">' +
    '<label class="form-label" for="' + id + '">' + label + '</label>' +
    '<input type="' + (tipe || 'text') + '" class="form-control" id="' + id + '" value="' +
      esc(nilai === undefined || nilai === null ? '' : nilai) + '"></div>';
}

function submitPengaturan() {
  const payload = {
    namaPerusahaan: $('setNamaPerusahaan').value.trim(),
    taglinePerusahaan: $('setTagline').value.trim(),
    alamatPerusahaan: $('setAlamat').value.trim(),
    telpPerusahaan: $('setTelp').value.trim(),
    emailPerusahaan: $('setEmail').value.trim(),
    bankNama: $('setBankNama').value.trim(),
    bankRekening: $('setBankRek').value.trim(),
    bankAtasNama: $('setBankAn').value.trim(),
    termin: $('setTermin').value,
    pajakPersen: $('setPajak').value,
    pajakAktif: $('setPajakAktif').checked ? 'Ya' : 'Tidak'
  };

  const selesai = tombolSibuk($('btnSimpanSet'), 'Menyimpan...');
  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) { tanganiGagal(res.message); return; }
      AppState.config = res.data;
      showToast('Berhasil', res.message, 'success');
    })
    .withFailureHandler(function (err) { selesai(); showToast('Error', err.message, 'danger'); })
    .simpanPengaturan(AppState.token, payload);
}

/** Ganti nama aplikasi — langsung terlihat di header dan judul tab */
function simpanNamaAplikasi() {
  const nama = $('setAppName').value.trim();
  if (!nama) { showToast('Peringatan', 'Nama aplikasi tidak boleh kosong.', 'warning'); return; }

  const selesai = tombolSibuk($('btnSimpanNamaApp'), 'Menyimpan...');
  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) { tanganiGagal(res.message); return; }
      AppState.config = res.data;
      terapkanIdentitasAplikasi();
      showToast('Berhasil', 'Nama aplikasi diubah menjadi "' + nama + '".', 'success');
    })
    .withFailureHandler(function (err) { selesai(); showToast('Error', err.message, 'danger'); })
    .simpanPengaturan(AppState.token, { appName: nama });
}

function hapusLogoUI() {
  konfirmasi('Hapus logo perusahaan? Lembar PDF akan kembali memakai inisial nama.', function () {
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res.success) { tanganiGagal(res.message); return; }
        AppState.config = res.data;
        terapkanFavicon();
        showToast('Berhasil', 'Logo dihapus.', 'success');
        renderPengaturan();
      })
      .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
      .simpanPengaturan(AppState.token, { logoUrl: '' });
  });
}

function unggahLogoUI() {
  const input = $('fileLogo');
  const file = input.files[0];
  if (!file) { showToast('Peringatan', 'Pilih berkas logo terlebih dahulu.', 'warning'); return; }
  if (file.size > 2 * 1024 * 1024) { showToast('Peringatan', 'Ukuran maksimal 2 MB.', 'warning'); return; }

  const selesai = tombolSibuk($('btnUnggahLogo'), 'Mengunggah...');
  const reader = new FileReader();
  reader.onload = function () {
    const base64 = String(reader.result).split(',')[1];
    google.script.run
      .withSuccessHandler(function (res) {
        selesai();
        if (!res.success) { tanganiGagal(res.message); return; }
        AppState.config.logoUrl = res.data.logoUrl;
        terapkanFavicon();
        showToast('Berhasil', res.message, 'success');
        renderPengaturan();
      })
      .withFailureHandler(function (err) { selesai(); showToast('Error', err.message, 'danger'); })
      .unggahLogo(AppState.token, base64, file.name, file.type);
  };
  reader.onerror = function () { selesai(); showToast('Error', 'Gagal membaca berkas.', 'danger'); };
  reader.readAsDataURL(file);
}

function muatPengguna() {
  google.script.run
    .withSuccessHandler(function (res) {
      const wadah = $('listPengguna');
      if (!wadah) return;
      if (!res.success) {
        wadah.innerHTML = '<div class="empty-state">' + esc(res.message) + '</div>';
        return;
      }
      AppState.cachePengguna = res.data;
      wadah.innerHTML = '<table class="table-x"><thead><tr>' +
        '<th>Nama</th><th>Username</th><th>Peran</th><th></th></tr></thead><tbody>' +
        res.data.map(function (u) {
          return '<tr><td><b>' + esc(u.Nama) + '</b></td><td>' + esc(u.Username) + '</td>' +
            '<td><span class="badge-status ' + (u.Peran === 'Owner' ? 'badge-lunas' : 'badge-belum') + '">' +
              esc(u.Peran) + '</span></td>' +
            '<td class="text-end">' +
              '<button class="btn btn-ghost btn-sm" onclick="formPengguna(\'' + esc(u.ID) + '\')">' +
                '<i class="bi bi-pencil"></i></button> ' +
              '<button class="btn btn-ghost btn-sm text-magenta" onclick="hapusPenggunaUI(\'' +
                esc(u.ID) + '\',\'' + esc(u.Nama).replace(/'/g, '') + '\')">' +
                '<i class="bi bi-trash3"></i></button></td></tr>';
        }).join('') + '</tbody></table>';
    })
    .withFailureHandler(function () {
      const wadah = $('listPengguna');
      if (wadah) wadah.innerHTML = '<div class="empty-state">Gagal memuat daftar pengguna.</div>';
    })
    .getPengguna(AppState.token);
}

function formPengguna(id) {
  const u = id && AppState.cachePengguna
    ? AppState.cachePengguna.filter(function (x) { return x.ID === id; })[0] : null;
  const isEdit = !!u;

  $('confirmMessage').innerHTML =
    '<div class="mb-2"><label class="form-label" for="pgNama">Nama</label>' +
      '<input class="form-control" id="pgNama" value="' + esc(isEdit ? u.Nama : '') + '"></div>' +
    '<div class="mb-2"><label class="form-label" for="pgUsername">Username</label>' +
      '<input class="form-control" id="pgUsername" value="' + esc(isEdit ? u.Username : '') + '"></div>' +
    '<div class="mb-2"><label class="form-label" for="pgPassword">Password' +
      (isEdit ? ' (kosongkan bila tidak diubah)' : '') + '</label>' +
      '<input type="password" class="form-control" id="pgPassword"></div>' +
    '<div><label class="form-label" for="pgPeran">Peran</label>' +
      '<select class="form-select" id="pgPeran">' +
        '<option value="Owner"' + (isEdit && u.Peran === 'Owner' ? ' selected' : '') + '>Owner</option>' +
        '<option value="Tim"' + (!isEdit || u.Peran === 'Tim' ? ' selected' : '') + '>Tim</option>' +
      '</select></div>';

  const modal = bootstrap.Modal.getOrCreateInstance($('confirmModal'));
  $('confirmModalLabel').textContent = isEdit ? 'Ubah Pengguna' : 'Pengguna Baru';
  const btn = $('confirmOkBtn');
  btn.className = 'btn btn-cyan';
  btn.textContent = 'Simpan';
  btn.onclick = function () {
    const payload = {
      ID: isEdit ? u.ID : '', Nama: $('pgNama').value.trim(),
      Username: $('pgUsername').value.trim(), Password: $('pgPassword').value,
      Peran: $('pgPeran').value, Aktif: 'Ya'
    };
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res.success) { tanganiGagal(res.message); return; }
        modal.hide();
        showToast('Berhasil', res.message, 'success');
        muatPengguna();
      })
      .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
      .simpanPengguna(AppState.token, payload);
  };
  modal.show();
}

function hapusPenggunaUI(id, nama) {
  konfirmasi('Hapus akun "' + nama + '"?', function () {
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res.success) { tanganiGagal(res.message); return; }
        showToast('Terhapus', res.message, 'success');
        muatPengguna();
      })
      .withFailureHandler(function (err) { showToast('Error', err.message, 'danger'); })
      .hapusPengguna(AppState.token, id);
  });
}

function submitGantiPassword() {
  const lama = $('pwLama').value, baru = $('pwBaru').value;
  if (!lama || !baru) { showToast('Peringatan', 'Isi kedua kolom password.', 'warning'); return; }
  if (baru.length < 5) { showToast('Peringatan', 'Password baru minimal 5 karakter.', 'warning'); return; }

  const selesai = tombolSibuk($('btnGantiPw'), 'Memproses...');
  google.script.run
    .withSuccessHandler(function (res) {
      selesai();
      if (!res.success) { tanganiGagal(res.message); return; }
      $('pwLama').value = ''; $('pwBaru').value = '';
      showToast('Berhasil', res.message, 'success');
    })
    .withFailureHandler(function (err) { selesai(); showToast('Error', err.message, 'danger'); })
    .gantiPasswordSendiri(AppState.token, lama, baru);
}


// ════════════════════════════════════════════════════════
// BAGIAN 14: INISIALISASI
// ════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
  // Tema tersimpan
  const tema = bacaLokal(KUNCI_TEMA) || 'light';
  document.documentElement.setAttribute('data-theme', tema);
  $('themeBtn').innerHTML = tema === 'dark' ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';

  // Kembalikan modal konfirmasi ke bentuk semula setiap kali ditutup
  $('confirmModal').addEventListener('hidden.bs.modal', function () {
    $('confirmModalLabel').textContent = 'Konfirmasi';
    const btn = $('confirmOkBtn');
    btn.className = 'btn btn-magenta';
    btn.textContent = 'Ya, Lanjutkan';
    btn.onclick = null;
    $('confirmMessage').innerHTML = '';
  });

  // Enter pada kolom satuan = tambah
  $('satuanBaru').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); tambahSatuan(); }
  });

  // Simpan draf sebelum tab ditutup / disembunyikan
  window.addEventListener('beforeunload', function () {
    if (AppState.halaman === 'buatInvoice') simpanDraft();
  });

  // Sesi persisten: bila token tersimpan, langsung masuk tanpa login ulang
  const tokenTersimpan = bacaLokal(KUNCI_TOKEN);
  if (tokenTersimpan) {
    AppState.token = tokenTersimpan;
    $('loadingText').textContent = 'Memulihkan sesi…';
    muatDataAwal(null, false);
  } else {
    renderLogin();
  }

  const overlay = $('loadingOverlay');
  overlay.style.opacity = '0';
  setTimeout(function () { overlay.style.display = 'none'; }, 300);
});