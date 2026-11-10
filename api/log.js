// /api/log.js — receives a visit record from the edge middleware and writes it
// to MongoDB. POST only, authenticated with a shared secret (LOG_SECRET) so the
// endpoint can't be written to from outside. Node serverless function.

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'bcs';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 90);

// Reuse the connection across warm invocations instead of reconnecting each time.
let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = new MongoClient(uri, { maxPoolSize: 5 }).connect();
  }
  return clientPromise;
}

let indexEnsured = false;
async function ensureIndexes(col) {
  if (indexEnsured) return;
  // TTL index: visits auto-delete RETENTION_DAYS after `ts` (data-retention limit).
  await col.createIndex({ ts: 1 }, { expireAfterSeconds: RETENTION_DAYS * 86400 });
  await col.createIndex({ ip: 1 });
  indexEnsured = true;
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method Not Allowed');
  }
  if (!process.env.LOG_SECRET || req.headers['x-log-secret'] !== process.env.LOG_SECRET) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }
  if (!uri) {
    res.statusCode = 500;
    return res.end('MONGODB_URI not set');
  }
  try {
    let body = req.body;
    if (!body || typeof body === 'string') {
      const raw = typeof body === 'string' ? body : await readRaw(req);
      body = raw ? JSON.parse(raw) : {};
    }
    const doc = {
      ip: body.ip || null,
      path: body.path || null,
      ua: body.ua || null,
      ref: body.ref || null,
      country: body.country || null,
      region: body.region || null,
      city: body.city || null,
      lat: body.lat != null ? Number(body.lat) : null,
      lon: body.lon != null ? Number(body.lon) : null,
      ts: body.ts ? new Date(body.ts) : new Date(),
    };
    const client = await getClient();
    const col = client.db(dbName).collection('visits');
    await ensureIndexes(col);
    await col.insertOne(doc);
    res.statusCode = 204;
    return res.end();
  } catch (err) {
    res.statusCode = 500;
    return res.end('log error');
  }
};
