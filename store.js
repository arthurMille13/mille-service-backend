import { readFileSync, writeFileSync, renameSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// This file simulates a database using a JSON file on disk.
// Swap this module out for a real database (Postgres, Mongo, etc.)
// when moving past the prototype stage — every other file only
// talks to the functions exported here, so that's the only place
// a real integration would need to change.
//
// Note: on Render's free tier the filesystem is not guaranteed to
// persist across deploys/restarts — this store is fine for a demo
// session but not a durable database.
//
// Every read/write below uses Node's *synchronous* fs calls, so two
// requests in this single-threaded process can never interleave in
// the middle of a read-modify-write cycle. The real risk this module
// guards against is a *partial write* if the process is killed mid-save
// (a crash or restart) — writeAtomic() avoids that by writing to a
// temp file and renaming it into place, which is a single atomic
// filesystem operation.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "db.json");
const TMP_PATH = `${DB_PATH}.tmp`;

function readDb() {
  const raw = readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDb(db) {
  writeFileSync(TMP_PATH, JSON.stringify(db, null, 2));
  renameSync(TMP_PATH, DB_PATH);
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

export function getBooking(id) {
  const db = readDb();
  return db.bookings.find((b) => b.id === id) || null;
}

export function getBookingByRequestId(requestId) {
  const db = readDb();
  return db.bookings.find((b) => b.requestId === requestId) || null;
}

export function saveExpense(expense) {
  const db = readDb();
  if (!db.expenses) db.expenses = [];
  db.expenses.push(expense);
  writeDb(db);
  return expense;
}

export function listExpenses() {
  const db = readDb();
  return [...(db.expenses || [])].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
}
