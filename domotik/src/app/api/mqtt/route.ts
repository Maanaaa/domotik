import { NextResponse } from "next/server";
import { mqttManager } from "~/lib/mqtt";

// GET /api/mqtt - Récupère l'état courant de la connexion MQTT et des appareils Zigbee
export async function GET() {
  const status = mqttManager.getStatus();
  return NextResponse.json(status);
}

// POST /api/mqtt - Envoie une commande MQTT (ex: allumer une lampe, changer une consigne)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { topic, payload } = body;

    if (!topic || payload === undefined) {
      return NextResponse.json(
        { error: "Paramètres 'topic' et 'payload' requis" },
        { status: 400 }
      );
    }

    const success = mqttManager.publish(topic, payload);
    return NextResponse.json({ success, topic, payload });
  } catch (error) {
    console.error("Erreur API MQTT POST:", error);
    return NextResponse.json(
      { error: "Erreur lors de l'envoi du message MQTT" },
      { status: 500 }
    );
  }
}
