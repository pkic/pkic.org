/*
 * Shared helpers for the two logo walls: the strip above the footer and the
 * grid on the members page.
 */
import { spreadSponsors } from "../../shared/logo-wall-order";

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
  logoSpreadSponsors: spreadSponsors,
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
 * What it draws is every member in grey, in a fresh order each pass, with the
 * sponsors shown in color at even intervals among them.
 */
(function () {
  var SPEED = 42; // px per second

  /**
   * The endless order of tiles.
   *
   * Each pass shows every member once, in a fresh shuffle, with the sponsors
   * (highest level first) spread among them so no two sponsors sit together.
   * The spreading keeps its spacing across the seam between two passes, so
   * the procession never bunches sponsors where one pass hands over to the
   * next.
   */
  function createStream(members, levels) {
    var queue = [];

    function drawPass() {
      var sponsors = [];
      levels.forEach(function (level) {
        logoShuffle(level.items).forEach(function (el) {
          sponsors.push(el);
        });
      });
      spreadSponsors(logoShuffle(members), sponsors).forEach(function (el) {
        queue.push({ kind: "logo", el: el });
      });
    }

    return function next() {
      if (!queue.length) drawPass();
      return queue.length ? queue.shift() : null; // Nothing to show at all.
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
