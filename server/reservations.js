import { randomBytes } from 'node:crypto';
import { AppError, validateReservation } from './validation.js';

export function getShowtime(db, id) {
  const showtime = db.prepare('SELECT s.*, a.name auditorium FROM showtimes s JOIN auditoriums a ON a.id=s.auditorium_id WHERE s.id=?').get(id);
  if (!showtime) throw new AppError(404, 'NOT_FOUND', 'This showtime could not be found.');
  return showtime;
}
export function getReservation(db, reference) {
  const row = db.prepare('SELECT reference, showtime_id, total, created_at FROM reservations WHERE reference=?').get(reference);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'No reservation found. Check your reference and try again.');
  const show = getShowtime(db, row.showtime_id);
  const movie = JSON.parse(db.prepare('SELECT data FROM movies WHERE id=?').get(show.movie_id).data);
  const seats = db.prepare('SELECT seat_id id, category, price FROM reservation_seats WHERE reservation_id=(SELECT id FROM reservations WHERE reference=?) ORDER BY seat_id').all(reference);
  return { reference: row.reference, status: 'confirmed', movie, showtime: show, seats, total: row.total, createdAt: row.created_at };
}
export function createReservation(db, body) {
  const input = validateReservation(body);
  db.exec('BEGIN IMMEDIATE');
  try {
    const show = getShowtime(db, input.showtimeId);
    if (new Date(show.starts_at).getTime() <= Date.now()) throw new AppError(422, 'SHOWTIME_EXPIRED', 'Your selected showtime is no longer available.');
    const seats = input.seatIds.map(id => db.prepare('SELECT * FROM seats WHERE auditorium_id=? AND id=?').get(show.auditorium_id, id));
    if (seats.some(seat => !seat)) throw new AppError(422, 'VALIDATION_ERROR', 'A selected seat does not belong to this auditorium.', { fields: { seatIds: 'Choose seats shown in this auditorium.' } });
    const unavailableSeats = input.seatIds.filter(id => db.prepare('SELECT 1 FROM reservation_seats WHERE showtime_id=? AND seat_id=?').get(show.id, id));
    if (unavailableSeats.length) throw new AppError(409, 'SEAT_CONFLICT', `Seat${unavailableSeats.length > 1 ? 's' : ''} ${unavailableSeats.join(', ')} ${unavailableSeats.length > 1 ? 'have' : 'has'} already been reserved. Choose another seat.`, { unavailableSeats });
    const reference = `RV-${randomBytes(12).toString('hex').toUpperCase()}`;
    const total = seats.reduce((sum, seat) => sum + seat.price, 0);
    const result = db.prepare('INSERT INTO reservations(reference,showtime_id,customer_name,customer_email,total,created_at) VALUES (?,?,?,?,?,?)').run(reference, show.id, input.customerName, input.customerEmail, total, new Date().toISOString());
    const claim = db.prepare('INSERT INTO reservation_seats VALUES (?,?,?,?,?,?)');
    for (const seat of seats) claim.run(result.lastInsertRowid, show.id, show.auditorium_id, seat.id, seat.category, seat.price);
    db.exec('COMMIT');
    return getReservation(db, reference);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
