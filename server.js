import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { buildSuggestions } from "./aiEngine.js";
import { getAiRecommendation } from "./aiReasoning.js";
import { saveRequest, getRequest, saveBooking, listBookings } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(
  readFileSync(join(__dirname, "policy.json"), "utf-8")
);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/policy", (_req, res) => {
  res.json(policy);
});

// Submit a new travel request. In a real system this is where an LLM
// call + travel-content API (Amadeus/Duffel/Sabre) would run. Here we
// generate deterministic mock options so the demo is self-contained.
app.post("/api/requests", async (req, res) => {
  const { destination, reason, startDate, endDate, requester } = req.body || {};

  if (!destination || !startDate || !endDate) {
    return res.status(400).json({
      error: "destination, startDate and endDate are required",
    });
  }

  const tripContext = {
    destination,
    reason: reason || "Non précisé",
    startDate,
    endDate,
    requester: requester || "Utilisateur test",
  };

  const suggestions = buildSuggestions(destination, policy);

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
});

app.get("/api/requests/:id", (req, res) => {
  const request = getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found" });
  res.json(request);
});

// Validate a request: pick one flight + one hotel and "book" them.
// A real implementation would call the airline/hotel booking APIs and
// a corporate card/payment processor here.
app.post("/api/bookings", (req, res) => {
  const { requestId, flightId, hotelId } = req.body || {};
  const request = getRequest(requestId);

  if (!request) {
    return res.status(404).json({ error: "Request not found" });
  }

  const flight = request.suggestions.flights.find((f) => f.id === flightId);
  const hotel = request.suggestions.hotels.find((h) => h.id === hotelId);

  if (!flight || !hotel) {
    return res.status(400).json({ error: "Invalid flight or hotel id" });
  }

  const booking = {
    id: randomUUID(),
    requestId,
    destination: request.destination,
    reason: request.reason,
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

app.listen(PORT, () => {
  console.log(`Travel agency backend listening on http://localhost:${PORT}`);
});
