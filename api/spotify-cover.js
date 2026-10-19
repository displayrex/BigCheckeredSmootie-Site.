// /api/spotify-cover.js
// Returns real, high-res album cover art for a Spotify track ID.
// Uses the Client Credentials flow (no user login needed) so the
// Client ID/Secret stay server-side and are never exposed to the browser.

const { getAccessToken } = require('./_spotify');

module.exports = async (req, res) => {
  const trackId = String(req.query.trackId || '');

  // Spotify track IDs are 22 base-62 characters. Rejecting anything else stops
  // callers from steering the request to other Spotify API paths.
  if (!/^[A-Za-z0-9]{22}$/.test(trackId)) {
    res.status(400).json({ error: 'Invalid trackId' });
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const accessToken = await getAccessToken();

    const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!trackRes.ok) {
      console.error('Spotify track request failed', trackRes.status, await trackRes.text());
      res.status(trackRes.status === 404 ? 404 : 502).json({ error: 'Cover art is unavailable right now' });
      return;
    }

    const trackData = await trackRes.json();
    const images = (trackData.album && trackData.album.images) || [];

    if (!images.length) {
      res.status(404).json({ error: 'No cover art found for this track' });
      return;
    }

    // Spotify returns images largest-first (typically 640, 300, 64)
    const largest = images[0];

    // cache for a day at the edge — album art essentially never changes
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
    res.status(200).json({ url: largest.url, width: largest.width, height: largest.height });
  } catch (err) {
    console.error('spotify-cover error', err);
    res.status(500).json({ error: 'Cover art is unavailable right now' });
  }
};
