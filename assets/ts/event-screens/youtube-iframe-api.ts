/**
 * YouTube's IFrame Player API, loaded once per page from YouTube. A load that
 * fails or never finishes rejects and is forgotten, so the next attempt adds
 * the script again. Only the parts a venue screen drives are typed.
 */

export const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";
/** Give up on a load that has not finished in this time; the caller retries. */
const LOAD_TIMEOUT_MS = 30_000;

/** The player's states, as the API numbers them. */
export const YOUTUBE_PLAYER_STATES = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

export interface YouTubePlayer {
  playVideo(): void;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  destroy(): void;
  /** Readings the screen reports; each may be missing or throw before the player is ready. */
  getPlayerState?(): number;
  getVideoLoadedFraction?(): number;
  getPlaybackQuality?(): string;
  getDuration?(): number;
  getCurrentTime?(): number;
  /** Not part of the documented API: `isLive` is read only when present. */
  getVideoData?(): { isLive?: unknown } | undefined;
}

export interface YouTubePlayerEvents {
  onReady?: (event: { target: YouTubePlayer }) => void;
  onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
  onError?: (event: { data: number; target: YouTubePlayer }) => void;
}

/** Attaches to an iframe that already loads an `/embed/` address with `enablejsapi=1`. */
export interface YouTubeIframeApi {
  Player: new (iframe: HTMLIFrameElement, options: { events: YouTubePlayerEvents }) => YouTubePlayer;
}

type YouTubeWindow = Window & {
  YT?: Partial<YouTubeIframeApi> & { loaded?: number };
  onYouTubeIframeAPIReady?: () => void;
};

let pending: Promise<YouTubeIframeApi> | null = null;

export function loadYouTubeIframeApi(win: Window = window): Promise<YouTubeIframeApi> {
  const page = win as YouTubeWindow;
  if (page.YT?.Player && page.YT.loaded) return Promise.resolve(page.YT as YouTubeIframeApi);
  pending ??= new Promise<YouTubeIframeApi>((resolve, reject) => {
    const script = win.document.createElement("script");
    const timeout = win.setTimeout(() => fail(new Error("The YouTube player did not load.")), LOAD_TIMEOUT_MS);
    function fail(error: Error) {
      win.clearTimeout(timeout);
      script.remove();
      pending = null;
      reject(error);
    }
    page.onYouTubeIframeAPIReady = () => {
      win.clearTimeout(timeout);
      if (page.YT?.Player) resolve(page.YT as YouTubeIframeApi);
      else fail(new Error("The YouTube player did not load."));
    };
    script.src = YOUTUBE_IFRAME_API_URL;
    script.async = true;
    script.addEventListener("error", () => fail(new Error("The YouTube player did not load.")));
    win.document.head.append(script);
  });
  return pending;
}
