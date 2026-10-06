/* Showroom turntable: drag to spin between real photo angles (crossfade + perspective),
   drag vertically (mouse) to tilt. One image = tilt-only mode. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function Turntable(el, views, opts) {
    opts = opts || {};
    var n = views.length, seg = 360 / Math.max(n, 1);
    el.classList.add('tt');
    if (!reduce) el.classList.add('tt-reveal');
    var imgs = views.map(function (v, k) {
      return '<img class="tt-img" draggable="false" alt="' + (k === 0 ? (opts.alt || 'Vehicle photo') : '') + '" ' + (k ? 'aria-hidden="true" loading="lazy"' : 'fetchpriority="high"') + ' src="' + v.src + '">';
    }).join('');
    el.innerHTML =
      '<div class="tt-stage" tabindex="0" role="img" aria-label="' + (opts.alt || 'Vehicle') + (n > 1 ? '. Use left and right arrow keys to spin.' : '') + '">' +
        '<div class="tt-spot"></div><div class="tt-floor"></div><div class="tt-shadow"></div>' +
        '<div class="tt-car">' + imgs + '</div><div class="tt-sweep"></div>' +
        (n > 1 ? '<div class="tt-hint"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Drag to spin</div>' : '') +
      '</div>' +
      (n > 1 ? '<div class="tt-ui" role="group" aria-label="Pick an angle">' + views.map(function (v, k) { return '<button type="button" class="tt-dot" data-k="' + k + '">' + (v.label || ('View ' + (k + 1))) + '</button>'; }).join('') + '<button type="button" class="tt-auto" aria-pressed="false" title="Auto-rotate">⟳ Auto</button></div>' : '');

    var stage = el.querySelector('.tt-stage'), car = el.querySelector('.tt-car');
    var layers = [].slice.call(el.querySelectorAll('.tt-img'));
    var dots = [].slice.call(el.querySelectorAll('.tt-dot'));
    var autoBtn = el.querySelector('.tt-auto');
    var angle = 0, target = 0, tilt = 0, tiltTarget = 0, vel = 0, dragging = false, lastX = 0, lastY = 0, lastT = 0, raf = 0;
    var auto = !!opts.auto && !reduce && n > 1, autoTimer = 0, lastInteract = 0;

    function smooth(t) { return t * t * (3 - 2 * t); }
    function render() {
      var a = ((angle % 360) + 360) % 360;
      if (n > 1) {
        var i = Math.floor(a / seg) % n, t = (a - i * seg) / seg, j = (i + 1) % n, e = smooth(t);
        layers.forEach(function (img, k) {
          var m = views[k].mirror ? -1 : 1, op = 0, tr = '';
          if (k === i) { op = 1 - e; tr = 'translateX(' + (-e * 7) + '%) rotateY(' + (e * 30) + 'deg) scale(' + (m * (1 - e * 0.12)) + ',' + (1 - e * 0.04) + ')'; }
          else if (k === j) { op = e; tr = 'translateX(' + ((1 - e) * 7) + '%) rotateY(' + (-(1 - e) * 30) + 'deg) scale(' + (m * (1 - (1 - e) * 0.12)) + ',' + (1 - (1 - e) * 0.04) + ')'; }
          else { tr = 'scale(' + m + ',1)'; }
          img.style.opacity = op.toFixed(3);
          img.style.transform = tr;
        });
        var near = Math.round(a / seg) % n;
        dots.forEach(function (d, k) { d.classList.toggle('on', k === near); d.setAttribute('aria-pressed', k === near ? 'true' : 'false'); });
        car.style.transform = 'rotateX(' + tilt.toFixed(2) + 'deg)';
      } else {
        // tilt-only: map angle to a gentle Y-rotation
        var ry = Math.max(-18, Math.min(18, ((a + 180) % 360) - 180));
        car.style.transform = 'rotateX(' + tilt.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
        layers[0].style.opacity = 1;
      }
    }
    function loop() {
      raf = 0;
      if (!dragging) {
        if (Math.abs(vel) > 0.05) { target += vel; vel *= 0.92; }
        else if (n > 1) { vel = 0; target = Math.round(target / seg) * seg; }
        else { vel = 0; target = target * 0.9; }
        tiltTarget *= 0.9;
      }
      angle += (target - angle) * (reduce ? 1 : 0.16);
      tilt += (tiltTarget - tilt) * (reduce ? 1 : 0.16);
      render();
      if (dragging || Math.abs(target - angle) > 0.05 || Math.abs(vel) > 0.05 || Math.abs(tilt - tiltTarget) > 0.05 || Math.abs(tiltTarget) > 0.05) raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    function interact() { lastInteract = Date.now(); }

    stage.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY; lastT = performance.now(); vel = 0; interact();
      stage.classList.add('grabbing'); el.classList.add('touched');
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      kick();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY, now = performance.now();
      var k = n > 1 ? 0.55 : 0.25;
      target -= dx * k; vel = -dx * k * 0.6;
      if (e.pointerType === 'mouse') tiltTarget = Math.max(-10, Math.min(10, tiltTarget - dy * 0.15));
      lastX = e.clientX; lastY = e.clientY; lastT = now; interact();
    });
    function end() { if (!dragging) return; dragging = false; stage.classList.remove('grabbing'); interact(); kick(); }
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end); stage.addEventListener('lostpointercapture', end);
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { target -= seg; interact(); kick(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { target += seg; interact(); kick(); e.preventDefault(); }
    });
    dots.forEach(function (d) {
      d.addEventListener('click', function () {
        var k = +d.dataset.k, cur = Math.round(target / seg), base = cur - (((cur % n) + n) % n);
        var to = base + k; if (to - cur > n / 2) to -= n; if (cur - to > n / 2) to += n;
        target = to * seg; interact(); kick();
      });
    });
    function setAuto(on) {
      auto = on; if (autoBtn) { autoBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); autoBtn.classList.toggle('on', on); }
      clearInterval(autoTimer);
      if (on) autoTimer = setInterval(function () {
        if (!document.body.contains(el)) { clearInterval(autoTimer); return; }
        if (dragging || Date.now() - lastInteract < 3500 || document.hidden) return;
        target += seg; kick();
      }, 2600);
    }
    if (autoBtn) autoBtn.addEventListener('click', function () { setAuto(!auto); interact(); });
    setAuto(auto);
    render();
    return { set: function (deg) { target = deg; kick(); }, get angle() { return angle; } };
  }
  window.Turntable = Turntable;
})();
