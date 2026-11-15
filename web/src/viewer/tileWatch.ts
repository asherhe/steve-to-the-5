/**
 * Watches the all-sky cube's tile requests and fetches tiles ahead of time.
 *
 * Aladin loads tiles inside its WebAssembly core and gives no "loaded" signal, but it asks
 * for them through `fetch`. Counting those requests shows when the map is still loading, and
 * the tiles it asked for at one wavelength tell us which tiles the same view needs at the
 * next. Fetching those early fills the browser's cache, so switching wavelengths draws at
 * once instead of showing blank tiles while they download.
 */
export interface TileWatch {
  /** Tile requests in flight right now. */
  loading(): number;
  /** Resolves true when every tile of this wavelength for the current view is in the cache. */
  prefetch(slice: number): Promise<boolean>;
  /** Names the tiles the current view uses; it changes when the map is panned or zoomed. */
  viewSignature(): string;
  /** Restores `fetch`. */
  stop(): void;
}

const tilePath = /(Norder\d+\/Dir\d+\/Npix\d+)_(\d+)\.png$/;

export function watchTiles(isTileUrl: (url: string) => boolean, baseUrl: string): TileWatch {
  const original = window.fetch;
  let inflight = 0;
  let slice = -1;
  let seen = new Set<string>();
  // Prefetches already started, per view; a pan or zoom changes the tiles and starts over.
  let started = new Map<number, Promise<boolean>>();
  let startedFor = "";

  const counted: typeof fetch = function (this: unknown, input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request = original.call(this, input, init);
    if (isTileUrl(url)) {
      inflight += 1;
      const done = () => { inflight = Math.max(0, inflight - 1); };
      request.then(done, done);
      const match = tilePath.exec(url);
      if (match) {
        if (Number(match[2]) !== slice) {
          slice = Number(match[2]);
          seen = new Set();
        }
        seen.add(match[1]);
      }
    }
    return request;
  };
  window.fetch = counted;

  return {
    loading: () => inflight,
    viewSignature: () => [...seen].sort().join(","),
    prefetch(target) {
      const tiles = [...seen].sort();
      if (!tiles.length) return Promise.resolve(false);
      const view = tiles.join(",");
      if (view !== startedFor) {
        started = new Map();
        startedFor = view;
      }
      let pending = started.get(target);
      if (!pending) {
        // Through the original fetch, so these do not count as the map loading.
        pending = Promise.all(tiles.map((tile) =>
          original.call(window, `${baseUrl}/${tile}_${target}.png`)
            .then(async (response) => { await response.arrayBuffer(); return response.ok; })
            .catch(() => false))).then((results) => results.every(Boolean));
        started.set(target, pending);
        // A failed wavelength is tried again next time rather than remembered as failed.
        void pending.then((ok) => { if (!ok && started.get(target) === pending) started.delete(target); });
      }
      return pending;
    },
    stop() {
      if (window.fetch === counted) window.fetch = original;
    },
  };
}
