import { createClient } from '@libsql/client';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';

const production = process.env.NODE_ENV === 'production';
const databaseUrl = process.env.TURSO_DATABASE_URL ?? (production ? '' : 'file:cookie-dev.db');
const authToken = process.env.TURSO_AUTH_TOKEN;
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? (production ? '' : 'http://localhost:3000');
const port = Number(process.env.PORT ?? 3000);

try {
  if (!databaseUrl || !publicBaseUrl) throw new Error('Set TURSO_DATABASE_URL and PUBLIC_BASE_URL (or use Render).');
  const publicUrl = new URL(publicBaseUrl);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error('PUBLIC_BASE_URL must be a plain HTTP(S) origin, without a path, query or credentials.');
  }
  if (production && (publicUrl.protocol !== 'https:' || !databaseUrl.startsWith('libsql://') || !authToken)) {
    throw new Error('Production requires an HTTPS public URL and a remote libsql:// database with TURSO_AUTH_TOKEN.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  if (process.env.CORS_ORIGIN && new URL(process.env.CORS_ORIGIN).origin !== process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be a plain origin without a trailing slash or path.');
  }

  const db = createClient({ url: databaseUrl, authToken });
  await db.executeMultiple(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  const app = createApp(db, { publicBaseUrl, corsOrigin: process.env.CORS_ORIGIN });
  const server = app.listen(port, '0.0.0.0', () => console.log(`Cookie service listening on port ${port}.`));
  const shutdown = () => {
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  // Configuration messages are safe; driver exceptions may contain credentials.
  console.error('Cookie service could not start. Check database access and environment variables.');
  if (error instanceof Error && !error.name.includes('Libsql') && !error.message.includes('://')) {
    console.error(error.message);
  }
  process.exit(1);
}
