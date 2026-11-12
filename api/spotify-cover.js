// /api/spotify-cover.js
// Returns album cover art for a Spotify track ID.
// Tries Spotify's public oEmbed endpoint first (the one behind link previews):
// it needs no credentials and doesn't count against the Web API quota, so
// cover art keeps working while the API is rate-limiting the app. Falls back
// to the Web API (Client Credentials, secrets stay server-side) if it fails.

const { spotifyGet } = require('./_spotify');

async function coverFromOembed(trackId) {
  const trackUrl = `https://open.spotify.com/track/${trackId}`;
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`);
  if (!res.ok) throw new Error(`Spotify oEmbed request failed: ${res.status}`);
  const data = await res.json();
  if (!data.thumbnail_url) throw new Error('Spotify oEmbed returned no thumbnail');
  // oEmbed hands back the 300px cover; Spotify's image IDs encode the size,
  // so swap in the 640px variant's prefix when it's the familiar one
  return data.thumbnail_url.replace('ab67616d00001e02', 'ab67616d0000b273');
}

async function coverFromApi(trackId) {
  const track = await spotifyGet(`/tracks/${trackId}`);
  const images = (track.album && track.album.images) || [];
  // Spotify returns images largest-first (typically 640, 300, 64)
  return images.length ? images[0].url : null;
}

module.exports = async (req, res) => {
  const trackId = String(req.query.trackId || '');

  // Spotify track IDs are 22 base-62 characters. Rejecting anything else stops
  // callers from steering the request to other Spotify paths.
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) {
    res.status(400).json({ error: 'Invalid trackId' });
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let url = null;
  try {
    url = await coverFromOembed(trackId);
  } catch (err) {
    console.error('spotify-cover oEmbed error', err.message);
    try {
      url = await coverFromApi(trackId);
    } catch (apiErr) {
      console.error('spotify-cover API error', apiErr.message);
    }
  }

  if (!url) {
    // cache the miss briefly so a burst of page loads doesn't hammer Spotify
    res.setHeader('Cache-Control', 's-maxage=300');
    res.status(502).json({ error: 'Cover art is unavailable right now' });
    return;
  }

  // cache for a day at the edge — album art essentially never changes
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  res.status(200).json({ url });
};
