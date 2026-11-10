// middleware.js — Edge Middleware for bigcheckeredsmoothie.com
//
// Records each page visit (IP, geo, path, user-agent, referer) straight into
// Supabase over HTTPS. Fire-and-forget via waitUntil, so it never adds latency
// and never breaks the page. Inserts use the publishable key against an
// insert-only RLS policy on public.visits (the key can write, not read).

import { next, ipAddress, geolocation, waitUntil } from '@vercel/functions';

export const config = {
  // Match page navigations only — skip /api/*, /assets/*, and any path with a
  // dot (static files). For this site that's effectively just "/".
  matcher: ['/((?!api/|assets/|.*\\.).*)'],
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

export default function middleware(request) {
  try {
    const accept = request.headers.get('accept') || '';
    const ok = request.method === 'GET' && accept.includes('text/html');
    if (ok && SUPABASE_URL && SUPABASE_KEY) {
      const geo = geolocation(request);
      let city = geo.city || null;
      try { city = city ? decodeURIComponent(city) : null; } catch (_) {}

      const record = {
        ip: ipAddress(request) || null,
        path: new URL(request.url).pathname,
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
            // Lightweight logging so the first live visits are verifiable in
            // Vercel runtime logs. Ask me to silence the success line later.
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
