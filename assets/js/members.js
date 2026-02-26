(function () {
  'use strict';

  var input    = document.getElementById('memberSearch');
  var noResult = document.getElementById('member-no-results');
  var sidebar  = document.querySelector('.members-az-sidebar');

  if (!input) return;

  // ── Search filter ──────────────────────────────────────────────────────────

  function applyFilters() {
    var q = input.value.trim().toLowerCase();
    var totalVisible = 0;

    document.querySelectorAll('.member-letter-group').forEach(function (group) {
      var groupVisible = 0;
      group.querySelectorAll('.member-card').forEach(function (card) {
        var name = (card.dataset.memberName || '').toLowerCase();
        var show = !q || name.includes(q);
        card.style.display = show ? '' : 'none';
        if (show) groupVisible++;
      });
      totalVisible += groupVisible;
      group.classList.toggle('is-hidden', groupVisible === 0);
    });

    noResult.classList.toggle('d-none', totalVisible > 0 || !q);
    updateSidebarEmpties(q);
    updateActiveLetter();
  }

  function updateSidebarEmpties(q) {
    if (!sidebar) return;
    sidebar.querySelectorAll('.az-sidebar-link').forEach(function (link) {
      if (link.classList.contains('is-empty')) return;
      var group = document.querySelector('[data-letter="' + link.dataset.letter + '"]');
      link.classList.toggle('is-empty-search', !!(group && group.classList.contains('is-hidden')));
    });
  }

  input.addEventListener('input', applyFilters);

  // ── Scroll spy ────────────────────────────────────────────────────────────

  function updateActiveLetter() {
    if (!sidebar) return;
    var groups  = Array.from(document.querySelectorAll('.member-letter-group:not(.is-hidden)'));
    var scrollY = window.scrollY + 90;
    var active  = null;
    groups.forEach(function (g) { if (g.offsetTop <= scrollY) active = g.dataset.letter; });
    sidebar.querySelectorAll('.az-sidebar-link').forEach(function (link) {
      link.classList.toggle('is-active',
        !link.classList.contains('is-empty') && link.dataset.letter === active);
    });
  }

  window.addEventListener('scroll', updateActiveLetter, { passive: true });

  // ── Smooth-scroll sidebar links ───────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var link = e.target.closest('.az-sidebar-link[href^="#"]');
    if (!link) return;
    e.preventDefault();
    var target = document.querySelector(link.getAttribute('href'));
    if (target) window.scrollTo({ top: target.offsetTop - 80, behavior: 'smooth' });
  });

})();
