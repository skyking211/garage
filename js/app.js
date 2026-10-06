/* Skysailing Garage: UI, routing, forms. Plain JS, no build step. */
(function () {
  'use strict';
  var S = window.Schedule;
  var app = document.getElementById('app');
  var FORM_EMAIL = 'Nighthooligans2@gmail.com';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- helpers ---------------- */
  function nw(s) { return esc(s).replace(/(\S*-\S*)/g, '<span class="nw">$1</span>'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return n == null || n === '' || isNaN(+n) ? '—' : (+n).toLocaleString('en-US', { maximumFractionDigits: 1 }); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fdate(d) { if (!d) return '—'; if (typeof d === 'string') d = S.parseDate(d); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function fmonth(d) { return MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function todayIso() { return S.iso(new Date()); }
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); }
  function vehicle(id) { return (Store.data.vehicles || []).filter(function (v) { return v.id === id; })[0]; }
  function isAir(v) { return v && v.category === 'aircraft'; }
  function ymm(v) { return [v.year, v.make, v.model].filter(Boolean).join(' '); }
  function img(src) { return (src && Store.cachedImage(src)) || src || null; }
  function placeholderFor(v) { return isAir(v) ? 'images/glider.svg' : 'images/car-placeholder.svg'; }
  function srcFor(v) { return img(v.photo) || placeholderFor(v); }
  function unitWord(v) { return isAir(v) ? 'hrs' : 'mi'; }

  var toastEl = document.getElementById('toast'), toastT;
  function toast(msg, kind) {
    toastEl.textContent = msg; toastEl.className = 'toast show ' + (kind || '');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.className = 'toast'; }, 2400);
  }
  function copy(text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove();
      return ok;
    }
    var p = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(text).then(function () { return true; }, fallback) : Promise.resolve(fallback());
    return p.then(function (ok) { toast(ok ? 'Copied ' + text : 'Copy failed. Long-press to select.', ok ? 'ok' : 'bad'); });
  }

  /* VIN / registration guard: this repo is public. */
  var VIN_RE = /\b(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/i;
  var NNUM_RE = /\bN[1-9][0-9]{0,4}[A-HJ-NP-Z]{0,2}\b/;
  function publicGuard(values, air) {
    var all = values.join(' \n ');
    if (VIN_RE.test(all)) { alert('That looks like a VIN (17 characters).\n\nThis site is PUBLIC, so remove it before saving.'); return false; }
    if (air && NNUM_RE.test(all) && !confirm('That looks like an N-number.\n\nThis site is PUBLIC. Save it anyway?')) return false;
    return true;
  }

  /* ---------------- modal ---------------- */
  var modal = document.getElementById('modal'), modalBody = document.getElementById('modalBody');
  function openModal(html, onReady) {
    modalBody.innerHTML = '<button class="modal-x" type="button" aria-label="Close">×</button>' + html;
    $('.modal-x', modalBody).onclick = closeModal;
    if (typeof modal.showModal === 'function') { if (!modal.open) modal.showModal(); } else modal.setAttribute('open', '');
    document.body.classList.add('modal-open');
    if (onReady) onReady(modalBody);
    var first = $('input:not([type=hidden]):not([type=checkbox]),textarea,select', modalBody); if (first && window.innerWidth > 700) first.focus();
  }
  function closeModal() { if (modal.open && modal.close) modal.close(); modal.removeAttribute('open'); document.body.classList.remove('modal-open'); }
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  modal.addEventListener('close', function () { document.body.classList.remove('modal-open'); });

  Store.setConflictHandler(function () {
    return new Promise(function (resolve) {
      openModal('<h2>Changes on GitHub too</h2><p>The data file on GitHub changed since you last loaded it (maybe from another phone or computer).</p>' +
        '<div class="stack"><button class="btn primary" data-c="merge">Merge both (recommended)</button>' +
        '<button class="btn" data-c="mine">Keep mine, overwrite GitHub</button>' +
        '<button class="btn" data-c="theirs">Use GitHub’s, drop my unsynced edits</button>' +
        '<button class="btn ghost" data-c="cancel">Not now</button></div><p class="small">Merge keeps every log entry, part and to-do from both copies.</p>', function (b) {
        var done = false;
        function finish(c) { if (done) return; done = true; modal.removeEventListener('close', onClose); resolve(c); }
        function onClose() { finish('cancel'); }
        modal.addEventListener('close', onClose);
        $('.modal-x', b).onclick = function () { closeModal(); finish('cancel'); };
        $$('[data-c]', b).forEach(function (btn) { btn.onclick = function () { var c = btn.dataset.c; finish(c); closeModal(); }; });
      });
    });
  });

  /* ---------------- sync pill ---------------- */
  var pill = document.getElementById('syncPill');
  function updatePill() {
    var st = Store.state, cls = '', lbl = '';
    if (!st.data) { lbl = '…'; }
    else if (st.syncing) { cls = 'busy'; lbl = 'Syncing…'; }
    else if (st.lastError && Store.isDirty()) { cls = 'bad'; lbl = 'Sync error'; }
    else if (Store.isDirty()) { cls = 'warn'; lbl = Store.hasToken() ? 'Not synced, tap' : 'Not synced'; }
    else if (Store.hasToken()) { cls = 'good'; lbl = 'Synced'; }
    else { cls = 'idle'; lbl = 'View only'; }
    pill.className = 'sync-pill ' + cls; $('.lbl', pill).textContent = lbl;
    pill.title = st.lastError ? ('Last error: ' + st.lastError) : (Store.hasToken() ? 'Saving to GitHub' : 'Edits are saved on this device only. Add a GitHub token in Settings to publish them.');
  }
  pill.onclick = function () {
    if (Store.hasToken() && Store.isDirty()) Store.sync().then(function () { toast('Synced to GitHub ✓', 'ok'); }, function (e) { if (!e.cancelled) toast('Sync failed: ' + e.message, 'bad'); route(); });
    else location.hash = '#/settings';
  };
  Store.onChange(updatePill);

  /* save wrapper with feedback (commit() already starts a sync when a token is set) */
  function save(mutator, msg, okText) {
    var p = Store.commit(mutator, msg);
    route();
    if (Store.hasToken()) {
      toast('Saving to GitHub…');
      p.then(function () {
        if (Store.isDirty()) toast('Saved on this device. Sync failed: ' + (Store.state.lastError || 'unknown error'), 'bad');
        else toast((okText || 'Saved') + ' · synced ✓', 'ok');
        route();
      });
    } else toast((okText || 'Saved') + ' on this device (not synced)', 'warn');
    return p;
  }

  /* ---------------- status text ---------------- */
  function statusLabel(s, v) {
    var u = unitWord(v);
    switch (s.status) {
      case 'na': return 'Severe schedule only';
      case 'notlogged': return 'Not yet logged';
      case 'unknown': return 'No record';
      case 'done': return 'Done';
    }
    var parts = [];
    if (s.remMeter != null) parts.push(s.remMeter < 0 ? num(-s.remMeter) + ' ' + u + ' over' : num(s.remMeter) + ' ' + u);
    if (s.remDays != null) parts.push(s.remDays < 0 ? fmonth(s.dueDate) + ' (past)' : 'by ' + fmonth(s.dueDate));
    var head = s.status === 'overdue' ? 'Overdue' : s.status === 'soon' ? 'Due soon' : 'OK';
    return head + (parts.length ? ' · ' + parts.join(' / ') : '');
  }
  function pillClass(st) { return { overdue: 'bad', soon: 'warn', ok: 'good', done: 'good', notlogged: 'muted', unknown: 'muted', na: 'muted' }[st] || 'muted'; }
  function pillText(st) { return { overdue: 'Overdue', soon: 'Due soon', ok: 'OK', done: 'Done', notlogged: 'Not yet logged', unknown: 'No record', na: 'N/A' }[st]; }

  function cardBadge(v) {
    var sum = S.summary(v);
    if (isAir(v)) {
      var ann = sum.statuses.filter(function (s) { return s.item.id === 'annual'; })[0];
      if (sum.counts.overdue) return { cls: 'bad', text: sum.counts.overdue + ' item' + (sum.counts.overdue > 1 ? 's' : '') + ' overdue' };
      if (ann && ann.status === 'notlogged') return { cls: 'muted', text: 'Annual: not yet logged' };
      if (ann) return { cls: pillClass(ann.status), text: 'Annual ' + statusLabel(ann, v).toLowerCase() };
      return { cls: 'muted', text: 'Nothing logged yet' };
    }
    var oil = sum.statuses.filter(function (s) { return s.item.id === 'oil'; })[0];
    var n = S.nextService(v);
    var main;
    if (oil && oil.status !== 'na') {
      if (oil.status === 'overdue') main = { cls: 'bad', text: 'Oil change overdue' };
      else main = { cls: pillClass(oil.status), text: 'Oil change due in ' + num(oil.remMeter) + ' mi' };
    } else if (n) main = { cls: pillClass(n.status), text: n.item.task + ': ' + statusLabel(n, v) };
    else main = { cls: 'muted', text: 'No schedule yet' };
    if (sum.counts.overdue) main.extra = sum.counts.overdue + ' overdue';
    else if (sum.counts.soon) main.extra = sum.counts.soon + ' due soon';
    return main;
  }

  function meterLine(v) {
    if (isAir(v)) {
      var tt = v.totalTime != null && v.totalTime !== '' ? num(v.totalTime) + ' hrs TT' : 'Total time: <span class="add-slot sm">add</span>';
      var tach = v.tach != null && v.tach !== '' ? ' · tach ' + num(v.tach) : '';
      return tt + tach;
    }
    return num(v.mileage) + ' mi' + (v.mileageNeedsUpdate ? ' <span class="flag">needs update</span>' : '');
  }

  /* ---------------- routing ---------------- */
  function parseHash() {
    var h = (location.hash || '#/').replace(/^#\/?/, '');
    return h.split('/').map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
  }
  function setTheme(sky) {
    document.body.dataset.theme = sky ? 'sky' : 'garage';
    $$('.tab').forEach(function (t) { var on = (t.dataset.tab === 'sky') === sky; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
    document.querySelector('meta[name=theme-color]').setAttribute('content', sky ? '#0a2340' : '#07090c');
  }
  var lastRouteKey = '';
  function route() {
    if (!Store.data) return;
    var p = parseHash(), key = p.join('/');
    var scrollTop = key !== lastRouteKey;
    lastRouteKey = key;
    var view = p[0] || '';
    try {
      if (view === '' || view === 'garage') { setTheme(false); renderHome('vehicle'); }
      else if (view === 'sky') { setTheme(true); renderHome('aircraft'); }
      else if (view === 'v') { var v = vehicle(p[1]); if (!v) return notFound(); setTheme(isAir(v)); renderProfile(v, p[2]); scrollTop = scrollTop && !p[2]; }
      else if (view === 'request') { var rv = vehicle(p[1]); if (!rv) return notFound(); setTheme(isAir(rv)); renderRequest(rv); }
      else if (view === 'settings') { renderSettings(); }
      else if (view === 'search') { renderSearch(p.slice(1).join('/')); scrollTop = false; }
      else notFound();
    } catch (e) { console.error(e); app.innerHTML = '<section class="panel"><h2>Something broke</h2><pre class="small">' + esc(e.stack || e) + '</pre></section>'; }
    if (scrollTop) window.scrollTo(0, 0);
    if (view !== 'search') { var si = $('#searchInput'); if (document.activeElement !== si) si.value = ''; }
  }
  function notFound() { app.innerHTML = '<section class="panel"><h2>Not found</h2><p><a class="btn" href="#/">Back to the garage</a></p></section>'; }
  window.addEventListener('hashchange', route);

  /* ---------------- HOME ---------------- */
  function renderHome(cat) {
    var air = cat === 'aircraft';
    var list = Store.data.vehicles.filter(function (v) { return v.category === cat; });
    var html = '<section class="intro reveal-up">' +
      (air ? '<p class="kicker">Sky Sailing · gliders</p><h1 class="display chrome">Ridge lift &amp; logbooks</h1><p class="lede">Annuals, ADs and squawks for the fleet. Tap a glider for its profile.</p>'
           : '<p class="kicker">The Garage · ' + list.length + ' vehicle' + (list.length === 1 ? '' : 's') + '</p><h1 class="display chrome">Oil, iron &amp; elbow grease</h1><p class="lede">What’s due, what’s done, and the part numbers. Tap a card.</p>') +
      '</section><section class="cards">';
    list.forEach(function (v, i) {
      var b = cardBadge(v);
      html += '<article class="card" style="--i:' + i + '">' +
        '<a class="card-photo" href="#/v/' + encodeURIComponent(v.id) + '" aria-label="Open ' + esc(v.name) + ' profile"><span class="card-spot"></span><img src="' + esc(srcFor(v)) + '" alt="' + esc(v.name) + '" loading="lazy"></a>' +
        '<div class="card-body"><div class="card-top"><h2 class="card-name">' + nw(v.name) + '</h2>' + (isAir(v) ? '<span class="cat-chip">Glider</span>' : '') + '</div>' +
        '<p class="card-ymm">' + esc(ymm(v) || 'Year / make / model: add') + '</p>' +
        '<p class="card-meter">' + meterLine(v) + '</p>' +
        '<p class="badges"><span class="badge ' + b.cls + '">' + esc(b.text) + '</span>' + (b.extra ? '<span class="badge ghost">' + esc(b.extra) + '</span>' : '') + '</p>' +
        '<div class="card-actions"><a class="btn primary big" href="#/v/' + encodeURIComponent(v.id) + '">Profile</a><a class="btn big" href="#/request/' + encodeURIComponent(v.id) + '">Request</a></div></div></article>';
    });
    html += '<button class="card add-card" type="button" id="addUnit" style="--i:' + list.length + '"><span class="plus">+</span><span>' + (air ? 'Add aircraft' : 'Add vehicle') + '</span></button></section>';
    app.innerHTML = html;
    $('#addUnit').onclick = function () { unitForm(cat); };
  }

  /* ---------------- PROFILE ---------------- */
  function renderProfile(v, section) {
    var air = isAir(v), u = unitWord(v);
    var sum = S.summary(v), next = S.nextService(v);
    var h = '<nav class="crumbs"><a href="' + (air ? '#/sky' : '#/') + '">‹ ' + (air ? 'Sky Sailing' : 'Garage') + '</a></nav>';
    h += '<section class="profile-head reveal-up"><p class="kicker">' + (air ? 'Glider' : 'Vehicle') + ' profile</p><h1 class="display chrome">' + nw(v.name) + '</h1>' +
      '<p class="lede">' + esc(ymm(v) || 'Year / make / model: add') + (v.color ? ' · <span class="swatch" style="--c:' + esc(v.colorHex || '#aaa') + '"></span>' + esc(v.color) : '') + (v.engine ? ' · ' + esc(v.engine) : '') + '</p></section>';
    h += '<section class="showroom" id="showroom"></section>';
    h += '<div class="photo-tools"><button class="btn small" id="changePhoto">📷 Change photo</button><button class="btn small" id="editUnit">✎ Edit details</button></div>';

    h += '<section class="grid2">';
    h += '<div class="panel meter-panel reveal-up"><p class="kicker">' + (air ? 'Total time / tach' : 'Odometer') + '</p>';
    if (air) {
      h += '<p class="meter-big">' + (v.totalTime != null && v.totalTime !== '' ? num(v.totalTime) + '<small> hrs TT</small>' : '<span class="add-slot">add</span><small> total time</small>') + '</p>' +
        '<p class="small">Tach: ' + (v.tach != null && v.tach !== '' ? num(v.tach) + ' hrs' : '<span class="add-slot sm">add</span>') + (v.meterDate ? ' · as of ' + fdate(v.meterDate) : '') + '</p>';
    } else {
      h += '<p class="meter-big">' + num(v.mileage) + '<small> mi</small></p><p class="small">as of ' + fdate(v.mileageDate) + '</p>';
      if (v.mileageNeedsUpdate) {
        var pc = S.pace(v);
        h += '<p class="callout warn"><strong>Mileage needs an update.</strong> ' + (pc ? 'At the recent pace (~' + num(Math.round(pc.perMonth / 10) * 10) + ' mi/month) it could be around <strong>' + num(Math.round(pc.estimateNow(new Date()) / 100) * 100) + ' mi</strong> by now. The statuses below use the last recorded reading.' : '') + '</p>';
      }
    }
    h += '<button class="btn primary big wide" id="editMeter">' + (air ? 'Update times' : 'Update mileage') + '</button></div>';

    h += '<div class="panel countdown reveal-up"><p class="kicker">Next service</p>';
    if (next) {
      var used = Math.max(0, Math.min(1, next.used == null ? 0 : next.used));
      var C = 2 * Math.PI * 52;
      h += '<div class="ring-wrap"><svg class="ring ' + pillClass(next.status) + '" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="ring-bg"/><circle cx="60" cy="60" r="52" class="ring-fg" style="stroke-dasharray:' + C.toFixed(1) + ';--off:' + (C * (1 - used)).toFixed(1) + ';stroke-dashoffset:' + (C * (1 - used)).toFixed(1) + '"/></svg>' +
        '<div class="ring-text"><strong>' + (next.remMeter != null ? (next.remMeter < 0 ? '−' + num(-next.remMeter) : num(next.remMeter)) : (next.remDays != null ? num(next.remDays) : '—')) + '</strong><span>' + (next.remMeter != null ? u + (next.remMeter < 0 ? ' over' : ' left') : 'days') + '</span></div></div>' +
        '<p class="next-task">' + esc(next.item.task) + '</p><p><span class="badge ' + pillClass(next.status) + '">' + esc(statusLabel(next, v)) + '</span></p>';
      if (sum.counts.overdue > 1 || (sum.counts.overdue && next.status !== 'overdue')) h += '<p class="small">' + sum.counts.overdue + ' items overdue. See the chart below.</p>';
    } else {
      h += '<p class="empty">' + (air ? 'Nothing logged yet. Log the last annual to start the countdown.' : 'No schedule yet.') + '</p>';
    }
    h += '</div></section>';

    h += '<section class="quick reveal-up"><button class="qa" id="qaLog"><span>＋</span>Log ' + (air ? 'entry' : 'service') + '</button><button class="qa" id="qaPart"><span>＋</span>Add part</button><button class="qa" id="qaTodo"><span>＋</span>' + (air ? 'Squawk' : 'To-do') + '</button><a class="qa" href="#/request/' + encodeURIComponent(v.id) + '"><span>✉</span>Request</a></section>';

    // specs
    h += '<section class="panel reveal-up" id="specs"><div class="panel-head"><h2>Quick specs</h2><button class="btn small" id="editSpecs">✎ Edit</button></div><dl class="specs">';
    v.specs.forEach(function (s) {
      h += '<div class="spec"><dt>' + esc(s.label) + '</dt><dd>' + (s.value ? esc(s.value) : '<button class="add-slot" data-addspec>add</button>') +
        (s.note ? '<span class="spec-note">' + esc(s.note) + '</span>' : '') + srcTag(s.source, s.status) + '</dd></div>';
    });
    if (!v.specs.length) h += '<p class="empty">No specs yet. Tap Edit to add some.</p>';
    h += '</dl>' + (air ? '<p class="small public-note">Keep the N-number and serial in the paper logbook. This site is public.</p>' : '') + '</section>';

    // schedule chart
    h += '<section class="panel reveal-up" id="schedule"><div class="panel-head"><h2>' + (air ? 'Annual inspection &amp; ADs' : 'Maintenance schedule') + '</h2>' +
      (!air ? '<div class="seg" role="group" aria-label="Schedule type"><button data-mode="normal" class="' + (v.scheduleMode !== 'severe' ? 'on' : '') + '">Normal</button><button data-mode="severe" class="' + (v.scheduleMode === 'severe' ? 'on' : '') + '">Severe</button></div>' : '') + '</div>';
    if (!air && v.inServiceAssumed) h += '<p class="small">Items with no record are counted from an <em>assumed</em> in-service date of ' + fdate(v.inServiceDate) + '. Change it under Edit details.</p>';
    h += '<div class="sched">';
    var order = sum.statuses.slice().sort(function (a, b) { return (S.RANK[a.status] - S.RANK[b.status]); });
    order.forEach(function (s) {
      var it = s.item, interval = [];
      if (s.every) interval.push('every ' + num(s.every) + ' ' + u);
      if (s.months) interval.push(s.months % 12 === 0 ? 'every ' + (s.months === 12 ? '12 months' : (s.months / 12) + ' years') : 'every ' + s.months + ' months');
      if (it.once) interval.push('one-time');
      if (!air && it.severeMiles && v.scheduleMode !== 'severe' && !it.everyMiles) interval.push('severe: every ' + num(it.severeMiles) + ' mi');
      var lastTxt = s.last ? fdate(s.last.date) + (s.lastMeter != null ? ' · ' + (s.lastEst ? '≈' : '') + num(s.lastMeter) + ' ' + u : '') : (s.assumedStart ? 'No record (counted from in-service)' : 'Not yet logged');
      var dueTxt = [];
      if (s.dueMeter != null) dueTxt.push(num(s.dueMeter) + ' ' + u);
      if (s.dueDate) dueTxt.push(fdate(s.dueDate));
      var used = s.used == null ? null : Math.max(0, Math.min(1, s.used));
      h += '<div class="srow ' + pillClass(s.status) + '"><div class="srow-main"><p class="stask">' + esc(it.task) + srcTag(it.source, it.status) + '</p>' +
        '<p class="sint">' + esc(interval.join(' or ') || '—') + (it.basis ? '<span class="sbasis">' + esc(it.basis) + '</span>' : '') + (it.note ? '<span class="sbasis">' + esc(it.note) + '</span>' : '') + '</p>' +
        '<p class="smeta"><span>Last: ' + lastTxt + '</span>' + (dueTxt.length ? '<span>Next: ' + dueTxt.join(' or ') + '</span>' : '') + '</p>' +
        (used != null ? '<div class="bar"><i style="width:' + (used * 100).toFixed(0) + '%"></i></div>' : '') +
        '</div><div class="srow-side"><span class="badge ' + pillClass(s.status) + '">' + pillText(s.status) + '</span>' +
        (s.status !== 'na' ? '<button class="btn tiny" data-logfor="' + esc(it.id) + '">Log</button>' : '') + '</div></div>';
    });
    if (!v.schedule.length) h += '<p class="empty">No schedule items yet.</p>';
    h += '</div><div class="row-btns"><button class="btn small" id="addSched">＋ Schedule item</button></div>';
    h += '<p class="footnote">' + (air ? 'Every item stays “not yet logged” until you log it. Nothing here is made up.' : 'Intervals come from the 2022 Buick Enclave Owner’s Manual, pp. 336–341 (Normal and Severe charts). “≈” means the mileage was estimated from nearby odometer readings.') + ' Sources are listed at the bottom.</p></section>';

    // parts
    h += '<section class="panel reveal-up" id="parts"><div class="panel-head"><h2>Parts</h2><button class="btn small" id="addPart2">＋ Add part</button></div>';
    if (!v.parts.length) h += '<p class="empty">No parts yet.</p>';
    h += '<div class="parts">';
    v.parts.forEach(function (p) {
      h += '<div class="part"><div class="part-head"><div><p class="kicker">' + esc(p.category || 'Part') + '</p><h3>' + esc(p.name) + '</h3>' + (p.qty ? '<p class="small">Qty: ' + esc(p.qty) + '</p>' : '') + '</div><button class="btn tiny ghost" data-editpart="' + esc(p.id) + '" aria-label="Edit part">✎</button></div><div class="pnums">';
      (p.numbers || []).forEach(function (n) {
        var st = n.status || 'user';
        h += '<div class="pnum-wrap"><button class="pnum ' + esc(st.replace(/\s+/g, '-')) + '" data-copy="' + esc(n.number) + '" title="Tap to copy"><span class="pbrand">' + esc(n.brand || '') + '</span><span class="pval">' + esc(n.number) + '</span><span class="pst">' + esc(stLabel(st)) + '</span></button>' +
          (n.note ? '<p class="pnote">' + esc(n.note) + (n.source ? srcTag(n.source) : '') + '</p>' : '') + '</div>';
      });
      h += '</div>' + (p.notes ? '<p class="small">' + esc(p.notes) + '</p>' : '');
      var q = p.buy || ((p.numbers && p.numbers[0] ? (p.numbers[0].brand + ' ' + p.numbers[0].number) : p.name));
      h += '<div class="buy"><a class="btn small amazon" target="_blank" rel="noopener" href="https://www.amazon.com/s?k=' + encodeURIComponent(q) + '">Amazon search ↗</a><a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/search?tbm=shop&amp;q=' + encodeURIComponent(q) + '">Compare prices ↗</a></div></div>';
    });
    h += '</div><p class="footnote">Tap a part number to copy it. Buy links are store <em>searches</em>, so check fitment before you order. Labels: <span class="pst verified">verified</span> = confirmed in a cited source · <span class="pst cross-ref">cross-ref</span> = interchange list only · <span class="pst unverified">unverified</span> · <span class="pst not-a-match">not a match</span> · <span class="pst user">added</span> = you typed it.</p></section>';

    // log
    var log = v.log.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    h += '<section class="panel reveal-up" id="log"><div class="panel-head"><h2>' + (air ? 'Aircraft logbook' : 'Maintenance log') + '</h2><button class="btn small" id="addLog2">＋ Log</button></div>';
    if (!log.length) h += '<p class="empty">' + (air ? 'The logbook is empty. Add entries from the paper logbook: date, total time, work done, who signed it off.' : 'No entries yet.') + '</p>';
    h += '<ol class="log">';
    log.forEach(function (e) {
      var m = S.meterOf(e, v), est = null;
      if (m == null && !air) est = S.estimateAt(v, e.date).m;
      h += '<li class="entry"><button class="entry-btn" data-editlog="' + esc(e.id) + '"><div class="entry-date"><strong>' + fdate(e.date) + '</strong>' + (e.dateUncertain ? '<span class="flag">date?</span>' : '') +
        '<span class="entry-m">' + (m != null ? num(m) + ' ' + u + (e.mileageUncertain ? ' <span class="flag">uncertain</span>' : '') : (est != null ? '<span class="est">≈' + num(est) + ' ' + u + '</span>' : '<span class="est">' + u + ' not recorded</span>')) +
        (air && e.tach != null && e.tach !== '' ? ' · tach ' + num(e.tach) : '') + '</span></div>' +
        '<div class="entry-body"><p class="entry-svc">' + esc(e.service) + '</p>' + (e.parts ? '<p class="small"><b>Parts:</b> ' + esc(e.parts) + '</p>' : '') + (e.notes ? '<p class="small"><b>Notes:</b> ' + esc(e.notes) + '</p>' : '') + (e.signedBy ? '<p class="small"><b>Signed off:</b> ' + esc(e.signedBy) + '</p>' : '') + '</div></button></li>';
    });
    h += '</ol></section>';

    // todos / squawks
    var open = v.todos.filter(function (t) { return !t.done; }), done = v.todos.filter(function (t) { return t.done; });
    h += '<section class="panel reveal-up" id="todos"><div class="panel-head"><h2>' + (air ? 'Squawks / to-do' : 'Open to-dos') + '</h2><span class="badge ghost">' + open.length + ' open</span></div>' +
      '<form class="todo-add" id="todoForm"><input id="todoText" placeholder="' + (air ? 'New squawk…' : 'New to-do…') + '" aria-label="New item" autocomplete="off" enterkeyhint="done"><button class="btn primary">Add</button></form><ul class="todos">';
    open.concat(done).forEach(function (t) {
      h += '<li class="todo ' + (t.done ? 'done' : '') + '"><label><input type="checkbox" data-todo="' + esc(t.id) + '" ' + (t.done ? 'checked' : '') + '><span class="tick" aria-hidden="true"></span><span class="ttext">' + esc(t.text) + '</span></label><button class="btn tiny ghost" data-deltodo="' + esc(t.id) + '" aria-label="Delete">✕</button></li>';
    });
    if (!v.todos.length) h += '<li class="empty">' + (air ? 'No squawks logged.' : 'Nothing open. Nice.') + '</li>';
    h += '</ul></section>';

    h += sourcesBlock(v);
    h += '<div class="danger-zone"><button class="btn ghost small" id="delUnit">Delete this ' + (air ? 'aircraft' : 'vehicle') + '</button></div>';
    app.innerHTML = h;

    // showroom / turntable
    var views = (v.turntable && v.turntable.views && v.turntable.views.length) ? v.turntable.views.map(function (x) { return { src: img(x.src), label: x.label, mirror: x.mirror }; }) : [{ src: srcFor(v), label: 'Photo' }];
    Turntable($('#showroom'), views, { alt: v.name + (views.length > 1 ? ' showroom turntable' : ''), auto: views.length > 1 });

    // wire up
    $('#editMeter').onclick = function () { meterForm(v); };
    $('#changePhoto').onclick = function () { photoPicker(v); };
    $('#editUnit').onclick = function () { unitForm(v.category, v); };
    $('#qaLog').onclick = $('#addLog2').onclick = function () { logForm(v); };
    $('#qaPart').onclick = $('#addPart2').onclick = function () { partForm(v); };
    $('#qaTodo').onclick = function () { var t = $('#todoText'); t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); setTimeout(function () { t.focus(); }, 300); };
    $('#editSpecs').onclick = function () { specsForm(v); };
    $$('[data-addspec]').forEach(function (b) { b.onclick = function () { specsForm(v); }; });
    $('#addSched').onclick = function () { schedForm(v); };
    $$('.seg [data-mode]').forEach(function (b) { b.onclick = function () { var m = b.dataset.mode; if (m === (v.scheduleMode || 'normal')) return; save(function () { v.scheduleMode = m; }, 'Schedule mode: ' + m + ' (' + v.name + ')', m === 'severe' ? 'Severe schedule' : 'Normal schedule'); }; });
    $$('[data-logfor]').forEach(function (b) { b.onclick = function () { logForm(v, null, b.dataset.logfor); }; });
    $$('[data-copy]').forEach(function (b) { b.onclick = function () { copy(b.dataset.copy); b.classList.add('copied'); setTimeout(function () { b.classList.remove('copied'); }, 900); }; });
    $$('[data-editpart]').forEach(function (b) { b.onclick = function () { partForm(v, v.parts.filter(function (p) { return p.id === b.dataset.editpart; })[0]); }; });
    $$('[data-editlog]').forEach(function (b) { b.onclick = function () { logForm(v, v.log.filter(function (e) { return e.id === b.dataset.editlog; })[0]); }; });
    $('#todoForm').onsubmit = function (e) {
      e.preventDefault(); var t = $('#todoText').value.trim(); if (!t) return;
      if (!publicGuard([t], air)) return;
      save(function () { v.todos.push({ id: uid('t'), text: t, done: false, created: todayIso() }); }, 'Add to-do for ' + v.name, 'Added');
    };
    $$('[data-todo]').forEach(function (c) { c.onchange = function () { var id = c.dataset.todo; save(function () { v.todos.forEach(function (t) { if (t.id === id) { t.done = c.checked; if (c.checked) t.doneDate = todayIso(); else delete t.doneDate; } }); }, (c.checked ? 'Check off' : 'Reopen') + ' to-do (' + v.name + ')', c.checked ? 'Checked off' : 'Reopened'); }; });
    $$('[data-deltodo]').forEach(function (b) { b.onclick = function () { if (!confirm('Delete this item?')) return; var id = b.dataset.deltodo; save(function () { v.todos = v.todos.filter(function (t) { return t.id !== id; }); }, 'Delete to-do (' + v.name + ')', 'Deleted'); }; });
    $('#delUnit').onclick = function () {
      if (!confirm('Delete ' + v.name + ' and all its records? (Export a backup first if unsure.)')) return;
      var back = air ? '#/sky' : '#/';
      Store.commit(function (d) { d.vehicles = d.vehicles.filter(function (x) { return x.id !== v.id; }); }, 'Delete ' + v.name);
      location.hash = back;
    };
    if (section) { var el = document.getElementById(section); if (el) setTimeout(function () { el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); el.classList.add('flash'); }, 60); }
  }
  function stLabel(st) { return { verified: 'verified', 'cross-ref': 'cross-ref', unverified: 'unverified', 'not a match': 'not a match', 'partly verified': 'partly verified', user: 'added' }[st] || st; }
  function srcTag(key, status) {
    if (!key && !status) return '';
    var src = key && Store.data.sources[key];
    var st = status ? '<span class="pst ' + esc(String(status).replace(/\s+/g, '-')) + '">' + esc(status) + '</span>' : '';
    return ' <span class="srcref">' + st + (src ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener" title="' + esc(src.title) + '">source</a>' : '') + '</span>';
  }
  function sourcesBlock(v) {
    var keys = {};
    function add(k) { if (k && Store.data.sources[k]) keys[k] = 1; }
    v.specs.forEach(function (s) { add(s.source); }); v.schedule.forEach(function (s) { add(s.source); });
    v.parts.forEach(function (p) { (p.numbers || []).forEach(function (n) { add(n.source); }); });
    var ks = Object.keys(keys); if (!ks.length) return '';
    return '<section class="panel sources reveal-up" id="sources"><h2>Sources</h2><ol>' + ks.map(function (k) { var s = Store.data.sources[k]; return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></li>'; }).join('') + '</ol>' +
      (!isAir(v) ? '<p class="small">Anything not verified is labelled. Always double-check fitment at the parts counter.</p>' : '') + '</section>';
  }

  /* ---------------- form helpers ---------------- */
  function field(label, name, val, opts) {
    opts = opts || {};
    var id = 'f-' + name + '-' + Math.random().toString(36).slice(2, 6), input;
    if (opts.type === 'textarea') input = '<textarea id="' + id + '" name="' + name + '" rows="' + (opts.rows || 3) + '"' + (opts.required ? ' required' : '') + ' placeholder="' + esc(opts.ph || '') + '">' + esc(val == null ? '' : val) + '</textarea>';
    else input = '<input id="' + id + '" name="' + name + '" type="' + (opts.type || 'text') + '" value="' + esc(val == null ? '' : val) + '"' + (opts.required ? ' required' : '') + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '') + (opts.step ? ' step="' + opts.step + '"' : '') + (opts.min != null ? ' min="' + opts.min + '"' : '') + ' placeholder="' + esc(opts.ph || '') + '" autocomplete="off">';
    return '<div class="field"><label for="' + id + '">' + esc(label) + (opts.hint ? ' <span class="hint">' + esc(opts.hint) + '</span>' : '') + '</label>' + input + '</div>';
  }
  function formVals(form) { var o = {}; new FormData(form).forEach(function (v, k) { if (o[k] !== undefined) { if (!Array.isArray(o[k])) o[k] = [o[k]]; o[k].push(v); } else o[k] = v; }); return o; }
  function numOrNull(x) { if (x === '' || x == null) return null; var n = +String(x).replace(/,/g, ''); return isNaN(n) ? null : n; }
  var PUBLIC_NOTE = '<p class="callout">This data is <strong>public</strong>. No VINs, plates, N-numbers, serials or customer info.</p>';
  function wireRemove(b) { $$('[data-rm]', b).forEach(function (x) { x.onclick = function () { x.parentNode.remove(); }; }); }

  /* ---------------- LOG FORM (vehicles: odometer · aircraft: total time + tach) ---------------- */
  function logForm(v, entry, preTag) {
    var air = isAir(v), e = entry || { date: todayIso(), tags: preTag ? [preTag] : [] };
    var chips = v.schedule.map(function (s) { return '<label class="chip"><input type="checkbox" name="tags" value="' + esc(s.id) + '"' + ((e.tags || []).indexOf(s.id) >= 0 ? ' checked' : '') + ' data-task="' + esc(s.task) + '"><span>' + esc(s.task) + '</span></label>'; }).join('');
    var preTask = preTag && !entry ? (v.schedule.filter(function (s) { return s.id === preTag; })[0] || {}).task : '';
    openModal('<h2>' + (entry ? 'Edit entry' : (air ? 'Log entry' : 'Log service')) + '</h2><form id="lf" class="form">' +
      field('Date', 'date', e.date, { type: 'date', required: true }) +
      (air ? '<div class="two">' + field('Total time (hrs)', 'totalTime', e.totalTime, { type: 'number', step: '0.1', inputmode: 'decimal', min: 0 }) + field('Tach (hrs)', 'tach', e.tach, { type: 'number', step: '0.1', inputmode: 'decimal', min: 0 }) + '</div>'
           : field('Odometer (mi)', 'mileage', e.mileage, { type: 'number', inputmode: 'numeric', min: 0, hint: 'leave blank if unknown' })) +
      (chips ? '<div class="field"><span class="flabel">What got done? <span class="hint">updates the chart</span></span><div class="chips">' + chips + '</div></div>' : '') +
      field(air ? 'Work performed' : 'Service', 'service', e.service || preTask, { required: true, ph: air ? 'e.g., Annual inspection completed' : 'e.g., Oil & filter change' }) +
      field('Parts used', 'parts', e.parts, { ph: air ? 'e.g., tow release parts' : 'e.g., WIX WL10255, 6 qt 5W-30' }) +
      field('Notes', 'notes', e.notes, { type: 'textarea', rows: 2 }) +
      (air ? field('Signed off by', 'signedBy', e.signedBy, { ph: 'Mechanic / IA (optional)' }) : '') +
      PUBLIC_NOTE +
      '<div class="form-actions">' + (entry ? '<button type="button" class="btn ghost danger" id="lfDel">Delete</button>' : '') + '<button class="btn primary big">Save</button></div></form>', function (b) {
      var svc = $('[name=service]', b);
      $$('input[name=tags]', b).forEach(function (c) {
        c.onchange = function () {
          var picked = $$('input[name=tags]:checked', b).map(function (x) { return x.dataset.task; });
          if (!svc.dataset.touched) svc.value = picked.join(', ');
        };
      });
      svc.oninput = function () { svc.dataset.touched = '1'; };
      if (entry) svc.dataset.touched = '1';
      $('#lf', b).onsubmit = function (ev) {
        ev.preventDefault();
        var f = formVals(ev.target), tags = [].concat(f.tags || []);
        if (!publicGuard([f.service, f.parts, f.notes, f.signedBy || ''], air)) return;
        var rec = entry ? entry : { id: uid('l') };
        rec.date = f.date; rec.service = f.service.trim(); rec.parts = (f.parts || '').trim(); rec.notes = (f.notes || '').trim(); rec.tags = tags;
        if (air) { rec.totalTime = numOrNull(f.totalTime); rec.tach = numOrNull(f.tach); rec.signedBy = (f.signedBy || '').trim(); }
        else { var nm = numOrNull(f.mileage); if (entry && nm !== entry.mileage) delete rec.mileageUncertain; rec.mileage = nm; }
        closeModal();
        save(function () {
          if (!entry) v.log.push(rec);
          if (!air && rec.mileage != null && (v.mileage == null || rec.mileage >= v.mileage)) { v.mileage = rec.mileage; v.mileageDate = rec.date; v.mileageNeedsUpdate = false; }
          if (air && rec.totalTime != null && (v.totalTime == null || rec.totalTime >= v.totalTime)) { v.totalTime = rec.totalTime; if (rec.tach != null) v.tach = rec.tach; v.meterDate = rec.date; v.meterNeedsUpdate = false; }
        }, (entry ? 'Edit' : 'Log') + ': ' + rec.service + ' (' + v.name + ')', entry ? 'Entry updated' : 'Logged');
      };
      var del = $('#lfDel', b); if (del) del.onclick = function () { if (!confirm('Delete this log entry?')) return; closeModal(); save(function () { v.log = v.log.filter(function (x) { return x.id !== entry.id; }); }, 'Delete log entry (' + v.name + ')', 'Deleted'); };
    });
  }

  /* ---------------- PART FORM ---------------- */
  function partForm(v, part) {
    var p = part || { numbers: [{ brand: '', number: '' }] };
    function numRow(n, i) { return '<div class="numrow" data-i="' + (i == null ? '' : i) + '"><input name="nbrand" placeholder="Brand" value="' + esc(n.brand || '') + '" aria-label="Brand"><input name="nnum" placeholder="Part #" value="' + esc(n.number || '') + '" aria-label="Part number"><input type="hidden" name="nidx" value="' + (i == null ? '' : i) + '"><button type="button" class="btn tiny ghost" data-rm aria-label="Remove">✕</button></div>'; }
    openModal('<h2>' + (part ? 'Edit part' : 'Add part') + '</h2><form id="pf" class="form">' +
      field('Category', 'category', p.category, { ph: 'e.g., Oil filter' }) +
      field('Name / description', 'name', p.name, { required: true, ph: 'e.g., Oil filter' }) +
      field('Quantity', 'qty', p.qty, { ph: 'e.g., 1' }) +
      '<div class="field"><span class="flabel">Part numbers</span><div id="nums">' + (p.numbers.length ? p.numbers : [{}]).map(function (n, i) { return numRow(n, part ? i : null); }).join('') + '</div><button type="button" class="btn small" id="addNum">＋ Another number</button></div>' +
      field('Store search words', 'buy', p.buy, { ph: 'e.g., ACDelco PF63E oil filter', hint: 'used by the Amazon button' }) +
      field('Notes', 'notes', p.notes, { type: 'textarea', rows: 2 }) + PUBLIC_NOTE +
      '<div class="form-actions">' + (part ? '<button type="button" class="btn ghost danger" id="pfDel">Delete</button>' : '') + '<button class="btn primary big">Save</button></div></form>', function (b) {
      wireRemove(b);
      $('#addNum', b).onclick = function () { $('#nums', b).insertAdjacentHTML('beforeend', numRow({}, null)); wireRemove(b); };
      $('#pf', b).onsubmit = function (ev) {
        ev.preventDefault();
        var f = formVals(ev.target);
        var br = [].concat(f.nbrand || []), nn = [].concat(f.nnum || []), ix = [].concat(f.nidx || []);
        if (!publicGuard([f.name, f.category, f.notes, f.buy].concat(nn), isAir(v))) return;
        var nums = [];
        nn.forEach(function (n, i) {
          n = String(n).trim(); if (!n) return;
          var old = part && ix[i] !== '' ? part.numbers[+ix[i]] : null;
          if (old && old.number === n && (old.brand || '') === br[i].trim()) nums.push(old);
          else nums.push({ brand: br[i].trim(), number: n, status: 'user' });
        });
        var rec = part || { id: uid('p') };
        rec.category = (f.category || '').trim(); rec.name = f.name.trim(); rec.qty = (f.qty || '').trim(); rec.numbers = nums; rec.buy = (f.buy || '').trim(); rec.notes = (f.notes || '').trim();
        closeModal();
        save(function () { if (!part) v.parts.push(rec); }, (part ? 'Edit' : 'Add') + ' part: ' + rec.name + ' (' + v.name + ')', part ? 'Part updated' : 'Part added');
      };
      var del = $('#pfDel', b); if (del) del.onclick = function () { if (!confirm('Delete this part?')) return; closeModal(); save(function () { v.parts = v.parts.filter(function (x) { return x.id !== part.id; }); }, 'Delete part (' + v.name + ')', 'Deleted'); };
    });
  }

  /* ---------------- METER FORM ---------------- */
  function meterForm(v) {
    var air = isAir(v);
    openModal('<h2>' + (air ? 'Update times' : 'Update mileage') + '</h2><form id="mf" class="form">' +
      (air ? '<div class="two">' + field('Total time (hrs)', 'totalTime', v.totalTime, { type: 'number', step: '0.1', inputmode: 'decimal', min: 0 }) + field('Tach (hrs)', 'tach', v.tach, { type: 'number', step: '0.1', inputmode: 'decimal', min: 0 }) + '</div>'
           : field('Odometer (mi)', 'mileage', '', { type: 'number', inputmode: 'numeric', min: 0, required: true, ph: 'Last: ' + num(v.mileage) })) +
      field('As of', 'date', todayIso(), { type: 'date', required: true }) +
      '<div class="form-actions"><button class="btn primary big">Save</button></div></form>', function (b) {
      $('#mf', b).onsubmit = function (ev) {
        ev.preventDefault(); var f = formVals(ev.target);
        if (!air) {
          var m = numOrNull(f.mileage); if (m == null) return;
          if (v.mileage != null && m < v.mileage && !confirm('That is lower than the last reading (' + num(v.mileage) + '). Save anyway?')) return;
          closeModal(); save(function () { v.mileage = m; v.mileageDate = f.date; v.mileageNeedsUpdate = false; }, 'Mileage ' + m + ' (' + v.name + ')', 'Mileage updated');
        } else {
          closeModal(); save(function () { v.totalTime = numOrNull(f.totalTime); v.tach = numOrNull(f.tach); v.meterDate = f.date; v.meterNeedsUpdate = false; }, 'Times updated (' + v.name + ')', 'Times updated');
        }
      };
    });
  }

  /* ---------------- SPECS FORM ---------------- */
  function specsForm(v) {
    function row(s) { return '<div class="specrow"><input name="slabel" placeholder="Label" value="' + esc(s.label || '') + '" aria-label="Label"><input name="svalue" placeholder="add" value="' + esc(s.value || '') + '" aria-label="Value"><button type="button" class="btn tiny ghost" data-rm aria-label="Remove">✕</button></div>'; }
    openModal('<h2>Edit specs</h2><form id="sf" class="form"><div id="srows">' + (v.specs.length ? v.specs : [{}]).map(row).join('') + '</div><button type="button" class="btn small" id="addSpec">＋ Row</button>' + PUBLIC_NOTE + '<div class="form-actions"><button class="btn primary big">Save</button></div></form>', function (b) {
      wireRemove(b);
      $('#addSpec', b).onclick = function () { $('#srows', b).insertAdjacentHTML('beforeend', row({})); wireRemove(b); var ins = $$('#srows input[name=slabel]', b); ins[ins.length - 1].focus(); };
      $('#sf', b).onsubmit = function (ev) {
        ev.preventDefault(); var f = formVals(ev.target);
        var L = [].concat(f.slabel || []), V = [].concat(f.svalue || []);
        if (!publicGuard(L.concat(V), isAir(v))) return;
        var old = {}; v.specs.forEach(function (s) { old[s.label] = s; });
        var specs = [];
        L.forEach(function (l, i) {
          l = l.trim(); if (!l) return;
          var o = old[l] ? JSON.parse(JSON.stringify(old[l])) : { label: l };
          if ((o.value || '') !== V[i].trim()) { delete o.source; delete o.status; delete o.note; }
          o.value = V[i].trim(); specs.push(o);
        });
        closeModal(); save(function () { v.specs = specs; }, 'Edit specs (' + v.name + ')', 'Specs saved');
      };
    });
  }

  /* ---------------- SCHEDULE ITEM FORM ---------------- */
  function schedForm(v) {
    var air = isAir(v);
    openModal('<h2>Schedule item</h2><form id="schf" class="form">' + field('Task', 'task', '', { required: true, ph: air ? 'e.g., Tow release inspection' : 'e.g., Tire rotation' }) +
      '<div class="two">' + field(air ? 'Every (hrs)' : 'Every (mi)', 'every', '', { type: 'number', inputmode: 'numeric', min: 0 }) + field('Every (months)', 'months', '', { type: 'number', inputmode: 'numeric', min: 0 }) + '</div>' +
      field('Notes / basis', 'basis', '', { type: 'textarea', rows: 2, ph: 'Where does this interval come from?' }) +
      '<p class="small">Leave both intervals blank for a one-time item.</p><div class="form-actions"><button class="btn primary big">Save</button></div></form>', function (b) {
      $('#schf', b).onsubmit = function (ev) {
        ev.preventDefault(); var f = formVals(ev.target);
        var rec = { id: uid('s'), task: f.task.trim(), basis: (f.basis || '').trim(), status: 'user-added' };
        if (air) rec.everyHours = numOrNull(f.every); else rec.everyMiles = numOrNull(f.every);
        rec.everyMonths = numOrNull(f.months);
        if (!rec.everyHours && !rec.everyMiles && !rec.everyMonths) rec.once = true;
        closeModal(); save(function () { v.schedule.push(rec); }, 'Schedule item: ' + rec.task + ' (' + v.name + ')', 'Schedule item saved');
      };
    });
  }

  /* ---------------- UNIT (vehicle / aircraft) FORM ---------------- */
  function unitForm(cat, v) {
    var air = cat === 'aircraft', u = v || {};
    openModal('<h2>' + (v ? 'Edit details' : (air ? 'Add aircraft' : 'Add vehicle')) + '</h2><form id="uf" class="form">' +
      field('Nickname', 'name', u.name, { required: true, ph: air ? 'e.g., The 1-26' : 'e.g., Work truck' }) +
      '<div class="two">' + field('Year', 'year', u.year, { type: 'number', inputmode: 'numeric', min: 1900 }) + field('Make', 'make', u.make, { ph: air ? 'Schweizer' : 'Buick' }) + '</div>' +
      field('Model', 'model', u.model, { ph: air ? 'SGS 1-26' : 'Enclave' }) +
      '<div class="two">' + field('Color', 'color', u.color) + field(air ? 'Type' : 'Engine', 'engine', u.engine, { ph: air ? 'Glider' : '3.6L V6' }) + '</div>' +
      (air ? '<div class="two">' + field('Total time (hrs)', 'totalTime', u.totalTime, { type: 'number', step: '0.1', inputmode: 'decimal', min: 0 }) + field('Tach (hrs)', 'tach', u.tach, { type: 'number', step: '0.1', inputmode: 'decimal', min: 0 }) + '</div>'
           : field('Mileage (mi)', 'mileage', u.mileage, { type: 'number', inputmode: 'numeric', min: 0 }) + field('In service since', 'inServiceDate', u.inServiceDate, { type: 'date', hint: 'for time-based items with no record' })) +
      (!v ? '<div class="field"><span class="flabel">Photo <span class="hint">optional, resized on your phone</span></span><input type="file" name="photo" accept="image/*"></div>' : '') +
      PUBLIC_NOTE + '<div class="form-actions"><button class="btn primary big">Save</button></div></form>', function (b) {
      $('#uf', b).onsubmit = function (ev) {
        ev.preventDefault(); var f = formVals(ev.target);
        if (!publicGuard([f.name, f.make, f.model, f.color, f.engine], air)) return;
        var file = ev.target.photo && ev.target.photo.files && ev.target.photo.files[0];
        var rec = v || { id: slug([f.year, f.make, f.model || f.name].filter(Boolean).join('-')), category: cat, specs: [], schedule: [], parts: [], log: [], todos: [] };
        if (!v && vehicle(rec.id)) rec.id += '-' + Math.random().toString(36).slice(2, 5);
        rec.name = f.name.trim(); rec.year = numOrNull(f.year); rec.make = (f.make || '').trim(); rec.model = (f.model || '').trim(); rec.color = (f.color || '').trim(); rec.engine = (f.engine || '').trim();
        if (air) {
          var tt = numOrNull(f.totalTime), tc = numOrNull(f.tach);
          if (tt !== (rec.totalTime == null ? null : rec.totalTime) || tc !== (rec.tach == null ? null : rec.tach)) { rec.totalTime = tt; rec.tach = tc; rec.meterDate = (tt != null || tc != null) ? todayIso() : null; }
          if (!v) {
            rec.specs = ['Model variant', 'Year built', 'Total time (hrs)', 'Tach / meter (hrs)', 'Empty weight', 'Useful load', 'Last weight & balance', 'Instruments / radio'].map(function (l) { return { label: l, value: '' }; });
            rec.schedule = [{ id: 'annual', task: 'Annual inspection', everyMonths: 12, basis: 'Required within the preceding 12 calendar months (14 CFR 91.409). Due at the end of the month.', source: 'far91409', status: 'verified' }];
          }
        } else {
          var m = numOrNull(f.mileage);
          if (m !== (rec.mileage == null ? null : rec.mileage)) { rec.mileage = m; rec.mileageDate = todayIso(); rec.mileageNeedsUpdate = false; }
          if ((f.inServiceDate || '') !== (rec.inServiceDate || '')) { rec.inServiceDate = f.inServiceDate || null; rec.inServiceAssumed = false; }
          if (!v) rec.specs = ['Engine', 'Oil type & capacity', 'Oil filter', 'Drain plug size & torque', 'Tire size & pressure', 'Other fluids'].map(function (l) { return { label: l, value: '' }; });
        }
        var finish = function (dataUrl) {
          closeModal();
          save(function (d) { if (dataUrl) { rec.photo = dataUrl; delete rec.turntable; } if (!v) d.vehicles.push(rec); }, (v ? 'Edit ' : 'Add ') + rec.name, v ? 'Details saved' : (air ? 'Aircraft added' : 'Vehicle added'));
          if (!v) location.hash = '#/v/' + encodeURIComponent(rec.id);
        };
        if (file) resizeImage(file).then(finish, function (e) { alert('Could not read that photo: ' + e.message); });
        else finish(null);
      };
    });
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('v'); }

  /* ---------------- PHOTO (resized client-side; committed to images/ on sync) ---------------- */
  function resizeImage(file, max) {
    max = max || 1280;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        var w = Math.round(im.naturalWidth * s), h = Math.round(im.naturalHeight * s);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ctx = c.getContext('2d'); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h); ctx.drawImage(im, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unsupported image')); };
      im.src = url;
    });
  }
  function photoPicker(v) {
    openModal('<h2>Change photo</h2><p>Pick a photo or take one. It gets shrunk to about 1280 px on your phone before saving.</p>' +
      '<p class="callout warn">The photo will be <strong>public</strong>. Make sure no plate, N-number or VIN shows.</p>' +
      '<input type="file" accept="image/*" id="pp"><div id="ppPrev" class="pp-prev"></div><div class="form-actions"><button class="btn primary big" id="ppSave" disabled>Use this photo</button></div>', function (b) {
      var data = null;
      $('#pp', b).onchange = function (e) {
        var f = e.target.files[0]; if (!f) return;
        resizeImage(f).then(function (d) { data = d; $('#ppPrev', b).innerHTML = '<img alt="Preview" src="' + d + '">'; $('#ppSave', b).disabled = false; }, function (er) { alert(er.message); });
      };
      $('#ppSave', b).onclick = function () { if (!data) return; closeModal(); save(function () { v.photo = data; delete v.turntable; }, 'New photo for ' + v.name, 'Photo saved'); };
    });
  }

  /* ---------------- REQUEST (FormSubmit) ---------------- */
  function renderRequest(v) {
    var air = isAir(v), title = (ymm(v) || v.name);
    var subject = (air ? 'Sky Sailing request: ' : 'Garage request: ') + title;
    var next = new URL('thanks.html?v=' + encodeURIComponent(v.id), location.href.split('#')[0]).href;
    var h = '<nav class="crumbs"><a href="#/v/' + encodeURIComponent(v.id) + '">‹ ' + esc(v.name) + '</a></nav>' +
      '<section class="request-head reveal-up"><img class="req-thumb" src="' + esc(srcFor(v)) + '" alt=""><div><p class="kicker">Request service</p><h1 class="display chrome">' + nw(title) + '</h1><p class="lede">Tell Blue what you need. It goes straight to his inbox.</p></div></section>' +
      '<form class="panel form request-form reveal-up" id="reqForm" action="https://formsubmit.co/' + FORM_EMAIL + '" method="POST">' +
      '<input type="hidden" name="_subject" value="' + esc(subject) + '">' +
      '<input type="hidden" name="_template" value="table">' +
      '<input type="hidden" name="_next" value="' + esc(next) + '">' +
      '<input type="text" name="_honey" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<input type="hidden" name="' + (air ? 'aircraft' : 'vehicle') + '" value="' + esc(title + ' (' + v.name + ')') + '">' +
      field('Your name', 'name', '', { required: true, ph: 'First & last' }) +
      '<div class="two">' + field('Phone', 'phone', '', { type: 'tel', inputmode: 'tel', ph: '(555) 555-5555' }) + field('Email', 'email', '', { type: 'email', ph: 'you@example.com' }) + '</div>' +
      '<p class="small hint-line" id="contactHint">Give a phone <em>or</em> an email so Blue can reach you.</p>' +
      field('What do you need?', 'need', '', { type: 'textarea', required: true, rows: 4, ph: air ? 'e.g., Annual inspection, tow release check' : 'e.g., Oil change + tire rotation, squeak from front left' }) +
      field('Preferred date', 'preferred_date', '', { type: 'date' }) +
      field('Notes', 'notes', '', { type: 'textarea', rows: 2, ph: 'Best time to call, drop-off details…' }) +
      '<p class="callout">Your request is emailed privately through FormSubmit. It is <strong>not</strong> saved on this public site.</p>' +
      '<button class="btn primary big wide shine" type="submit">Send request</button></form>';
    app.innerHTML = h;
    var form = $('#reqForm');
    form.onsubmit = function (e) {
      var ph = form.elements.phone.value.trim(), em = form.elements.email.value.trim();
      if (!ph && !em) { e.preventDefault(); $('#contactHint').classList.add('err'); form.elements.phone.focus(); toast('Add a phone or an email', 'bad'); return; }
      var btn = form.querySelector('[type=submit]'); btn.textContent = 'Sending…'; btn.disabled = true;
      setTimeout(function () { btn.disabled = false; btn.textContent = 'Send request'; }, 8000);
    };
  }

  /* ---------------- SETTINGS ---------------- */
  function renderSettings() {
    var s = Store.settings();
    var h = '<nav class="crumbs"><a href="#/">‹ Garage</a></nav><section class="reveal-up"><p class="kicker">Settings</p><h1 class="display chrome">Sync &amp; backup</h1></section>' +
      '<section class="panel reveal-up"><div class="panel-head"><h2>Status</h2><span class="badge ' + (Store.isDirty() ? 'warn' : 'good') + '">' + (Store.isDirty() ? 'Not synced' : 'Up to date') + '</span></div>' +
      '<p>' + (Store.hasToken() ? 'Edits save to GitHub (<code>' + esc(s.owner + '/' + s.repo) + '</code>, branch <code>' + esc(s.branch) + '</code>). The public site updates about a minute later.' : 'No GitHub token yet, so edits are saved <strong>on this device only</strong>. Export a backup, or add a token below to publish your edits.') + '</p>' +
      (Store.state.lastError ? '<p class="callout warn">Last sync error: ' + esc(Store.state.lastError) + '</p>' : '') +
      '<div class="row-btns">' + (Store.hasToken() ? '<button class="btn primary" id="syncNow">Sync now</button>' : '') + (Store.isDirty() ? '<button class="btn ghost danger" id="discard">Discard unsynced edits</button>' : '') + '</div></section>' +
      '<section class="panel reveal-up" id="setup"><h2>Save edits to GitHub (one-time setup)</h2>' +
      '<ol class="guide"><li>Sign in to GitHub and open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Developer settings → Fine-grained tokens → Generate new token</a>.</li>' +
      '<li><b>Token name:</b> “garage site”. <b>Expiration:</b> your pick. A year is fine; redo these steps when it expires.</li>' +
      '<li><b>Repository access:</b> pick <b>Only select repositories</b> and choose <b>skyking211/garage</b>. Nothing else.</li>' +
      '<li><b>Permissions → Repository permissions → Contents:</b> set it to <b>Read and write</b>. Leave everything else alone (GitHub adds Metadata: read-only by itself).</li>' +
      '<li>Tap <b>Generate token</b> and copy it (it starts with <code>github_pat_</code>). Paste it below, tap <b>Save</b>, then <b>Test</b>.</li></ol>' +
      '<p class="callout">The token is stored <strong>only in this browser</strong> and never goes into the repo. Do this once on each phone or computer you edit from. Lost your phone? Delete the token on GitHub and it stops working.</p>' +
      '<form id="setForm" class="form">' + field('Personal access token', 'token', s.token, { type: 'password', ph: 'github_pat_…' }) +
      '<details><summary>Advanced (repo)</summary><div class="two">' + field('Owner', 'owner', s.owner) + field('Repo', 'repo', s.repo) + '</div>' + field('Branch', 'branch', s.branch) + '</details>' +
      '<div class="form-actions"><button type="button" class="btn ghost" id="clearTok">Remove token</button><button type="button" class="btn" id="testTok">Test</button><button class="btn primary">Save</button></div><p id="testOut" class="small" role="status"></p></form></section>' +
      '<section class="panel reveal-up"><h2>Backup</h2><p>Download everything as one file, or restore a backup. Do this before big changes.</p><div class="row-btns"><button class="btn primary" id="exportBtn">⬇ Export JSON</button><label class="btn" for="importFile" tabindex="0">⬆ Import JSON</label><input type="file" id="importFile" accept="application/json,.json" class="visually-hidden"></div></section>' +
      '<section class="panel reveal-up"><h2>Request form email</h2><p class="small">Requests reach the shop inbox through <a href="https://formsubmit.co" target="_blank" rel="noopener">FormSubmit</a> (free, no account). The <b>first</b> request triggers a one-time <b>activation email</b>. Open it and click “Activate Form”. Until then, no requests come through.</p></section>';
    app.innerHTML = h;
    function readSet() { var f = formVals($('#setForm')); return { token: (f.token || '').trim(), owner: (f.owner || 'skyking211').trim(), repo: (f.repo || 'garage').trim(), branch: (f.branch || 'main').trim() }; }
    $('#setForm').onsubmit = function (e) {
      e.preventDefault(); Store.saveSettings(readSet()); toast('Settings saved', 'ok');
      if (Store.hasToken() && Store.isDirty()) Store.sync().then(function () { toast('Synced ✓', 'ok'); renderSettings(); }, function (er) { if (!er.cancelled) toast('Sync failed: ' + er.message, 'bad'); renderSettings(); });
      else renderSettings();
    };
    $('#testTok').onclick = function () {
      var out = $('#testOut'); Store.saveSettings(readSet());
      if (!Store.hasToken()) { out.textContent = 'Paste a token first.'; return; }
      out.textContent = 'Testing…';
      Store.testConnection().then(function (r) {
        out.innerHTML = r.canWrite ? '✅ Connected to <b>' + esc(r.name) + '</b> with write access.' : (r.canWrite === false ? '⚠️ Connected to ' + esc(r.name) + ', but the token can’t write. Set Contents to “Read and write”.' : '✅ Connected to ' + esc(r.name) + '.');
      }, function (e) { out.textContent = '❌ ' + (e.status === 401 ? 'Token not accepted. Typo, or expired?' : e.status === 404 ? 'Repo not found, or the token doesn’t include it.' : e.message); });
    };
    $('#clearTok').onclick = function () { var s2 = Store.settings(); s2.token = ''; Store.saveSettings(s2); toast('Token removed'); renderSettings(); };
    var sn = $('#syncNow'); if (sn) sn.onclick = function () { sn.disabled = true; sn.textContent = 'Syncing…'; Store.sync().then(function () { toast('Synced ✓', 'ok'); renderSettings(); }, function (e) { if (!e.cancelled) toast('Sync failed: ' + e.message, 'bad'); renderSettings(); }); };
    var dc = $('#discard'); if (dc) dc.onclick = function () { if (!confirm('Throw away edits that only exist on this device?')) return; Store.discardLocal().then(function () { toast('Reloaded'); renderSettings(); }); };
    $('#exportBtn').onclick = exportJson;
    $('#importFile').onchange = function (e) { var f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; };
  }
  function exportJson() {
    var blob = new Blob([JSON.stringify(Store.data, null, 1) + '\n'], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'garage-backup-' + todayIso() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Backup downloaded', 'ok');
  }
  function importJson(file) {
    var r = new FileReader();
    r.onload = function () {
      var d;
      try { d = Store.normalize(JSON.parse(r.result)); } catch (e) { alert('That file isn’t a garage backup: ' + e.message); return; }
      if (!confirm('Replace all data with this backup?\n\n' + d.vehicles.length + ' item(s): ' + d.vehicles.map(function (v) { return v.name; }).join(', '))) return;
      Store.replaceAll(d, 'Import backup');
      toast(Store.hasToken() ? 'Imported · syncing…' : 'Imported on this device (not synced)', 'ok');
      renderSettings();
    };
    r.readAsText(file);
  }

  /* ---------------- SEARCH ---------------- */
  function norm(s) { return String(s || '').toLowerCase(); }
  function squash(s) { return norm(s).replace(/[\s\-_.\/]/g, ''); }
  function matches(hay, terms) { var h = norm(hay), hs = squash(hay); return terms.every(function (t) { return h.indexOf(t) >= 0 || (squash(t) && hs.indexOf(squash(t)) >= 0); }); }
  function hl(text, terms) {
    var out = esc(text);
    terms.forEach(function (t) { if (t.length < 2) return; var re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'ig'); out = out.replace(re, '<mark>$1</mark>'); });
    return out;
  }
  function searchAll(q) {
    var terms = norm(q).split(/\s+/).filter(Boolean), res = [];
    if (!terms.length) return res;
    Store.data.vehicles.forEach(function (v) {
      v.parts.forEach(function (p) {
        var nums = (p.numbers || []).map(function (n) { return (n.brand ? n.brand + ' ' : '') + n.number; }).join(' · ');
        if (matches([p.category, p.name, nums, p.notes, p.qty, p.buy].join(' '), terms)) res.push({ v: v, type: 'Part', title: p.name, sub: nums, sec: 'parts', copy: (p.numbers || []).filter(function (n) { return n.status !== 'not a match' && matches((n.brand || '') + ' ' + n.number, terms); }).map(function (n) { return n.number; }) });
      });
      v.log.forEach(function (e) { if (matches([e.service, e.parts, e.notes, e.date].join(' '), terms)) res.push({ v: v, type: 'Service', title: e.service, sub: fdate(e.date) + (e.parts ? ' · ' + e.parts : '') + (e.notes ? ' · ' + e.notes : ''), sec: 'log' }); });
      v.schedule.forEach(function (s) { if (matches([s.task, s.basis].join(' '), terms)) res.push({ v: v, type: 'Schedule', title: s.task, sub: s.basis || '', sec: 'schedule' }); });
      v.todos.forEach(function (t) { if (matches(t.text, terms)) res.push({ v: v, type: t.done ? 'Done' : (isAir(v) ? 'Squawk' : 'To-do'), title: t.text, sub: '', sec: 'todos' }); });
      v.specs.forEach(function (s) { if (s.value && matches(s.label + ' ' + s.value, terms)) res.push({ v: v, type: 'Spec', title: s.label, sub: s.value, sec: 'specs' }); });
    });
    return res.map(function (r) { r.terms = terms; return r; });
  }
  function renderSearch(q) {
    var si = $('#searchInput'); if (document.activeElement !== si) si.value = q;
    var res = searchAll(q);
    var h = '<section class="reveal-up"><p class="kicker">Search</p><h1 class="display chrome">“' + esc(q) + '”</h1><p class="lede">' + res.length + ' result' + (res.length === 1 ? '' : 's') + ' across parts, part numbers, services, schedule, specs and to-dos</p></section><section class="results">';
    res.forEach(function (r, i) {
      h += '<div class="result" style="--i:' + Math.min(i, 12) + '"><a href="#/v/' + encodeURIComponent(r.v.id) + '/' + r.sec + '"><span class="rtype">' + esc(r.type) + '</span><strong>' + hl(r.title, r.terms) + '</strong>' + (r.sub ? '<span class="rsub">' + hl(r.sub, r.terms) + '</span>' : '') + '<span class="rveh">' + esc(r.v.name) + ' ›</span></a>' +
        (r.copy && r.copy.length ? '<div class="rcopy">' + r.copy.map(function (c) { return '<button class="pnum verified" data-copy="' + esc(c) + '"><span class="pval">' + esc(c) + '</span><span class="pst">copy</span></button>'; }).join('') + '</div>' : '') + '</div>';
    });
    if (!res.length) h += '<p class="empty">Nothing found. Try a part number like <a href="#/search/PF63">PF63</a>, or a word like <a href="#/search/cabin">cabin</a> or <a href="#/search/wipers">wipers</a>.</p>';
    h += '</section>';
    app.innerHTML = h;
    $$('[data-copy]', app).forEach(function (b) { b.onclick = function () { copy(b.dataset.copy); }; });
  }
  var searchT;
  $('#searchInput').addEventListener('input', function (e) {
    clearTimeout(searchT);
    var q = e.target.value.trim();
    searchT = setTimeout(function () {
      if (!q) { if (parseHash()[0] === 'search') location.hash = '#/'; return; }
      var target = '#/search/' + encodeURIComponent(q);
      if (parseHash()[0] === 'search') { history.replaceState(null, '', target); route(); }
      else location.hash = target;
    }, 220);
  });
  $('#searchForm').addEventListener('submit', function (e) { e.preventDefault(); var q = $('#searchInput').value.trim(); if (q) location.hash = '#/search/' + encodeURIComponent(q); $('#searchInput').blur(); });

  /* ---------------- credits ---------------- */
  function renderCredits() {
    var c = Store.data.credits || {}, h = '';
    Object.keys(c).forEach(function (k) { var x = c[k]; h += '<p class="small credit">' + esc(x.text) + (x.links && x.links.length ? ' ' + x.links.map(function (l) { return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + '</a>'; }).join(' · ') : '') + '</p>'; });
    h += '<p class="small credit">Service intervals and part numbers: see the Sources list on each profile. Fonts: Big Shoulders Display, Inter and JetBrains Mono (SIL Open Font License), via Google Fonts.</p>';
    document.getElementById('credits').innerHTML = h;
  }

  /* ---------------- boot ---------------- */
  Store.onChange(function () { if (Store.data) renderCredits(); });
  Store.load().then(function () { renderCredits(); route(); updatePill(); }, function (e) {
    app.innerHTML = '<section class="panel"><h2>Couldn’t load the garage data</h2><p>' + esc(e.message) + '</p><p class="small">Opened the file directly from disk? Run a local web server instead (for example <code>python3 -m http.server</code>).</p></section>';
  });
  window.GarageApp = { searchAll: searchAll, route: route };
})();
