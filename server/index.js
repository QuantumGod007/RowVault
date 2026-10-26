import { createApp } from './app.js';
const { app, db } = createApp();
const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, '0.0.0.0', () => console.log(`RowVault is ready at http://localhost:${port}`));
server.on('error', error => { console.error(`Unable to start RowVault: ${error.message}`); db.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
