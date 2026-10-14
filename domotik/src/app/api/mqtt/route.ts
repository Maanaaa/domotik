import { NextResponse } from "next/server";
import { mqttManager } from "~/lib/mqtt";

// GET /api/mqtt - Récupère l'état courant de la connexion MQTT, des appareils et du couplage Zigbee
export async function GET() {
  const status = mqttManager.getStatus();
  return NextResponse.json(status);
}

// POST /api/mqtt - Actions (Permit Join / Couplage, Refresh, Commandes ON/OFF, Rename)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, topic, payload, enable, time, from, to, id } = body;

    // Action 1: Gérer l'appairage / couplage (sans passer par Mosquitto / Zigbee2MQTT)
    if (action === "permit_join") {
      const isEnable = enable !== undefined ? Boolean(enable) : true;
      const duration = Number(time) || 254;
      const success = mqttManager.setPermitJoin(isEnable, duration);
      return NextResponse.json({
        success,
        action: "permit_join",
        permitJoin: isEnable,
        duration: isEnable ? duration : 0,
      });
    }

    // Action 2: Rafraîchir les appareils
    if (action === "refresh") {
      const success = mqttManager.refreshDevices();
      return NextResponse.json({ success, action: "refresh" });
    }

    // Action 3: Renommer un appareil
    if (action === "rename" && from && to) {
      const success = mqttManager.renameDevice(from, to);
      return NextResponse.json({ success, action: "rename", from, to });
    }

    // Action 4: Supprimer un appareil
    if (action === "remove" && id) {
      const success = mqttManager.removeDevice(id);
      return NextResponse.json({ success, action: "remove", id });
    }

    // Action 5: Publication MQTT directe (ex: allumer une prise: topic="zigbee2mqtt/0xa4c13810f2d8ffff/set", payload={"state": "ON"})
    if (topic && payload !== undefined) {
      const success = mqttManager.publish(topic, payload);
      return NextResponse.json({ success, topic, payload });
    }

    return NextResponse.json(
      { error: "Action ou paramètres (topic, payload) invalides" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Erreur API MQTT POST:", error);
    return NextResponse.json(
      { error: "Erreur lors de l'exécution de l'action MQTT" },
      { status: 500 }
    );
  }
}
