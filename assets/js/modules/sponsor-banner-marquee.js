/** Fisher-Yates in-place shuffle — returns the same array. */
function logoShuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function logoBuildSequence(S, NS) {
  if (!S.length) return NS.slice();
  if (!NS.length) return S.slice();

  var ns = NS.slice();
  while (ns.length < 2 * S.length) {
    ns = ns.concat(logoShuffle(NS.slice()));
  }

  var perSlot = Math.max(2, Math.floor(ns.length / S.length));
  var remainder = ns.length - perSlot * S.length;
  var result = [];
  var nsIdx = 0;

  for (var i = 0; i < S.length; i++) {
    var count = Math.max(2, perSlot + (i < remainder ? 1 : 0));
    for (var j = 0; j < count; j++) {
      result.push(ns[nsIdx % ns.length]);
      nsIdx++;
    }
    result.push(S[i]);
  }
  return result;
}

function logoBuckets(links) {
  var sponsors = [];
  var nonSponsors = [];

  links.forEach(function (el) {
    var lvl = parseInt(el.dataset.sponsorLevel, 10) || 0;
    (lvl > 0 ? sponsors : nonSponsors).push({ el: el, level: lvl });
  });

  logoShuffle(sponsors);
  logoShuffle(nonSponsors);
  return { sponsors: sponsors, nonSponsors: nonSponsors };
}

window.pkicLogoUtils = {
  logoShuffle: logoShuffle,
  logoBuildSequence: logoBuildSequence,
  logoBuckets: logoBuckets
};

(function () {
  var banner = document.querySelector('.members .banner');
  if (!banner) return;

  var links = Array.from(banner.querySelectorAll('a[data-sponsor-level]'));
  if (links.length < 2) return;

  var b = logoBuckets(links);
  var sequence = logoBuildSequence(b.sponsors, b.nonSponsors);

  function makeCopy(items, hidden) {
    var span = document.createElement('span');
    span.className = 'banner-copy';
    if (hidden) span.setAttribute('aria-hidden', 'true');
    items.forEach(function (item) { span.appendChild(item.el.cloneNode(true)); });
    return span;
  }

  var track = document.createElement('div');
  track.className = 'banner-track';
  var copy1 = makeCopy(sequence, false);
  var copy2 = makeCopy(sequence, true);
  track.appendChild(copy1);
  track.appendChild(copy2);
  banner.innerHTML = '';
  banner.appendChild(track);

  requestAnimationFrame(function () {
    var w = copy1.scrollWidth;
    if (w > 0) track.style.animationDuration = Math.max(20, Math.round(w / 80)) + 's';
  });

  banner.addEventListener('mouseenter', function () { track.style.animationPlayState = 'paused'; });
  banner.addEventListener('mouseleave', function () { track.style.animationPlayState = 'running'; });
})();
