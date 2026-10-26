// Shared SQLite schema for the local practical and hosted libSQL database.
export const schema = `
    CREATE TABLE IF NOT EXISTS movies (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auditoriums (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS seats (
      auditorium_id INTEGER NOT NULL REFERENCES auditoriums(id), id TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('Standard','Prime','Recliner')), price INTEGER NOT NULL CHECK(price > 0),
      PRIMARY KEY(auditorium_id, id));
    CREATE TABLE IF NOT EXISTS showtimes (
      id INTEGER PRIMARY KEY, movie_id INTEGER NOT NULL REFERENCES movies(id),
      auditorium_id INTEGER NOT NULL REFERENCES auditoriums(id), starts_at TEXT NOT NULL,
      UNIQUE(movie_id, starts_at), UNIQUE(id, auditorium_id));
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, showtime_id INTEGER NOT NULL REFERENCES showtimes(id),
      customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, total INTEGER NOT NULL CHECK(total > 0),
      created_at TEXT NOT NULL, UNIQUE(id, showtime_id));
    CREATE TABLE IF NOT EXISTS reservation_seats (
      reservation_id INTEGER NOT NULL, showtime_id INTEGER NOT NULL, auditorium_id INTEGER NOT NULL,
      seat_id TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0),
      PRIMARY KEY(showtime_id, seat_id),
      FOREIGN KEY(reservation_id, showtime_id) REFERENCES reservations(id, showtime_id),
      FOREIGN KEY(showtime_id, auditorium_id) REFERENCES showtimes(id, auditorium_id),
      FOREIGN KEY(auditorium_id, seat_id) REFERENCES seats(auditorium_id, id));`;
