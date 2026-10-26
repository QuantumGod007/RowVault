// Vercel Express entry point. Local development continues to use server/index.js.
import express from 'express';
import { createApp } from './server/app.js';
import { createCloudStore } from './server/cloud-store.js';

const app = express();
let application;
app.use(async (req, res, next) => {
  // One persistent database connection pool per warm function instance.
  application ||= createCloudStore().then(store => createApp(undefined, store).app).catch(error => { application = undefined; throw error; });
  try { (await application)(req, res, next); }
  catch (error) {
    console.error('RowVault database initialization failed:', error.message);
    res.status(503).json({ success:false, error:'DATABASE_UNAVAILABLE', message:'Reservations are temporarily unavailable. Please try again shortly.' });
  }
});
export default app;
