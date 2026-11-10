// /api/visits.js — protected read endpoint. Returns the most recent visits as
// JSON for your own review. Requires the admin key via ?key=... or the
// x-admin-key header. Node serverless function.

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'bcs';

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = new MongoClient(uri, { maxPoolSize: 5 }).connect();
  }
  return clientPromise;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const key = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }
  if (!uri) {
    res.statusCode = 500;
    return res.end('MONGODB_URI not set');
  }
  const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
  try {
    const client = await getClient();
    const col = client.db(dbName).collection('visits');
    const rows = await col
      .find({}, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({ count: rows.length, visits: rows }, null, 2));
  } catch (err) {
    res.statusCode = 500;
    return res.end('query error');
  }
};
