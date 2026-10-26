import { openDatabase } from './database.js';
import { AppError } from './validation.js';
import { createReservation, getReservation, getShowtime } from './reservations.js';

export function createLocalStore(path) {
  const { db, ensureSchedule } = openDatabase(path);
  const getMovie = id => {
    const row = db.prepare('SELECT data FROM movies WHERE id=?').get(id);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'This film could not be found.');
    return JSON.parse(row.data);
  };
  return {
    db, ensureSchedule,
    health: () => db.prepare('SELECT 1 healthy').get().healthy === 1,
    movies: () => db.prepare('SELECT data FROM movies ORDER BY id').all().map(row => JSON.parse(row.data)),
    movie: getMovie,
    showtimes(id) {
      getMovie(id);
      return db.prepare(`SELECT s.id,s.movie_id,s.starts_at,a.name auditorium,
        (SELECT COUNT(*) FROM seats WHERE auditorium_id=s.auditorium_id) - (SELECT COUNT(*) FROM reservation_seats WHERE showtime_id=s.id) available
        FROM showtimes s JOIN auditoriums a ON a.id=s.auditorium_id WHERE movie_id=? AND starts_at>? ORDER BY starts_at`).all(id, new Date().toISOString());
    },
    seats(id) {
      const show = getShowtime(db, id);
      return { showtime: show, expired: new Date(show.starts_at).getTime() <= Date.now(), seats: db.prepare(`SELECT s.id,s.category,s.price, EXISTS(SELECT 1 FROM reservation_seats r WHERE r.showtime_id=? AND r.seat_id=s.id) booked FROM seats s WHERE auditorium_id=? ORDER BY substr(s.id,1,1), CAST(substr(s.id,2) AS INTEGER)`).all(show.id, show.auditorium_id) };
    },
    reserve: body => createReservation(db, body),
    reservation: reference => getReservation(db, reference)
  };
}
