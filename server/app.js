import express from 'express';
import { fileURLToPath } from 'node:url';
import { createLocalStore } from './local-store.js';
import { AppError, resourceId } from './validation.js';

export function createApp(databasePath, providedStore) {
  const store = providedStore || createLocalStore(databasePath);
  const { db } = store;
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    next();
  });
  app.use(express.json({ limit: '8kb', strict: false }));
  app.use('/api', async (req, res, next) => { res.set('Cache-Control', 'no-store'); await store.ensureSchedule(); next(); });
  const ok = (res, data) => res.json({ success:true, data });
  app.get('/api/health', async (req, res) => ok(res, { status:'ok', database:await store.health() }));
  app.get('/api/movies', async (req, res) => ok(res, await store.movies()));
  app.get('/api/movies/:id', async (req, res) => ok(res, await store.movie(resourceId(req.params.id))));
  app.get('/api/movies/:id/showtimes', async (req, res) => ok(res, await store.showtimes(resourceId(req.params.id))));
  app.get('/api/showtimes/:id/seats', async (req, res) => ok(res, await store.seats(resourceId(req.params.id))));
  app.post('/api/reservations', async (req, res) => {
    if (!req.is('application/json')) throw new AppError(400, 'INVALID_BODY', 'Send reservation details as application/json.');
    res.status(201).json({ success:true, data:await store.reserve(req.body) });
  });
  app.get('/api/reservations/:reference', async (req, res) => {
    const reference = req.params.reference.toUpperCase();
    if (!/^RV-[A-F0-9]{24}$/.test(reference)) throw new AppError(400, 'INVALID_REFERENCE', 'Enter a valid reservation reference: RV- followed by 24 characters.');
    ok(res, await store.reservation(reference));
  });
  app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'This API endpoint could not be found.' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
  app.use((req, res) => res.status(404).send('Page not found. Return to RowVault at /.'));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'BODY_TOO_LARGE', message: 'Request too large. Send fewer than 8 KB.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'MALFORMED_JSON', message: 'The request contains malformed JSON.' });
    if (error instanceof AppError) return res.status(error.status).json({ success: false, error: error.code, message: error.message, ...error.details });
    console.error('Request failed:', error);
    res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' });
  });
  return { app, db };
}
