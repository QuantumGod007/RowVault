import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createApp } from '../server/app.js';

const dir = mkdtempSync(join(tmpdir(), 'rowvault-test-'));
const path = join(dir, 'test.sqlite');
let db, server, base, showId;
before(async () => {
  const result = createApp(path); db = result.db;
  server = result.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
  showId = db.prepare('SELECT id FROM showtimes WHERE starts_at>? ORDER BY starts_at LIMIT 1').get(new Date().toISOString()).id;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); db?.close(); rmSync(dir, { recursive:true, force:true }); });
async function request(route, body, options = {}) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type':'application/json' }, ...(body === undefined ? {} : { body:JSON.stringify(body) }), ...options });
  return { status:response.status, body:await response.json(), headers:response.headers };
}
const valid = () => ({ showtimeId:showId, seatIds:['C4'], customerName:'  Demo Guest  ', customerEmail:'GUEST@example.com' });

test('GET catalog, movie, schedules, health, and authoritative seat prices', async () => {
  const movies = await request('/api/movies'); assert.equal(movies.status, 200); assert.equal(movies.body.data.length, 10);
  assert.equal(movies.body.data.filter(m => m.collection === 'classics').length, 5);
  assert.equal((await request('/api/movies/6')).body.data.title, 'Interstellar');
  const shows = await request('/api/movies/6/showtimes'); assert.ok(shows.body.data.length); assert.ok(shows.body.data.every(show => show.movie_id === 6 && new Date(show.starts_at) > new Date()));
  const seats = await request(`/api/showtimes/${showId}/seats`); assert.equal(seats.body.data.seats.length, 80);
  assert.equal(seats.body.data.seats.find(s => s.id === 'A1').price, 250); assert.equal(seats.body.data.seats.find(s => s.id === 'H10').price, 500);
  assert.equal((await request('/api/health')).body.data.database, true);
  assert.equal(movies.headers.get('cache-control'), 'no-store'); assert.equal(movies.headers.get('x-powered-by'), null);
});
test('invalid and unknown GET resources return 400 / 404', async () => {
  for (const route of ['/api/movies/nope','/api/movies/0','/api/showtimes/-1/seats','/api/movies/1e2']) assert.equal((await request(route)).status,400);
  for (const route of ['/api/movies/999','/api/movies/999/showtimes','/api/showtimes/9999999/seats','/api/unknown']) assert.equal((await request(route)).status,404);
});
test('all essential server validation cases reject without creating reservations', async t => {
  const cases = [
    ['missing name',{customerName:undefined}], ['blank name',{customerName:'   '}], ['long name',{customerName:'x'.repeat(101)}], ['name type',{customerName:42}], ['control character',{customerName:'hello\nworld'}],
    ['missing email',{customerEmail:undefined}], ['invalid email',{customerEmail:'bad@'}], ['email type',{customerEmail:[]}], ['email spaces',{customerEmail:'a b@demo.com'}],
    ['missing showtime',{showtimeId:undefined}], ['showtime type',{showtimeId:String(showId)}], ['negative showtime',{showtimeId:-1}],
    ['missing seats',{seatIds:undefined}], ['empty seats',{seatIds:[]}], ['too many seats',{seatIds:['A1','A2','A3','A4','A5','A6','A7']}], ['duplicate seats',{seatIds:['A1','A1']}],
    ['seat array type',{seatIds:'A1'}], ['seat item type',{seatIds:[1]}], ['bad seat format',{seatIds:['a1']}], ['unknown row',{seatIds:['Z1']}], ['unknown number',{seatIds:['A99']}],
    ['manipulated price',{price:1}], ['manipulated total',{total:1}], ['additional property',{admin:true}]
  ];
  const beforeCount = db.prepare('SELECT COUNT(*) n FROM reservations').get().n;
  for (const [label, patch] of cases) await t.test(label, async () => { const result = await request('/api/reservations',{...valid(),...patch}); assert.equal(result.status,422); assert.equal(result.body.success,false); assert.ok(result.body.message); });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservations').get().n,beforeCount);
});
test('unknown, expired, and mismatched auditorium seat requests are rejected', async () => {
  assert.equal((await request('/api/reservations',{...valid(),showtimeId:999999})).status,404);
  const result = db.prepare('INSERT INTO showtimes(movie_id,auditorium_id,starts_at) VALUES(1,1,?)').run('2000-01-01T00:00:00.000Z');
  const expired = await request('/api/reservations',{...valid(),showtimeId:Number(result.lastInsertRowid)}); assert.equal(expired.status,422); assert.equal(expired.body.error,'SHOWTIME_EXPIRED');
  db.prepare('INSERT INTO seats VALUES(2,?,?,?)').run('J1','Standard',250);
  const mismatch = await request('/api/reservations',{...valid(),seatIds:['J1']}); assert.equal(mismatch.status,422);
});
test('malformed JSON, body types, missing content-type and excessive size are handled', async () => {
  assert.equal((await request('/api/reservations',null,{body:'{ broken'})).status,400);
  for (const body of [null, [], 'test', 123]) assert.equal((await request('/api/reservations',body)).status,400);
  assert.equal((await request('/api/reservations',valid(),{headers:{'Content-Type':'text/plain'}})).status,400);
  assert.equal((await request('/api/reservations',{...valid(),customerName:'a'.repeat(10000)})).status,413);
});
let savedReference;
test('reservation saves normalized data, server total, ticket, and seat availability', async () => {
  const result = await request('/api/reservations',{...valid(),seatIds:['A1','C4','H1']});
  assert.equal(result.status,201); const ticket = result.body.data; savedReference = ticket.reference;
  assert.match(ticket.reference,/^RV-[A-F0-9]{24}$/); assert.equal(ticket.total,1100); assert.equal(ticket.status,'confirmed'); assert.equal(ticket.seats.length,3);
  assert.equal(ticket.customerEmail,undefined); assert.equal(ticket.customerName,undefined);
  const row = db.prepare('SELECT * FROM reservations WHERE reference=?').get(savedReference); assert.equal(row.customer_name,'Demo Guest'); assert.equal(row.customer_email,'guest@example.com');
  assert.equal((await request(`/api/reservations/${savedReference}`)).body.data.total,1100);
  const seats = (await request(`/api/showtimes/${showId}/seats`)).body.data.seats; assert.equal(seats.find(s => s.id === 'C4').booked,1);
  const shows = await request(`/api/movies/${ticket.movie.id}/showtimes`); assert.equal(shows.body.data.find(s => s.id === showId).available,77);
});
test('duplicate reservation returns 409 and multiseat requests roll back completely', async () => {
  const result = await request('/api/reservations',{...valid(),seatIds:['C4','C5']}); assert.equal(result.status,409); assert.deepEqual(result.body.unavailableSeats,['C4']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_seats WHERE showtime_id=? AND seat_id=?').get(showId,'C5').n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservations').get().n,1);
});
test('simultaneous HTTP attempts have exactly one winner', async () => {
  const results = await Promise.all(Array.from({length:8},()=>request('/api/reservations',{...valid(),seatIds:['D1']})));
  assert.equal(results.filter(r => r.status === 201).length,1); assert.equal(results.filter(r => r.status === 409).length,7);
});
test('independent SQLite connections serialize competing transactions', async () => {
  const shared = new SharedArrayBuffer(4), gate = new Int32Array(shared);
  const runWorker = () => new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./booking-worker.js',import.meta.url),{workerData:{path,showId,shared}});
    worker.on('message',message => { if (message === 'ready') { Atomics.add(gate,0,1); if (Atomics.load(gate,0) === 2) Atomics.notify(gate,0); } else resolve(message); }); worker.on('error',reject); worker.on('exit',code=>{if(code) reject(new Error(`worker exit ${code}`));});
  });
  const results = await Promise.all([runWorker(),runWorker()]); assert.deepEqual(results.sort(),[201,409]);
});
test('database unique constraint independently prevents a second claim', () => {
  const row = db.prepare('SELECT * FROM reservation_seats LIMIT 1').get();
  assert.throws(()=>db.prepare('INSERT INTO reservation_seats VALUES(?,?,?,?,?,?)').run(row.reservation_id,row.showtime_id,row.auditorium_id,row.seat_id,row.category,row.price),/UNIQUE constraint failed/);
});
test('reservation references validate and unknown references return 404', async () => {
  assert.equal((await request('/api/reservations/INVALID')).status,400);
  assert.equal((await request('/api/reservations/RV-000000000000000000000000')).status,404);
  assert.equal((await request(`/api/reservations/${savedReference.toLowerCase()}`)).status,200);
});
test('reservations persist after closing and reopening SQLite; reseeding preserves them', async () => {
  await new Promise(resolve=>server.close(resolve)); db.close();
  const reopened = createApp(path); db = reopened.db;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservations WHERE reference=?').get(savedReference).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reservation_seats WHERE showtime_id=? AND seat_id=?').get(showId,'C4').n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM movies').get().n,10);
});
test('all static film images, independent fallbacks, fonts and attribution are present', () => {
  const sources=JSON.parse(readFileSync(new URL('../public/assets/sources.json',import.meta.url)));
  assert.equal(sources.length,10);
  for (const source of sources) for (const suffix of ['', '-fallback']) { const bytes = readFileSync(new URL(`../public/assets/${source.film}${suffix}.jpg`,import.meta.url)); assert.ok(bytes.length>1000); assert.equal(bytes[0],0xff); assert.equal(bytes[1],0xd8); }
  for (const name of ['interstellar-backdrop.jpg','tmdb.svg','FONT-LICENSES.txt','dm-sans.css','instrument-serif.css']) assert.ok(existsSync(new URL(`../public/assets/${name}`,import.meta.url)),name);
});
