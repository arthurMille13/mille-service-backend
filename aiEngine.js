// This module stands in for the real AI + travel-content integration
// (an LLM call plus a GDS/travel API such as Amadeus, Duffel or Sabre).
// It deterministically "generates" flight and hotel options from the
// destination string, so a demo run is stable and repeatable without
// needing real API keys or network access. Replace `buildSuggestions`
// with real provider calls when moving past the prototype.

const AIRLINES = ["Air France", "Transavia", "Vueling", "KLM", "Lufthansa"];
const HOTEL_BRANDS = ["Ibis Styles", "Novotel", "Mercure", "Radisson Blu", "Hyatt Place"];
const STREET_NAMES = [
  "Rue de la République",
  "Avenue Jean Jaurès",
  "Rue du Centre",
  "Boulevard de la Gare",
  "Rue Victor Hugo",
];

// Small deterministic hash so the same destination always produces
// the same-looking options within a demo session.
function seedFromString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function randomTime(rng) {
  const hour = Math.floor(rng() * 14) + 6; // 06:00 - 20:00
  const minute = pick(rng, ["00", "15", "30", "45"]);
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function buildSuggestions(destination, policy) {
  const rng = mulberry32(seedFromString(destination.trim().toLowerCase()));

  const flights = Array.from({ length: 3 }).map((_, i) => {
    const departure = randomTime(rng);
    const durationMin = 60 + Math.floor(rng() * 90);
    const price = Math.round(69 + rng() * (i === 0 ? 60 : i === 1 ? 140 : 220));
    return {
      id: `flight-${i + 1}`,
      airline: pick(rng, AIRLINES),
      flightNumber: `${pick(rng, ["AF", "TO", "VY", "KL", "LH"])}${Math.floor(
        1000 + rng() * 8999
      )}`,
      departure,
      arrival: addMinutes(departure, durationMin),
      durationMin,
      cabin: policy.cabinClass,
      price,
      compliant: price <= policy.maxFlightPrice,
      // Rough estimate (short/medium-haul average ~90g CO2/passenger-km,
      // ~750km/h cruise speed) — a placeholder until a real emissions
      // provider (e.g. Amadeus Travel Sustainability) is wired in.
      co2Kg: Math.round(durationMin * 0.9),
    };
  });

  const hotels = Array.from({ length: 3 }).map((_, i) => {
    const price = Math.round(59 + rng() * (i === 0 ? 45 : i === 1 ? 130 : 210));
    const stars = 3 + Math.floor(rng() * 2);
    const streetNumber = 2 + Math.floor(rng() * 140);
    return {
      id: `hotel-${i + 1}`,
      name: `${pick(rng, HOTEL_BRANDS)} ${destination}`,
      stars,
      distanceKm: Math.round((rng() * 5 + 0.3) * 10) / 10,
      pricePerNight: price,
      compliant: price <= policy.maxHotelPricePerNight,
      // Simulated address (not a real, geolocated property) — a
      // placeholder until a real hotel-content provider is wired in.
      address: `${streetNumber} ${pick(rng, STREET_NAMES)}, ${destination}`,
    };
  });

  return { flights, hotels };
}
