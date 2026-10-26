import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../server/database.js';
import { createReservation } from '../server/reservations.js';
const { db } = openDatabase(workerData.path);
const gate = new Int32Array(workerData.shared);
parentPort.postMessage('ready');
while (Atomics.load(gate,0) < 2) Atomics.wait(gate,0,1,5000);
try { createReservation(db,{showtimeId:workerData.showId,seatIds:['E1'],customerName:'Concurrent Guest',customerEmail:'guest@example.com'}); parentPort.postMessage(201); }
catch(error) { parentPort.postMessage(error.status || 500); }
finally { db.close(); }
