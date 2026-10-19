// /api/_spotify.js
// Shared Spotify Client Credentials helper (the leading underscore keeps
// Vercel from deploying this file as its own endpoint).

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

// GET a Spotify Web API URL (absolute, or a path under /v1)
async function spotifyGet(url) {
  const accessToken = await getAccessToken();
  const full = url.startsWith('https://') ? url : `https://api.spotify.com/v1${url}`;
  const res = await fetch(full, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const err = new Error(`Spotify request failed: ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

module.exports = { getAccessToken, spotifyGet };
