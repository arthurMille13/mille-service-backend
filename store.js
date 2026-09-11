import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "db.json");

function readDb() {
  const raw = readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDb(db) {
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function saveRequest(request) {
  const db = readDb();
  db.requests.push(request);
  writeDb(db);
  return request;
}

export function getRequest(id) {
  const db = readDb();
  return db.requests.find((r) => r.id === id) || null;
}

export function saveBooking(booking) {
  const db = readDb();
  db.bookings.push(booking);
  writeDb(db);
  return booking;
}

export function listBookings() {
  const db = readDb();
  return [...db.bookings].sort(
    (a, b) => new Date(a.startDate) - new Date(b.startDate)
  );
}
