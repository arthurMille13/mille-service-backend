import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { buildSuggestions } from "./aiEngine.js";
import { getAiRecommendation } from "./aiReasoning.js";
import { chatAboutTrip } from "./chat.js";
import {
  saveRequest,
  getRequest,
  saveBooking,
  getBookingByRequestId,
  listBookings,
  getBooking,
  saveExpense,
  listExpenses,
} from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Fail loudly and clearly on boot rather than crashing later with an
// obscure stack trace if the policy file is missing or malformed.
let policy;
try {
  policy = JSON.parse(readFileSync(join(__dirname, "policy.json"), "utf-8"));
} catch (err) {
  console.error("Impossible de charger policy.json :", err.message);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// Express 4 does not catch rejected promises from async route handlers —
// an unhandled rejection would otherwise hang the request forever and,
// left unhandled at the process level, can crash the whole server.
// Wrapping every async handler forwards errors to the error middleware.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function isValidDateString(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

const MAX_TRIP_DAYS = 90;

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.get("/api/policy", (_req, res) => {
  res.json(policy);
});

// Submit a new travel request. In a real system this is where an LLM
// call + travel-content API (Amadeus/Duffel/Sabre) would run. Here we
// generate deterministic flight/hotel options so a demo run is
// self-contained and repeatable.
app.post(
  "/api/requests",
  asyncHandler(async (req, res) => {
    const { origin, destination, reason, tripType, startDate, endDate, travelers, note, requester } =
      req.body || {};

    if (!destination || typeof destination !== "string" || !destination.trim()) {
      return res.status(400).json({ error: "La destination est obligatoire." });
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ error: "Le motif du déplacement est obligatoire." });
    }
    if (!requester || typeof requester !== "string" || !requester.trim()) {
      return res.status(400).json({ error: "Le nom du voyageur est obligatoire." });
    }
    if (!isValidDateString(startDate)) {
      return res.status(400).json({ error: "La date de départ est invalide." });
    }

    const normalizedTripType = tripType === "oneway" ? "oneway" : "roundtrip";
    const effectiveEndDate = normalizedTripType === "oneway" ? startDate : endDate;

    if (!isValidDateString(effectiveEndDate)) {
      return res.status(400).json({ error: "La date de retour est invalide." });
    }
    if (normalizedTripType === "roundtrip" && effectiveEndDate < startDate) {
      return res.status(400).json({ error: "La date de retour doit être après la date de départ." });
    }
    const tripDays = Math.round(
      (new Date(effectiveEndDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
    );
    if (tripDays > MAX_TRIP_DAYS) {
      return res.status(400).json({ error: `Le voyage ne peut pas dépasser ${MAX_TRIP_DAYS} jours.` });
    }

    const numericTravelers = Number(travelers);
    const safeTravelers =
      Number.isInteger(numericTravelers) && numericTravelers >= 1 && numericTravelers <= 20
        ? numericTravelers
        : 1;

    const tripContext = {
      origin: origin && String(origin).trim() ? String(origin).trim() : "Non précisé",
      destination: destination.trim(),
      reason: reason.trim(),
      tripType: normalizedTripType,
      startDate,
      endDate: effectiveEndDate,
      travelers: safeTravelers,
      note: note ? String(note).trim() : "",
      requester: requester.trim(),
    };

    const suggestions = buildSuggestions(tripContext.destination, policy);

    // Real AI reasoning over the candidate options. Returns null (and the
    // request still succeeds) if no API key is configured or the call fails.
    const aiRecommendation = await getAiRecommendation(
      tripContext,
      policy,
      suggestions.flights,
      suggestions.hotels
    );

    const request = {
      id: randomUUID(),
      ...tripContext,
      createdAt: new Date().toISOString(),
      suggestions,
      aiRecommendation,
    };

    saveRequest(request);
    res.status(201).json(request);
  })
);

app.get("/api/requests/:id", (req, res) => {
  const request = getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "Demande introuvable." });
  res.json(request);
});

// Validate a request: pick one flight + one hotel and "book" them.
// A real implementation would call the airline/hotel booking APIs and
// a corporate card/payment processor here.
app.post("/api/bookings", (req, res) => {
  const { requestId, flightId, hotelId } = req.body || {};
  const request = getRequest(requestId);

  if (!request) {
    return res.status(404).json({ error: "Demande introuvable." });
  }

  // Prevent duplicate bookings from a double-tap or a network retry.
  const existing = getBookingByRequestId(requestId);
  if (existing) {
    return res.status(409).json({
      error: "Cette demande a déjà été réservée.",
      booking: existing,
    });
  }

  const flight = request.suggestions.flights.find((f) => f.id === flightId);
  const hotel = request.suggestions.hotels.find((h) => h.id === hotelId);

  if (!flight || !hotel) {
    return res.status(400).json({ error: "Vol ou hôtel invalide." });
  }

  const booking = {
    id: randomUUID(),
    requestId,
    origin: request.origin,
    destination: request.destination,
    reason: request.reason,
    tripType: request.tripType,
    travelers: request.travelers,
    note: request.note,
    requester: request.requester,
    startDate: request.startDate,
    endDate: request.endDate,
    flight,
    hotel,
    status: "confirmed",
    bookedAt: new Date().toISOString(),
  };

  saveBooking(booking);
  res.status(201).json(booking);
});

app.get("/api/dashboard", (_req, res) => {
  res.json({ bookings: listBookings() });
});

const EXPENSE_CATEGORIES = ["Repas", "Taxi / VTC", "Transports", "Parking", "Autre"];

// Expense notes: for costs incurred during a trip that aren't already
// covered by the automated flight/hotel booking (meals, taxis, etc.).
// There is no manager approval flow yet — every expense stays "pending"
// until that feature exists; see README for known limitations.
app.post("/api/expenses", (req, res) => {
  const { category, amount, date, note, bookingId } = req.body || {};

  if (!category || amount === undefined || amount === null || amount === "" || !date) {
    return res.status(400).json({ error: "La catégorie, le montant et la date sont obligatoires." });
  }
  if (!EXPENSE_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `La catégorie doit être l'une des suivantes : ${EXPENSE_CATEGORIES.join(", ")}.`,
    });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: "Le montant doit être un nombre positif." });
  }
  if (!isValidDateString(date)) {
    return res.status(400).json({ error: "La date est invalide." });
  }

  const expense = {
    id: randomUUID(),
    category,
    amount: numericAmount,
    date,
    note: note ? String(note).trim() : "",
    bookingId: bookingId || null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  saveExpense(expense);
  res.status(201).json(expense);
});

app.get("/api/expenses", (_req, res) => {
  res.json({ expenses: listExpenses(), categories: EXPENSE_CATEGORIES });
});

const MAX_CHAT_HISTORY_MESSAGES = 20;
const MAX_CHAT_MESSAGE_CHARS = 4000;
const MAX_CHAT_HISTORY_CHARS = 20000;

// Free-form Q&A about a trip (restaurants, local tips, practical advice).
// Unlike /api/requests, this is genuine conversation — Claude answers
// from its own knowledge, not from the simulated flight/hotel catalogue.
app.post(
  "/api/chat",
  asyncHandler(async (req, res) => {
    const { bookingId, message, history } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Le message est obligatoire." });
    }
    if (message.length > MAX_CHAT_MESSAGE_CHARS) {
      return res.status(400).json({ error: "Le message est trop long." });
    }

    // Cap both the number of turns and total size of history sent to the
    // model — an unbounded client-supplied history could otherwise blow
    // up token usage (and cost) on every request.
    let safeHistory = Array.isArray(history) ? history.slice(-MAX_CHAT_HISTORY_MESSAGES) : [];
    let totalChars = 0;
    safeHistory = safeHistory.filter((h) => {
      const len = typeof h?.content === "string" ? h.content.length : 0;
      totalChars += len;
      return totalChars <= MAX_CHAT_HISTORY_CHARS;
    });

    const booking = bookingId ? getBooking(bookingId) : null;

    try {
      const reply = await chatAboutTrip(booking, safeHistory, message.trim());
      res.json({ reply });
    } catch (err) {
      console.error("Chat failed:", err.message);
      res.status(503).json({
        error: "L'assistant n'est pas disponible pour le moment.",
      });
    }
  })
);

// 404 for anything that didn't match a route above.
app.use((req, res) => {
  res.status(404).json({ error: "Route introuvable." });
});

// Centralized error handler — must be registered last. Catches anything
// forwarded by asyncHandler() as well as synchronous throws in routes,
// and errors thrown by middleware (e.g. malformed JSON bodies).
app.use((err, _req, res, _next) => {
  console.error("Erreur interne :", err);
  const status = err.statusCode || err.status || 500;
  const message = status === 400 ? "Requête invalide." : "Une erreur interne est survenue.";
  res.status(status).json({ error: message });
});

const server = app.listen(PORT, () => {
  console.log(`Travel agency backend listening on http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Le port ${PORT} est déjà utilisé par un autre processus.`);
  } else {
    console.error("Erreur au démarrage du serveur :", err.message);
  }
  process.exit(1);
});
