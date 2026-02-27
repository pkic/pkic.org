(function () {
  var utils = window.pkicLogoUtils;
  if (!utils) return;

  var WALL_NS_LIMIT = 84;

  document.querySelectorAll('.members-overview .members').forEach(function (grid) {
    var links = Array.from(grid.querySelectorAll('a[data-sponsor-level]'));
    if (links.length < 2) return;

    var b = utils.logoBuckets(links);
    var nonSponsors = b.nonSponsors.slice(0, Math.max(WALL_NS_LIMIT, b.sponsors.length * 2));
    var sequence = utils.logoBuildSequence(b.sponsors, nonSponsors);

    function makeCopy(items, hidden) {
      var div = document.createElement('div');
      div.className = 'logo-wall-copy';
      if (hidden) div.setAttribute('aria-hidden', 'true');
      items.forEach(function (item) { div.appendChild(item.el.cloneNode(true)); });
      return div;
    }

    var track = document.createElement('div');
    track.className = 'logo-wall-track';
    var copy1 = makeCopy(sequence, false);
    var copy2 = makeCopy(sequence, true);
    track.appendChild(copy1);
    track.appendChild(copy2);

    grid.innerHTML = '';
    grid.appendChild(track);

    requestAnimationFrame(function () {
      var h = copy1.scrollHeight;
      if (h > 0) track.style.animationDuration = Math.max(30, Math.round(h / 8)) + 's';
    });

    grid.addEventListener('mouseenter', function () { track.style.animationPlayState = 'paused'; });
    grid.addEventListener('mouseleave', function () { track.style.animationPlayState = 'running'; });
  });
})();

(function () {
  var tip = document.createElement('div');
  tip.className = 'member-hovercard';
  tip.innerHTML =
    '<div class="member-hovercard-body">'
      + '<strong class="member-hovercard-name"></strong>'
      + '<span class="member-hovercard-slogan"></span>'
    + '</div>'
    + '<div class="member-hovercard-footer"></div>';
  document.body.appendChild(tip);

  var tipName = tip.querySelector('.member-hovercard-name');
  var tipSlogan = tip.querySelector('.member-hovercard-slogan');
  var tipFooter = tip.querySelector('.member-hovercard-footer');
  var currentAnchor = null;

  function position(anchor) {
    var rect = anchor.getBoundingClientRect();
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var top = rect.top - th - 10;
    if (top < 6) top = rect.bottom + 10;
    var left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  }

  function show(anchor) {
    var name = anchor.getAttribute('data-member-name') || '';
    var slogan = anchor.getAttribute('data-member-slogan') || '';
    var levelName = anchor.getAttribute('data-sponsor-level-name') || '';
    var level = parseInt(anchor.getAttribute('data-sponsor-level') || '0', 10);

    tipName.textContent = name;
    tipSlogan.textContent = slogan;
    tipSlogan.style.display = slogan ? '' : 'none';

    if (level > 0 && levelName) {
      tipFooter.textContent = levelName + ' Sponsor';
      tipFooter.className = 'member-hovercard-footer sponsor-tier-' + level;
      tipFooter.style.display = '';
    } else {
      tipFooter.style.display = 'none';
    }

    currentAnchor = anchor;
    tip.classList.add('member-hovercard--visible');
    position(anchor);
  }

  function hide() {
    currentAnchor = null;
    tip.classList.remove('member-hovercard--visible');
  }

  document.addEventListener('mouseover', function (e) {
    var a = e.target.closest('a[data-member-name]');
    if (a) { show(a); } else { hide(); }
  });

  window.addEventListener('scroll', function () {
    if (currentAnchor) position(currentAnchor);
  }, { passive: true });

  document.addEventListener('member:spotlight', function (e) { show(e.detail.anchor); });
  document.addEventListener('member:spotlight-hide', function () { hide(); });
})();

(function () {
  var SHOW_MS = 2200;
  var ZOOM_MS = 3800;
  var ZOOM_MS_DIA = 7600;
  var ZOOM_FADE_MS = 650;
  var GAP_AFTER = 4300;
  var INITIAL_DELAY = 2500;
  var ZOOM_MIN_TIER = 5;
  var CARD_MIN_TIER = 3;

  document.querySelectorAll('.members-overview .members').forEach(function (grid) {
    var overlay = document.createElement('div');
    overlay.className = 'member-zoom-overlay';
    overlay.innerHTML =
      '<img class="member-zoom-logo" alt="" />'
      + '<div class="member-zoom-info">'
        + '<strong class="member-zoom-name"></strong>'
        + '<span class="member-zoom-slogan"></span>'
      + '</div>'
      + '<div class="member-zoom-badge"></div>';
    grid.appendChild(overlay);

    var ovLogo = overlay.querySelector('.member-zoom-logo');
    var ovName = overlay.querySelector('.member-zoom-name');
    var ovSlogan = overlay.querySelector('.member-zoom-slogan');
    var ovBadge = overlay.querySelector('.member-zoom-badge');

    var track = null;
    var timer = null;
    var active = false;
    var manualHover = false;
    var recentlyShown = [];
    var spotlit = null;

    function clearSpotlight() {
      if (spotlit) {
        spotlit.classList.remove('member-logo--spotlight');
        spotlit = null;
      }
      overlay.classList.remove('member-zoom-overlay--visible');
      grid.classList.remove('members--zooming');
      document.dispatchEvent(new CustomEvent('member:spotlight-hide'));
    }

    function endZoom() {
      if (spotlit) {
        spotlit.classList.remove('member-logo--spotlight');
        spotlit = null;
      }
      overlay.classList.remove('member-zoom-overlay--visible');
      document.dispatchEvent(new CustomEvent('member:spotlight-hide'));
      timer = setTimeout(function () {
        grid.classList.remove('members--zooming');
        if (track) track.style.animationPlayState = 'running';
        timer = setTimeout(spotlight, GAP_AFTER);
      }, ZOOM_FADE_MS);
    }

    function getTrack() {
      if (!track) track = grid.querySelector('.logo-wall-track');
      return track;
    }

    function allAnchors() {
      var copy = grid.querySelector('.logo-wall-copy:not([aria-hidden])');
      if (!copy) return [];
      return Array.from(copy.querySelectorAll('a[data-member-name]'));
    }

    function highTierCandidates() {
      return allAnchors().filter(function (a) {
        return parseInt(a.getAttribute('data-sponsor-level') || '0', 10) >= ZOOM_MIN_TIER;
      }).sort(function (a, b) {
        return parseInt(b.getAttribute('data-sponsor-level') || '0', 10) - parseInt(a.getAttribute('data-sponsor-level') || '0', 10);
      });
    }

    function midTierCandidates() {
      getTrack();
      var copy = grid.querySelector('.logo-wall-copy:not([aria-hidden])');
      if (!copy) return [];

      var cr = grid.getBoundingClientRect();
      var top = cr.top + cr.height * 0.15;
      var bot = cr.bottom - cr.height * 0.15;

      return Array.from(copy.querySelectorAll('a[data-member-name]')).filter(function (a) {
        var r = a.getBoundingClientRect();
        var mid = r.top + r.height / 2;
        return mid >= top && mid <= bot && r.width > 0
          && parseInt(a.getAttribute('data-sponsor-level') || '0', 10) >= CARD_MIN_TIER
          && parseInt(a.getAttribute('data-sponsor-level') || '0', 10) < ZOOM_MIN_TIER;
      }).sort(function (a, b) {
        return parseInt(b.getAttribute('data-sponsor-level') || '0', 10) - parseInt(a.getAttribute('data-sponsor-level') || '0', 10);
      });
    }

    function spotlight() {
      if (!active || manualHover) return;

      var highAll = highTierCandidates();
      var highFresh = highAll.filter(function (a) {
        return recentlyShown.indexOf(a.getAttribute('data-member-name')) === -1;
      });
      if (!highFresh.length && highAll.length) {
        recentlyShown = [];
        highFresh = highAll;
      }

      var midAll = highFresh.length ? [] : midTierCandidates();
      var midFresh = midAll.filter(function (a) {
        return recentlyShown.indexOf(a.getAttribute('data-member-name')) === -1;
      });
      if (!midFresh.length && midAll.length) {
        midFresh = midAll;
      }

      var candidates = highFresh.length ? highFresh : midFresh;
      if (!candidates.length) {
        timer = setTimeout(spotlight, GAP_AFTER);
        return;
      }

      var pick = candidates[0];
      var level = parseInt(pick.getAttribute('data-sponsor-level') || '0', 10);
      recentlyShown.push(pick.getAttribute('data-member-name'));

      getTrack();
      if (track) track.style.animationPlayState = 'paused';
      spotlit = pick;
      pick.classList.add('member-logo--spotlight');

      if (level >= ZOOM_MIN_TIER) {
        var img = pick.querySelector('img');
        var name = pick.getAttribute('data-member-name') || '';
        var slogan = pick.getAttribute('data-member-slogan') || '';
        var levelName = pick.getAttribute('data-sponsor-level-name') || '';

        ovLogo.src = img ? img.src : '';
        ovLogo.alt = name;
        ovName.textContent = name;
        ovSlogan.textContent = slogan;
        ovSlogan.style.display = slogan ? '' : 'none';
        ovBadge.textContent = levelName + ' Sponsor';
        ovBadge.className = 'member-zoom-badge sponsor-tier-' + level;

        grid.classList.add('members--zooming');
        overlay.classList.add('member-zoom-overlay--visible');

        var holdMs = level >= 6 ? ZOOM_MS_DIA : ZOOM_MS;
        timer = setTimeout(endZoom, holdMs);
      } else {
        document.dispatchEvent(new CustomEvent('member:spotlight', { detail: { anchor: pick } }));
        timer = setTimeout(function () {
          clearSpotlight();
          if (track) track.style.animationPlayState = 'running';
          timer = setTimeout(spotlight, GAP_AFTER);
        }, SHOW_MS);
      }
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !active) {
            active = true;
            timer = setTimeout(spotlight, INITIAL_DELAY);
          } else if (!entry.isIntersecting && active) {
            active = false;
            clearTimeout(timer);
            clearSpotlight();
            if (track) track.style.animationPlayState = 'running';
          }
        });
      }, { threshold: 0.3 });
      io.observe(grid);
    }

    grid.addEventListener('mouseenter', function () {
      manualHover = true;
      clearTimeout(timer);
      clearSpotlight();
      if (track) track.style.animationPlayState = 'paused';
    });

    grid.addEventListener('mouseleave', function () {
      manualHover = false;
      if (track) track.style.animationPlayState = 'running';
      if (active) timer = setTimeout(spotlight, GAP_AFTER);
    });
  });
})();
