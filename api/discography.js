// /api/discography.js
// Returns every track on LELo the Tsar's Spotify albums, EPs and singles,
// with cover art, so the site can fill its music slots from the whole catalog.
// The browser shuffles the list on each page load; this endpoint only
// collects it, and the edge cache keeps Spotify calls to a few per day.

const { spotifyGet } = require('./_spotify');

const ARTIST_ID = '3pihy4nJpAAhTgQJbn7awN';

// "album" covers albums and EPs (Spotify files EPs under album or single
// depending on length); "single" covers singles. Features on other
// artists' releases ("appears_on") are left out.
const INCLUDE_GROUPS = 'album,single';
const TYPE_RANK = { album: 0, compilation: 1, single: 2 };

let lastGood = null;

// follow Spotify's `next` links until a paged list is exhausted
async function allPages(firstUrl) {
  const items = [];
  let url = firstUrl;
  while (url) {
    const page = await spotifyGet(url);
    items.push(...(page.items || []));
    url = page.next;
  }
  return items;
}

// the same song often ships as a single and again on an album; key on the
// title minus any "(feat. ...)" so it only shows up once (remixes stay separate)
const songKey = name => name.toLowerCase().replace(/\s*[([](feat|ft|with)\b.*?[)\]]/g, '').trim();

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const releases = await allPages(`/artists/${ARTIST_ID}/albums?include_groups=${INCLUDE_GROUPS}&limit=10`);

    // one release at a time: a parallel burst is what trips Spotify's rate limit
    const albums = [];
    for (const r of releases) {
      const album = await spotifyGet(`/albums/${r.id}`);
      const tracks = [...(album.tracks.items || [])];
      if (album.tracks.next) tracks.push(...await allPages(album.tracks.next));
      albums.push({ album, tracks });
    }

    const byKey = new Map();
    for (const { album, tracks } of albums) {
      const images = album.images || [];
      for (const t of tracks) {
        if (!t.id || !(t.artists || []).some(a => a.id === ARTIST_ID)) continue;
        const track = {
          id: t.id,
          name: t.name,
          feat: t.artists.filter(a => a.id !== ARTIST_ID).map(a => a.name),
          album: album.name,
          albumId: album.id,
          type: album.album_type,
          year: (album.release_date || '').slice(0, 4),
          trackNumber: t.track_number,
          durationMs: t.duration_ms,
          art: images[0] ? images[0].url : null,
          // images come largest-first (640, 300, 64); tiles only need ~300px
          artSmall: (images[1] || images[0] || {}).url || null,
        };
        const key = songKey(t.name);
        const prev = byKey.get(key);
        // keep the album version of a song over its single
        if (!prev || (TYPE_RANK[track.type] ?? 3) < (TYPE_RANK[prev.type] ?? 3)) byKey.set(key, track);
      }
    }

    const tracks = [...byKey.values()];
    if (!tracks.length) throw new Error('Spotify returned no tracks');

    lastGood = { releases: albums.length, tracks };
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=604800');
    res.status(200).json(lastGood);
  } catch (err) {
    console.error('discography error', err);
    // a warm instance can still serve the last catalog it built
    if (lastGood) {
      res.setHeader('Cache-Control', 's-maxage=900');
      res.status(200).json(lastGood);
      return;
    }
    // cache the failure briefly so every page load doesn't re-hit a rate-limited API
    res.setHeader('Cache-Control', 's-maxage=900');
    res.status(502).json({ error: 'Discography is unavailable right now' });
  }
};
