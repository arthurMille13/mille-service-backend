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
  ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Personal/service-account keys with access to multiple workspaces
      // must specify which one to bill against on every request.
      defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
        ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }
        : undefined,
    })
  : null;

const MODEL = "claude-haiku-4-5-20251001";

function buildPrompt(
  { origin, destination, reason, tripType, startDate, endDate, travelers, note, requester },
  policy,
  flights,
  hotels
) {
  return `Tu es l'assistant IA d'une agence de voyage d'entreprise. Une personne a fait une demande de déplacement professionnel. Tu as DEUX tâches séparées, avec des règles différentes pour chacune :

TÂCHE 1 — Choisir le vol et l'hôtel :
Choisis le meilleur vol ET le meilleur hôtel PARMI LES OPTIONS FOURNIES CI-DESSOUS UNIQUEMENT (elles sont simulées, pas de vraies disponibilités). N'invente jamais d'autre vol ou hôtel. Justifie ton choix en français, en 2-3 phrases maximum, dans un ton professionnel et direct. Respecte la politique voyage sauf si le motif la justifie clairement (explique-le si c'est le cas). Un aller simple ("oneway") n'a pas de date de retour fixe ; un aller-retour ("roundtrip") en a une.

TÂCHE 2 — Conseils pratiques (optionnel) :
Si la note du voyageur demande autre chose que choisir parmi les options fournies (ex: un restaurant, un conseil local, une info pratique sur la destination), réponds avec tes VRAIES connaissances sur la ville de destination — tu peux citer de vrais lieux si tu les connais. Si tu n'es pas sûr d'un détail précis (ex: quel hôtel simulé est réellement proche d'un lieu donné), dis-le honnêtement plutôt que d'inventer. Si la note ne demande rien de tel, laisse "tips" vide.

Demande :
${JSON.stringify({ origin, destination, reason, tripType, startDate, endDate, travelers, note, requester }, null, 2)}

Politique voyage de l'entreprise :
${JSON.stringify(policy, null, 2)}

Vols disponibles (simulés) :
${JSON.stringify(flights, null, 2)}

Hôtels disponibles (simulés) :
${JSON.stringify(hotels, null, 2)}

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown, au format exact :
{"recommendedFlightId": "...", "recommendedHotelId": "...", "rationale": "...", "policyException": false, "tips": ["...", "..."]}
("tips" : 0 à 3 phrases courtes, tableau vide si rien de pertinent à ajouter)`;
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
      max_tokens: 500,
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
