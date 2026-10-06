/* Vault: encrypted per-profile details (plate, VIN, N-number, serial, insurance...).
   WebCrypto only: PBKDF2-SHA256 (600,000 iterations, random 16-byte salt per vault) -> AES-GCM-256 (random 12-byte IV per save).
   Only the ciphertext is stored, as vehicle.vault = {v, kdf, iter, salt, iv, ct} (base64).
   The password and the decrypted values live only in memory while unlocked. Nothing here is logged or written to storage. */
(function () {
  'use strict';
  var ITER = 600000, MIN_ITER = 100000, MAX_ITER = 5000000, IDLE_MS = 5 * 60 * 1000;
  var te = new TextEncoder(), td = new TextDecoder();
  var subtle = window.crypto && window.crypto.subtle;

  /* ---------- crypto core ---------- */
  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(str) { var s = atob(str), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function rand(n) { return window.crypto.getRandomValues(new Uint8Array(n)); }
  function deriveKey(password, salt, iter) {
    return subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function validBlob(b) {
    return !!b && b.v === 1 && b.kdf === 'PBKDF2-SHA256' && typeof b.iter === 'number' && b.iter >= MIN_ITER && b.iter <= MAX_ITER &&
      typeof b.salt === 'string' && typeof b.iv === 'string' && typeof b.ct === 'string';
  }
  function encryptWith(key, salt, iter, payload) {
    // Pad to a 256-byte bucket so the ciphertext length says little about how much is inside.
    var len = te.encode(JSON.stringify(payload)).length + 10;
    var body = JSON.stringify(Object.assign({}, payload, { pad: new Array((256 - len % 256) % 256 + 1).join(' ') }));
    var iv = rand(12);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, te.encode(body)).then(function (ct) {
      return { v: 1, kdf: 'PBKDF2-SHA256', iter: iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
    });
  }
  function openBlob(blob, password) {
    if (!validBlob(blob)) return Promise.reject(new Error('This vault looks damaged or comes from a newer version of the site.'));
    var salt = unb64(blob.salt);
    return deriveKey(password, salt, blob.iter).then(function (key) {
      return subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct)).then(function (pt) {
        var data = JSON.parse(td.decode(pt)); delete data.pad;
        return { key: key, salt: salt, iter: blob.iter, data: data };
      }, function () { var e = new Error('Wrong password'); e.wrong = true; throw e; });
    });
  }
  function createBlob(password, payload) {
    var salt = rand(16);
    return deriveKey(password, salt, ITER).then(function (key) {
      return encryptWith(key, salt, ITER, payload).then(function (blob) { return { key: key, salt: salt, iter: ITER, blob: blob }; });
    });
  }

  /* ---------- password strength (rough guide, not a guarantee) ---------- */
  var COMMON = /pass(word|w0rd)|123456|qwerty|letmein|admin|welcome|iloveyou|monkey|dragon|abc123|111111|000000|skysail|enclave|buick|garage|glider|schweizer/i;
  function strength(pw) {
    if (!pw) return { score: 0, label: '' };
    var pool = 0;
    if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/[0-9]/.test(pw)) pool += 10; if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
    var uniq = new Set(pw.split('')).size;
    var bits = Math.log2(Math.max(pool, 2)) * pw.length * Math.min(1, uniq / Math.max(4, pw.length * 0.6));
    var words = pw.trim().split(/[\s\-_.,]+/).filter(function (w) { return w.length >= 3; }).length;
    if (words >= 3) bits = Math.max(bits, words * 12 + (pw.length >= 20 ? 10 : 0));
    if (COMMON.test(pw) && pw.length < 16) bits = Math.min(bits, 25);
    if (/^(.)\1*$/.test(pw)) bits = 4;
    var score = bits < 36 ? 1 : bits < 56 ? 2 : bits < 76 ? 3 : 4;
    return { score: score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] };
  }

  /* ---------- in-memory session ---------- */
  var SUGGEST = {
    vehicle: ['License plate', 'VIN', 'Registration exp.', 'Insurance policy #', 'Insurance company', 'Key/fob code', 'Notes'],
    aircraft: ['N-number', 'Serial #', 'Registration exp.', 'Insurance policy #', 'ELT/Transponder codes', 'Notes'],
    tractor: ['Serial # (engine/tractor)', 'PIN', 'Insurance policy #', 'Key code', 'Notes']
  };
  var sessions = {};     // vehicle id -> { key, salt, iter, fields: [{label, value, custom}], saved, show: {} }
  var sitePw = null;     // shared mode only: kept in memory while unlocked so other vaults can open; cleared on lock
  var fails = 0, waitUntil = 0, setupOpen = {}, lastActivity = Date.now();
  var mounted = null, H = null;  // H = helpers from app.js: { save, toast }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function find(d, id) { return ((d && d.vehicles) || []).filter(function (x) { return x.id === id; })[0]; }
  function cat(v) { return v && (v.category === 'aircraft' || v.category === 'tractor') ? v.category : 'vehicle'; }
  function shared() { return !window.Store || !Store.data || Store.data.vaultShared !== false; }
  function hasVault(v) { return !!(v && v.vault && typeof v.vault === 'object'); }
  function anyUnlocked() { return Object.keys(sessions).length > 0 || !!sitePw; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function touch() { lastActivity = Date.now(); }

  function fieldsFrom(v, data) {
    var stored = (data && Array.isArray(data.fields)) ? data.fields : [], out = [], used = {};
    SUGGEST[cat(v)].forEach(function (l) {
      var f = stored.filter(function (x) { return x.label === l; })[0]; used[l] = 1;
      out.push({ label: l, value: f ? String(f.value) : '', custom: false });
    });
    stored.forEach(function (x) { if (!used[x.label]) out.push({ label: String(x.label), value: String(x.value), custom: true }); });
    return out;
  }
  function payloadOf(s) {
    return { v: 1, updated: today(), fields: s.fields.filter(function (f) { return String(f.label).trim() && String(f.value).trim(); })
      .map(function (f) { return { label: String(f.label).trim(), value: String(f.value) }; }) };
  }
  function snapshot(s) { return JSON.stringify(payloadOf(s).fields); }
  function isDirty(s) { return !!s && snapshot(s) !== s.saved; }
  function makeSession(v, key, salt, iter, data) { var s = { key: key, salt: salt, iter: iter, fields: fieldsFrom(v, data), show: {} }; s.saved = snapshot(s); return s; }

  function failed() { fails++; if (fails >= 3) waitUntil = Date.now() + Math.min(30000, 1000 * Math.pow(2, fails - 2)); }
  function waitLeft() { return Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000)); }

  function unlock(v, pw) {
    return openBlob(v.vault, pw).then(function (r) {
      fails = 0; waitUntil = 0;
      sessions[v.id] = makeSession(v, r.key, r.salt, r.iter, r.data);
      if (shared()) { sitePw = pw; unlockOthers(pw, v.id); }
      touch();
    }, function (e) { if (e.wrong) failed(); throw e; });
  }
  function unlockOthers(pw, skip) {
    Store.data.vehicles.forEach(function (o) {
      if (o.id === skip || !hasVault(o) || sessions[o.id]) return;
      openBlob(o.vault, pw).then(function (r) { if (sitePw === pw && !sessions[o.id]) sessions[o.id] = makeSession(o, r.key, r.salt, r.iter, r.data); }, function () { /* different password: stays locked */ });
    });
  }
  function commitBlobs(list, msg, ok) {  // list: [{id, blob}]
    return H.save(function (d) { list.forEach(function (x) { var t = find(d, x.id); if (t) t.vault = x.blob; }); }, msg, ok);
  }
  function saveVault(v) {
    var s = sessions[v.id]; if (!s) return Promise.resolve();
    return encryptWith(s.key, s.salt, s.iter, payloadOf(s)).then(function (blob) {
      s.saved = snapshot(s);
      return commitBlobs([{ id: v.id, blob: blob }], 'Update encrypted vault (' + v.name + ')', 'Vault saved (encrypted)');
    });
  }
  function setup(v, pw) {
    return createBlob(pw, { v: 1, updated: today(), fields: [] }).then(function (r) {
      sessions[v.id] = makeSession(v, r.key, r.salt, r.iter, null);
      if (shared()) sitePw = pw;
      setupOpen[v.id] = false; touch();
      return commitBlobs([{ id: v.id, blob: r.blob }], 'Create encrypted vault (' + v.name + ')', 'Vault created');
    });
  }
  function changePassword(v, cur, next) {
    return openBlob(v.vault, cur).then(function () {
      fails = 0;
      var targets = shared() ? Store.data.vehicles.filter(hasVault) : [v], skipped = [];
      return Promise.all(targets.map(function (o) {
        var have = sessions[o.id] ? Promise.resolve(sessions[o.id])
          : openBlob(o.vault, cur).then(function (r) { return makeSession(o, r.key, r.salt, r.iter, r.data); }, function () { skipped.push(o.name); return null; });
        return have.then(function (s) {
          if (!s) return null;
          return createBlob(next, payloadOf(s)).then(function (r) { return { id: o.id, blob: r.blob, s: { key: r.key, salt: r.salt, iter: r.iter, fields: s.fields, show: {} } }; });
        });
      })).then(function (res) {
        res = res.filter(Boolean);
        res.forEach(function (x) { x.s.saved = snapshot(x.s); sessions[x.id] = x.s; });
        if (shared()) sitePw = next;
        return commitBlobs(res, 'Change vault password (re-encrypted)', 'Password changed').then(function () { return skipped; });
      });
    }, function (e) { if (e.wrong) failed(); throw e; });
  }
  function lockAll(note) {
    var snap = sessions, had = anyUnlocked();
    sessions = {}; sitePw = null;
    if (!had) return;
    var dirty = Object.keys(snap).filter(function (id) { return isDirty(snap[id]); });
    // encrypt unsaved edits synchronously-captured, then drop every plaintext reference
    var jobs = dirty.map(function (id) { var s = snap[id]; return encryptWith(s.key, s.salt, s.iter, payloadOf(s)).then(function (blob) { return { id: id, blob: blob }; }); });
    Object.keys(snap).forEach(function (id) { snap[id].fields.forEach(function (f) { f.value = ''; f.label = ''; }); snap[id].key = null; });
    snap = null;
    render();
    if (jobs.length && H) Promise.all(jobs).then(function (list) { commitBlobs(list, 'Update encrypted vault (saved on auto-lock)', 'Vault locked · changes saved'); });
    else if (note && H) H.toast(note);
  }

  /* auto-lock: 5 minutes idle, or the page is hidden */
  ['pointerdown', 'keydown', 'input', 'touchstart', 'wheel', 'scroll'].forEach(function (ev) { document.addEventListener(ev, touch, { passive: true, capture: true }); });
  setInterval(function () { if (anyUnlocked() && Date.now() - lastActivity >= IDLE_MS) lockAll('Vault locked after 5 minutes idle'); }, 5000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') lockAll('Vault locked'); });
  window.addEventListener('pagehide', function () { lockAll(); });

  /* ---------- UI ---------- */
  var ICO_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.4" class="fill"/></svg>';
  var ICO_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.6"/><circle cx="12" cy="15.5" r="1.4" class="fill"/></svg>';
  var ICO_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var ICO_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>';
  var USER = '<input type="text" name="username" value="skysailing-vault" autocomplete="username" hidden>';
  var MASK_OK = window.CSS && CSS.supports && (CSS.supports('-webkit-text-security', 'disc') || CSS.supports('text-security', 'disc'));

  function head(state, badge) {
    return '<div class="panel-head"><h2 class="vault-title"><span class="vault-ico">' + (state === 'open' ? ICO_OPEN : ICO_LOCK) + '</span>Vault</h2><span class="badge vault-badge ' + state + '">' + badge + '</span></div>';
  }
  function meterHtml() { return '<div class="vmeter" data-score="0" aria-hidden="true"><i></i></div><p class="vmeter-label small" aria-live="polite">Use 12+ characters, or a passphrase of 4 or more random words.</p>'; }
  function bindMeter(root) {
    var pw = root.querySelector('[name=pw]'), m = root.querySelector('.vmeter'), lab = root.querySelector('.vmeter-label');
    if (!pw || !m) return;
    pw.addEventListener('input', function () {
      var st = strength(pw.value); m.dataset.score = st.score;
      lab.textContent = !pw.value ? 'Use 12+ characters, or a passphrase of 4 or more random words.' : st.label + (pw.value.length < 12 ? ' · ' + pw.value.length + ' characters. 12+ recommended.' : ' · ' + pw.value.length + ' characters');
    });
  }
  function msg(el, text, kind) { var m = el.querySelector('.vault-msg'); if (m) { m.textContent = text || ''; m.className = 'vault-msg ' + (kind || ''); } }
  function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }
  function countdown(el, btn) {
    var t = setInterval(function () {
      var left = waitLeft();
      if (!document.body.contains(el) || left <= 0) { clearInterval(t); if (btn) btn.disabled = false; if (left <= 0) msg(el, 'Wrong password. Try again.', 'bad'); return; }
      msg(el, 'Wrong password. Too many tries. Wait ' + left + 's.', 'bad');
    }, 250);
    if (btn) btn.disabled = true;
  }
  function pwOk(el, pw, pw2) {
    if (pw.length < 8) { msg(el, 'Use at least 8 characters (12+ recommended).', 'bad'); return false; }
    if (pw !== pw2) { msg(el, 'The two passwords don’t match.', 'bad'); return false; }
    if (strength(pw).score < 3 && !confirm('This password is ' + (strength(pw).label || 'weak').toLowerCase() + '. The encrypted vault is public, so a short password can be guessed by a fast computer.\n\nUse it anyway?')) return false;
    return true;
  }

  function mount(el, v, helpers) { H = helpers; mounted = { el: el, id: v.id }; render(); }
  function render() {
    if (!mounted || !mounted.el || !document.body.contains(mounted.el)) return;
    var v = find(Store.data, mounted.id); if (!v) return;
    var el = mounted.el, s = sessions[v.id];
    if (!subtle) { el.innerHTML = head('locked', 'Unavailable') + '<p class="small">The Vault needs a secure (https) page and a modern browser. Open the site at its https:// address.</p>'; return; }
    el.dataset.state = s ? 'open' : hasVault(v) ? 'locked' : 'empty';
    if (s) renderOpen(el, v, s); else if (hasVault(v)) renderLocked(el, v); else renderSetup(el, v);
  }

  function renderLocked(el, v) {
    var air = cat(v) === 'aircraft', trac = cat(v) === 'tractor';
    el.innerHTML = head('locked', 'Locked · AES-256') +
      '<p class="small">' + (air ? 'N-number, serial, registration, insurance, ELT/transponder codes.' : trac ? 'Tractor and engine serials, PIN, insurance, key code.' : 'Plate, VIN, registration, insurance, key code.') + ' Encrypted on your phone before it’s saved. The public repo only holds scrambled text.</p>' +
      '<form class="form vault-form" data-vunlock>' + USER +
      '<div class="field"><label for="vpw-' + esc(v.id) + '">' + (shared() ? 'Vault password' : 'Vault password for ' + esc(v.name)) + '</label><input id="vpw-' + esc(v.id) + '" type="password" name="pw" autocomplete="current-password" autocapitalize="off" spellcheck="false" required></div>' +
      '<button class="btn primary big vault-go" type="submit">' + ICO_OPEN + 'Unlock</button></form>' +
      '<p class="vault-msg" role="alert" aria-live="assertive"></p>' +
      '<button type="button" class="vault-link" data-vforgot>Forgot the password?</button>';
    var f = el.querySelector('[data-vunlock]'), btn = f.querySelector('button');
    if (waitLeft()) countdown(el, btn);
    f.onsubmit = function (e) {
      e.preventDefault();
      var inp = f.querySelector('[name=pw]'), pw = inp.value;
      if (waitLeft()) { countdown(el, btn); return; }
      if (!pw) return;
      busy(btn, true, 'Unlocking…'); msg(el, '');
      unlock(v, pw).then(function () { inp.value = ''; H.toast('Vault unlocked', 'ok'); render(); }, function (err) {
        busy(btn, false); inp.value = ''; inp.focus();
        if (!err.wrong) { msg(el, err.message, 'bad'); return; }
        if (waitLeft()) countdown(el, btn); else msg(el, 'Wrong password. Try again.', 'bad');
      });
      pw = null;
    };
    el.querySelector('[data-vforgot]').onclick = function () {
      if (!confirm('Nobody can recover a lost vault password, not even GitHub. The data is encrypted and the password isn’t stored anywhere.\n\nThe only fix is to ERASE this vault and type the details in again with a new password. Erase it?')) return;
      if (prompt('Type ERASE to permanently delete the encrypted vault for ' + v.name + '.') !== 'ERASE') return;
      delete sessions[v.id];
      H.save(function (d) { var t = find(d, v.id); if (t) t.vault = null; }, 'Erase vault (' + v.name + ')', 'Vault erased');
    };
  }

  function renderSetup(el, v) {
    var others = Store.data.vehicles.filter(function (o) { return o.id !== v.id && hasVault(o); });
    var useSite = shared() && others.length > 0;
    var h = head('empty', 'Not set up') + '<p class="small">Keep the ' + (cat(v) === 'aircraft' ? 'N-number, serial, registration and insurance' : cat(v) === 'tractor' ? 'tractor serial, engine serial, PIN and insurance' : 'plate, VIN, registration and insurance') + ' here. It’s encrypted with your password before it’s saved, so the public repo only sees scrambled text.</p>';
    if (!setupOpen[v.id]) {
      el.innerHTML = h + '<button class="btn primary big vault-go" type="button" data-vstart>' + ICO_LOCK + (useSite ? 'Set up vault' : 'Set vault password') + '</button>';
      el.querySelector('[data-vstart]').onclick = function () { setupOpen[v.id] = true; render(); var i = el.querySelector('input[type=password]'); if (i) i.focus(); };
      return;
    }
    if (useSite && sitePw) {
      el.innerHTML = h + '<p class="callout">Uses the vault password you already set for this site.</p><button class="btn primary big vault-go" type="button" data-vcreate>' + ICO_LOCK + 'Create encrypted vault</button><p class="vault-msg" role="alert"></p>';
      el.querySelector('[data-vcreate]').onclick = function () { var b = this; busy(b, true, 'Encrypting…'); setup(v, sitePw).catch(function (e) { busy(b, false); msg(el, e.message, 'bad'); }); };
      return;
    }
    if (useSite) {
      el.innerHTML = h + '<form class="form vault-form" data-vsite>' + USER +
        '<div class="field"><label for="vsp-' + esc(v.id) + '">Your site vault password</label><input id="vsp-' + esc(v.id) + '" type="password" name="pw" autocomplete="current-password" required></div>' +
        '<p class="small">One password opens every vault (change this in Settings).</p><button class="btn primary big vault-go">' + ICO_LOCK + 'Create encrypted vault</button></form><p class="vault-msg" role="alert"></p>';
      var fs = el.querySelector('[data-vsite]'), bs = fs.querySelector('button');
      fs.onsubmit = function (e) {
        e.preventDefault(); var inp = fs.querySelector('[name=pw]'), pw = inp.value; inp.value = '';
        if (waitLeft()) { countdown(el, bs); return; }
        busy(bs, true, 'Checking…');
        unlock(others[0], pw).then(function () { return setup(v, pw); }).catch(function (err) {
          busy(bs, false); if (err.wrong) { if (waitLeft()) countdown(el, bs); else msg(el, 'Wrong password. Try again.', 'bad'); } else msg(el, err.message, 'bad');
        });
      };
      return;
    }
    el.innerHTML = h +
      '<div class="callout warn"><strong>This password can’t be recovered.</strong> It isn’t stored anywhere. If it’s lost, the vault must be erased and the details typed in again. Write it down somewhere safe (not on this site).</div>' +
      '<form class="form vault-form" data-vsetup>' + USER +
      '<div class="field"><label for="vn-' + esc(v.id) + '">' + (shared() ? 'New vault password (one for the whole site)' : 'New vault password for ' + esc(v.name)) + '</label><input id="vn-' + esc(v.id) + '" type="password" name="pw" autocomplete="new-password" autocapitalize="off" spellcheck="false" required></div>' +
      meterHtml() +
      '<div class="field"><label for="vn2-' + esc(v.id) + '">Type it again</label><input id="vn2-' + esc(v.id) + '" type="password" name="pw2" autocomplete="new-password" autocapitalize="off" spellcheck="false" required></div>' +
      '<label class="vchk"><input type="checkbox" data-vshowpw> Show password</label>' +
      '<div class="form-actions"><button type="button" class="btn ghost" data-vcancel>Cancel</button><button class="btn primary vault-go" type="submit">' + ICO_LOCK + 'Create vault</button></div></form>' +
      '<p class="vault-msg" role="alert"></p>';
    var f = el.querySelector('[data-vsetup]'), btn = f.querySelector('button[type=submit]');
    bindMeter(f);
    f.addEventListener('input', function () { msg(el, ''); });
    f.querySelector('[data-vshowpw]').onchange = function () { var t = this.checked ? 'text' : 'password'; f.querySelectorAll('input[name^=pw]').forEach(function (i) { i.type = t; }); };
    f.querySelector('[data-vcancel]').onclick = function () { setupOpen[v.id] = false; render(); };
    f.onsubmit = function (e) {
      e.preventDefault();
      var a = f.querySelector('[name=pw]'), b = f.querySelector('[name=pw2]');
      if (!pwOk(el, a.value, b.value)) return;
      var pw = a.value; a.value = ''; b.value = '';
      busy(btn, true, 'Encrypting…');
      setup(v, pw).catch(function (err) { busy(btn, false); msg(el, err.message, 'bad'); });
      pw = null;
    };
  }

  function rowHtml(f, i, s) {
    var shown = !!s.show[i], id = 'vf-' + i, notes = !f.custom && f.label === 'Notes';
    var common = ' id="' + id + '" data-vval="' + i + '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-form-type="other"';
    var cls = 'vinput' + (shown ? '' : MASK_OK ? ' masked' : ' blurred');
    var input = notes ? '<textarea' + common + ' class="' + cls + '" rows="3">' + esc(f.value) + '</textarea>'
      : '<input type="text"' + common + ' class="' + cls + '" value="' + esc(f.value) + '">';
    return '<div class="vrow' + (f.custom ? ' custom' : '') + '">' +
      (f.custom ? '<input type="text" class="vlabel-in" data-vlabel="' + i + '" value="' + esc(f.label) + '" placeholder="Field name" aria-label="Field name" autocomplete="off">' : '<label class="vlabel" for="' + id + '">' + esc(f.label) + '</label>') +
      '<div class="vval">' + input +
      '<button type="button" class="icon-btn" data-veye="' + i + '" aria-pressed="' + shown + '" aria-label="' + (shown ? 'Hide' : 'Show') + ' ' + esc(f.label || 'value') + '">' + ICO_EYE + '</button>' +
      '<button type="button" class="icon-btn" data-vcopy="' + i + '" aria-label="Copy ' + esc(f.label || 'value') + '">' + ICO_COPY + '</button>' +
      (f.custom ? '<button type="button" class="icon-btn" data-vdel="' + i + '" aria-label="Remove field">✕</button>' : '') + '</div></div>';
  }
  function renderOpen(el, v, s) {
    var allShown = s.fields.length && s.fields.every(function (f, i) { return s.show[i]; });
    el.innerHTML = head('open', 'Unlocked') +
      '<p class="small">Showing on this device only. Locks itself after 5 minutes idle or when you leave the page. Plates, VINs and N-numbers are fine here: they’re encrypted before saving.</p>' +
      '<div class="vrows">' + s.fields.map(function (f, i) { return rowHtml(f, i, s); }).join('') + '</div>' +
      '<div class="row-btns"><button type="button" class="btn small" data-vadd>＋ Custom field</button><button type="button" class="btn small ghost" data-vshowall>' + (allShown ? 'Hide all' : 'Show all') + '</button></div>' +
      '<p class="vault-dirty small" ' + (isDirty(s) ? '' : 'hidden') + '>● Unsaved changes</p>' +
      '<div class="vault-actions"><button type="button" class="btn primary big" data-vsave>Save vault</button><button type="button" class="btn big" data-vlock>' + ICO_LOCK + 'Lock</button></div>' +
      '<details class="vault-change"><summary>Change password</summary><form class="form vault-form" data-vchange>' + USER +
        '<div class="field"><label for="vc0">Current password</label><input id="vc0" type="password" name="cur" autocomplete="current-password" required></div>' +
        '<div class="field"><label for="vc1">New password</label><input id="vc1" type="password" name="pw" autocomplete="new-password" required></div>' + meterHtml() +
        '<div class="field"><label for="vc2">Type the new one again</label><input id="vc2" type="password" name="pw2" autocomplete="new-password" required></div>' +
        '<p class="small">' + (shared() ? 'Re-encrypts every vault on the site with the new password.' : 'Re-encrypts this vault with the new password.') + ' The new one can’t be recovered either.</p>' +
        '<button class="btn primary">Change password</button></form></details>' +
      '<p class="vault-msg" role="alert"></p>';
    var dirtyEl = el.querySelector('.vault-dirty');
    function markDirty() { dirtyEl.hidden = !isDirty(s); }
    el.querySelectorAll('[data-vval]').forEach(function (inp) { inp.addEventListener('input', function () { s.fields[+inp.dataset.vval].value = inp.value; markDirty(); }); });
    el.querySelectorAll('[data-vlabel]').forEach(function (inp) { inp.addEventListener('input', function () { s.fields[+inp.dataset.vlabel].label = inp.value; markDirty(); }); });
    el.querySelectorAll('[data-veye]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.veye, inp = el.querySelector('[data-vval="' + i + '"]'); s.show[i] = !s.show[i];
        inp.classList.toggle(MASK_OK ? 'masked' : 'blurred', !s.show[i]); b.setAttribute('aria-pressed', String(!!s.show[i]));
      };
    });
    el.querySelectorAll('[data-vcopy]').forEach(function (b) {
      b.onclick = function () {
        var f = s.fields[+b.dataset.vcopy]; if (!f || !f.value) { H.toast('Nothing to copy'); return; }
        copyText(f.value).then(function (ok) { H.toast(ok ? 'Copied ' + (f.label || 'value') : 'Copy failed', ok ? 'ok' : 'bad'); });
      };
    });
    el.querySelectorAll('[data-vdel]').forEach(function (b) { b.onclick = function () { s.fields.splice(+b.dataset.vdel, 1); s.show = {}; render(); }; });
    el.querySelector('[data-vadd]').onclick = function () { s.fields.push({ label: '', value: '', custom: true }); render(); var l = el.querySelectorAll('[data-vlabel]'); if (l.length) l[l.length - 1].focus(); };
    el.querySelector('[data-vshowall]').onclick = function () { var on = !allShown; s.show = {}; if (on) s.fields.forEach(function (f, i) { s.show[i] = true; }); render(); };
    el.querySelector('[data-vsave]').onclick = function () { var b = this; busy(b, true, 'Encrypting…'); saveVault(v).catch(function (e) { busy(b, false); msg(el, e.message, 'bad'); }); };
    el.querySelector('[data-vlock]').onclick = function () { lockAll('Vault locked'); };
    var cf = el.querySelector('[data-vchange]'), cb = cf.querySelector('button.primary');
    bindMeter(cf);
    cf.onsubmit = function (e) {
      e.preventDefault();
      var c = cf.querySelector('[name=cur]'), a = cf.querySelector('[name=pw]'), b2 = cf.querySelector('[name=pw2]');
      if (waitLeft()) { countdown(el, cb); return; }
      if (!pwOk(el, a.value, b2.value)) return;
      var cur = c.value, next = a.value; c.value = a.value = b2.value = '';
      busy(cb, true, 'Re-encrypting…');
      changePassword(v, cur, next).then(function (skipped) {
        if (skipped && skipped.length) H.toast('Changed. Not changed (different old password): ' + skipped.join(', '), 'warn');
      }, function (err) { busy(cb, false); if (err.wrong) { if (waitLeft()) countdown(el, cb); else msg(el, 'Current password is wrong.', 'bad'); } else msg(el, err.message, 'bad'); });
      cur = next = null;
    };
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.value = ''; ta.remove(); return ok;
    }
    return navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(text).then(function () { return true; }, fallback) : Promise.resolve(fallback());
  }

  /* ---------- settings panel ---------- */
  function settingsHtml() {
    var n = (Store.data.vehicles || []).filter(hasVault).length;
    return '<section class="panel reveal-up" id="vaultSettings"><div class="panel-head"><h2 class="vault-title"><span class="vault-ico">' + ICO_LOCK + '</span>Vault</h2><span class="badge ghost">' + n + ' vault' + (n === 1 ? '' : 's') + '</span></div>' +
      '<p class="small">Each profile has an encrypted Vault for the plate, VIN, N-number, serial and insurance. Encryption happens on your phone (AES-256, key made from your password with PBKDF2 600,000 rounds). The password is never saved. Lose it and the vault has to be erased and re-entered.</p>' +
      '<label class="vchk"><input type="checkbox" id="vaultShared"' + (shared() ? ' checked' : '') + '> One password for every vault (recommended)</label>' +
      '<p class="small">Turn this off to give each vehicle, aircraft or tractor its own password. Existing vaults keep the password they were made with. Use “Change password” inside a vault to switch it.</p>' +
      '<div class="row-btns"><button type="button" class="btn" id="vaultLockAll">' + ICO_LOCK + 'Lock all vaults now</button></div></section>';
  }
  function bindSettings(root, helpers) {
    H = helpers;
    var cb = root.querySelector('#vaultShared'), lb = root.querySelector('#vaultLockAll');
    if (cb) cb.onchange = function () { var on = cb.checked; lockAll(); H.save(function (d) { d.vaultShared = on; }, 'Vault: ' + (on ? 'one shared password' : 'separate passwords'), on ? 'One password for all vaults' : 'Separate vault passwords'); };
    if (lb) lb.onclick = function () { lockAll('All vaults locked'); };
  }

  window.Vault = { mount: mount, lockAll: lockAll, isUnlocked: function (id) { return !!sessions[id]; }, strength: strength, settingsHtml: settingsHtml, bindSettings: bindSettings,
    supported: !!subtle, _crypto: { openBlob: openBlob, createBlob: createBlob, encryptWith: encryptWith, validBlob: validBlob } };
})();
