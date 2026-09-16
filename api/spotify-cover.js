// /api/spotify-cover.js
// Returns real, high-res album cover art for a Spotify track ID.
// Uses the Client Credentials flow (no user login needed) so the
// Client ID/Secret stay server-side and are never exposed to the browser.

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET env vars');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Spotify token request failed: ${tokenRes.status} ${text}`);
  }

  const tokenData = await tokenRes.json();
  cachedToken = tokenData.access_token;
  // refresh a little early to be safe
  cachedTokenExpiry = now + (tokenData.expires_in - 60) * 1000;
  return cachedToken;
}

module.exports = async (req, res) => {
  const trackId = req.query.trackId;

  if (!trackId) {
    res.status(400).json({ error: 'Missing trackId query param' });
    return;
  }

  try {
    const accessToken = await getAccessToken();

    const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!trackRes.ok) {
      const text = await trackRes.text();
      res.status(trackRes.status).json({ error: `Spotify track request failed: ${text}` });
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
    res.status(500).json({ error: err.message });
  }
};
