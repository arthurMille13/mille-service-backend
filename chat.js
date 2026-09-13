import Anthropic from "@anthropic-ai/sdk";

// This is genuine free-form conversation, unlike aiReasoning.js which
// must only pick from a fixed simulated catalogue. Here Claude answers
// using its own real knowledge (restaurants, local tips, practical
// advice) — appropriate because we're not claiming this info comes
// from the fake flight/hotel data.

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
        ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }
        : undefined,
    })
  : null;

const MODEL = "claude-haiku-4-5-20251001";

function buildSystemPrompt(booking) {
  const context = booking
    ? `Contexte du voyage du collaborateur :
- Destination : ${booking.destination}${booking.origin && booking.origin !== "Non précisé" ? ` (départ de ${booking.origin})` : ""}
- Dates : ${booking.startDate} → ${booking.endDate}
- Motif : ${booking.reason}
- Hôtel réservé : ${booking.hotel.name}${booking.hotel.address ? ` (${booking.hotel.address})` : ""}
- Vol : ${booking.flight.airline} ${booking.flight.flightNumber}, départ ${booking.flight.departure}`
    : "Aucun voyage spécifique n'est associé à cette conversation.";

  return `Tu es l'assistant voyage de MILL Services, une agence de voyage d'entreprise. Un collaborateur en déplacement professionnel te pose des questions sur son voyage — restaurants, lieux à visiter, transports locaux, conseils pratiques, etc.

${context}

Règles :
- Réponds avec tes vraies connaissances. Si tu connais des lieux réels pertinents (restaurants, quartiers, transports), cite-les.
- Si tu n'es pas certain d'un détail précis, dis-le honnêtement plutôt que d'inventer.
- Tu n'as pas accès à des informations en temps réel (horaires exacts, disponibilités, prix actuels) — reste général sur ces points et suggère de vérifier sur place ou en ligne.
- Réponds en français, de façon concise (3-4 phrases maximum sauf si la question demande clairement plus de détail), dans un ton professionnel mais chaleureux.
- Tu n'es pas en charge de modifier la réservation elle-même (vol/hôtel) — si on te le demande, explique que ça se fait depuis l'appli.`;
}

export async function chatAboutTrip(booking, history, message) {
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const messages = [
    ...(Array.isArray(history) ? history : []).map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    })),
    { role: "user", content: message },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: buildSystemPrompt(booking),
    messages,
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}
