/* Schedule math: odometer/hours estimation and per-item status. Pure functions (testable). */
(function () {
  'use strict';
  var DAY = 86400000;
  function parseDate(s) { if (!s) return null; var p = String(s).split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addMonths(d, m, endOfMonth) {
    var r = new Date(d.getFullYear(), d.getMonth() + m, endOfMonth ? 1 : d.getDate());
    if (endOfMonth) r = new Date(r.getFullYear(), r.getMonth() + 1, 0);
    else if (r.getDate() !== d.getDate()) r = new Date(r.getFullYear(), r.getMonth(), 0);
    return r;
  }
  function daysBetween(a, b) { return Math.round((b - a) / DAY); }
  function isAir(v) { return v.category === 'aircraft'; }
  function meterOf(entry, v) { var x = isAir(v) ? entry.totalTime : entry.mileage; return (x === '' || x == null || isNaN(+x)) ? null : +x; }
  function currentMeter(v) { var x = isAir(v) ? v.totalTime : v.mileage; return (x === '' || x == null || isNaN(+x)) ? null : +x; }
  function currentDate(v) { return isAir(v) ? v.meterDate : v.mileageDate; }
  function unit(v) { return isAir(v) ? 'hrs' : 'mi'; }

  /* Known readings (date, value) sorted by date. */
  function readings(v) {
    var pts = [];
    (v.log || []).forEach(function (e) { var m = meterOf(e, v); if (m != null && e.date) pts.push({ d: parseDate(e.date), m: m }); });
    var cm = currentMeter(v), cd = currentDate(v);
    if (cm != null && cd) pts.push({ d: parseDate(cd), m: cm });
    pts.sort(function (a, b) { return a.d - b.d || a.m - b.m; });
    return pts;
  }
  /* Estimate meter at a date. Returns {m, est}. After the last reading we conservatively hold the last value. */
  function estimateAt(v, dateStr) {
    var d = parseDate(dateStr), pts = readings(v);
    if (!pts.length) return { m: null, est: true };
    if (!isAir(v) && v.inServiceDate) pts = [{ d: parseDate(v.inServiceDate), m: 0 }].concat(pts);
    if (d <= pts[0].d) return { m: pts[0].m, est: true };
    for (var i = 1; i < pts.length; i++) {
      if (d <= pts[i].d) {
        var a = pts[i - 1], b = pts[i], span = b.d - a.d;
        var m = span ? a.m + (b.m - a.m) * ((d - a.d) / span) : b.m;
        return { m: Math.round(m), est: true };
      }
    }
    return { m: pts[pts.length - 1].m, est: true };
  }
  /* Average pace from the two most recent real readings (per 30 days). */
  function pace(v) {
    var pts = readings(v).filter(function (p, i, arr) { return i === 0 || p.d - arr[i - 1].d > 0; });
    if (pts.length < 2) return null;
    var a = pts[pts.length - 2], b = pts[pts.length - 1];
    var days = (b.d - a.d) / DAY; if (days < 20 || b.m <= a.m) return null;
    var perMonth = (b.m - a.m) / days * 30;
    return { perMonth: perMonth, since: b, estimateNow: function (today) { return Math.round(b.m + perMonth * ((today - b.d) / DAY) / 30); } };
  }

  function lastFor(v, id) {
    var list = (v.log || []).filter(function (e) { return (e.tags || []).indexOf(id) >= 0 && e.date; });
    list.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return list[0] || null;
  }

  function itemStatus(v, item, today) {
    today = today || new Date(); today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var air = isAir(v), severe = v.scheduleMode === 'severe';
    var every = air ? (item.everyHours || null) : (severe && item.severeMiles ? item.severeMiles : (item.everyMiles || null));
    var months = item.everyMonths || null;
    var r = { item: item, every: every, months: months, unit: unit(v), status: 'ok', last: null, lastMeter: null, lastEst: false, dueMeter: null, dueDate: null, remMeter: null, remDays: null, noRecord: false, assumedStart: false };
    var last = lastFor(v, item.id);
    r.last = last;
    if (!every && !months && !item.once) { r.status = 'na'; return r; }
    var cur = currentMeter(v);
    var baseDate, baseMeter = null;
    if (last) {
      baseDate = parseDate(last.date);
      var lm = meterOf(last, v);
      if (lm != null) baseMeter = lm; else { var e = estimateAt(v, last.date); baseMeter = e.m; r.lastEst = true; }
      r.lastMeter = baseMeter;
      if (item.once) { r.status = 'done'; return r; }
    } else {
      r.noRecord = true;
      if (air || item.once) { r.status = 'notlogged'; return r; }
      if (!v.inServiceDate) { r.status = 'unknown'; return r; }
      baseDate = parseDate(v.inServiceDate); baseMeter = 0; r.assumedStart = true;
    }
    if (every != null && baseMeter != null) { r.dueMeter = baseMeter + every; if (cur != null) r.remMeter = r.dueMeter - cur; }
    if (months) { r.dueDate = addMonths(baseDate, months, !!item.calendarMonths || item.id === 'annual'); r.remDays = daysBetween(today, r.dueDate); }
    var soonMeter = every ? (air ? Math.max(5, every * 0.1) : Math.min(1000, Math.max(500, every * 0.1))) : 0;
    var soonDays = months ? Math.min(90, Math.max(30, months * 30.4 * 0.1)) : 0;
    var over = (r.remMeter != null && r.remMeter < 0) || (r.remDays != null && r.remDays < 0);
    var soon = (r.remMeter != null && r.remMeter <= soonMeter) || (r.remDays != null && r.remDays <= soonDays);
    r.status = over ? 'overdue' : soon ? 'soon' : 'ok';
    // fraction of the interval used (for rings)
    var fr = [];
    if (every && r.remMeter != null) fr.push(1 - r.remMeter / every);
    if (months && r.remDays != null) fr.push(1 - r.remDays / (months * 30.4));
    r.used = fr.length ? Math.max.apply(null, fr) : null;
    return r;
  }

  function allStatuses(v, today) { return (v.schedule || []).map(function (it) { return itemStatus(v, it, today); }); }

  var RANK = { overdue: 0, soon: 1, notlogged: 2, unknown: 3, ok: 4, done: 5, na: 6 };
  /* The single most urgent upcoming item. */
  function nextService(v, today) {
    var list = allStatuses(v, today).filter(function (s) { return ['overdue', 'soon', 'ok'].indexOf(s.status) >= 0; });
    list.sort(function (a, b) { return (RANK[a.status] - RANK[b.status]) || ((b.used || 0) - (a.used || 0)); });
    return list[0] || null;
  }
  function summary(v, today) {
    var st = allStatuses(v, today), c = { overdue: 0, soon: 0, notlogged: 0 };
    st.forEach(function (s) { if (c[s.status] != null) c[s.status]++; });
    return { counts: c, statuses: st };
  }

  window.Schedule = { parseDate: parseDate, iso: iso, addMonths: addMonths, readings: readings, estimateAt: estimateAt, pace: pace, itemStatus: itemStatus, allStatuses: allStatuses, nextService: nextService, summary: summary, meterOf: meterOf, currentMeter: currentMeter, unit: unit, isAir: isAir, RANK: RANK };
})();
