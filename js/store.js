/* Store: loads data/garage.json, keeps a local copy, syncs to GitHub (contents API). */
(function () {
  'use strict';
  var K = { data: 'garage.data', base: 'garage.base', dirty: 'garage.dirty', sha: 'garage.sha', set: 'garage.settings', img: 'garage.imgcache' };
  var DATA_PATH = 'data/garage.json';
  var state = { data: null, sha: null, syncing: false, lastError: '', source: '' };
  var listeners = [];
  var conflictHandler = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { console.warn('localStorage full?', e); return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function settings() {
    var s = {}; try { s = JSON.parse(lsGet(K.set) || '{}'); } catch (e) {}
    return { owner: s.owner || 'skyking211', repo: s.repo || 'garage', branch: s.branch || 'main', token: s.token || '' };
  }
  function saveSettings(s) { lsSet(K.set, JSON.stringify(s)); emit(); }
  function hasToken() { return !!settings().token; }
  function isDirty() { return lsGet(K.dirty) === '1'; }
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) { console.error(e); } }); }
  function onChange(f) { listeners.push(f); }
  function setConflictHandler(f) { conflictHandler = f; }

  /* ---------- base64 helpers (UTF-8 safe) ---------- */
  function b64FromBytes(bytes) {
    var bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function b64EncodeUtf8(str) { return b64FromBytes(new TextEncoder().encode(str)); }
  function b64DecodeUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- GitHub API ---------- */
  function api(path, opts) {
    var s = settings();
    opts = opts || {};
    var headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (s.token) headers['Authorization'] = 'Bearer ' + s.token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch('https://api.github.com' + path, { method: opts.method || 'GET', headers: headers, body: opts.body, cache: 'no-store' })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) { var err = new Error((j && j.message) || ('GitHub error ' + r.status)); err.status = r.status; err.body = j; throw err; }
          return j;
        });
      });
  }
  function contentsPath(p) { var s = settings(); return '/repos/' + encodeURIComponent(s.owner) + '/' + encodeURIComponent(s.repo) + '/contents/' + p.split('/').map(encodeURIComponent).join('/'); }
  function ghGetJson() {
    var s = settings();
    return api(contentsPath(DATA_PATH) + '?ref=' + encodeURIComponent(s.branch) + '&t=' + Date.now()).then(function (j) {
      return { sha: j.sha, json: JSON.parse(b64DecodeUtf8(j.content)) };
    });
  }
  function ghPut(path, b64content, message, sha) {
    var s = settings();
    var body = { message: message, content: b64content, branch: s.branch };
    if (sha) body.sha = sha;
    return api(contentsPath(path), { method: 'PUT', body: JSON.stringify(body) });
  }
  function testConnection() {
    var s = settings();
    return api('/repos/' + encodeURIComponent(s.owner) + '/' + encodeURIComponent(s.repo)).then(function (j) {
      var canWrite = j.permissions ? !!j.permissions.push : null;
      return { name: j.full_name, private: j.private, canWrite: canWrite, defaultBranch: j.default_branch };
    });
  }

  /* ---------- load / save ---------- */
  function normalize(d) {
    if (!d || typeof d !== 'object') throw new Error('Not a garage file');
    if (!Array.isArray(d.vehicles)) throw new Error('Missing "vehicles" list');
    d.vehicles.forEach(function (v) {
      v.category = v.category === 'aircraft' || v.category === 'tractor' ? v.category : 'vehicle';
      ['specs', 'schedule', 'parts', 'log', 'todos'].forEach(function (k) { if (!Array.isArray(v[k])) v[k] = []; });
    });
    d.vehicles.forEach(function (v) { if (v.vault !== undefined && v.vault !== null && (typeof v.vault !== 'object' || typeof v.vault.ct !== 'string')) delete v.vault; });
    d.sources = d.sources || {}; d.credits = d.credits || {};
    return d;
  }
  function persistLocal(dirty) {
    lsSet(K.data, JSON.stringify(state.data));
    if (dirty) lsSet(K.dirty, '1');
  }
  function load() {
    var local = lsGet(K.data);
    if (local && isDirty()) {
      try { state.data = normalize(JSON.parse(local)); state.sha = lsGet(K.sha) || null; state.source = 'local'; emit(); return Promise.resolve(state.data); } catch (e) { console.warn(e); }
    }
    var p = hasToken()
      ? ghGetJson().then(function (r) { state.sha = r.sha; lsSet(K.sha, r.sha); state.source = 'github'; return r.json; })
          .catch(function (e) { console.warn('GitHub load failed, using site copy', e); state.lastError = e.message; return fetchSite(); })
      : fetchSite();
    return p.then(function (d) {
      state.data = normalize(d);
      lsSet(K.base, JSON.stringify(state.data));
      persistLocal(false);
      emit();
      return state.data;
    }).catch(function (e) {
      if (local) { state.data = normalize(JSON.parse(local)); state.source = 'local'; emit(); return state.data; }
      throw e;
    });
  }
  function fetchSite() {
    state.source = 'site';
    return fetch(DATA_PATH + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('Could not load ' + DATA_PATH); return r.json(); });
  }

  /* Apply a change. mutator(data) edits in place. */
  function commit(mutator, message) {
    mutator(state.data);
    state.data.updated = new Date().toISOString().slice(0, 10);
    state.pendingMessage = message || 'Update garage data';
    state.rev = (state.rev || 0) + 1;
    persistLocal(true);
    emit();
    if (hasToken()) {
      if (state.syncing) { state.resync = true; return state.syncing.catch(function () {}); }
      return sync().catch(function () {});
    }
    return Promise.resolve();
  }

  function replaceAll(newData, message) {
    state.data = normalize(newData);
    return commit(function () {}, message || 'Import garage backup');
  }

  /* ---------- merge (union by id, mine wins) ---------- */
  function mergeArr(mine, theirs, key) {
    key = key || 'id';
    var out = mine.slice(); var seen = {};
    mine.forEach(function (x) { if (x && x[key] != null) seen[x[key]] = 1; });
    (theirs || []).forEach(function (x) { if (x && x[key] != null && !seen[x[key]]) out.push(x); });
    return out;
  }
  function merge(mine, theirs) {
    var m = JSON.parse(JSON.stringify(mine));
    var byId = {}; m.vehicles.forEach(function (v) { byId[v.id] = v; });
    (theirs.vehicles || []).forEach(function (tv) {
      var mv = byId[tv.id];
      if (!mv) { m.vehicles.push(tv); return; }
      mv.log = mergeArr(mv.log, tv.log); mv.parts = mergeArr(mv.parts, tv.parts); mv.todos = mergeArr(mv.todos, tv.todos);
      mv.schedule = mergeArr(mv.schedule, tv.schedule); mv.specs = mergeArr(mv.specs, tv.specs, 'label');
      if (mv.vault === undefined && tv.vault) mv.vault = tv.vault; // encrypted blob: mine wins, else take theirs (null = erased on purpose)
      if (mv.category === 'vehicle' && (tv.mileage || 0) > (mv.mileage || 0)) { mv.mileage = tv.mileage; mv.mileageDate = tv.mileageDate; mv.mileageNeedsUpdate = tv.mileageNeedsUpdate; }
      if (mv.category === 'tractor' && (tv.hours || 0) > (mv.hours || 0)) { mv.hours = tv.hours; mv.meterDate = tv.meterDate; }
      if (mv.category === 'aircraft' && (tv.totalTime || 0) > (mv.totalTime || 0)) { mv.totalTime = tv.totalTime; mv.tach = tv.tach; mv.meterDate = tv.meterDate; }
    });
    m.sources = Object.assign({}, theirs.sources || {}, m.sources || {});
    m.credits = Object.assign({}, theirs.credits || {}, m.credits || {});
    return m;
  }

  /* ---------- images ---------- */
  function imgCache() { try { return JSON.parse(lsGet(K.img) || '{}'); } catch (e) { return {}; } }
  function cachedImage(path) { return imgCache()[path] || null; }
  function cacheImage(path, dataUrl) { var c = imgCache(); c[path] = dataUrl; if (!lsSet(K.img, JSON.stringify(c))) { var o = {}; o[path] = dataUrl; lsSet(K.img, JSON.stringify(o)); } }

  function uploadPendingImages() {
    var jobs = [];
    state.data.vehicles.forEach(function (v) {
      if (typeof v.photo === 'string' && v.photo.indexOf('data:image/') === 0) jobs.push(v);
    });
    return jobs.reduce(function (p, v) {
      return p.then(function () {
        var dataUrl = v.photo;
        var ext = dataUrl.indexOf('image/png') > 0 ? 'png' : 'jpg';
        var path = 'images/' + v.id + '-' + Date.now() + '.' + ext;
        return ghPut(path, dataUrl.split(',')[1], 'Add photo for ' + (v.name || v.id)).then(function () {
          cacheImage(path, dataUrl);
          v.photo = path; if (v.turntable) delete v.turntable; delete v.photoSm;
          persistLocal(true);
        });
      });
    }, Promise.resolve());
  }

  /* ---------- sync ---------- */
  function sync(opts) {
    opts = opts || {};
    if (!hasToken()) return Promise.reject(new Error('No GitHub token set'));
    if (state.syncing) return state.syncing;
    state.lastError = ''; emit();
    var run = uploadPendingImages()
      .then(function () { return state.sha ? null : ghGetJson().then(function (r) { return checkBase(r); }); })
      .then(function () { return putData(); })
      .then(function () {
        state.syncing = false; emit();
        if (state.resync) { state.resync = false; return sync(); }
      })
      .catch(function (e) { state.syncing = false; state.resync = false; state.lastError = e.cancelled ? '' : (e.message || String(e)); emit(); throw e; });
    state.syncing = run; emit();
    return run;
  }
  function checkBase(remote) {
    // We have no sha (data came from the public site). Safe if remote matches what we started from.
    var base = lsGet(K.base);
    if (base && JSON.stringify(normalize(remote.json)) === JSON.stringify(normalize(JSON.parse(base)))) { state.sha = remote.sha; return; }
    return resolveConflict(remote);
  }
  function putData() {
    var body = JSON.stringify(state.data, null, 1) + '\n';
    var rev = state.rev || 0;
    return ghPut(DATA_PATH, b64EncodeUtf8(body), state.pendingMessage || 'Update garage data', state.sha).then(function (res) {
      state.sha = res.content.sha; lsSet(K.sha, state.sha);
      lsSet(K.base, body); state.source = 'github';
      if ((state.rev || 0) === rev) { lsDel(K.dirty); state.pendingMessage = null; }
      else state.resync = true; // edited while uploading: keep dirty, push again
    }).catch(function (e) {
      if (e.status === 409 || e.status === 422 || (e.status === 400 && /sha/i.test(e.message))) {
        return ghGetJson().then(function (remote) { return resolveConflict(remote); }).then(function () { return putData(); });
      }
      throw e;
    });
  }
  function resolveConflict(remote) {
    var ask = conflictHandler ? conflictHandler() : Promise.resolve('merge');
    return Promise.resolve(ask).then(function (choice) {
      if (choice === 'cancel') { var c = new Error('Sync cancelled'); c.cancelled = true; throw c; } // keep old sha so the next sync asks again
      state.sha = remote.sha;
      if (choice === 'theirs') {
        state.data = normalize(remote.json); lsSet(K.base, JSON.stringify(state.data)); persistLocal(false); lsDel(K.dirty); emit();
        var e = new Error('Kept the GitHub version'); e.cancelled = true; throw e;
      }
      if (choice === 'merge') state.data = normalize(merge(state.data, normalize(remote.json)));
      persistLocal(true);
    });
  }

  function discardLocal() { lsDel(K.dirty); lsDel(K.data); return load(); }

  window.Store = {
    load: load, commit: commit, sync: sync, replaceAll: replaceAll, discardLocal: discardLocal,
    settings: settings, saveSettings: saveSettings, hasToken: hasToken, isDirty: isDirty,
    testConnection: testConnection, onChange: onChange, setConflictHandler: setConflictHandler,
    cachedImage: cachedImage, merge: merge, normalize: normalize,
    get data() { return state.data; }, get state() { return state; }
  };
})();
