import Anthropic from "@anthropic-ai/sdk";

// This is the real AI layer: it calls Claude to reason over the
// candidate flights/hotels that aiEngine.js generated, and picks the
// best combo with a written justification — instead of the person
// having to compare options by hand.
//
// The flights/hotels themselves are still the simulated catalogue
// (see aiEngine.js) until a real travel-content provider is wired in.
// Claude reasons over that catalogue; it does not invent flights.
//
// Requires ANTHROPIC_API_KEY to be set. If it's missing, invalid, or
// the call fails for any reason, this returns null and the app falls
// back to showing the plain option list with no AI pick — it never
// breaks the request.

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const MODEL = "claude-haiku-4-5-20251001";

function buildPrompt({ destination, reason, startDate, endDate, requester }, policy, flights, hotels) {
  return `Tu es l'assistant IA d'une agence de voyage d'entreprise. Une personne a fait une demande de déplacement professionnel. Choisis le meilleur vol ET le meilleur hôtel parmi les options fournies, puis justifie ton choix en français, en 2 phrases maximum, dans un ton professionnel et direct.

Règles :
- Respecte la politique voyage sauf si le motif du voyage justifie clairement une exception (explique-le si c'est le cas).
- Privilégie l'équilibre prix / confort / horaires adaptés au motif du déplacement.
- Ne mentionne jamais que tu es une IA générique ; parle comme un vrai conseiller voyage.

Demande :
${JSON.stringify({ destination, reason, startDate, endDate, requester }, null, 2)}

Politique voyage de l'entreprise :
${JSON.stringify(policy, null, 2)}

Vols disponibles :
${JSON.stringify(flights, null, 2)}

Hôtels disponibles :
${JSON.stringify(hotels, null, 2)}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown, au format exact :
{"recommendedFlightId": "...", "recommendedHotelId": "...", "rationale": "...", "policyException": false}`;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in model output");
  return JSON.parse(match[0]);
}

export async function getAiRecommendation(request, policy, flights, hotels) {
  if (!client) {
    console.warn("ANTHROPIC_API_KEY is not set — skipping AI recommendation.");
    return null;
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [
        { role: "user", content: buildPrompt(request, policy, flights, hotels) },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = extractJson(text);

    const flightOk = flights.some((f) => f.id === parsed.recommendedFlightId);
    const hotelOk = hotels.some((h) => h.id === parsed.recommendedHotelId);
    if (!flightOk || !hotelOk) {
      throw new Error("Model recommended an id that isn't in the candidate list");
    }

    return parsed;
  } catch (err) {
    console.error("AI recommendation failed, falling back to plain list:", err.message);
    return null;
  }
}
