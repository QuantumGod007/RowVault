import { createClient } from '@libsql/client/web';
import { randomBytes } from 'node:crypto';
import { catalog } from './catalog.js';
import { schema } from './schema.js';
import { AppError, validateReservation } from './validation.js';

const indiaDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
const prices = { Standard:250, Prime:350, Recliner:500 };
const statement = (sql, args = []) => ({ sql, args });
const rows = async (connection, sql, args = []) => (await connection.execute(statement(sql, args))).rows;
const one = async (connection, sql, args = []) => (await rows(connection, sql, args))[0];

export async function createCloudStore({ url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN, client } = {}) {
  if (!client && (!url || !authToken)) throw new Error('Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before deploying RowVault.');
  const db = client || createClient({ url, authToken });
  if (db.protocol === 'file') await db.executeMultiple('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  await db.executeMultiple(schema);
  // Bulk seeds run atomically and never replace a reservation or claimed seat.
  const seeds = [];
  for (const film of catalog) {
    seeds.push(statement('INSERT INTO movies VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', [film.id, JSON.stringify(film)]));
    seeds.push(statement('INSERT OR IGNORE INTO auditoriums VALUES (?,?)', [film.id, `The Vault · Screen ${String(film.id).padStart(2, '0')}`]));
    const values = [];
    for (const row of 'ABCDEFGH') for (let n = 1; n <= 10; n++) {
      const category = row <= 'B' ? 'Standard' : row <= 'F' ? 'Prime' : 'Recliner';
      values.push(film.id, `${row}${n}`, category, prices[category]);
    }
    seeds.push(statement(`INSERT OR IGNORE INTO seats VALUES ${Array.from({ length:80 }, () => '(?,?,?,?)').join(',')}`, values));
  }
  await db.batch(seeds, 'write');
  let seededDay, seeding;
  async function ensureSchedule() {
    const today = indiaDate();
    if (seededDay === today) return;
    if (seeding) { await seeding; if (seededDay === today) return; }
    seeding = (async () => {
      const base = new Date(`${today}T00:00:00+05:30`), shows = [];
      for (let day = 0; day < 5; day++) {
        const date = indiaDate(new Date(base.getTime() + day * 86400000));
        for (const film of catalog) for (const hour of ['11:00', '15:00', '19:00']) {
          shows.push(statement('INSERT OR IGNORE INTO showtimes(movie_id,auditorium_id,starts_at) VALUES (?,?,?)', [film.id, film.id, new Date(`${date}T${hour}:00+05:30`).toISOString()]));
        }
      }
      await db.batch(shows, 'write'); seededDay = today;
    })();
    try { await seeding; } finally { seeding = undefined; }
  }
  async function getMovie(id) {
    const film = await one(db, 'SELECT data FROM movies WHERE id=?', [id]);
    if (!film) throw new AppError(404, 'NOT_FOUND', 'This film could not be found.');
    return JSON.parse(film.data);
  }
  async function getShowtime(connection, id) {
    const show = await one(connection, 'SELECT s.*, a.name auditorium FROM showtimes s JOIN auditoriums a ON a.id=s.auditorium_id WHERE s.id=?', [id]);
    if (!show) throw new AppError(404, 'NOT_FOUND', 'This showtime could not be found.');
    return show;
  }
  async function getReservation(reference) {
    const reservation = await one(db, 'SELECT reference,showtime_id,total,created_at FROM reservations WHERE reference=?', [reference]);
    if (!reservation) throw new AppError(404, 'NOT_FOUND', 'No reservation found. Check your reference and try again.');
    const showtime = await getShowtime(db, reservation.showtime_id);
    const [movie, seats] = await Promise.all([
      getMovie(showtime.movie_id),
      rows(db, 'SELECT seat_id id,category,price FROM reservation_seats WHERE reservation_id=(SELECT id FROM reservations WHERE reference=?) ORDER BY seat_id', [reference])
    ]);
    return { reference, status:'confirmed', movie, showtime, seats, total:reservation.total, createdAt:reservation.created_at };
  }
  async function reserve(body) {
    const input = validateReservation(body);
    for (let attempt = 0; ; attempt++) {
      let transaction;
      try {
        transaction = await db.transaction('write');
        const show = await getShowtime(transaction, input.showtimeId);
        if (new Date(show.starts_at).getTime() <= Date.now()) throw new AppError(422, 'SHOWTIME_EXPIRED', 'Your selected showtime is no longer available.');
        const placeholders = input.seatIds.map(() => '?').join(',');
        const seats = await rows(transaction, `SELECT * FROM seats WHERE auditorium_id=? AND id IN (${placeholders})`, [show.auditorium_id, ...input.seatIds]);
        if (seats.length !== input.seatIds.length) throw new AppError(422, 'VALIDATION_ERROR', 'A selected seat does not belong to this auditorium.', { fields:{ seatIds:'Choose seats shown in this auditorium.' } });
        const unavailableSeats = (await rows(transaction, `SELECT seat_id FROM reservation_seats WHERE showtime_id=? AND seat_id IN (${placeholders})`, [show.id, ...input.seatIds])).map(seat => seat.seat_id);
        if (unavailableSeats.length) throw new AppError(409, 'SEAT_CONFLICT', `Seat${unavailableSeats.length > 1 ? 's' : ''} ${unavailableSeats.join(', ')} ${unavailableSeats.length > 1 ? 'have' : 'has'} already been reserved. Choose another seat.`, { unavailableSeats });
        const reference = `RV-${randomBytes(12).toString('hex').toUpperCase()}`;
        const total = seats.reduce((sum, seat) => sum + seat.price, 0);
        const result = await transaction.execute(statement('INSERT INTO reservations(reference,showtime_id,customer_name,customer_email,total,created_at) VALUES (?,?,?,?,?,?)', [reference, show.id, input.customerName, input.customerEmail, total, new Date().toISOString()]));
        await transaction.batch(seats.map(seat => statement('INSERT INTO reservation_seats VALUES (?,?,?,?,?,?)', [result.lastInsertRowid, show.id, show.auditorium_id, seat.id, seat.category, seat.price])));
        await transaction.commit();
        return getReservation(reference);
      } catch (error) {
        if (transaction && !transaction.closed) await transaction.rollback();
        if (attempt < 4 && /SQLITE_BUSY|database is locked/.test(`${error.code} ${error.message}`)) {
          await new Promise(resolve => setTimeout(resolve, 40 * 2 ** attempt)); continue;
        }
        throw error;
      } finally { transaction?.close(); }
    }
  }
  await ensureSchedule();
  return {
    db, ensureSchedule,
    health: async () => (await one(db, 'SELECT 1 healthy')).healthy === 1,
    movies: async () => (await rows(db, 'SELECT data FROM movies ORDER BY id')).map(row => JSON.parse(row.data)),
    movie: getMovie,
    async showtimes(id) {
      await getMovie(id);
      return rows(db, `SELECT s.id,s.movie_id,s.starts_at,a.name auditorium,
        (SELECT COUNT(*) FROM seats WHERE auditorium_id=s.auditorium_id) - (SELECT COUNT(*) FROM reservation_seats WHERE showtime_id=s.id) available
        FROM showtimes s JOIN auditoriums a ON a.id=s.auditorium_id WHERE movie_id=? AND starts_at>? ORDER BY starts_at`, [id, new Date().toISOString()]);
    },
    async seats(id) {
      const show = await getShowtime(db, id);
      return { showtime:show, expired:new Date(show.starts_at).getTime() <= Date.now(), seats:await rows(db, `SELECT s.id,s.category,s.price, EXISTS(SELECT 1 FROM reservation_seats r WHERE r.showtime_id=? AND r.seat_id=s.id) booked FROM seats s WHERE auditorium_id=? ORDER BY substr(s.id,1,1), CAST(substr(s.id,2) AS INTEGER)`, [show.id, show.auditorium_id]) };
    },
    reserve, reservation:getReservation
  };
}
