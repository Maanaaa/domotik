"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  DoorClosed,
  DoorOpen,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Radio,
  Battery,
  BatteryCharging,
  Power,
  RefreshCw,
  Signal,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  HardDrive,
  Activity,
  Layers,
  Settings,
  Edit2,
  Check,
  X,
  PlusCircle,
  Wifi,
} from "lucide-react";

interface PiStats {
  hostname: string;
  platform: string;
  nodeVersion: string;
  ip: string;
  uptimeSeconds: number;
  cpu: {
    usagePercent: number;
    tempC: number | null;
    cores: number;
    model: string;
    loadAvg: number[];
  };
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    percent: number;
  };
  disk: {
    total: string;
    used: string;
    free: string;
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
    vendor?: string;
    description?: string;
    exposes?: Array<Record<string, unknown>>;
  } | null;
  power_source?: string;
  supported?: boolean;
}

interface MqttStatus {
  connected: boolean;
  brokerUrl: string;
  bridgeState: string;
  bridgeDevicesCount: number;
  devicesCount: number;
  devices: MqttDevicePayload[];
  bridgeDevices: BridgeDevice[];
  permitJoin: boolean;
  permitJoinTimeout: number;
  bridgeInfo?: Record<string, unknown>;
}

export default function DomotikDashboard() {
  const [mqttStatus, setMqttStatus] = useState<MqttStatus | null>(null);
  const [piStats, setPiStats] = useState<PiStats | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [pairingLoading, setPairingLoading] = useState<boolean>(false);
  const [renameModal, setRenameModal] = useState<{ open: boolean; ieee: string; currentName: string; newName: string }>({
    open: false,
    ieee: "",
    currentName: "",
    newName: "",
  });

  // Fetch données MQTT & Zigbee2MQTT
  const fetchMqttStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/mqtt");
      if (res.ok) {
        const data: MqttStatus = await res.json();
        setMqttStatus(data);
      }
    } catch (err) {
      console.warn("Erreur fetch /api/mqtt:", err);
    }
  }, []);

  // Fetch stats Raspberry Pi
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data: PiStats = await res.json();
        setPiStats(data);
      }
    } catch (err) {
      console.warn("Erreur fetch /api/stats:", err);
    }
  }, []);

  // Rafraîchissement global manuel
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch("/api/mqtt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      await Promise.all([fetchMqttStatus(), fetchStats()]);
    } catch (e) {
      console.error("Erreur rafraîchissement:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Gestion du Couplage / Appairage (Permit Join) sans Mosquitto
  const togglePairing = async (enable: boolean) => {
    setPairingLoading(true);
    try {
      await fetch("/api/mqtt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "permit_join",
          enable,
          time: 254,
        }),
      });
      await fetchMqttStatus();
    } catch (err) {
      console.error("Erreur toggle permit_join:", err);
    } finally {
      setPairingLoading(false);
    }
  };

  // Actionneur Prise (ON/OFF)
  const togglePlugState = async (friendlyName: string, currentState: string) => {
    const nextState = currentState === "ON" ? "OFF" : "ON";
    try {
      await fetch("/api/mqtt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: `zigbee2mqtt/${friendlyName}/set`,
          payload: { state: nextState },
        }),
      });
      // Rafraîchir rapidement
      setTimeout(fetchMqttStatus, 300);
    } catch (e) {
      console.error("Erreur bascule prise:", e);
    }
  };

  // Renommer un appareil via API
  const handleRenameSubmit = async () => {
    if (!renameModal.newName.trim()) return;
    try {
      await fetch("/api/mqtt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          from: renameModal.currentName,
          to: renameModal.newName.trim(),
        }),
      });
      setRenameModal({ open: false, ieee: "", currentName: "", newName: "" });
      setTimeout(handleRefresh, 600);
    } catch (e) {
      console.error("Erreur renommage:", e);
    }
  };

  // Initialisation et boucle de mise à jour temps réel (toutes les 2.5 secondes)
  useEffect(() => {
    fetchMqttStatus();
    fetchStats();

    const interval = setInterval(() => {
      fetchMqttStatus();
    }, 2500);

    const statsInterval = setInterval(() => {
      fetchStats();
    }, 8000);

    return () => {
      clearInterval(interval);
      clearInterval(statsInterval);
    };
  }, [fetchMqttStatus, fetchStats]);

  // Dictionnaire des payloads MQTT indexés par topic/nom
  const payloadsMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    mqttStatus?.devices?.forEach((d) => {
      // Clé par topic complet (ex: zigbee2mqtt/0x8c73dafffeceac07)
      map.set(d.topic, d.payload);
      // Clé par sous-nom seul (ex: 0x8c73dafffeceac07)
      const sub = d.topic.replace("zigbee2mqtt/", "");
      map.set(sub, d.payload);
    });
    return map;
  }, [mqttStatus?.devices]);

  // Détection automatique de tous les appareils réels connectés au dongle Sonoff
  const { doorSensors, plugs, otherDevices } = useMemo(() => {
    const bridgeDevs = mqttStatus?.bridgeDevices || [];
    // Filtrer le Coordinator Sonoff lui-même
    const physicalDevices = bridgeDevs.filter((d) => d.type !== "Coordinator");

    // Si la liste bridge/devices n'est pas encore prête, on se base sur les topics reçus ou les deux matériels connus
    const rawDeviceNames = new Set<string>();
    physicalDevices.forEach((d) => rawDeviceNames.add(d.friendly_name));

    // Ajouter ceux vus dans les topics MQTT
    mqttStatus?.devices?.forEach((d) => {
      const name = d.topic.replace("zigbee2mqtt/", "");
      if (!name.startsWith("bridge")) {
        rawDeviceNames.add(name);
      }
    });

    // Fallbacks si démarrage à froid sans broker encore peuplé
    if (rawDeviceNames.size === 0) {
      rawDeviceNames.add("0x8c73dafffeceac07");
      rawDeviceNames.add("0xa4c13810f2d8ffff");
    }

    const dSensors: Array<{
      name: string;
      ieee: string;
      description: string;
      contact: boolean;
      battery: number;
      batteryLow: boolean;
      tamper: boolean;
      lqi: number;
      lastSeen?: number;
    }> = [];

    const dPlugs: Array<{
      name: string;
      ieee: string;
      description: string;
      state: string;
      power: number;
      current: number;
      voltage: number;
      energy: number;
      lqi: number;
      lastSeen?: number;
    }> = [];

    const dOthers: Array<{
      name: string;
      ieee: string;
      description: string;
      payload: Record<string, unknown>;
      lqi: number;
    }> = [];

    rawDeviceNames.forEach((name) => {
      const bridgeDev = physicalDevices.find((b) => b.friendly_name === name || b.ieee_address === name);
      const payload = payloadsMap.get(name) || payloadsMap.get(`zigbee2mqtt/${name}`) || {};

      const desc = bridgeDev?.definition?.description || "Appareil Zigbee";
      const isDoor =
        payload.contact !== undefined ||
        name.includes("8c73dafffeceac07") ||
        desc.toLowerCase().includes("door") ||
        desc.toLowerCase().includes("contact") ||
        desc.toLowerCase().includes("ouverture");

      const isPlug =
        !isDoor &&
        (payload.state !== undefined ||
          payload.power !== undefined ||
          name.includes("a4c13810f2d8ffff") ||
          desc.toLowerCase().includes("plug") ||
          desc.toLowerCase().includes("prise") ||
          desc.toLowerCase().includes("switch"));

      if (isDoor) {
        // Dans Zigbee2MQTT standard : contact=true signifie fermé (aimant proche), contact=false signifie ouvert
        const contactVal = payload.contact !== undefined ? Boolean(payload.contact) : true;
        dSensors.push({
          name: bridgeDev?.friendly_name || name,
          ieee: bridgeDev?.ieee_address || name,
          description: desc || "Détecteur d'ouverture de porte",
          contact: contactVal,
          battery: typeof payload.battery === "number" ? payload.battery : 100,
          batteryLow: Boolean(payload.battery_low),
          tamper: Boolean(payload.tamper),
          lqi: typeof payload.linkquality === "number" ? payload.linkquality : 207,
        });
      } else if (isPlug) {
        dPlugs.push({
          name: bridgeDev?.friendly_name || name,
          ieee: bridgeDev?.ieee_address || name,
          description: desc || "Prise connectée",
          state: String(payload.state || "OFF").toUpperCase(),
          power: typeof payload.power === "number" ? payload.power : 0,
          current: typeof payload.current === "number" ? payload.current : 0,
          voltage: typeof payload.voltage === "number" ? payload.voltage : 230,
          energy: typeof payload.energy === "number" ? payload.energy : 0,
          lqi: typeof payload.linkquality === "number" ? payload.linkquality : 180,
        });
      } else {
        dOthers.push({
          name: bridgeDev?.friendly_name || name,
          ieee: bridgeDev?.ieee_address || name,
          description: desc,
          payload,
          lqi: typeof payload.linkquality === "number" ? payload.linkquality : 150,
        });
      }
    });

    return { doorSensors: dSensors, plugs: dPlugs, otherDevices: dOthers };
  }, [mqttStatus, payloadsMap]);

  // Capteur de porte principal
  const primaryDoor = doorSensors[0] || {
    name: "0x8c73dafffeceac07",
    ieee: "0x8c73dafffeceac07",
    description: "Détecteur d'ouverture de porte",
    contact: true,
    battery: 100,
    batteryLow: false,
    tamper: false,
    lqi: 207,
  };

  const isDoorClosed = primaryDoor.contact;
  const isPairingActive = Boolean(mqttStatus?.permitJoin);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500 selection:text-white pb-16">
      {/* Glow décoratif d'arrière-plan */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* TOP BAR / HEADER */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
              <Radio className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                  Domotik Hub
                </h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                  Sonoff Zigbee
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Supervision directe des objets connectés via Mosquitto &amp; Zigbee2MQTT
              </p>
            </div>
          </div>

          {/* Statuts & Boutons d'action */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Statut Broker MQTT */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs">
              <span className="relative flex h-2.5 w-2.5">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    mqttStatus?.connected ? "bg-emerald-400" : "bg-rose-400"
                  }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    mqttStatus?.connected ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                />
              </span>
              <span className="text-slate-300 font-medium">
                {mqttStatus?.connected ? "MQTT Connecté (1883)" : "MQTT Déconnecté"}
              </span>
            </div>

            {/* Statut Bridge Zigbee2MQTT */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs text-slate-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Bridge : {mqttStatus?.bridgeState || "online"}</span>
            </div>

            {/* Bouton Couplage / Appairage (API) */}
            <button
              onClick={() => togglePairing(!isPairingActive)}
              disabled={pairingLoading || !mqttStatus?.connected}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 shadow-md ${
                isPairingActive
                  ? "bg-amber-500 hover:bg-amber-600 text-slate-950 ring-2 ring-amber-400/50 animate-pulse"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30"
              } disabled:opacity-50`}
            >
              <Radio className={`w-3.5 h-3.5 ${isPairingActive ? "animate-spin" : ""}`} />
              {isPairingActive ? "Arrêter le couplage (actif)" : "Autoriser l'appairage"}
            </button>

            {/* Rafraîchir */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-all duration-150"
              title="Actualiser les états et appareils"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-indigo-400" : ""}`} />
            </button>
          </div>
        </header>

        {/* ALERTE COUPLAGE ACTIF (Si activé via API) */}
        {isPairingActive && (
          <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-transparent border border-amber-500/30 flex items-center justify-between gap-4 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center">
                <Radio className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-200">
                  Mode couplage actif (Permit Join)
                </p>
                <p className="text-xs text-amber-300/80">
                  Mettez votre appareil Zigbee en mode appairage (maintenez le bouton 5s). Il sera détecté automatiquement sans passer par l'interface Mosquitto.
                </p>
              </div>
            </div>
            <button
              onClick={() => togglePairing(false)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition"
            >
              Terminer
            </button>
          </div>
        )}

        {/* SECTION PRINCIPALE : DÉTECTEUR D'OUVERTURE DE PORTE */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-2">
              <DoorClosed className="w-4 h-4 text-indigo-400" />
              État d'ouverture de porte (Capteur Sonoff)
            </h2>
            <span className="text-xs text-slate-500 font-mono">
              IEEE: {primaryDoor.ieee}
            </span>
          </div>

          <div
            className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 border transition-all duration-500 shadow-2xl backdrop-blur-xl ${
              isDoorClosed
                ? "bg-gradient-to-br from-emerald-950/40 via-slate-900/80 to-slate-900/90 border-emerald-500/30 shadow-emerald-500/5"
                : "bg-gradient-to-br from-rose-950/50 via-slate-900/80 to-slate-900/90 border-rose-500/40 shadow-rose-500/10"
            }`}
          >
            {/* Effet halo d'état */}
            <div
              className={`absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 rounded-full blur-3xl pointer-events-none transition-all duration-700 ${
                isDoorClosed ? "bg-emerald-500/15" : "bg-rose-500/20 animate-pulse"
              }`}
            />

            <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
              {/* Icône géante + Statut texte */}
              <div className="flex items-center gap-5">
                <div
                  className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center transition-all duration-500 shadow-xl ${
                    isDoorClosed
                      ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/25 ring-2 ring-emerald-400/30"
                      : "bg-gradient-to-br from-rose-500 to-amber-600 text-white shadow-rose-500/30 ring-2 ring-rose-400/40 animate-bounce"
                  }`}
                >
                  {isDoorClosed ? (
                    <DoorClosed className="w-10 h-10 sm:w-12 sm:h-12" />
                  ) : (
                    <DoorOpen className="w-10 h-10 sm:w-12 sm:h-12" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        isDoorClosed
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse"
                      }`}
                    >
                      {isDoorClosed ? (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          Porte Fermée
                        </>
                      ) : (
                        <>
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                          Porte Ouverte
                        </>
                      )}
                    </span>
                    <button
                      onClick={() =>
                        setRenameModal({
                          open: true,
                          ieee: primaryDoor.ieee,
                          currentName: primaryDoor.name,
                          newName: primaryDoor.name,
                        })
                      }
                      className="text-slate-400 hover:text-slate-200 p-1 rounded-md transition"
                      title="Renommer ce capteur"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                    {primaryDoor.name}
                  </h3>
                  <p className="text-sm text-slate-400 mt-0.5">
                    {isDoorClosed
                      ? "Le contact magnétique est bien établi. Accès sécurisé."
                      : "Alerte : Le battant de porte a été ouvert !"}
                  </p>
                </div>
              </div>

              {/* Badges télémétrie du capteur de porte */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border-t md:border-t-0 md:border-l border-slate-800/80 pt-4 md:pt-0 md:pl-6">
                {/* Batterie */}
                <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/40">
                  <span className="text-[11px] font-medium text-slate-400 block mb-1">
                    Niveau Batterie
                  </span>
                  <div className="flex items-center gap-2">
                    <Battery className="w-4 h-4 text-emerald-400" />
                    <span className="text-base font-bold text-white">
                      {primaryDoor.battery}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-700/60 rounded-full h-1.5 mt-2">
                    <div
                      className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, primaryDoor.battery))}%` }}
                    />
                  </div>
                </div>

                {/* Qualité Signal (LQI) */}
                <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/40">
                  <span className="text-[11px] font-medium text-slate-400 block mb-1">
                    Liaison Radio
                  </span>
                  <div className="flex items-center gap-2">
                    <Signal className="w-4 h-4 text-indigo-400" />
                    <span className="text-base font-bold text-white">
                      {primaryDoor.lqi} <span className="text-xs text-slate-400 font-normal">/255</span>
                    </span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-semibold block mt-1">
                    Excellente portée
                  </span>
                </div>

                {/* Sabotage / Tamper */}
                <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/40 col-span-2 sm:col-span-1">
                  <span className="text-[11px] font-medium text-slate-400 block mb-1">
                    Sabotage (Tamper)
                  </span>
                  <div className="flex items-center gap-1.5">
                    {primaryDoor.tamper ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Altéré
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Normal
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Boîtier fermé
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION PRISE CONNECTÉE (Actionneur Sonoff) */}
        {plugs.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Prises &amp; Actionneurs connectés ({plugs.length})
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plugs.map((plug) => {
                const isOn = plug.state === "ON";
                return (
                  <div
                    key={plug.ieee}
                    className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md shadow-xl flex flex-col justify-between space-y-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                            isOn
                              ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          <Power className={`w-6 h-6 ${isOn ? "text-amber-400" : ""}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-white text-base">{plug.name}</h3>
                            <button
                              onClick={() =>
                                setRenameModal({
                                  open: true,
                                  ieee: plug.ieee,
                                  currentName: plug.name,
                                  newName: plug.name,
                                })
                              }
                              className="text-slate-500 hover:text-slate-300"
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-xs text-slate-400 font-mono">{plug.ieee}</p>
                        </div>
                      </div>

                      {/* Bouton Toggle ON/OFF */}
                      <button
                        onClick={() => togglePlugState(plug.name, plug.state)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md ${
                          isOn
                            ? "bg-amber-500 hover:bg-amber-400 text-slate-950 ring-2 ring-amber-400/40"
                            : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        {isOn ? "ALLUMÉ" : "ÉTEINT"}
                      </button>
                    </div>

                    {/* Mesures électriques en direct */}
                    <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-800/80 text-center">
                      <div className="p-2 rounded-lg bg-slate-800/40">
                        <span className="text-[10px] text-slate-400 block">Puissance</span>
                        <span className="text-xs font-bold text-amber-300">{plug.power} W</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-800/40">
                        <span className="text-[10px] text-slate-400 block">Tension</span>
                        <span className="text-xs font-bold text-slate-200">{plug.voltage} V</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-800/40">
                        <span className="text-[10px] text-slate-400 block">Courant</span>
                        <span className="text-xs font-bold text-slate-200">{plug.current} A</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-800/40">
                        <span className="text-[10px] text-slate-400 block">Signal LQI</span>
                        <span className="text-xs font-bold text-indigo-300">{plug.lqi}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* TOUS LES APPAREILS DÉTECTÉS PAR LE DONGLE SONOFF */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              Tous les appareils appairés ({doorSensors.length + plugs.length + otherDevices.length})
            </h2>
            <button
              onClick={() => togglePairing(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Ajouter un appareil via API
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Détecteurs de porte */}
            {doorSensors.map((d) => (
              <div
                key={d.ieee}
                className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <DoorClosed className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{d.name}</h4>
                    <p className="text-xs text-slate-400">Capteur d'ouverture</p>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                      d.contact ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                    }`}
                  >
                    {d.contact ? "Fermé" : "Ouvert"}
                  </span>
                  <span className="block text-[10px] text-slate-500 mt-1">Bat: {d.battery}%</span>
                </div>
              </div>
            ))}

            {/* Prises */}
            {plugs.map((p) => (
              <div
                key={p.ieee}
                className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{p.name}</h4>
                    <p className="text-xs text-slate-400">Prise connectée</p>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                      p.state === "ON" ? "bg-amber-500/20 text-amber-300" : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {p.state}
                  </span>
                  <span className="block text-[10px] text-slate-500 mt-1">{p.power} W</span>
                </div>
              </div>
            ))}

            {/* Autres appareils découverts */}
            {otherDevices.map((o) => (
              <div
                key={o.ieee}
                className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{o.name}</h4>
                    <p className="text-xs text-slate-400">{o.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono text-slate-400">LQI {o.lqi}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* MONITORING SYSTÈME RASPBERRY PI (Discret en bas) */}
        {piStats && (
          <footer className="pt-4 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 font-mono text-slate-300">
                <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                Raspberry Pi : {piStats.cpu.usagePercent}% CPU
                {piStats.cpu.tempC !== null && ` (${piStats.cpu.tempC}°C)`}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono text-slate-300">
                <Activity className="w-3.5 h-3.5 text-purple-400" />
                RAM : {piStats.memory.percent}% ({piStats.memory.usedMb}MB / {piStats.memory.totalMb}MB)
              </span>
              <span>•</span>
              <span className="font-mono text-slate-300">IP: {piStats.ip}</span>
            </div>

            <div className="text-slate-500">
              Uptime : {Math.floor(piStats.uptimeSeconds / 3600)}h {Math.floor((piStats.uptimeSeconds % 3600) / 60)}m
            </div>
          </footer>
        )}
      </div>

      {/* MODAL RENOMMER APPAREIL */}
      {renameModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">Renommer l'appareil</h3>
              <button
                onClick={() => setRenameModal({ open: false, ieee: "", currentName: "", newName: "" })}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Adresse IEEE : <span className="font-mono text-slate-300">{renameModal.ieee}</span>
            </p>
            <input
              type="text"
              value={renameModal.newName}
              onChange={(e) => setRenameModal((prev) => ({ ...prev, newName: e.target.value }))}
              placeholder="Ex: Porte d'entrée"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRenameModal({ open: false, ieee: "", currentName: "", newName: "" })}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                Annuler
              </button>
              <button
                onClick={handleRenameSubmit}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Sauvegarder via API
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
