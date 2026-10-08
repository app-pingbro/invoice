/**
 * ============================================================
 * InvoisKu v3.2 — Menu CRM & WhatsApp (frontend)
 * ------------------------------------------------------------
 * Satu menu "CRM" dengan 4 tab:
 *   Kontak        → Owner & Tim (Tim: lihat, tag, catat interaksi)
 *   Blast WA      → Owner
 *   Antrean       → Owner
 *   Pengaturan WA → Owner (saklar, token Fonnte, template)
 * Semua hak akses juga dicek ulang di server.
 * File ini berdiri sendiri; app.js hanya menambah menu & rute 'crm'.
 * ============================================================
 */

const CRM = {
  tab: 'kontak',
  filter: { cari: '', segmen: '', tag: '', statusWA: '', masalah: '', optOut: '', halaman: 1 },
  data: null,          // hasil getCrmKontak terakhir
  dataWaktu: 0,
  dipilih: {},         // { kontakId: true }
  detail: null,
  audiens: null,       // hasil getAudiensBlast
  blastAktif: null,    // id blast yang sedang dipantau
  otomatisTimer: null,
  otomatisSisa: 0,
  config: null
};

function crmOwner() { return AppState.peran === 'Owner'; }

/** Panggil API dengan pola yang sama seperti app.js. */
function crmApi(aksi, args, ok, opsi) {
  opsi = opsi || {};
  const runner = google.script.run
    .withSuccessHandler(function (res) {
      if (opsi.selesai) opsi.selesai();
      if (!res || !res.success) {
        if (opsi.gagal) opsi.gagal();
        if (!tanganiGagal(res ? res.message : 'Tidak ada balasan server.') && opsi.wadah) {
          tampilkanGalat(opsi.wadah, res ? res.message : 'Gagal', opsi.ulang);
        }
        return;
      }
      ok(res);
    })
    .withFailureHandler(function (err) {
      if (opsi.selesai) opsi.selesai();
      if (opsi.gagal) opsi.gagal();
      showToast('Gagal', err.message, 'danger');
      if (opsi.wadah) tampilkanGalat(opsi.wadah, err.message, opsi.ulang);
    });
  runner[aksi].apply(null, [AppState.token].concat(args || []));
}

function crmWaktu(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return d.getDate() + ' ' + bulan[d.getMonth()] + ' ' + d.getFullYear() + ' ' +
    ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
function crmTanggal(iso) { return iso ? crmWaktu(iso).replace(/ \d\d:\d\d$/, '') : '-'; }

function crmLinkWA(no) {
  const n = String(no || '').replace(/[^\d]/g, '');
  if (!n) return '';
  return 'https://wa.me/' + (n.charAt(0) === '0' ? '62' + n.slice(1) : n);
}

function badgeWA(k) {
  if (!k.WAValid) return '<span class="wa-badge wa-kosong" title="Nomor kosong / tidak valid"><i class="bi bi-dash-circle"></i> tanpa WA</span>';
  if (k.StatusWA === 'Terdaftar') return '<span class="wa-badge wa-ya"><i class="bi bi-whatsapp"></i> WA</span>';
  if (k.StatusWA === 'Tidak Terdaftar') return '<span class="wa-badge wa-tidak"><i class="bi bi-x-circle"></i> bukan WA</span>';
  return '<span class="wa-badge wa-belum"><i class="bi bi-question-circle"></i> belum dicek</span>';
}

// ════════════════════════════════════════════════════════
// HALAMAN & TAB
// ════════════════════════════════════════════════════════

function renderCrm(tab) {
  if (tab) CRM.tab = tab;
  if (!crmOwner() && CRM.tab !== 'kontak') CRM.tab = 'kontak';
  pastikanModalCrm();
  const tabs = [
    { id: 'kontak', label: 'Kontak', ikon: 'bi-person-lines-fill' }
  ].concat(crmOwner() ? [
    { id: 'blast', label: 'Blast WA', ikon: 'bi-megaphone' },
    { id: 'antrean', label: 'Antrean', ikon: 'bi-send' },
    { id: 'pengaturan', label: 'Pengaturan WA', ikon: 'bi-gear' }
  ] : []);

  $('app-container').innerHTML =
    '<div class="page-head d-flex align-items-start justify-content-between flex-wrap gap-2">' +
      '<div><h1>CRM</h1><div class="sub">Kontak pelanggan &amp; prospek, riwayat order, follow-up, dan WhatsApp.</div></div>' +
    '</div>' +
    '<div class="chip-row crm-tabs mb-3" role="tablist">' +
      tabs.map(function (t) {
        return '<button class="chip' + (CRM.tab === t.id ? ' active' : '') + '" role="tab" ' +
          'onclick="renderCrm(\'' + t.id + '\')"><i class="bi ' + t.ikon + '"></i> ' + t.label + '</button>';
      }).join('') +
    '</div>' +
    '<div id="crmIsi"></div>';

  if (CRM.otomatisTimer && CRM.tab !== 'blast') hentikanOtomatis();
  if (CRM.tab === 'kontak') renderKontak();
  else if (CRM.tab === 'blast') renderBlast();
  else if (CRM.tab === 'antrean') renderAntrean();
  else renderPengaturanWA();
}

// ════════════════════════════════════════════════════════
// TAB KONTAK
// ════════════════════════════════════════════════════════

function renderKontak() {
  const f = CRM.filter;
  $('crmIsi').innerHTML =
    '<div class="row g-2 mb-3" id="crmKpi"></div>' +
    '<div class="card-x mb-3"><div class="card-x-body">' +
      '<div class="d-flex flex-wrap gap-2 align-items-center mb-2">' +
        '<div class="input-group crm-cari">' +
          '<span class="input-group-text"><i class="bi bi-search"></i></span>' +
          '<input type="search" class="form-control" id="crmCari" placeholder="Cari nama, nomor, email, tag..." ' +
            'value="' + esc(f.cari) + '" oninput="crmCariDitunda()">' +
        '</div>' +
        '<select class="form-select crm-sel" id="crmTag" onchange="crmSetFilter(\'tag\', this.value)"><option value="">Semua tag</option></select>' +
        '<select class="form-select crm-sel" id="crmStatusWA" onchange="crmSetFilter(\'statusWA\', this.value)">' +
          '<option value="">Status WA: semua</option><option value="Terdaftar">Terdaftar WA</option>' +
          '<option value="Tidak Terdaftar">Bukan WA</option><option value="belum">Belum dicek</option></select>' +
      '</div>' +
      '<div class="chip-row" id="crmSegmen"></div>' +
      '<div class="d-flex flex-wrap gap-2 mt-2">' +
        '<button class="btn btn-ghost btn-sm" onclick="crmSinkron(this)"><i class="bi bi-arrow-repeat"></i> Sinkron dari Pelanggan</button>' +
        (crmOwner() ?
          '<button class="btn btn-cyan btn-sm" onclick="bukaFormProspek()"><i class="bi bi-person-plus"></i> Tambah Prospek</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="bukaImportCsv()"><i class="bi bi-upload"></i> Import CSV</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="eksporKontakCsv(this)"><i class="bi bi-download"></i> Ekspor CSV</button>' : '') +
        '<span class="crm-sinkron ms-auto" id="crmSinkronInfo"></span>' +
      '</div>' +
    '</div></div>' +
    '<div id="crmBulk"></div>' +
    '<div id="crmList"></div>' +
    '<div id="crmHalaman" class="d-flex justify-content-center gap-2 my-3"></div>';
  $('crmStatusWA').value = f.statusWA;

  if (CRM.data) gambarKontak(CRM.data);
  else $('crmList').innerHTML = skeleton(4);
  if (!CRM.data || Date.now() - CRM.dataWaktu > CACHE_TTL_MS || CRM.data._kotor) muatKontak();
}

let timerCariCrm;
function crmCariDitunda() {
  clearTimeout(timerCariCrm);
  timerCariCrm = setTimeout(function () { crmSetFilter('cari', $('crmCari').value.trim()); }, 350);
}

function crmSetFilter(k, v) {
  CRM.filter[k] = v;
  if (k !== 'halaman') CRM.filter.halaman = 1;
  muatKontak();
}

function crmFilterBawaan() {
  const f = CRM.filter;
  return !f.cari && !f.segmen && !f.tag && !f.statusWA && !f.masalah && !f.optOut && (f.halaman || 1) === 1;
}

// ─── v3.2.2: data CRM disiapkan di latar & disimpan di browser (tanpa loading) ──
function crmResetCache() {
  CRM.data = null; CRM.dataWaktu = 0; CRM.config = null; CRM.daftarBlast = null; CRM.antrean = null;
  CRM.dipilih = {}; CRM.audiens = null; hentikanOtomatis();
}

function crmPulihkanCache() {
  if (typeof bacaCacheInstan !== 'function') return;
  if (crmFilterBawaan()) CRM.data = bacaCacheInstan('crm') || CRM.data;   // dataWaktu 0 → tetap disegarkan saat dibuka
  if (crmOwner()) {
    CRM.config = bacaCacheInstan('crmConfig') || CRM.config;
    CRM.daftarBlast = bacaCacheInstan('crmBlast') || CRM.daftarBlast;
  }
}

/** Dipanggil prefetchLatar() di app.js setelah masuk. Tidak menggambar apa pun bila menu CRM tidak sedang dibuka. */
function crmPrefetch() {
  if (!CRM.data || Date.now() - CRM.dataWaktu > CACHE_TTL_MS) {
    if (crmFilterBawaan()) muatKontak();
  }
  if (!crmOwner()) return;
  setTimeout(function () {
    crmApi('getNotifConfig', [], function (res) { CRM.config = res.data; simpanCacheInstan('crmConfig', res.data); });
  }, 600);
  setTimeout(function () {
    crmApi('getDaftarBlast', [], function (res) { CRM.daftarBlast = res.data; simpanCacheInstan('crmBlast', res.data); });
  }, 1200);
  setTimeout(function () {
    crmApi('getAntrianNotif', [{ status: '' }], function (res) { if (!CRM.antrean) CRM.antrean = { f: '', d: res.data }; });
  }, 1800);
}

function muatKontak() {
  crmApi('getCrmKontak', [CRM.filter], function (res) {
    CRM.data = res.data; CRM.dataWaktu = Date.now();
    if (crmFilterBawaan() && typeof simpanCacheInstan === 'function') simpanCacheInstan('crm', res.data);
    if (AppState.halaman === 'crm' && res.data.sinkron && (res.data.sinkron.ditambah || res.data.sinkron.diperbarui)) {
      showToast('CRM', 'Sinkron otomatis: ' + res.data.sinkron.ditambah + ' kontak baru, ' + res.data.sinkron.diperbarui + ' diperbarui.', 'info');
    }
    if (AppState.halaman === 'crm' && CRM.tab === 'kontak') gambarKontak(res.data);
  }, { wadah: 'crmList', ulang: 'muatKontak()' });
}

function kpiCrm(label, nilai, ikon, warna, filterK, filterV, catatan) {
  return '<div class="col-6 col-lg-2"><button class="kpi kpi-' + warna + ' kpi-tombol w-100 text-start" ' +
    'onclick="crmKpiKlik(\'' + filterK + '\',\'' + filterV + '\')">' +
    '<div class="kpi-label"><span>' + label + '</span><i class="bi ' + ikon + '"></i></div>' +
    '<div class="kpi-value">' + rp(nilai) + '</div><div class="kpi-foot">' + catatan + '</div></button></div>';
}

function crmKpiKlik(k, v) {
  const f = CRM.filter;
  ['segmen', 'statusWA', 'masalah', 'optOut'].forEach(function (x) { f[x] = ''; });
  if (k) f[k] = v;
  f.halaman = 1;
  renderKontak();
  muatKontak();
}

function gambarKontak(d) {
  if (!$('crmKpi')) return;
  const s = d.stats;
  $('crmKpi').innerHTML =
    kpiCrm('Total kontak', s.total, 'bi-people', 'cyan', '', '', 'pelanggan + prospek') +
    kpiCrm('Pelanggan', s.pelanggan, 'bi-person-check', 'green', 'segmen', 'Pelanggan', 'dari menu Pelanggan') +
    kpiCrm('Prospek', s.prospek, 'bi-person-plus', 'yellow', 'segmen', 'Prospek', 'belum pernah order') +
    kpiCrm('WA terverifikasi', s.waTerdaftar, 'bi-whatsapp', 'green', 'statusWA', 'Terdaftar', s.belumCek + ' belum dicek') +
    kpiCrm('Tanpa WA', s.tanpaWA, 'bi-telephone-x', 'magenta', 'masalah', 'tanpaWA', 'nomor kosong / salah') +
    kpiCrm('Nomor ganda', s.ganda, 'bi-files', 'magenta', 'masalah', 'ganda', s.optOut + ' opt-out');

  const f = CRM.filter;
  const segs = [{ id: '', label: 'Semua' }, { id: 'Pelanggan', label: 'Pelanggan' }, { id: 'Prospek', label: 'Prospek' }];
  $('crmSegmen').innerHTML = segs.map(function (o) {
    return '<button class="chip' + (f.segmen === o.id && !f.masalah && !f.optOut ? ' active' : '') + '" onclick="crmKpiKlik(\'' +
      (o.id ? 'segmen' : '') + '\',\'' + o.id + '\')">' + o.label + '</button>';
  }).join('') +
    (f.masalah || f.optOut ? '<button class="chip active" onclick="crmKpiKlik(\'\',\'\')">' +
      (f.masalah === 'ganda' ? 'Nomor ganda' : f.masalah === 'tanpaWA' ? 'Tanpa WA' : 'Opt-out') + ' <i class="bi bi-x"></i></button>' : '') +
    (crmOwner() ? '<button class="chip' + (f.optOut ? ' active' : '') + '" onclick="crmKpiKlik(\'optOut\',\'YA\')">Opt-out</button>' : '');

  const sel = $('crmTag');
  if (sel) {
    sel.innerHTML = '<option value="">Semua tag</option>' + (d.tags || []).map(function (t) {
      return '<option value="' + esc(t) + '"' + (f.tag === t ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('');
  }
  if ($('crmSinkronInfo')) $('crmSinkronInfo').textContent = d.sinkronTerakhir ? 'Sinkron terakhir ' + crmWaktu(d.sinkronTerakhir) : '';

  const wadah = $('crmList');
  if (!d.rows.length) {
    wadah.innerHTML = '<div class="card-x"><div class="empty-state"><i class="bi bi-person-lines-fill"></i>' +
      (d.stats.total ? 'Tidak ada kontak yang cocok dengan filter.' :
        'Belum ada kontak. Kontak otomatis dibuat dari menu Pelanggan' + (crmOwner() ? ', atau tambah prospek manual.' : '.')) +
      '</div></div>';
  } else {
    wadah.innerHTML = d.rows.map(kartuKontak).join('');
  }
  gambarBulk();
  const nHal = Math.max(1, Math.ceil(d.total / d.per));
  $('crmHalaman').innerHTML = nHal > 1 ?
    '<button class="btn btn-ghost btn-sm" ' + (d.halaman <= 1 ? 'disabled' : '') + ' onclick="crmSetFilter(\'halaman\',' + (d.halaman - 1) + ')"><i class="bi bi-chevron-left"></i></button>' +
    '<span class="crm-hal">Hal. ' + d.halaman + ' / ' + nHal + ' · ' + rp(d.total) + ' kontak</span>' +
    '<button class="btn btn-ghost btn-sm" ' + (d.halaman >= nHal ? 'disabled' : '') + ' onclick="crmSetFilter(\'halaman\',' + (d.halaman + 1) + ')"><i class="bi bi-chevron-right"></i></button>'
    : '<span class="crm-hal">' + rp(d.total) + ' kontak</span>';
}

function kartuKontak(k) {
  const aksen = k.Segmen === 'Pelanggan' ? 'var(--paid-solid)' : 'var(--cmyk-yellow)';
  const tags = k.Tag ? k.Tag.split(',').map(function (t) { return '<span class="crm-tag">' + esc(t.trim()) + '</span>'; }).join('') : '';
  const masalah = !k.WAValid || k.Ganda;
  return '<div class="inv-card crm-kartu' + (masalah ? ' crm-masalah' : '') + '" style="--inv-accent:' + aksen + '">' +
    '<div class="d-flex gap-2 align-items-start">' +
      '<input type="checkbox" class="form-check-input mt-1" aria-label="Pilih ' + esc(k.Nama) + '" ' +
        (CRM.dipilih[k.ID] ? 'checked ' : '') + 'onchange="crmPilih(\'' + esc(k.ID) + '\', this.checked)">' +
      '<div class="flex-grow-1 min-w-0">' +
        '<div class="d-flex justify-content-between gap-2 flex-wrap">' +
          '<div class="min-w-0"><div class="inv-nama text-truncate">' + esc(k.Nama) + '</div>' +
            (k.Perusahaan ? '<div class="inv-meta">' + esc(k.Perusahaan) + '</div>' : '') + '</div>' +
          '<div class="d-flex gap-1 flex-wrap align-items-start">' +
            '<span class="crm-seg crm-seg-' + (k.Segmen === 'Pelanggan' ? 'pel' : 'pros') + '">' + esc(k.Segmen) + '</span>' +
            (k.StatusKontak && k.StatusKontak !== 'Aktif' && k.StatusKontak !== 'Prospek' ? '<span class="crm-seg crm-seg-mati">' + esc(k.StatusKontak) + '</span>' : '') +
            (k.OptOut === 'YA' ? '<span class="crm-seg crm-seg-mati">opt-out</span>' : '') +
            (k.Ganda ? '<span class="crm-seg crm-seg-ganda">nomor ganda</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="crm-baris mt-1">' +
          '<span class="crm-no">' + esc(k.NoWA || '-') + '</span> ' + badgeWA(k) +
          (k.WAValid ? ' <a class="crm-wa-link" href="' + crmLinkWA(k.NoWA) + '" target="_blank" rel="noopener" title="Chat WhatsApp"><i class="bi bi-chat-dots"></i></a>' : '') +
        '</div>' +
        (tags ? '<div class="mt-1">' + tags + '</div>' : '') +
        '<div class="crm-statistik mt-1">' +
          (k.Segmen === 'Pelanggan' ? '<span><i class="bi bi-receipt"></i> ' + k.JumlahInvoice + ' invoice · Rp' + rpRingkas(k.TotalBelanja) + '</span>' +
            '<span><i class="bi bi-calendar3"></i> order ' + crmTanggal(k.TerakhirOrder) + '</span>' : '') +
          '<span><i class="bi bi-chat-left-text"></i> dihubungi ' + crmTanggal(k.TerakhirDihubungi) + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" onclick="bukaDetailKontak(\'' + esc(k.ID) + '\')"><i class="bi bi-chevron-right"></i><span class="visually-hidden">Detail</span></button>' +
    '</div></div>';
}

function crmPilih(id, ya) {
  if (ya) CRM.dipilih[id] = true; else delete CRM.dipilih[id];
  gambarBulk();
}

function crmPilihSemua(ya) {
  (CRM.data ? CRM.data.rows : []).forEach(function (k) { if (ya) CRM.dipilih[k.ID] = true; else delete CRM.dipilih[k.ID]; });
  if (CRM.data) gambarKontak(CRM.data);
}

function gambarBulk() {
  const el = $('crmBulk');
  if (!el) return;
  const n = Object.keys(CRM.dipilih).length;
  const bisaPilih = CRM.data && CRM.data.rows.length;
  if (!n) {
    el.innerHTML = bisaPilih ? '<div class="crm-pilih-semua"><button class="btn btn-link btn-sm p-0" onclick="crmPilihSemua(true)">Pilih semua di halaman ini</button></div>' : '';
    return;
  }
  el.innerHTML = '<div class="crm-bulk card-x"><div class="d-flex flex-wrap gap-2 align-items-center">' +
    '<strong>' + n + ' dipilih</strong>' +
    '<button class="btn btn-ghost btn-sm" onclick="crmBulkTag(\'tag\')"><i class="bi bi-tag"></i> Beri tag</button>' +
    '<button class="btn btn-ghost btn-sm" onclick="crmBulkTag(\'untag\')"><i class="bi bi-tag"></i> Hapus tag</button>' +
    (crmOwner() ?
      '<button class="btn btn-ghost btn-sm" onclick="crmBulkCekWA(this)"><i class="bi bi-whatsapp"></i> Cek nomor WA</button>' +
      '<button class="btn btn-cyan btn-sm" onclick="crmBlastTerpilih()"><i class="bi bi-megaphone"></i> Blast ke terpilih</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="crmBulkOpt(\'optout\')"><i class="bi bi-slash-circle"></i> Opt-out</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="crmBulkOpt(\'optin\')">Batalkan opt-out</button>' : '') +
    '<button class="btn btn-link btn-sm ms-auto" onclick="CRM.dipilih={}; gambarKontak(CRM.data)">Batal pilih</button>' +
    '</div></div>';
}

function crmIdDipilih() { return Object.keys(CRM.dipilih); }

function crmBulkTag(aksi) {
  bukaModalCrm(aksi === 'tag' ? 'Beri tag' : 'Hapus tag',
    '<label class="form-label" for="crmTagMassal">Nama tag (pisahkan dengan koma)</label>' +
    '<input class="form-control" id="crmTagMassal" placeholder="mis. langganan, reseller" list="crmTagDaftar">' +
    '<datalist id="crmTagDaftar">' + ((CRM.data && CRM.data.tags) || []).map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>' +
    '<div class="form-text">' + crmIdDipilih().length + ' kontak terpilih.</div>',
    '<button class="btn btn-cyan" id="crmTagOk">Simpan</button>');
  $('crmTagOk').onclick = function () {
    const nilai = $('crmTagMassal').value.trim();
    if (!nilai) { $('crmTagMassal').focus(); return; }
    const selesai = tombolSibuk($('crmTagOk'), 'Menyimpan...');
    crmApi('tandaiCrmMassal', [crmIdDipilih(), aksi, nilai], function (res) {
      tutupModalCrm(); showToast('Berhasil', res.message, 'success'); CRM.dipilih = {}; muatKontak();
    }, { selesai: selesai });
  };
}

function crmBulkOpt(aksi) {
  konfirmasi((aksi === 'optout' ? 'Tandai ' : 'Batalkan opt-out untuk ') + crmIdDipilih().length +
    ' kontak? Kontak opt-out tidak pernah ikut blast (notifikasi invoice & pembayaran tetap terkirim).', function () {
    crmApi('tandaiCrmMassal', [crmIdDipilih(), aksi, ''], function (res) {
      showToast('Berhasil', res.message, 'success'); CRM.dipilih = {}; muatKontak();
    });
  });
}

/** Cek nomor WA kontak terpilih (per 50 nomor). */
function crmBulkCekWA(btn) {
  const nomor = (CRM.data ? CRM.data.rows : []).filter(function (k) { return CRM.dipilih[k.ID] && k.WAValid; })
    .map(function (k) { return k.NoWA; });
  if (!nomor.length) { showToast('Info', 'Kontak terpilih tidak punya nomor yang valid.', 'warning'); return; }
  cekNomorBertahap(nomor, btn, function () { CRM.dipilih = {}; muatKontak(); });
}

function cekNomorBertahap(nomor, btn, selesai) {
  const asli = btn ? btn.innerHTML : '';
  let i = 0;
  const langkah = function () {
    if (i >= nomor.length) {
      if (btn) { btn.innerHTML = asli; btn.disabled = false; }
      showToast('Selesai', nomor.length + ' nomor dicek.', 'success');
      if (selesai) selesai();
      return;
    }
    const potong = nomor.slice(i, i + 50);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-inline"></span> Mengecek ' + Math.min(i + 50, nomor.length) + '/' + nomor.length; }
    crmApi('cekNomorWA', [potong], function () { i += 50; langkah(); },
      { gagal: function () { if (btn) { btn.innerHTML = asli; btn.disabled = false; } } });
  };
  langkah();
}

function crmBlastTerpilih() {
  CRM.audiens = null;
  CRM.blastSasaran = { ids: crmIdDipilih() };
  renderCrm('blast');
}

function crmSinkron(btn) {
  const selesai = tombolSibuk(btn, 'Sinkron...');
  crmApi('sinkronKontak', [], function (res) {
    showToast('Sinkron', res.message, 'success'); muatKontak();
  }, { selesai: selesai });
}

// ─── Detail kontak ───────────────────────────────────────

function bukaDetailKontak(id) {
  bukaModalCrm('Detail kontak', skeleton(3), '', true);
  crmApi('getCrmDetail', [id], function (res) {
    CRM.detail = res.data;
    gambarDetail(res.data);
  }, { wadah: 'crmModalBody' });
}

function gambarDetail(k) {
  const owner = crmOwner();
  const manual = k.Sumber === 'manual';
  $('crmModalTitle').innerHTML = '<i class="bi bi-person-vcard text-cyan"></i> ' + esc(k.Nama);
  const invoice = k.invoice.length ? '<div class="table-responsive"><table class="table-x"><thead><tr><th>Invoice</th><th>Tanggal</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' +
    k.invoice.map(function (r) {
      return '<tr><td>' + esc(r.NoInvoice) + '</td><td>' + esc(r.Tanggal) + '</td><td class="num">Rp' + rp(r.Total) + '</td><td>' +
        '<span class="badge-status ' + (r.Status === 'Lunas' ? 'badge-lunas' : r.Status === 'Jatuh Tempo' ? 'badge-overdue' : 'badge-belum') + '">' + esc(r.Status) + '</span></td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="text-muted small">Belum ada invoice.</div>';
  const produk = k.produkSering.length ? k.produkSering.map(function (p) {
    return '<span class="crm-tag">' + esc(p.produk) + ' · ' + p.kali + '× (' + rp(p.qty) + ' ' + esc(p.satuan) + ')</span>';
  }).join('') : '<span class="text-muted small">-</span>';
  const timeline = k.timeline.length ? '<ul class="crm-timeline">' + k.timeline.map(function (t) {
    return '<li class="crm-tl-' + (t.jenis === 'wa' ? 'wa' : 'cat') + '"><div class="crm-tl-kepala"><strong>' + esc(t.kanal) + '</strong>' +
      (t.status ? ' · ' + esc(t.status) : '') + '<span>' + crmWaktu(t.waktu) + '</span></div>' +
      '<div class="crm-tl-isi">' + esc(t.isi) + '</div>' + (t.jenis !== 'wa' && t.oleh ? '<div class="crm-tl-oleh">oleh ' + esc(t.oleh) + '</div>' : '') + '</li>';
  }).join('') + '</ul>' : '<div class="text-muted small">Belum ada interaksi tercatat.</div>';
  const ganda = k.kontakGanda.length && owner ? '<div class="alert-crm mb-3"><i class="bi bi-files"></i> Nomor ini juga dipakai oleh: ' +
    k.kontakGanda.map(function (g) {
      return '<span class="d-inline-flex gap-1 align-items-center me-2"><strong>' + esc(g.Nama) + '</strong> (' + esc(g.Segmen) + ') ' +
        '<button class="btn btn-ghost btn-sm" onclick="gabungKontakUI(\'' + esc(k.ID) + '\',\'' + esc(g.ID) + '\',\'' + esc(g.Sumber) + '\',\'' + esc(k.Sumber) + '\')">Gabungkan</button></span>';
    }).join('') + '</div>' : '';

  $('crmModalBody').innerHTML = ganda +
    '<div class="row g-3">' +
      '<div class="col-md-6">' +
        '<div class="crm-info">' +
          '<div><span>Segmen</span>' + esc(k.Segmen) + (k.Sumber === 'pelanggan' ? ' (dari menu Pelanggan)' : ' (input manual)') + '</div>' +
          '<div><span>WhatsApp</span>' + esc(k.NoWA || '-') + ' ' + badgeWA(k) +
            (k.WAValid ? ' <a href="' + crmLinkWA(k.NoWA) + '" target="_blank" rel="noopener" class="crm-wa-link"><i class="bi bi-chat-dots"></i> Chat</a>' : '') + '</div>' +
          '<div><span>Perusahaan</span>' + esc(k.Perusahaan || '-') + '</div>' +
          '<div><span>Email</span>' + esc(k.Email || '-') + '</div>' +
          '<div><span>Alamat</span>' + esc(k.Alamat || '-') + '</div>' +
          '<div><span>Pesan WA terkirim</span>' + k.JumlahPesan + ' · terakhir dihubungi ' + crmTanggal(k.TerakhirDihubungi) + '</div>' +
          (k.Segmen === 'Pelanggan' ? '<div><span>Total belanja</span>Rp' + rp(k.TotalBelanja) + ' dari ' + k.JumlahInvoice + ' invoice</div>' : '') +
        '</div>' +
        (manual && owner ? '<div class="d-flex gap-2 mt-2"><button class="btn btn-ghost btn-sm" onclick="bukaFormProspek(CRM.detail)"><i class="bi bi-pencil"></i> Ubah data prospek</button>' +
          '<button class="btn btn-ghost btn-sm text-magenta" onclick="hapusProspekUI(\'' + esc(k.ID) + '\')"><i class="bi bi-trash3"></i> Hapus</button></div>' :
          (k.Sumber === 'pelanggan' ? '<div class="form-text mt-2">Nama, nomor, dan alamat diubah lewat menu Pelanggan; CRM menyalinnya otomatis.</div>' : '')) +
      '</div>' +
      '<div class="col-md-6">' +
        '<label class="form-label" for="crmDetStatus">Status kontak</label>' +
        '<select class="form-select mb-2" id="crmDetStatus">' + ['Aktif', 'Prospek', 'Tidak aktif'].map(function (s) {
          return '<option' + (k.StatusKontak === s ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + (['Aktif', 'Prospek', 'Tidak aktif'].indexOf(k.StatusKontak) === -1 ? '<option selected>' + esc(k.StatusKontak) + '</option>' : '') + '</select>' +
        '<label class="form-label" for="crmDetTag">Tag (pisahkan koma)</label>' +
        '<input class="form-control mb-2" id="crmDetTag" value="' + esc(k.Tag) + '" placeholder="mis. langganan, reseller">' +
        '<label class="form-label" for="crmDetProduk">Produk yang diminati</label>' +
        '<input class="form-control mb-2" id="crmDetProduk" value="' + esc(k.ProdukDiminati) + '" placeholder="mis. Banner, Stiker Vinyl">' +
        '<label class="form-label" for="crmDetCatatan">Catatan</label>' +
        '<textarea class="form-control mb-2" id="crmDetCatatan" rows="3">' + esc(k.Catatan) + '</textarea>' +
        (owner ? '<div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="crmDetOpt"' + (k.OptOut === 'YA' ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="crmDetOpt">Opt-out (tidak ikut blast)</label></div>' : '') +
        '<button class="btn btn-cyan btn-sm" id="crmDetSimpan" onclick="simpanDetailKontak()"><i class="bi bi-check2"></i> Simpan</button>' +
      '</div>' +
    '</div>' +
    '<hr>' +
    '<h6 class="crm-sub">Produk yang sering dibeli</h6><div class="mb-3">' + produk + '</div>' +
    (k.Segmen === 'Pelanggan' ? '<h6 class="crm-sub">Riwayat order</h6><div class="mb-3">' + invoice + '</div>' : '') +
    '<h6 class="crm-sub">Catat interaksi</h6>' +
    '<div class="d-flex gap-2 flex-wrap mb-3">' +
      '<select class="form-select crm-sel" id="crmIntKanal"><option>Telepon</option><option>WA Manual</option><option>Kunjungan</option><option>Catatan</option></select>' +
      '<input class="form-control flex-grow-1 crm-int-isi" id="crmIntIsi" placeholder="mis. Tanya harga banner 3×1 m, follow-up Senin">' +
      '<button class="btn btn-ghost btn-sm" id="crmIntBtn" onclick="catatInteraksiUI()"><i class="bi bi-plus-lg"></i> Catat</button>' +
    '</div>' +
    '<h6 class="crm-sub">Timeline</h6>' + timeline;
  $('crmModalFoot').innerHTML = '<button class="btn btn-ghost" data-bs-dismiss="modal">Tutup</button>';
}

function simpanDetailKontak() {
  const k = CRM.detail;
  const obj = { ID: k.ID, StatusKontak: $('crmDetStatus').value, Tag: $('crmDetTag').value,
    ProdukDiminati: $('crmDetProduk').value, Catatan: $('crmDetCatatan').value };
  if ($('crmDetOpt')) obj.OptOut = $('crmDetOpt').checked ? 'YA' : 'TIDAK';
  const selesai = tombolSibuk($('crmDetSimpan'), 'Menyimpan...');
  crmApi('simpanCrmKontak', [obj], function (res) {
    showToast('Tersimpan', res.message, 'success');
    if (CRM.data) CRM.data._kotor = true;
    muatKontak();
  }, { selesai: selesai });
}

function catatInteraksiUI() {
  const isi = $('crmIntIsi').value.trim();
  if (!isi) { $('crmIntIsi').focus(); return; }
  const selesai = tombolSibuk($('crmIntBtn'), '...');
  crmApi('catatInteraksi', [CRM.detail.ID, $('crmIntKanal').value, isi], function () {
    showToast('Tercatat', 'Interaksi disimpan.', 'success');
    if (CRM.data) CRM.data._kotor = true;
    bukaDetailKontak(CRM.detail.ID);
  }, { selesai: selesai });
}

function gabungKontakUI(idIni, idLain, sumberLain, sumberIni) {
  // Kontak dari Pelanggan selalu jadi kontak utama
  const utama = sumberLain === 'pelanggan' && sumberIni !== 'pelanggan' ? idLain : idIni;
  const gabung = utama === idIni ? idLain : idIni;
  konfirmasi('Gabungkan dua kontak bernomor sama? Tag, catatan, opt-out, dan riwayat interaksi dipindah ke kontak utama.', function () {
    crmApi('gabungKontak', [utama, gabung], function (res) {
      showToast('Digabung', res.message, 'success');
      if (CRM.data) CRM.data._kotor = true;
      bukaDetailKontak(utama); muatKontak();
    });
  });
}

function hapusProspekUI(id) {
  konfirmasi('Hapus prospek ini dari CRM?', function () {
    crmApi('hapusCrmKontak', [id], function (res) {
      tutupModalCrm(); showToast('Dihapus', res.message, 'success'); muatKontak();
    });
  });
}

// ─── Tambah / ubah prospek ───────────────────────────────

function bukaFormProspek(k) {
  k = k || {};
  bukaModalCrm(k.ID ? 'Ubah prospek' : 'Tambah prospek',
    '<div class="row g-2">' +
      '<div class="col-12"><label class="form-label" for="prNama">Nama *</label><input class="form-control" id="prNama" value="' + esc(k.Nama || '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label" for="prWA">Nomor WhatsApp *</label><input class="form-control" id="prWA" inputmode="tel" placeholder="081234567890" value="' + esc(k.NoWA || '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label" for="prPers">Perusahaan / usaha</label><input class="form-control" id="prPers" value="' + esc(k.Perusahaan || '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label" for="prEmail">Email</label><input class="form-control" id="prEmail" type="email" value="' + esc(k.Email || '') + '"></div>' +
      '<div class="col-md-6"><label class="form-label" for="prTag">Tag</label><input class="form-control" id="prTag" placeholder="mis. pameran-okt" value="' + esc(k.Tag || '') + '"></div>' +
      '<div class="col-12"><label class="form-label" for="prProduk">Produk yang diminati</label><input class="form-control" id="prProduk" value="' + esc(k.ProdukDiminati || '') + '"></div>' +
      '<div class="col-12"><label class="form-label" for="prAlamat">Alamat</label><input class="form-control" id="prAlamat" value="' + esc(k.Alamat || '') + '"></div>' +
      (k.ID ? '' : '<div class="col-12"><label class="form-label" for="prCatatan">Catatan</label><textarea class="form-control" id="prCatatan" rows="2"></textarea></div>') +
    '</div>' +
    '<div class="form-text mt-2">Prospek tidak muncul di daftar pelanggan saat Buat Invoice. Begitu ia jadi pelanggan, tambahkan di menu Pelanggan lalu gabungkan kontaknya di sini.</div>',
    '<button class="btn btn-cyan" id="prSimpan">Simpan</button>');
  $('prSimpan').onclick = function () {
    const obj = { ID: k.ID || '', Nama: $('prNama').value, NoWA: $('prWA').value, Perusahaan: $('prPers').value,
      Email: $('prEmail').value, Tag: $('prTag').value, ProdukDiminati: $('prProduk').value, Alamat: $('prAlamat').value };
    if ($('prCatatan')) obj.Catatan = $('prCatatan').value;
    const selesai = tombolSibuk($('prSimpan'), 'Menyimpan...');
    crmApi('simpanCrmKontak', [obj], function (res) {
      tutupModalCrm(); showToast('Tersimpan', res.message, 'success');
      if (!k.ID) { CRM.filter.cari = ''; CRM.filter.halaman = 1; if ($('crmCari')) $('crmCari').value = ''; }   // supaya prospek baru langsung terlihat
      muatKontak();
    }, { selesai: selesai });
  };
}

// ─── Import & ekspor CSV ─────────────────────────────────

/** Parser CSV sederhana: mendukung tanda kutip, koma atau titik koma. */
function parseCsv(teks) {
  const baris = [];
  const pemisah = (teks.split('\n')[0].match(/;/g) || []).length > (teks.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  let sel = '', row = [], kutip = false;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    if (kutip) {
      if (c === '"' && teks[i + 1] === '"') { sel += '"'; i++; }
      else if (c === '"') kutip = false;
      else sel += c;
    } else if (c === '"') kutip = true;
    else if (c === pemisah) { row.push(sel); sel = ''; }
    else if (c === '\n') { row.push(sel); baris.push(row); row = []; sel = ''; }
    else if (c !== '\r') sel += c;
  }
  if (sel || row.length) { row.push(sel); baris.push(row); }
  return baris.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
}

function bukaImportCsv() {
  bukaModalCrm('Import prospek dari CSV',
    '<p class="small mb-2">Kolom yang dibaca (baris pertama = judul): <code>nama</code>, <code>wa</code>, <code>perusahaan</code>, <code>email</code>, <code>tag</code>, <code>produk</code>, <code>alamat</code>. ' +
    'Nomor yang sudah ada di CRM dilewati.</p>' +
    '<button class="btn btn-link btn-sm p-0 mb-2" onclick="unduhTemplateCsv()"><i class="bi bi-file-earmark-arrow-down"></i> Unduh template CSV</button>' +
    '<input type="file" class="form-control" id="csvFile" accept=".csv,text/csv">' +
    '<div id="csvPratinjau" class="mt-2 small"></div>',
    '<button class="btn btn-cyan" id="csvOk" disabled>Import</button>');
  let rows = [];
  $('csvFile').onchange = function () {
    const f = this.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = function () {
      const data = parseCsv(String(r.result).replace(/^\uFEFF/, ''));
      if (data.length < 2) { $('csvPratinjau').textContent = 'File kosong atau tanpa baris data.'; return; }
      const hdr = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
      const idx = function (nama) { return hdr.indexOf(nama); };
      if (idx('nama') < 0 || idx('wa') < 0) { $('csvPratinjau').textContent = 'Kolom "nama" dan "wa" wajib ada.'; return; }
      rows = data.slice(1).map(function (r) {
        const o = {};
        ['nama', 'wa', 'perusahaan', 'email', 'tag', 'produk', 'alamat'].forEach(function (k) { o[k] = idx(k) >= 0 ? String(r[idx(k)] || '').trim() : ''; });
        return o;
      });
      $('csvPratinjau').innerHTML = '<strong>' + rows.length + '</strong> baris siap diimport. Contoh: ' +
        rows.slice(0, 3).map(function (o) { return esc(o.nama) + ' (' + esc(o.wa) + ')'; }).join(', ');
      $('csvOk').disabled = false;
    };
    r.readAsText(f);
  };
  $('csvOk').onclick = function () {
    const selesai = tombolSibuk($('csvOk'), 'Mengimport...');
    crmApi('importKontak', [rows], function (res) {
      tutupModalCrm(); showToast('Import selesai', res.message, 'success'); muatKontak();
    }, { selesai: selesai });
  };
}

function unduhFile(nama, isi, tipe) {
  const blob = new Blob(['\uFEFF' + isi], { type: tipe || 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nama;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function selCsv(v) { const s = String(v == null ? '' : v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function unduhTemplateCsv() {
  unduhFile('template-prospek.csv', 'nama,wa,perusahaan,email,tag,produk,alamat\nBu Sari,081234567890,Toko Sari,,pameran-okt,Banner,Denpasar\n');
}

function eksporKontakCsv(btn) {
  const selesai = tombolSibuk(btn, 'Menyiapkan...');
  crmApi('getCrmKontak', [Object.assign({}, CRM.filter, { semua: true })], function (res) {
    const kol = ['Nama', 'Perusahaan', 'NoWA', 'StatusWA', 'Email', 'Alamat', 'Segmen', 'StatusKontak', 'Tag', 'ProdukDiminati',
      'OptOut', 'JumlahInvoice', 'TotalBelanja', 'TerakhirOrder', 'TerakhirDihubungi', 'JumlahPesan', 'Catatan'];
    const isi = [kol.join(',')].concat(res.data.rows.map(function (k) { return kol.map(function (c) { return selCsv(k[c]); }).join(','); })).join('\n');
    unduhFile('kontak-crm-' + tglInput() + '.csv', isi);
    showToast('Ekspor', res.data.rows.length + ' kontak diekspor.', 'success');
  }, { selesai: selesai });
}

// ════════════════════════════════════════════════════════
// TAB BLAST WA (Owner)
// ════════════════════════════════════════════════════════

function renderBlast() {
  const sasaran = CRM.blastSasaran || {};
  const cfg = CRM.config;
  $('crmIsi').innerHTML =
    '<div id="blastPeringatan"></div>' +
    '<div id="blastAktifWadah"></div>' +
    '<div class="row g-3">' +
      '<div class="col-lg-6"><div class="card-x h-100"><div class="card-x-head"><h2>1. Pilih penerima</h2></div><div class="card-x-body">' +
        (sasaran.ids ? '<div class="alert-crm mb-2"><i class="bi bi-check2-square"></i> ' + sasaran.ids.length + ' kontak dipilih dari tab Kontak. ' +
          '<button class="btn btn-link btn-sm p-0" onclick="CRM.blastSasaran=null; CRM.audiens=null; renderBlast()">Ganti ke filter</button></div>' :
        '<div class="row g-2">' +
          '<div class="col-6"><label class="form-label" for="blSegmen">Segmen</label><select class="form-select" id="blSegmen">' +
            '<option value="">Semua kontak</option><option>Pelanggan</option><option>Prospek</option><option value="__manual">Tempel nomor manual</option></select></div>' +
          '<div class="col-6"><label class="form-label" for="blTag">Tag</label><select class="form-select" id="blTag"><option value="">Semua tag</option>' +
            ((CRM.data && CRM.data.tags) || []).map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
          '<div class="col-12 d-none" id="blManualWadah"><label class="form-label" for="blManual">Satu nomor per baris (boleh <code>0812…|Nama</code>)</label>' +
            '<textarea class="form-control" id="blManual" rows="4" placeholder="081234567890|Bu Sari"></textarea></div>' +
        '</div>') +
        '<div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="blHanyaWA"><label class="form-check-label" for="blHanyaWA">Hanya nomor yang sudah terverifikasi WhatsApp</label></div>' +
        '<div class="d-flex gap-2 mt-2 flex-wrap">' +
          '<button class="btn btn-key btn-sm" onclick="muatAudiens(this)"><i class="bi bi-people"></i> Muat penerima</button>' +
          '<button class="btn btn-ghost btn-sm" id="blCekBtn" onclick="cekAudiensWA(this)" disabled><i class="bi bi-whatsapp"></i> Cek nomor WA</button>' +
        '</div>' +
        '<div id="blRingkas" class="mt-3"></div>' +
        '<div id="blDaftar" class="bl-daftar"></div>' +
      '</div></div></div>' +
      '<div class="col-lg-6"><div class="card-x h-100"><div class="card-x-head"><h2>2. Tulis pesan</h2></div><div class="card-x-body">' +
        '<label class="form-label" for="blJudul">Judul (hanya untuk catatan internal)</label>' +
        '<input class="form-control mb-2" id="blJudul" placeholder="mis. Promo banner Oktober">' +
        '<div class="d-flex gap-1 flex-wrap mb-1">' +
          ['nama', 'perusahaan', 'usaha'].map(function (v) {
            return '<button class="btn btn-ghost btn-sm" onclick="sisipVariabel(\'blPesan\', \'{' + v + '}\')">{' + v + '}</button>';
          }).join('') +
        '</div>' +
        '<textarea class="form-control" id="blPesan" rows="6" oninput="pratinjauBlast()" placeholder="Halo Kak {nama} 👋&#10;Ada promo cetak banner minggu ini...&#10;&#10;Balas STOP bila tidak ingin menerima info promo."></textarea>' +
        '<div class="form-text">{nama} = nama penerima, {perusahaan} = perusahaan penerima, {usaha} = nama usaha Anda. Format WhatsApp: *tebal*, _miring_.</div>' +
        '<div class="wa-preview mt-2" id="blPreview"><span class="text-muted">Pratinjau pesan muncul di sini.</span></div>' +
        '<h2 class="crm-h2 mt-3">3. Ukuran batch &amp; jeda</h2>' +
        '<div class="d-flex gap-3 flex-wrap align-items-end">' +
          '<div><label class="form-label d-block">Pesan per batch</label><div class="seg-batch" id="blBatch">' +
            [10, 20, 50].map(function (n) {
              return '<button class="' + ((cfg ? cfg.batch : 20) === n ? 'active' : '') + '" onclick="pilihBatch(this)" data-n="' + n + '">' + n + '</button>';
            }).join('') + '</div></div>' +
          '<div><label class="form-label" for="blJeda">Jeda antarpesan (detik)</label><input class="form-control crm-jeda" id="blJeda" value="' + esc(cfg ? cfg.jeda : '5') + '" oninput="pratinjauBlast()"></div>' +
        '</div>' +
        '<div class="form-text" id="blEstimasi"></div>' +
        '<button class="btn btn-cyan w-100 mt-3" id="blMulai" onclick="mulaiBlast()" disabled><i class="bi bi-megaphone"></i> Mulai blast</button>' +
      '</div></div></div>' +
    '</div>' +
    '<div class="card-x mt-3"><div class="card-x-head"><h2>Riwayat blast</h2>' +
      '<button class="btn btn-ghost btn-sm" onclick="muatDaftarBlast()"><i class="bi bi-arrow-clockwise"></i></button></div>' +
      '<div class="card-x-body" id="blRiwayat">' + (CRM.daftarBlast ? '' : skeleton(2)) + '</div></div>';

  if ($('blSegmen')) $('blSegmen').onchange = function () {
    $('blManualWadah').classList.toggle('d-none', this.value !== '__manual');
    CRM.audiens = null; gambarAudiens();
  };
  if (!CRM.config) crmApi('getNotifConfig', [], function (res) { CRM.config = res.data; peringatanBlast(); });
  else peringatanBlast();
  if (CRM.audiens) gambarAudiens();
  if (CRM.daftarBlast) gambarDaftarBlast();   // tampil instan dari data terakhir
  muatDaftarBlast();                          // lalu disegarkan diam-diam
}

function peringatanBlast() {
  const c = CRM.config;
  if (!$('blastPeringatan') || !c) return;
  $('blastPeringatan').innerHTML = (!c.waAktif || !c.adaToken) ?
    '<div class="alert-crm alert-kuning mb-3"><i class="bi bi-exclamation-triangle"></i> Notifikasi WhatsApp masih <strong>NONAKTIF</strong>. ' +
    'Isi token Fonnte dan nyalakan saklar di tab <a href="#" onclick="renderCrm(\'pengaturan\'); return false;">Pengaturan WA</a> sebelum memulai blast.</div>' : '';
}

function sisipVariabel(id, teks) {
  const el = $(id);
  const a = el.selectionStart || el.value.length;
  el.value = el.value.slice(0, a) + teks + el.value.slice(el.selectionEnd || a);
  el.focus(); el.selectionStart = el.selectionEnd = a + teks.length;
  el.dispatchEvent(new Event('input'));
}

function pilihBatch(btn) {
  const wadah = $('blBatch');
  for (let i = 0; i < wadah.children.length; i++) wadah.children[i].classList.remove('active');
  btn.classList.add('active');
  pratinjauBlast();
}

function muatAudiens(btn) {
  const f = { hanyaTerdaftar: $('blHanyaWA').checked };
  if (CRM.blastSasaran && CRM.blastSasaran.ids) f.ids = CRM.blastSasaran.ids;
  else if ($('blSegmen').value === '__manual') {
    f.manual = $('blManual').value;
    if (!f.manual.trim()) { showToast('Info', 'Tempel minimal satu nomor.', 'warning'); return; }
  } else { f.segmen = $('blSegmen').value; f.tag = $('blTag').value; }
  const selesai = tombolSibuk(btn, 'Memuat...');
  crmApi('getAudiensBlast', [f], function (res) { CRM.audiens = res.data; gambarAudiens(); }, { selesai: selesai });
}

function gambarAudiens() {
  const a = CRM.audiens;
  if (!$('blRingkas')) return;
  if (!a) { $('blRingkas').innerHTML = ''; $('blDaftar').innerHTML = ''; if ($('blCekBtn')) $('blCekBtn').disabled = true; pratinjauBlast(); return; }
  const r = a.ringkas;
  const dikirim = a.rows.filter(function (x) { return x.kirim; }).length;
  $('blRingkas').innerHTML = '<div class="d-flex flex-wrap gap-1">' +
    '<span class="crm-tag crm-tag-kuat">' + dikirim + ' akan dikirimi</span>' +
    '<span class="crm-tag">' + r.total + ' total</span>' +
    (r.tidakValid ? '<span class="crm-tag">' + r.tidakValid + ' nomor tidak valid</span>' : '') +
    (r.ganda ? '<span class="crm-tag">' + r.ganda + ' ganda</span>' : '') +
    (r.optOut ? '<span class="crm-tag">' + r.optOut + ' opt-out</span>' : '') +
    '<span class="crm-tag">' + r.terdaftar + ' WA ✓ · ' + r.belumCek + ' belum dicek · ' + r.bukanWA + ' bukan WA</span></div>';
  $('blDaftar').innerHTML = a.rows.slice(0, 200).map(function (o) {
    const ket = !o.valid ? 'tidak valid' : o.ganda ? 'ganda' : o.optOut ? 'opt-out' : o.dilewati ? 'belum terverifikasi' : '';
    return '<div class="bl-baris' + (o.kirim ? '' : ' redup') + '"><span class="text-truncate">' + esc(o.nama || '(tanpa nama)') + '</span>' +
      '<span class="crm-no">' + esc(o.hp || '-') + '</span>' +
      (o.statusWA === 'Terdaftar' ? '<i class="bi bi-whatsapp text-success" title="Terverifikasi WA"></i>' : o.statusWA ? '<i class="bi bi-x-circle text-magenta" title="Bukan WA"></i>' : '<i class="bi bi-question-circle text-muted" title="Belum dicek"></i>') +
      (ket ? '<small>' + ket + '</small>' : '') + '</div>';
  }).join('') + (a.rows.length > 200 ? '<div class="small text-muted mt-1">+' + (a.rows.length - 200) + ' penerima lain</div>' : '');
  $('blCekBtn').disabled = !a.rows.some(function (o) { return o.valid && !o.statusWA && o.id; });
  pratinjauBlast();
}

function cekAudiensWA(btn) {
  const nomor = CRM.audiens.rows.filter(function (o) { return o.valid && !o.statusWA && o.id; }).map(function (o) { return o.hp; });
  cekNomorBertahap(nomor, btn, function () { muatAudiens(document.createElement('button')); if (CRM.data) CRM.data._kotor = true; });
}

function batchDipilih() {
  const el = $('blBatch') && $('blBatch').querySelector('.active');
  return el ? Number(el.dataset.n) : 20;
}

function rataJeda(teks) {
  const m = /^(\d+)(?:-(\d+))?$/.exec(String(teks).trim());
  if (!m) return null;
  return m[2] ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[1]);
}

function pratinjauBlast() {
  if (!$('blPesan')) return;
  const pesan = $('blPesan').value;
  const contoh = CRM.audiens && CRM.audiens.rows.filter(function (o) { return o.kirim; })[0];
  const isi = pesan.replace(/\{nama\}/g, contoh && contoh.nama ? contoh.nama : 'Kak')
    .replace(/\{perusahaan\}/g, contoh ? contoh.perusahaan || '' : '')
    .replace(/\{usaha\}/g, (AppState.config && AppState.config.namaPerusahaan) || '');
  $('blPreview').innerHTML = pesan.trim() ? formatWA(isi) : '<span class="text-muted">Pratinjau pesan muncul di sini.</span>';
  const n = CRM.audiens ? CRM.audiens.rows.filter(function (o) { return o.kirim; }).length : 0;
  const batch = batchDipilih(), jeda = rataJeda($('blJeda').value);
  const nBatch = Math.ceil(n / batch);
  $('blEstimasi').innerHTML = n ? n + ' penerima → ' + nBatch + ' batch · ±' + Math.max(1, Math.round(n * (jeda || 5) / 60)) +
    ' menit bila halaman ini dibiarkan terbuka dengan mode otomatis (tanpa halaman terbuka: 1 batch tiap 5 menit).' +
    (jeda === null ? ' <span class="text-magenta">Jeda harus angka, misal 5 atau 3-8.</span>' : '') : '';
  const c = CRM.config;
  $('blMulai').disabled = !(n && pesan.trim().length >= 5 && jeda !== null && c && c.waAktif && c.adaToken);
  $('blMulai').innerHTML = '<i class="bi bi-megaphone"></i> Mulai blast' + (n ? ' (' + n + ' nomor)' : '');
}

/** *tebal* _miring_ ~coret~ ala WhatsApp → HTML aman. */
function formatWA(teks) {
  return esc(teks).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>').replace(/\n/g, '<br>');
}

function mulaiBlast() {
  const penerima = CRM.audiens.rows.filter(function (o) { return o.kirim; })
    .map(function (o) { return { hp: o.hp, nama: o.nama, perusahaan: o.perusahaan }; });
  konfirmasi('Kirim pesan ke ' + penerima.length + ' nomor? Pesan dikirim bertahap ' + batchDipilih() + ' per batch.', function () {
    const selesai = tombolSibuk($('blMulai'), 'Membuat blast...');
    crmApi('buatBlast', [{ judul: $('blJudul').value, pesan: $('blPesan').value, ukuranBatch: batchDipilih(),
      jeda: $('blJeda').value.trim(), penerima: penerima }], function (res) {
      showToast('Blast dibuat', res.message, 'success');
      CRM.blastAktif = res.data.ID; CRM.audiens = null; CRM.blastSasaran = null;
      renderBlast();
      prosesBlastUI(res.data.ID, true);
    }, { selesai: selesai });
  });
}

function muatDaftarBlast() {
  crmApi('getDaftarBlast', [], function (res) {
    CRM.daftarBlast = res.data;
    if (typeof simpanCacheInstan === 'function') simpanCacheInstan('crmBlast', res.data);
    gambarDaftarBlast();
  }, { wadah: CRM.daftarBlast ? null : 'blRiwayat', ulang: 'muatDaftarBlast()' });
}

function gambarDaftarBlast() {
  const list = CRM.daftarBlast || [];
  if (!$('blRiwayat') || !$('blastAktifWadah')) return;
  const aktif = list.filter(function (b) { return b.Status === 'Berjalan'; });
  $('blastAktifWadah').innerHTML = aktif.map(kartuBlastAktif).join('');
  $('blRiwayat').innerHTML = list.length ? '<div class="table-responsive"><table class="table-x"><thead><tr><th>Blast</th><th>Tanggal</th><th>Progres</th><th>Status</th></tr></thead><tbody>' +
    list.map(function (b) {
      return '<tr><td><strong>' + esc(b.Judul) + '</strong><div class="inv-meta">' + b.UkuranBatch + '/batch · jeda ' + esc(b.JedaDetik) + ' dtk · oleh ' + esc(b.DibuatOleh) + '</div></td>' +
        '<td>' + crmWaktu(b.Tanggal) + '</td>' +
        '<td><div class="progress-x"><span style="width:' + b.Persen + '%"></span></div><div class="inv-meta">' + b.Terkirim + ' terkirim · ' + b.Gagal + ' gagal / ' + b.Total + '</div></td>' +
        '<td>' + esc(b.Status) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<div class="text-muted small">Belum ada blast.</div>';
}

function kartuBlastAktif(b) {
  const oto = CRM.otomatisTimer && CRM.blastAktif === b.ID;
  return '<div class="card-x mb-3 blast-aktif"><div class="card-x-body">' +
    '<div class="d-flex justify-content-between flex-wrap gap-2"><div><strong>' + esc(b.Judul) + '</strong>' +
      '<div class="inv-meta">' + b.Terkirim + ' terkirim · ' + b.Gagal + ' gagal · ' + b.Sisa + ' menunggu dari ' + b.Total + '</div></div>' +
      '<div class="d-flex gap-2 flex-wrap">' +
        '<button class="btn btn-cyan btn-sm" onclick="prosesBlastUI(\'' + esc(b.ID) + '\', false, this)"><i class="bi bi-play-fill"></i> Kirim batch berikutnya</button>' +
        '<div class="form-check form-switch m-0 d-flex align-items-center gap-1"><input class="form-check-input" type="checkbox" id="oto_' + esc(b.ID) + '"' + (oto ? ' checked' : '') +
          ' onchange="aturOtomatis(\'' + esc(b.ID) + '\', this.checked)"><label class="form-check-label small" for="oto_' + esc(b.ID) + '">Otomatis' +
          (oto ? ' <span id="otoHitung">(' + CRM.otomatisSisa + ' dtk)</span>' : '') + '</label></div>' +
        '<button class="btn btn-ghost btn-sm text-magenta" onclick="hentikanBlastUI(\'' + esc(b.ID) + '\')"><i class="bi bi-stop-fill"></i> Hentikan</button>' +
      '</div></div>' +
    '<div class="progress-x mt-2"><span style="width:' + b.Persen + '%"></span></div>' +
    '<div class="form-text">Server tetap mengirim 1 batch tiap 5 menit walau halaman ini ditutup.</div>' +
    '</div></div>';
}

function prosesBlastUI(id, diam, btn) {
  const selesai = btn ? tombolSibuk(btn, 'Mengirim...') : function () {};
  crmApi('prosesBlast', [id], function (res) {
    if (!diam) showToast('Blast', res.message, 'info');
    const list = CRM.daftarBlast || [];
    const i = list.findIndex(function (b) { return b.ID === res.data.ID; });
    if (i >= 0) list[i] = res.data; else list.unshift(res.data);
    CRM.daftarBlast = list;
    if (res.data.Status !== 'Berjalan' && CRM.blastAktif === id) hentikanOtomatis();
    if (AppState.halaman === 'crm' && CRM.tab === 'blast') gambarDaftarBlast();
  }, { selesai: selesai });
}

function aturOtomatis(id, nyala) {
  hentikanOtomatis();
  if (!nyala) { gambarDaftarBlast(); return; }
  const b = (CRM.daftarBlast || []).filter(function (x) { return x.ID === id; })[0];
  const interval = Math.max(30, Math.round((b ? b.UkuranBatch : 20) * (rataJeda(b ? b.JedaDetik : '5') || 5)));
  CRM.blastAktif = id;
  CRM.otomatisSisa = interval;
  CRM.otomatisTimer = setInterval(function () {
    CRM.otomatisSisa--;
    if ($('otoHitung')) $('otoHitung').textContent = '(' + CRM.otomatisSisa + ' dtk)';
    if (CRM.otomatisSisa <= 0) { CRM.otomatisSisa = interval; prosesBlastUI(id, true); }
  }, 1000);
  gambarDaftarBlast();
}

function hentikanOtomatis() {
  if (CRM.otomatisTimer) clearInterval(CRM.otomatisTimer);
  CRM.otomatisTimer = null;
}

function hentikanBlastUI(id) {
  konfirmasi('Hentikan blast ini? Pesan yang belum terkirim dibatalkan.', function () {
    hentikanOtomatis();
    crmApi('hentikanBlast', [id], function (res) { showToast('Dihentikan', res.message, 'warning'); muatDaftarBlast(); });
  });
}

// ════════════════════════════════════════════════════════
// TAB ANTREAN (Owner)
// ════════════════════════════════════════════════════════

let filterAntrean = '';
function renderAntrean() {
  $('crmIsi').innerHTML =
    '<div class="row g-2 mb-3" id="antKpi"></div>' +
    '<div class="d-flex gap-2 flex-wrap mb-2 align-items-center">' +
      '<div class="chip-row" id="antChip"></div>' +
      '<button class="btn btn-cyan btn-sm ms-auto" onclick="prosesSekarangUI(this)"><i class="bi bi-send"></i> Proses sekarang</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="ulangiGagalUI(this)"><i class="bi bi-arrow-repeat"></i> Ulangi yang gagal</button>' +
    '</div>' +
    '<div id="antInfo"></div>' +
    '<div id="antList">' + skeleton(3) + '</div>';
  if (CRM.antrean && CRM.antrean.f === filterAntrean) gambarAntrean(CRM.antrean.d);   // instan dari data terakhir
  muatAntrean();
}

function muatAntrean() {
  const adaCache = CRM.antrean && CRM.antrean.f === filterAntrean;
  crmApi('getAntrianNotif', [{ status: filterAntrean }], function (res) {
    CRM.antrean = { f: filterAntrean, d: res.data };
    gambarAntrean(res.data);
  }, { wadah: adaCache ? null : 'antList', ulang: 'muatAntrean()' });
}

function gambarAntrean(d) {
  {
    const r = d.ringkas;
    if (!$('antKpi') || !$('antList')) return;
    $('antKpi').innerHTML =
      '<div class="col-6 col-lg-3"><div class="kpi kpi-yellow"><div class="kpi-label"><span>Menunggu</span><i class="bi bi-hourglass"></i></div><div class="kpi-value">' + r.Antri + '</div></div></div>' +
      '<div class="col-6 col-lg-3"><div class="kpi kpi-green"><div class="kpi-label"><span>Terkirim</span><i class="bi bi-check2-all"></i></div><div class="kpi-value">' + r.Terkirim + '</div></div></div>' +
      '<div class="col-6 col-lg-3"><div class="kpi kpi-magenta"><div class="kpi-label"><span>Gagal</span><i class="bi bi-x-octagon"></i></div><div class="kpi-value">' + r.Gagal + '</div></div></div>' +
      '<div class="col-6 col-lg-3"><div class="kpi kpi-cyan"><div class="kpi-label"><span>Dibatalkan</span><i class="bi bi-slash-circle"></i></div><div class="kpi-value">' + r.Batal + '</div></div></div>';
    $('antChip').innerHTML = [['', 'Semua'], ['Antri', 'Menunggu'], ['Terkirim', 'Terkirim'], ['Gagal', 'Gagal'], ['Batal', 'Batal']].map(function (o) {
      return '<button class="chip' + (filterAntrean === o[0] ? ' active' : '') + '" onclick="filterAntrean=\'' + o[0] + '\'; muatAntrean()">' + o[1] + '</button>';
    }).join('');
    $('antInfo').innerHTML = !d.waAktif ? '<div class="alert-crm alert-kuning mb-2"><i class="bi bi-pause-circle"></i> WhatsApp NONAKTIF — pesan menunggu tidak dikirim sampai saklar dinyalakan.</div>' :
      (!d.trigger ? '<div class="alert-crm alert-kuning mb-2"><i class="bi bi-clock"></i> Pengiriman terjadwal belum aktif. Jalankan <code>setupNotifWA</code> sekali di editor Apps Script.</div>' : '');
    $('antList').innerHTML = d.list.length ? d.list.map(function (x) {
      const warna = { Terkirim: 'badge-lunas', Gagal: 'badge-overdue', Antri: 'badge-belum', Batal: '' }[x.Status] || '';
      return '<div class="inv-card"><div class="d-flex justify-content-between gap-2 flex-wrap">' +
        '<div class="min-w-0"><strong>' + esc(x.Nama || x.Tujuan) + '</strong> <span class="crm-no">' + esc(x.Tujuan) + '</span>' +
          '<div class="inv-meta">' + esc(labelEvent(x.Event)) + ' · ' + crmWaktu(x.Waktu) + (x.Percobaan ? ' · percobaan ' + x.Percobaan : '') + '</div></div>' +
        '<span class="badge-status ' + warna + '">' + esc(x.Status === 'Antri' ? 'Menunggu' : x.Status) + '</span></div>' +
        '<div class="crm-pesan-potong">' + esc(x.Pesan) + '</div>' +
        (x.Respon && x.Status !== 'Terkirim' ? '<div class="inv-meta text-magenta">' + esc(x.Respon) + '</div>' : '') + '</div>';
    }).join('') : '<div class="card-x"><div class="empty-state"><i class="bi bi-send"></i>Belum ada pesan.</div></div>';
  }
}

function labelEvent(e) {
  return { INVOICE_DIBUAT: 'Invoice baru', PEMBAYARAN_DITERIMA: 'Pembayaran diterima', BLAST: 'Blast' }[e] || e;
}

function prosesSekarangUI(btn) {
  const selesai = tombolSibuk(btn, 'Memproses...');
  crmApi('prosesAntrianSekarang', [], function (res) { showToast('Antrean', res.message, 'info'); muatAntrean(); }, { selesai: selesai });
}

function ulangiGagalUI(btn) {
  const selesai = tombolSibuk(btn, '...');
  crmApi('ulangiNotifGagal', [], function (res) { showToast('Antrean', res.message, 'info'); muatAntrean(); }, { selesai: selesai });
}

// ════════════════════════════════════════════════════════
// TAB PENGATURAN WA (Owner)
// ════════════════════════════════════════════════════════

function renderPengaturanWA() {
  $('crmIsi').innerHTML = '<div id="pwIsi">' + skeleton(3) + '</div>';
  const adaCache = !!CRM.config;
  if (adaCache) gambarPengaturanWA(CRM.config);   // instan dari data terakhir
  crmApi('getNotifConfig', [], function (res) {
    const berubah = JSON.stringify(res.data) !== JSON.stringify(CRM.config);
    CRM.config = res.data;
    if (typeof simpanCacheInstan === 'function') simpanCacheInstan('crmConfig', res.data);
    // Jangan menimpa formulir yang sedang diisi pengguna
    const sedangDiisi = $('pwIsi') && $('pwIsi').contains(document.activeElement) && document.activeElement !== document.body;
    if (!adaCache || (berubah && !sedangDiisi)) gambarPengaturanWA(res.data);
  }, { wadah: adaCache ? null : 'pwIsi', ulang: 'renderPengaturanWA()' });
}

function gambarPengaturanWA(c) {
  if (!$('pwIsi')) return;   // halaman sudah berpindah
  $('pwIsi').innerHTML =
    '<div class="row g-3">' +
      '<div class="col-lg-5"><div class="card-x"><div class="card-x-head"><h2><i class="bi bi-whatsapp text-success"></i> WhatsApp (Fonnte)</h2></div><div class="card-x-body">' +
        '<div class="form-check form-switch saklar-besar mb-3"><input class="form-check-input" type="checkbox" id="pwAktif"' + (c.waAktif ? ' checked' : '') + '>' +
          '<label class="form-check-label" for="pwAktif">Notifikasi WhatsApp <strong id="pwAktifTeks">' + (c.waAktif ? 'AKTIF' : 'NONAKTIF') + '</strong></label></div>' +
        '<label class="form-label" for="pwToken">Token Fonnte</label>' +
        '<div class="input-group mb-1"><input type="password" class="form-control" id="pwToken" autocomplete="off" placeholder="' + esc(c.adaToken ? c.tokenSamar + ' (tersimpan)' : 'Tempel token dari fonnte.com → Device') + '">' +
          (c.adaToken ? '<button class="btn btn-ghost" type="button" onclick="hapusTokenWA()" title="Hapus token"><i class="bi bi-trash3"></i></button>' : '') + '</div>' +
        '<div class="form-text mb-3">Token disimpan aman di server (Script Properties), tidak di spreadsheet dan tidak pernah dikirim balik ke browser.</div>' +
        '<div class="d-flex gap-2 flex-wrap mb-3">' +
          '<button class="btn btn-ghost btn-sm" onclick="cekPerangkatUI(this)"' + (c.adaToken ? '' : ' disabled') + '><i class="bi bi-phone"></i> Cek perangkat</button>' +
          '<div class="input-group input-group-sm crm-tes"><input class="form-control" id="pwTesNo" placeholder="08… untuk tes" inputmode="tel">' +
            '<button class="btn btn-ghost" onclick="kirimTesUI(this)"' + (c.adaToken ? '' : ' disabled') + '>Kirim tes</button></div>' +
        '</div>' +
        '<div id="pwPerangkat" class="small mb-3"></div>' +
        '<div class="row g-2">' +
          '<div class="col-6"><label class="form-label" for="pwBatch">Batch blast bawaan</label><select class="form-select" id="pwBatch">' +
            [10, 20, 50].map(function (n) { return '<option' + (c.batch === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
          '<div class="col-6"><label class="form-label" for="pwJeda">Jeda (detik)</label><input class="form-control" id="pwJeda" value="' + esc(c.jeda) + '"></div>' +
        '</div>' +
        '<div class="form-text mt-2">Pengiriman terjadwal: <strong>' + (c.trigger ? 'aktif (tiap 5 menit)' : 'belum aktif — jalankan setupNotifWA di editor Apps Script') + '</strong></div>' +
      '</div></div></div>' +
      '<div class="col-lg-7"><div class="card-x"><div class="card-x-head"><h2>Notifikasi otomatis</h2></div><div class="card-x-body">' +
        '<p class="small text-muted">Pesan masuk antrean saat kejadian terjadi, lalu dikirim beberapa detik kemudian. Notifikasi ini tetap dikirim ke kontak opt-out (opt-out hanya berlaku untuk blast).</p>' +
        c.events.map(function (e) {
          return '<div class="pw-event">' +
            '<div class="d-flex justify-content-between align-items-start gap-2">' +
              '<div><strong>' + esc(e.label) + '</strong><div class="inv-meta">' + esc(e.keterangan) + '</div></div>' +
              '<div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" id="ev_' + e.kode + '"' + (e.wa ? ' checked' : '') + '>' +
                '<label class="visually-hidden" for="ev_' + e.kode + '">Aktifkan ' + esc(e.label) + '</label></div>' +
            '</div>' +
            '<details class="mt-2"><summary class="small">Ubah isi pesan</summary>' +
              '<div class="d-flex gap-1 flex-wrap my-1">' + e.variabel.map(function (v) {
                return '<button class="btn btn-ghost btn-sm" onclick="sisipVariabel(\'tpl_' + e.kode + '\', \'{' + v + '}\')">{' + v + '}</button>';
              }).join('') + '</div>' +
              '<textarea class="form-control" rows="8" id="tpl_' + e.kode + '">' + esc(e.pesan) + '</textarea>' +
              '<button class="btn btn-link btn-sm p-0 mt-1" onclick="$(\'tpl_' + e.kode + '\').value = CRM.config.events.filter(function(x){return x.kode===\'' + e.kode + '\'})[0].pesanDefault">↺ Kembalikan pesan bawaan</button>' +
            '</details></div>';
        }).join('') +
      '</div></div></div>' +
    '</div>' +
    '<div class="d-flex justify-content-end mt-3"><button class="btn btn-cyan" id="pwSimpan" onclick="simpanPengaturanWA()"><i class="bi bi-save"></i> Simpan pengaturan</button></div>';
  $('pwAktif').onchange = function () { $('pwAktifTeks').textContent = this.checked ? 'AKTIF' : 'NONAKTIF'; };
}

function simpanPengaturanWA(tokenKhusus) {
  const c = CRM.config;
  const matriks = {};
  c.events.forEach(function (e) { matriks[e.kode] = { wa: $('ev_' + e.kode).checked, pesan: $('tpl_' + e.kode).value }; });
  const obj = { waAktif: $('pwAktif').checked, token: tokenKhusus || $('pwToken').value.trim(),
    batch: Number($('pwBatch').value), jeda: $('pwJeda').value.trim(), matriks: matriks };
  const selesai = tombolSibuk($('pwSimpan'), 'Menyimpan...');
  crmApi('simpanNotifConfig', [obj], function (res) {
    CRM.config = res.data;
    if (typeof simpanCacheInstan === 'function') simpanCacheInstan('crmConfig', res.data);
    showToast('Tersimpan', res.message, 'success');
    gambarPengaturanWA(res.data);
  }, { selesai: selesai });
}

function hapusTokenWA() {
  konfirmasi('Hapus token Fonnte? Notifikasi WhatsApp otomatis dimatikan.', function () {
    $('pwAktif').checked = false;
    simpanPengaturanWA('__HAPUS__');
  });
}

function cekPerangkatUI(btn) {
  const selesai = tombolSibuk(btn, 'Mengecek...');
  crmApi('cekPerangkatWA', [], function (res) {
    const d = res.data;
    if (!$('pwPerangkat')) return;   // halaman sudah berpindah
    $('pwPerangkat').innerHTML = '<div class="crm-info">' +
      '<div><span>Nomor</span>' + esc(d.nomor || '-') + '</div>' +
      '<div><span>Status</span>' + (d.status === 'connect' ? '<span class="text-success fw-bold">Terhubung</span>' :
        '<span><span class="text-magenta fw-bold">Terputus</span> (' + esc(d.status || '-') + ')</span>') + '</div>' +
      (d.status === 'connect' ? '' :
        '<div class="alert-crm alert-kuning mt-1"><i class="bi bi-qr-code-scan"></i> WhatsApp belum tersambung ke Fonnte, jadi pesan belum bisa dikirim. ' +
        'Buka <strong>fonnte.com → Device → Connect</strong>, lalu scan QR dari HP nomor ' + esc(d.nomor || 'usaha Anda') +
        ' (WhatsApp → Perangkat tertaut → Tautkan perangkat). Setelah itu klik <strong>Cek perangkat</strong> lagi.</div>') +
      '<div><span>Paket</span>' + esc(d.paket || '-') + ' · kuota ' + esc(d.kuota || '-') + '</div>' +
      '<div><span>Berlaku s/d</span>' + esc(d.kedaluwarsa || '-') + '</div></div>';
  }, { selesai: selesai });
}

function kirimTesUI(btn) {
  const no = $('pwTesNo').value.trim();
  if (!no) { $('pwTesNo').focus(); return; }
  const selesai = tombolSibuk(btn, '...');
  crmApi('kirimTesWA', [no], function (res) { showToast('Terkirim', res.message, 'success'); }, {
    selesai: selesai,
    gagal: function () { if ($('pwPerangkat') && !$('pwPerangkat').innerHTML) cekPerangkatUI(document.createElement('button')); }   // tampilkan penyebabnya
  });
}

// ════════════════════════════════════════════════════════
// MODAL SERBAGUNA
// ════════════════════════════════════════════════════════

function pastikanModalCrm() {
  if ($('crmModal')) return;
  const div = document.createElement('div');
  div.innerHTML =
    '<div class="modal fade" id="crmModal" tabindex="-1" aria-labelledby="crmModalTitle">' +
      '<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" id="crmModalDialog"><div class="modal-content">' +
        '<div class="modal-header"><h5 class="modal-title" id="crmModalTitle"></h5>' +
          '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Tutup"></button></div>' +
        '<div class="modal-body" id="crmModalBody"></div>' +
        '<div class="modal-footer" id="crmModalFoot"></div>' +
      '</div></div></div>';
  document.body.appendChild(div.firstChild);
}

function bukaModalCrm(judul, isi, tombol, lebar) {
  pastikanModalCrm();
  $('crmModalTitle').textContent = judul;
  $('crmModalBody').innerHTML = isi;
  $('crmModalFoot').innerHTML = '<button class="btn btn-ghost" data-bs-dismiss="modal">Batal</button>' + (tombol || '');
  $('crmModalDialog').classList.toggle('modal-lg', !!lebar);
  bootstrap.Modal.getOrCreateInstance($('crmModal')).show();
}

function tutupModalCrm() {
  if ($('crmModal')) bootstrap.Modal.getOrCreateInstance($('crmModal')).hide();
}
