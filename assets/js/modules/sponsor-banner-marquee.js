/*
 * Shared helpers for the two logo walls: the strip above the footer and the
 * grid on the members page.
 */

/** Fisher-Yates on a copy, so the caller's array keeps its order. */
function logoShuffle(list) {
  var copy = list.slice();
  for (var i = copy.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

function logoBuildSequence(S, NS) {
  if (!S.length) return NS.slice();
  if (!NS.length) return S.slice();

  var ns = NS.slice();
  while (ns.length < 2 * S.length) {
    ns = ns.concat(logoShuffle(NS));
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

  return { sponsors: logoShuffle(sponsors), nonSponsors: logoShuffle(nonSponsors) };
}

/**
 * Members, and the sponsors grouped by level from the highest down.
 *
 * Sponsor levels retain their ordering; names belong to each logo's hover card.
 * A level with no sponsor simply does not appear.
 */
function logoLevels(links) {
  var members = [];
  var byLevel = new Map();
  links.forEach(function (el) {
    var level = parseInt(el.dataset.sponsorLevel, 10) || 0;
    if (level <= 0) {
      members.push(el);
      return;
    }
    var group = byLevel.get(level);
    if (!group) {
      group = { level: level, name: el.dataset.sponsorLevelName || "", items: [] };
      byLevel.set(level, group);
    }
    group.items.push(el);
  });
  var levels = Array.from(byLevel.values()).sort(function (a, b) {
    return b.level - a.level;
  });
  return { members: members, levels: levels };
}

/**
 * Drops a tile whose logo could not be decoded.
 *
 * A handful of stored member logos are malformed, and a broken image rides
 * the strip as the member's name in alt text. `error` does not bubble, so the
 * listener captures — and it stays attached, because tiles are created for as
 * long as the marquee runs and their images load lazily as they come into
 * view rather than all at once up front.
 */
function logoDropOnError(container, tileSelector) {
  container.addEventListener(
    "error",
    function (event) {
      var image = event.target;
      if (!image || image.tagName !== "IMG") return;
      var tile = image.closest(tileSelector);
      if (tile && tile.parentNode) tile.parentNode.removeChild(tile);
    },
    true,
  );
}

window.pkicLogoUtils = {
  logoShuffle: logoShuffle,
  logoBuildSequence: logoBuildSequence,
  logoBuckets: logoBuckets,
  logoDropOnError: logoDropOnError,
  logoLevels: logoLevels,
};

/*
 * The strip above the footer.
 *
 * It reads as one continuous procession rather than a block that restarts:
 * the tile that leaves on the left is dropped and a freshly drawn one joins
 * on the right, so no two passes are alike and there is no seam to notice.
 *
 * What it draws alternates — a random handful of members in grey, then one
 * sponsor level shown in color, then the next level
 * down. Every level that has a sponsor gets its turn, so the strip stays the
 * same length whether the consortium has twenty sponsors or two hundred.
 */
(function () {
  var MEMBERS_MIN = 4;
  var MEMBERS_MAX = 8;
  var SPEED = 42; // px per second

  /**
   * The endless order of tiles.
   *
   * Members are drawn from a pool that is reshuffled once it runs out, so a
   * member reappears only after the rest have had their turn.
   */
  function createStream(members, levels) {
    var pool = [];
    var queue = [];
    var levelIndex = 0;

    function drawMembers() {
      var count = MEMBERS_MIN + Math.floor(Math.random() * (MEMBERS_MAX - MEMBERS_MIN + 1));
      for (var i = 0; i < count && members.length; i++) {
        if (!pool.length) pool = logoShuffle(members);
        queue.push({ kind: "logo", el: pool.pop() });
      }
    }

    function drawLevel() {
      if (!levels.length) return;
      var level = levels[levelIndex % levels.length];
      levelIndex += 1;
      logoShuffle(level.items).forEach(function (el) {
        queue.push({ kind: "logo", el: el });
      });
      // A gap closes the group, so the members that follow are not read as
      // belonging to the level that was just announced.
      queue.push({ kind: "gap" });
    }

    return function next() {
      if (!queue.length) {
        drawMembers();
        drawLevel();
        if (!queue.length) return null; // Nothing to show at all.
      }
      return queue.shift();
    };
  }

  function setup() {
    var banner = document.querySelector(".members .banner");
    if (!banner || banner.querySelector(".banner-track")) return;

    var links = Array.from(banner.querySelectorAll("a[data-sponsor-level]"));
    if (links.length < 2) return;

    var groups = logoLevels(links);
    var next = createStream(groups.members, groups.levels);

    var track = document.createElement("div");
    track.className = "banner-track";
    banner.innerHTML = "";
    banner.appendChild(track);
    logoDropOnError(track, ".banner-item");

    var offset = 0;

    function append() {
      var item = next();
      if (!item) return false;
      var tile = document.createElement("span");
      tile.className = "banner-item banner-item--" + item.kind;
      if (item.el) tile.appendChild(item.el.cloneNode(true));
      track.appendChild(tile);
      return true;
    }

    /** Enough tiles to cover the strip twice over, so nothing pops into view. */
    function topUp() {
      var target = banner.clientWidth * 2 + 200;
      var guard = 0;
      while (track.scrollWidth - offset < target && guard < 200) {
        if (!append()) break;
        guard += 1;
      }
    }

    topUp();

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var running = false;
    var paused = false;
    var last = 0;
    var frame = 0;

    function step(now) {
      var elapsed = last ? Math.min((now - last) / 1000, 0.25) : 0;
      last = now;
      offset += SPEED * elapsed;

      // The tile that has left on the left makes room for a new one at the
      // end, which is what keeps the procession from ever repeating itself.
      var first = track.firstElementChild;
      while (first) {
        var width = first.getBoundingClientRect().width;
        if (offset < width) break;
        offset -= width;
        track.removeChild(first);
        first = track.firstElementChild;
      }
      topUp();

      track.style.transform = "translate3d(" + -offset + "px, 0, 0)";
      frame = requestAnimationFrame(step);
    }

    function start() {
      if (running || paused) return;
      running = true;
      last = 0;
      frame = requestAnimationFrame(step);
    }

    function stop() {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }

    banner.addEventListener("mouseenter", function () {
      paused = true;
      stop();
    });
    banner.addEventListener("mouseleave", function () {
      paused = false;
      start();
    });

    // Off-screen the strip costs nothing: there is no point animating a
    // procession nobody is looking at, and it sits below the fold.
    if (typeof IntersectionObserver === "function") {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) start();
          else stop();
        });
      }).observe(banner);
    } else {
      start();
    }
  }

  setup();
  document.addEventListener("member:wall-rendered", setup);
})();
