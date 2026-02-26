(function () {
  'use strict';

  var nav = document.getElementById('wgSectionNav');
  if (!nav) return;

  var links   = Array.from(nav.querySelectorAll('.wg-nav-link'));
  var targets = links.map(function (l) {
    return document.getElementById(l.dataset.target);
  }).filter(Boolean);

  if (!targets.length) return;

  // ── Scroll spy ────────────────────────────────────────────────────────────

  var ticking = false;

  function updateActive() {
    var scrollY = window.scrollY + 90;
    var active  = null;
    targets.forEach(function (t) {
      if (t.offsetTop <= scrollY) active = t.id;
    });
    links.forEach(function (l) {
      l.classList.toggle('is-active', l.dataset.target === active);
    });
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) { requestAnimationFrame(updateActive); ticking = true; }
  }, { passive: true });

  updateActive();

  // ── Smooth scroll ─────────────────────────────────────────────────────────

  nav.addEventListener('click', function (e) {
    var link = e.target.closest('.wg-nav-link[data-target]');
    if (!link) return;
    e.preventDefault();
    var target = document.getElementById(link.dataset.target);
    if (target) window.scrollTo({ top: target.offsetTop - 75, behavior: 'smooth' });
  });

})();
