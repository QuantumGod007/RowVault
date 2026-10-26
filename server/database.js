import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { catalog } from './catalog.js';
import { schema } from './schema.js';

export const prices = { Standard: 250, Prime: 350, Recliner: 500 };
export const indiaDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function openDatabase(path = process.env.DATABASE_PATH || 'data/rowvault.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(schema);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const movie of catalog) {
      db.prepare('INSERT INTO movies VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(movie.id, JSON.stringify(movie));
      db.prepare('INSERT OR IGNORE INTO auditoriums VALUES (?, ?)').run(movie.id, `The Vault · Screen ${String(movie.id).padStart(2, '0')}`);
      for (const row of 'ABCDEFGH') for (let n = 1; n <= 10; n++) {
        const category = row <= 'B' ? 'Standard' : row <= 'F' ? 'Prime' : 'Recliner';
        db.prepare('INSERT OR IGNORE INTO seats VALUES (?, ?, ?, ?)').run(movie.id, `${row}${n}`, category, prices[category]);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  let seededDay;
  const ensureSchedule = () => {
    const today = indiaDate();
    if (seededDay === today) return;
    const base = new Date(`${today}T00:00:00+05:30`);
    const insert = db.prepare('INSERT OR IGNORE INTO showtimes(movie_id, auditorium_id, starts_at) VALUES (?, ?, ?)');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (let day = 0; day < 5; day++) {
        const date = indiaDate(new Date(base.getTime() + day * 86400000));
        for (const movie of catalog) for (const hour of ['11:00', '15:00', '19:00']) {
          insert.run(movie.id, movie.id, new Date(`${date}T${hour}:00+05:30`).toISOString());
        }
      }
      db.exec('COMMIT'); seededDay = today;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  ensureSchedule();
  return { db, ensureSchedule };
}
