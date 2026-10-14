"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  DoorClosed,
  DoorOpen,
  Power,
  RefreshCw,
  Bell,
  BellOff,
  Radio,
  Battery,
  Signal,
  AlertCircle,
  Edit2,
  X,
  Check,
} from "lucide-react";

interface PiStats {
  hostname: string;
  ip: string;
  uptimeSeconds: number;
  cpu: {
    usagePercent: number;
    tempC: number | null;
  };
  memory: {
    usedMb: number;
    totalMb: number;
    percent: number;
  };
}

interface MqttDevicePayload {
  topic: string;
  payload: Record<string, unknown>;
  lastSeen: number;
}

interface BridgeDevice {
  ieee_address: string;
  type: string;
  friendly_name: string;
  definition?: {
    model?: string;
    description?: string;
  } | null;
}

interface MqttStatus {
  connected: boolean;
  bridgeState: string;
  devices: MqttDevicePayload[];
  bridgeDevices: BridgeDevice[];
  permitJoin: boolean;
  permitJoinTimeout: number;
}

interface DoorSensorData {
  name: string;
  contact: boolean;
  battery: number;
  tamper: boolean;
  lqi: number;
}

interface PlugData {
  name: string;
  state: string;
  power: number;
  voltage: number;
  lqi: number;
}

export default function DomotikDashboard() {
  const [mqttStatus, setMqttStatus] = useState<MqttStatus | null>(null);
  const [piStats, setPiStats] = useState<PiStats | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");
  const [notifEnabled, setNotifEnabled] = useState(false);

  // Modal renommage
  const [renameModal, setRenameModal] = useState<{ open: boolean; currentName: string; newName: string }>({
    open: false,
    currentName: "",
    newName: "",
  });

  // Référence pour détecter le changement d'état de la porte (Notification)
  const lastDoorContactRef = useRef<boolean | null>(null);

  // Vérifier la permission des notifications au chargement
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPermission(Notification.permission);
      const saved = localStorage.getItem("domotik_notifs");
      if (saved === "true" && Notification.permission === "granted") {
        setNotifEnabled(true);
      }
    }
  }, []);

  // Activer / Désactiver les notifications
  const toggleNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      alert("Ce navigateur ne supporte pas les notifications.");
      return;
    }

    if (notifEnabled) {
      setNotifEnabled(false);
      localStorage.setItem("domotik_notifs", "false");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotifPermission(permission);

    if (permission === "granted") {
      setNotifEnabled(true);
      localStorage.setItem("domotik_notifs", "true");
      new Notification("Domotik", {
        body: "Notifications activées ! Vous serez alerté en cas d'ouverture de porte.",
        icon: "/favicon.ico",
      });
    } else {
      alert("Permission de notification refusée dans le navigateur.");
    }
  };

  // Récupérer l'état MQTT
  const fetchMqtt = useCallback(async () => {
    try {
      const res = await fetch("/api/mqtt");
      if (res.ok) {
        const data: MqttStatus = await res.json();
        setMqttStatus(data);
      }
    } catch {
      // Ignorer silencieusement pour éviter le spam console
    }
  }, []);

  // Récupérer les stats Pi
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data: PiStats = await res.json();
        setPiStats(data);
      }
    } catch {
      // Ignorer
    }
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetch("/api/mqtt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh" }),
    });
    await Promise.all([fetchMqtt(), fetchStats()]);
    setIsRefreshing(false);
  };

  // Couplage Zigbee (Permit join)
  const togglePairing = async (enable: boolean) => {
    await fetch("/api/mqtt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "permit_join", enable, time: 254 }),
    });
    fetchMqtt();
  };

  // Prise ON/OFF
  const togglePlug = async (name: string, currentState: string) => {
    const nextState = currentState === "ON" ? "OFF" : "ON";
    await fetch("/api/mqtt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: `zigbee2mqtt/${name}/set`,
        payload: { state: nextState },
      }),
    });
    setTimeout(fetchMqtt, 300);
  };

  // Renommer
  const submitRename = async () => {
    if (!renameModal.newName.trim()) return;
    await fetch("/api/mqtt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "rename",
        from: renameModal.currentName,
        to: renameModal.newName.trim(),
      }),
    });
    setRenameModal({ open: false, currentName: "", newName: "" });
    setTimeout(handleRefresh, 500);
  };

  // Polling régulier
  useEffect(() => {
    fetchMqtt();
    fetchStats();
    const interval = setInterval(fetchMqtt, 2000);
    const statsInterval = setInterval(fetchStats, 10000);
    return () => {
      clearInterval(interval);
      clearInterval(statsInterval);
    };
  }, [fetchMqtt, fetchStats]);

  // Map des données MQTT
  const payloadsMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    mqttStatus?.devices?.forEach((d) => {
      map.set(d.topic, d.payload);
      map.set(d.topic.replace("zigbee2mqtt/", ""), d.payload);
    });
    return map;
  }, [mqttStatus?.devices]);

  // Filtrage des appareils
  const { doorSensor, plug, allDevices } = useMemo(() => {
    const bridgeDevs = (mqttStatus?.bridgeDevices || []).filter((d) => d.type !== "Coordinator");
    const deviceNames = new Set<string>();

    bridgeDevs.forEach((d) => deviceNames.add(d.friendly_name));
    mqttStatus?.devices?.forEach((d) => {
      const name = d.topic.replace("zigbee2mqtt/", "");
      if (!name.startsWith("bridge")) deviceNames.add(name);
    });

    if (deviceNames.size === 0) {
      deviceNames.add("0x8c73dafffeceac07");
      deviceNames.add("0xa4c13810f2d8ffff");
    }

    let detectedDoor: DoorSensorData | null = null;
    let detectedPlug: PlugData | null = null;
    const others: Array<{ name: string; type: string; info: string }> = [];

    for (const name of deviceNames) {
      const payload = payloadsMap.get(name) || {};
      const isDoor = payload.contact !== undefined || name.includes("8c73dafffeceac07");
      const isPlug = !isDoor && (payload.state !== undefined || name.includes("a4c13810f2d8ffff"));

      if (isDoor && !detectedDoor) {
        detectedDoor = {
          name,
          contact: payload.contact !== undefined ? Boolean(payload.contact) : true,
          battery: typeof payload.battery === "number" ? payload.battery : 100,
          tamper: Boolean(payload.tamper),
          lqi: typeof payload.linkquality === "number" ? payload.linkquality : 200,
        };
      } else if (isPlug && !detectedPlug) {
        detectedPlug = {
          name,
          state: String(payload.state || "OFF").toUpperCase(),
          power: typeof payload.power === "number" ? payload.power : 0,
          voltage: typeof payload.voltage === "number" ? payload.voltage : 230,
          lqi: typeof payload.linkquality === "number" ? payload.linkquality : 180,
        };
      } else {
        others.push({
          name,
          type: isDoor ? "Capteur Porte" : isPlug ? "Prise" : "Appareil Zigbee",
          info: payload.contact !== undefined ? (payload.contact ? "Fermé" : "Ouvert") : String(payload.state || "Connecté"),
        });
      }
    }

    return {
      doorSensor: detectedDoor || {
        name: "0x8c73dafffeceac07",
        contact: true,
        battery: 100,
        tamper: false,
        lqi: 207,
      },
      plug: detectedPlug,
      allDevices: others,
    };
  }, [mqttStatus, payloadsMap]);

  // Surveillance de la porte pour envoyer la notification navigateur
  useEffect(() => {
    if (doorSensor) {
      if (lastDoorContactRef.current !== null) {
        // La porte était fermée (true) et vient de s'ouvrir (false)
        if (lastDoorContactRef.current === true && doorSensor.contact === false) {
          if (notifEnabled && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification("Alerte Porte Ouverte", {
              body: `La porte (${doorSensor.name}) vient d'être ouverte !`,
              icon: "/favicon.ico",
              tag: "door-alert",
            });
          }
        }
      }
      lastDoorContactRef.current = doorSensor.contact;
    }
  }, [doorSensor, notifEnabled]);

  const isPairing = Boolean(mqttStatus?.permitJoin);

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200 antialiased p-4 sm:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* HEADER SIMPLE & PROPRE */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-white tracking-tight">Domotik</h1>
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                {mqttStatus?.connected ? "En ligne" : "Hors ligne"}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">Supervision Sonoff &amp; Mosquitto</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Bouton Notification Navigateur */}
            <button
              onClick={toggleNotifications}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                notifEnabled
                  ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
              title="Alerte notification navigateur en cas d'ouverture"
            >
              {notifEnabled ? <Bell className="w-3.5 h-3.5 text-indigo-400" /> : <BellOff className="w-3.5 h-3.5" />}
              <span>{notifEnabled ? "Notifs ON" : "Activer notifs"}</span>
            </button>

            {/* Bouton Appairage */}
            <button
              onClick={() => togglePairing(!isPairing)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                isPairing
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300 animate-pulse"
                  : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>{isPairing ? "Appairage actif" : "Appairer (API)"}</span>
            </button>

            {/* Bouton Refresh */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
              title="Actualiser"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-indigo-400" : ""}`} />
            </button>
          </div>
        </header>

        {/* CARTE PRINCIPALE : PORTE */}
        <section>
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div
                className={`w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${
                  doorSensor.contact
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                }`}
              >
                {doorSensor.contact ? <DoorClosed className="w-7 h-7" /> : <DoorOpen className="w-7 h-7" />}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-white">{doorSensor.name}</h2>
                  <button
                    onClick={() =>
                      setRenameModal({
                        open: true,
                        currentName: doorSensor.name,
                        newName: doorSensor.name,
                      })
                    }
                    className="text-slate-500 hover:text-slate-300 p-0.5"
                    title="Renommer"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                      doorSensor.contact
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-rose-500/20 text-rose-300 animate-pulse"
                    }`}
                  >
                    {doorSensor.contact ? "Fermée" : "Ouverte"}
                  </span>
                  {doorSensor.tamper && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                      <AlertCircle className="w-3 h-3" /> Altéré
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Infos rapides capteur */}
            <div className="flex items-center gap-6 text-xs text-slate-400 border-t sm:border-t-0 sm:border-l border-slate-800 pt-3 sm:pt-0 sm:pl-6">
              <div className="flex items-center gap-2">
                <Battery className="w-4 h-4 text-slate-300" />
                <span>{doorSensor.battery}% pile</span>
              </div>
              <div className="flex items-center gap-2">
                <Signal className="w-4 h-4 text-slate-300" />
                <span>{doorSensor.lqi} LQI</span>
              </div>
            </div>
          </div>
        </section>

        {/* PRISE CONNECTÉE (si disponible) */}
        {plug && (
          <section>
            <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                    plug.state === "ON"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "bg-slate-800 text-slate-500"
                  }`}
                >
                  <Power className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">{plug.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{plug.power} W • {plug.voltage} V</p>
                </div>
              </div>

              <button
                onClick={() => togglePlug(plug.name, plug.state)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  plug.state === "ON"
                    ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
                }`}
              >
                {plug.state === "ON" ? "Allumé" : "Éteint"}
              </button>
            </div>
          </section>
        )}

        {/* AUTRES APPAREILS APPÉRÉS */}
        {allDevices.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Autres équipements ({allDevices.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allDevices.map((d) => (
                <div
                  key={d.name}
                  className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60 flex items-center justify-between text-xs"
                >
                  <span className="font-medium text-slate-300">{d.name}</span>
                  <span className="text-slate-500">{d.info}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PI STATS BAS DE PAGE */}
        {piStats && (
          <footer className="pt-4 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>Raspberry Pi : {piStats.cpu.tempC ? `${piStats.cpu.tempC}°C` : "OK"} • CPU {piStats.cpu.usagePercent}%</span>
            <span>IP: {piStats.ip}</span>
          </footer>
        )}
      </div>

      {/* MODAL RENOMMER */}
      {renameModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <h3 className="text-sm font-semibold text-white">Renommer l'appareil</h3>
            <input
              type="text"
              value={renameModal.newName}
              onChange={(e) => setRenameModal((prev) => ({ ...prev, newName: e.target.value }))}
              className="w-full px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="Nouveau nom..."
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRenameModal({ open: false, currentName: "", newName: "" })}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Annuler
              </button>
              <button
                onClick={submitRename}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
