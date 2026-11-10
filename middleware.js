// middleware.js — Edge Middleware for bigcheckeredsmoothie.com
//
// Records each page visit (IP, geo, path, user-agent, referer) straight into
// Supabase over HTTPS. Fire-and-forget via waitUntil, so it never adds latency
// and never breaks the page. Inserts use the publishable key against an
// insert-only RLS policy on public.visits (the key can write, not read).
//
// Self-exclusion: visit /?__mute=<MUTE_TOKEN> once to drop a "don't log me"
// cookie on this browser (survives dynamic IP changes, stores nothing about
// you); /?__mute=off to resume. Muted visits are never recorded.

import { next, ipAddress, geolocation, waitUntil } from '@vercel/functions';

export const config = {
  // Match page navigations only — skip /api/*, /assets/*, and any path with a
  // dot (static files). For this site that's effectively just "/".
  matcher: ['/((?!api/|assets/|.*\\.).*)'],
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const MUTE_TOKEN = process.env.MUTE_TOKEN;
const COOKIE = 'bcs_nolog';

// Zero the host portion of an IP before storing it (privacy measure):
// IPv4 -> last octet set to 0 (keeps the /24 network, drops the specific host);
// IPv6 -> keep the first three groups (/48), drop the rest.
function anonymizeIp(ip) {
  if (!ip) return null;
  if (ip.includes('.')) {
    const p = ip.split('.');
    if (p.length === 4) { p[3] = '0'; return p.join('.'); }
    return ip;
  }
  if (ip.includes(':')) {
    const kept = ip.split(':').slice(0, 3).filter(Boolean);
    while (kept.length < 3) kept.push('0');
    return kept.join(':') + '::';
  }
  return ip;
}

export default function middleware(request) {
  const url = new URL(request.url);

  // --- Self-exclusion toggle ---------------------------------------------
  const mute = url.searchParams.get('__mute');
  if (mute !== null) {
    if (MUTE_TOKEN && mute === MUTE_TOKEN) {
      return next({
        headers: {
          'set-cookie': `${COOKIE}=1; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    if (mute === 'off') {
      return next({
        headers: {
          'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
  }
  const cookie = request.headers.get('cookie') || '';
  const muted = new RegExp(`(?:^|;\\s*)${COOKIE}=1(?:;|$)`).test(cookie);

  // --- Visit logging ------------------------------------------------------
  try {
    const accept = request.headers.get('accept') || '';
    const loggable = request.method === 'GET' && accept.includes('text/html');
    if (loggable && !muted && SUPABASE_URL && SUPABASE_KEY) {
      const geo = geolocation(request);
      let city = geo.city || null;
      try { city = city ? decodeURIComponent(city) : null; } catch (_) {}

      const record = {
        ip: anonymizeIp(ipAddress(request)),
        path: url.pathname,
        ua: request.headers.get('user-agent') || null,
        ref: request.headers.get('referer') || null,
        country: geo.country || null,
        region: geo.countryRegion || null, // ISO subdivision, not Vercel edge region
        city,
        lat: geo.latitude ? Number(geo.latitude) : null,
        lon: geo.longitude ? Number(geo.longitude) : null,
      };

      waitUntil(
        fetch(`${SUPABASE_URL}/rest/v1/visits`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            authorization: `Bearer ${SUPABASE_KEY}`,
            'content-type': 'application/json',
            prefer: 'return=minimal',
          },
          body: JSON.stringify(record),
          keepalive: true,
        })
          .then((r) => {
            if (r.ok) console.log('visit-log ok', record.country || '?', record.path);
            else console.error('visit-log insert failed', r.status);
          })
          .catch((e) => console.error('visit-log error', String(e)))
      );
    }
  } catch (_) {
    // Observability must never take the site down.
  }
  return next();
}
