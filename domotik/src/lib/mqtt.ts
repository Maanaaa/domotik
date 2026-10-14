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
  private permitJoin: boolean = false;
  private permitJoinTimeout: number = 0;
  private bridgeInfo: Record<string, unknown> = {};

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

            // Au démarrage : forcer Zigbee2MQTT à renvoyer les appareils et l'état
            this.refreshDevices();

            // Répéter régulièrement pour détecter tout appareil se réveillant ou étant appairé
            setInterval(() => {
              if (this.isConnected && this.bridgeState === "online") {
                this.refreshDevices();
              }
            }, 5000);
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
            console.log(`[MQTT] État coordinateur Zigbee2MQTT: ${this.bridgeState}`);
            if (this.bridgeState === "online") {
              // Interroger immédiatement Zigbee2MQTT pour récupérer tous les appareils appairés
              this.refreshDevices();
            }
            return;
          }

          if (topic === "zigbee2mqtt/bridge/devices") {
            try {
              const parsed = JSON.parse(payloadStr);
              if (Array.isArray(parsed)) {
                this.bridgeDevices = parsed;
              }
            } catch (e) {
              console.error("[MQTT] Erreur parse bridge/devices:", e);
            }
            return;
          }

          if (topic === "zigbee2mqtt/bridge/info") {
            try {
              const parsed = JSON.parse(payloadStr);
              this.bridgeInfo = parsed;
              if (parsed.permit_join !== undefined) {
                this.permitJoin = Boolean(parsed.permit_join);
              }
              if (parsed.permit_join_timeout !== undefined) {
                this.permitJoinTimeout = Number(parsed.permit_join_timeout);
              }
            } catch (e) {
              console.error("[MQTT] Erreur parse bridge/info:", e);
            }
            return;
          }

          if (topic === "zigbee2mqtt/bridge/response/permit_join") {
            try {
              const res = JSON.parse(payloadStr);
              if (res.status === "ok" && res.data) {
                if (res.data.value !== undefined) {
                  this.permitJoin = Boolean(res.data.value);
                }
                if (res.data.time !== undefined) {
                  this.permitJoinTimeout = Number(res.data.time);
                }
              }
            } catch (e) {
              console.error("[MQTT] Erreur parse response/permit_join:", e);
            }
            return;
          }

          if (topic === "zigbee2mqtt/bridge/response/devices") {
            try {
              const res = JSON.parse(payloadStr);
              if (res.status === "ok" && Array.isArray(res.data)) {
                this.bridgeDevices = res.data;
              }
            } catch (e) {
              console.error("[MQTT] Erreur parse response/devices:", e);
            }
            return;
          }

          // Si c'est un autre topic bridge (logs, extensions), on ignore pour le dictionnaire devices
          if (topic.startsWith("zigbee2mqtt/bridge/")) {
            return;
          }

          // Pour les sous-topics d'équipements (ex: zigbee2mqtt/0x8c73dafffeceac07)
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

  // Activer ou désactiver l'appairage Zigbee (Permit Join)
  public setPermitJoin(enable: boolean, time: number = 254): boolean {
    const payload = {
      value: enable,
      time: enable ? time : 0,
    };
    this.permitJoin = enable;
    this.permitJoinTimeout = enable ? time : 0;
    return this.publish("zigbee2mqtt/bridge/request/permit_join", payload);
  }

  // Forcer le rafraîchissement des appareils et des infos
  public refreshDevices(): boolean {
    const pubDev = this.publish("zigbee2mqtt/bridge/request/devices", {});
    const pubInfo = this.publish("zigbee2mqtt/bridge/request/info", {});
    return pubDev && pubInfo;
  }

  // Renommer un appareil Zigbee
  public renameDevice(from: string, to: string): boolean {
    return this.publish("zigbee2mqtt/bridge/request/device/rename", {
      from,
      to,
      homeassistant_rename: true,
    });
  }

  // Supprimer un appareil Zigbee
  public removeDevice(id: string): boolean {
    return this.publish("zigbee2mqtt/bridge/request/device/remove", {
      id,
      force: true,
    });
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
      permitJoin: this.permitJoin,
      permitJoinTimeout: this.permitJoinTimeout,
      bridgeInfo: this.bridgeInfo,
    };
  }
}

export const mqttManager = MqttManager.getInstance();
