import mqtt, { MqttClient } from "mqtt";

interface DeviceState {
  topic: string;
  payload: Record<string, unknown>;
  lastSeen: number;
}

// Global MQTT Singleton for Next.js hot-reloading
class MqttManager {
  private static instance: MqttManager;
  private client: MqttClient | null = null;
  private devicesState: Map<string, DeviceState> = new Map();
  private isConnected: boolean = false;
  private bridgeState: string = "offline";
  private bridgeDevices: Array<Record<string, unknown>> = [];

  private constructor() {
    this.init();
  }

  public static getInstance(): MqttManager {
    if (!MqttManager.instance) {
      MqttManager.instance = new MqttManager();
    }
    return MqttManager.instance;
  }

  private init() {
    const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
    console.log(`[MQTT] Connexion au broker MQTT: ${brokerUrl}`);

    try {
      this.client = mqtt.connect(brokerUrl, {
        connectTimeout: 5000,
        reconnectPeriod: 3000,
        clientId: `domotik_nextjs_${Math.random().toString(16).substring(2, 8)}`,
      });

      this.client.on("connect", () => {
        console.log("[MQTT] Connecté avec succès au broker Zigbee2MQTT !");
        this.isConnected = true;

        // S'abonner à tous les topics Zigbee2MQTT
        this.client?.subscribe("zigbee2mqtt/#", (err) => {
          if (err) {
            console.error("[MQTT] Erreur d'abonnement aux topics zigbee2mqtt/#:", err);
          } else {
            console.log("[MQTT] Abonné avec succès aux topics zigbee2mqtt/#");
          }
        });
      });

      this.client.on("message", (topic, message) => {
        try {
          const payloadStr = message.toString();

          if (topic === "zigbee2mqtt/bridge/state") {
            try {
              const parsed = JSON.parse(payloadStr);
              this.bridgeState = parsed.state || payloadStr;
            } catch {
              this.bridgeState = payloadStr;
            }
            return;
          }

          if (topic === "zigbee2mqtt/bridge/devices") {
            try {
              this.bridgeDevices = JSON.parse(payloadStr);
            } catch (e) {
              console.error("[MQTT] Erreur parse bridge/devices:", e);
            }
            return;
          }

          // Pour les sous-topics d'équipements (ex: zigbee2mqtt/Salon_Plafonnier)
          let parsedPayload: Record<string, unknown> = {};
          try {
            parsedPayload = JSON.parse(payloadStr);
          } catch {
            parsedPayload = { value: payloadStr };
          }

          this.devicesState.set(topic, {
            topic,
            payload: parsedPayload,
            lastSeen: Date.now(),
          });
        } catch (err) {
          console.error(`[MQTT] Erreur traitement message [${topic}]:`, err);
        }
      });

      this.client.on("error", (err) => {
        console.error("[MQTT] Erreur client MQTT:", err.message);
        this.isConnected = false;
      });

      this.client.on("offline", () => {
        this.isConnected = false;
      });
    } catch (e) {
      console.error("[MQTT] Erreur d'initialisation du client MQTT:", e);
    }
  }

  public publish(topic: string, message: Record<string, unknown> | string): boolean {
    if (!this.client || !this.isConnected) {
      console.warn("[MQTT] Tentative de publication hors-ligne");
      return false;
    }

    const payload = typeof message === "string" ? message : JSON.stringify(message);
    this.client.publish(topic, payload, { qos: 0 }, (err) => {
      if (err) {
        console.error(`[MQTT] Échec publication [${topic}]:`, err);
      } else {
        console.log(`[MQTT] Message envoyé à [${topic}]:`, payload);
      }
    });
    return true;
  }

  public getStatus() {
    const devicesList = Array.from(this.devicesState.entries()).map(([topic, data]) => ({
      topic,
      payload: data.payload,
      lastSeen: data.lastSeen,
    }));

    return {
      connected: this.isConnected,
      brokerUrl: process.env.MQTT_BROKER_URL || "mqtt://localhost:1883",
      bridgeState: this.bridgeState,
      bridgeDevicesCount: this.bridgeDevices.length,
      devicesCount: devicesList.length,
      devices: devicesList,
      bridgeDevices: this.bridgeDevices,
    };
  }
}

export const mqttManager = MqttManager.getInstance();
