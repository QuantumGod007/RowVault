import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { createCloudStore } from '../server/cloud-store.js';
import { createApp } from '../server/app.js';

const dir = mkdtempSync(join(tmpdir(), 'rowvault-cloud-test-'));
const url = `file:${join(dir, 'cloud.sqlite')}`;
let store, second, server, base, showtimeId;
const payload = () => ({ showtimeId, seatIds:['C4'], customerName:'Hosted Demo', customerEmail:'demo@example.com' });
async function call(path, body) {
  const response = await fetch(base + path, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
  return {status:response.status,body:await response.json()};
}
before(async () => {
  store = await createCloudStore({client:createClient({url})});
  second = await createCloudStore({client:createClient({url})});
  const shows = await store.showtimes(6); showtimeId = shows[0].id;
  server = createApp(undefined, store).app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if(server) await new Promise(resolve=>server.close(resolve));store?.db.close();second?.db.close();rmSync(dir,{recursive:true,force:true}); });

test('hosted adapter serves the same catalog, upcoming schedules and seat pricing', async () => {
  assert.equal((await call('/api/health')).body.data.database,true);
  assert.equal((await call('/api/movies')).body.data.length,10);
  assert.equal((await call('/api/movies/6')).body.data.title,'Interstellar');
  const shows = await call('/api/movies/6/showtimes'); assert.ok(shows.body.data.every(show=>show.movie_id===6 && new Date(show.starts_at)>new Date()));
  const seats = (await call(`/api/showtimes/${showtimeId}/seats`)).body.data.seats;
  assert.equal(seats.length,80); assert.equal(seats.find(seat=>seat.id==='C4').price,350);
  assert.equal((await call('/api/movies/999')).status,404); assert.equal((await call('/api/showtimes/999999/seats')).status,404);
});
test('hosted adapter keeps validation, seat membership and expiry checks', async () => {
  for (const patch of [{customerName:' '},{customerEmail:'invalid'},{seatIds:[]},{seatIds:['A1','A1']},{seatIds:['Z1']},{seatIds:['A99']},{total:1},{showtimeId:'1'}]) {
    const result = await call('/api/reservations',{...payload(),...patch});assert.equal(result.status,422);
  }
  assert.equal((await call('/api/reservations',{...payload(),showtimeId:999999})).status,404);
  const expired = await store.db.execute({sql:'INSERT INTO showtimes(movie_id,auditorium_id,starts_at) VALUES(6,6,?)',args:['2000-01-01T00:00:00.000Z']});
  assert.equal((await call('/api/reservations',{...payload(),showtimeId:Number(expired.lastInsertRowid)})).body.error,'SHOWTIME_EXPIRED');
});
let reference;
test('hosted reservations return server totals and privacy-safe persisted tickets', async () => {
  const result = await call('/api/reservations',{...payload(),seatIds:['A1','C4','H1']});
  assert.equal(result.status,201);assert.equal(result.body.data.total,1100);reference=result.body.data.reference;
  assert.equal(result.body.data.customerEmail,undefined);assert.equal(result.body.data.customerName,undefined);
  assert.equal((await call(`/api/reservations/${reference}`)).body.data.seats.length,3);
  const conflict = await call('/api/reservations',{...payload(),seatIds:['C4','C5']});assert.equal(conflict.status,409);assert.deepEqual(conflict.body.unavailableSeats,['C4']);
  const seats = (await store.seats(showtimeId)).seats;assert.equal(seats.find(seat=>seat.id==='C5').booked,0);
  assert.equal((await store.showtimes(6)).find(show=>show.id===showtimeId).available,77);
});
test('two hosted clients racing for a seat produce one reservation and one conflict', async () => {
  const results = await Promise.allSettled([
    store.reserve({...payload(),seatIds:['D1','D2']}),second.reserve({...payload(),seatIds:['D1','D2']})
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const loser = results.find(result=>result.status==='rejected');assert.equal(loser.reason.status,409);
  assert.equal((await store.seats(showtimeId)).seats.find(seat=>seat.id==='D1').booked,1);
});
test('a fresh hosted adapter retains saved bookings through schema and catalog reseeding', async () => {
  const fresh = await createCloudStore({client:createClient({url})});
  try {const ticket=await fresh.reservation(reference);assert.equal(ticket.total,1100);assert.equal(ticket.seats.length,3);}
  finally {fresh.db.close();}
});
test('hosted database constraints independently reject a duplicate claim', async () => {
  const row = (await store.db.execute('SELECT * FROM reservation_seats LIMIT 1')).rows[0];
  await assert.rejects(()=>store.db.execute({sql:'INSERT INTO reservation_seats VALUES(?,?,?,?,?,?)',args:[row.reservation_id,row.showtime_id,row.auditorium_id,row.seat_id,row.category,row.price]}),/UNIQUE constraint failed/);
});
