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
 * ============================================================
 */

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

        fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: prop, args: args })
        })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' dari server.');
            return res.json();
          })
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
