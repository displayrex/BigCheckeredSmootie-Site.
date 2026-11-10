// middleware.js — Edge Middleware for bigcheckeredsmoothie.com
//
// Runs on page navigations (not assets or /api) and records each visit:
// IP, geo (country/region/city/lat/lon), path, user-agent, referer, timestamp.
// It fire-and-forgets the record to /api/log (which writes it to MongoDB) via
// waitUntil, so logging never adds latency and never breaks the page.

import { next, ipAddress, geolocation, waitUntil } from '@vercel/functions';

export const config = {
  // Match everything EXCEPT /api/*, /assets/*, and any path with a dot
  // (static files: .png/.js/.css/...). For this site that's effectively "/".
  matcher: ['/((?!api/|assets/|.*\\.).*)'],
};

export default function middleware(request) {
  try {
    const accept = request.headers.get('accept') || '';
    // Only count real page loads (HTML document requests).
    if (request.method === 'GET' && accept.includes('text/html')) {
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
        lat: geo.latitude || null,
        lon: geo.longitude || null,
        ts: new Date().toISOString(),
      };

      const logUrl = new URL('/api/log', request.url);
      waitUntil(
        fetch(logUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-log-secret': process.env.LOG_SECRET || '',
          },
          body: JSON.stringify(record),
          // keepalive helps the request survive the edge invocation ending
          keepalive: true,
        }).catch(() => {}) // observability must never take the site down
      );
    }
  } catch (_) {
    // Swallow everything.
  }
  return next();
}
