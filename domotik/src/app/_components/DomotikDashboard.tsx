"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Cpu,
  Radio,
  Thermometer,
  Zap,
  Lightbulb,
  ShieldCheck,
  ShieldAlert,
  Tv,
  Lock,
  Sliders,
  Moon,
  Activity,
  Droplets,
  RefreshCw,
  Sparkles,
  Server,
  Home as HomeIcon,
  CheckCircle2,
  TrendingDown,
  Shield,
  ExternalLink,
  Plus,
  Trash2,
  Edit,
  Save,
  Check,
  Globe,
  HardDrive,
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

interface MqttStatus {
  connected: boolean;
  brokerUrl: string;
  bridgeState: string;
  bridgeDevicesCount: number;
  devicesCount: number;
  devices: MqttDevicePayload[];
}

interface ServiceShortcut {
  id: string;
  name: string;
  url: string;
  category?: string;
  color?: string;
}

interface Device {
  id: string;
  name: string;
  room: string;
  type: "light" | "plug" | "climate" | "sensor" | "lock";
  state: boolean;
  value?: string | number;
  unit?: string;
  protocol: "Zigbee 3.0" | "Wi-Fi" | "Bluetooth";
  battery?: number;
  linkquality?: number;
  powerUsage?: number;
  topic?: string;
}

export default function DomotikDashboard() {
  const [selectedRoom, setSelectedRoom] = useState<string>("Tous");
  const [alarmArmed, setAlarmArmed] = useState<boolean>(true);
  const [targetTemp, setTargetTemp] = useState<number>(20.5);
  const [hvacMode, setHvacMode] = useState<"heat" | "cool" | "auto" | "off">("heat");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Stats du système Pi (Live depuis /api/stats)
  const [piStats, setPiStats] = useState<PiStats | null>(null);

  // État MQTT (Live depuis /api/mqtt)
  const [mqttStatus, setMqttStatus] = useState<MqttStatus | null>(null);

  // Services Raccourcis et Notes (depuis /api/config)
  const [services, setServices] = useState<ServiceShortcut[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [isSavedNotes, setIsSavedNotes] = useState<boolean>(false);

  // Modal Service
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState<string>("");
  const [formUrl, setFormUrl] = useState<string>("");
  const [formCategory, setFormCategory] = useState<string>("Général");
  const [formColor, setFormColor] = useState<string>("#10b981");

  // Liste des équipements Domotique
  const [devices, setDevices] = useState<Device[]>([
    {
      id: "dev-1",
      name: "Plafonnier principal",
      room: "Salon",
      type: "light",
      state: true,
      value: 80,
      unit: "%",
      protocol: "Zigbee 3.0",
      linkquality: 142,
      topic: "zigbee2mqtt/Salon_Plafonnier",
    },
    {
      id: "dev-2",
      name: "Ruban LED TV (RGB)",
      room: "Salon",
      type: "light",
      state: true,
      value: 65,
      unit: "%",
      protocol: "Zigbee 3.0",
      linkquality: 168,
      topic: "zigbee2mqtt/Salon_Led_TV",
    },
    {
      id: "dev-3",
      name: "Prise Multi-TV",
      room: "Salon",
      type: "plug",
      state: true,
      powerUsage: 124,
      protocol: "Zigbee 3.0",
      linkquality: 110,
      topic: "zigbee2mqtt/Salon_Prise_TV",
    },
    {
      id: "dev-4",
      name: "Thermostat Central",
      room: "Salon",
      type: "climate",
      state: true,
      value: 20.8,
      unit: "°C",
      protocol: "Zigbee 3.0",
      battery: 89,
      linkquality: 180,
      topic: "zigbee2mqtt/Thermostat_Salon",
    },
    {
      id: "dev-5",
      name: "Suspension Îlot",
      room: "Cuisine",
      type: "light",
      state: false,
      value: 0,
      unit: "%",
      protocol: "Zigbee 3.0",
      linkquality: 130,
      topic: "zigbee2mqtt/Cuisine_Ilot",
    },
    {
      id: "dev-6",
      name: "Machine à Café",
      room: "Cuisine",
      type: "plug",
      state: false,
      powerUsage: 0,
      protocol: "Zigbee 3.0",
      linkquality: 154,
      topic: "zigbee2mqtt/Cuisine_Prise_Cafe",
    },
    {
      id: "dev-7",
      name: "Détecteur de Mouvement",
      room: "Couloir",
      type: "sensor",
      state: true,
      value: "Mouvement (il y a 2m)",
      protocol: "Zigbee 3.0",
      battery: 92,
      linkquality: 190,
      topic: "zigbee2mqtt/Couloir_Motion",
    },
    {
      id: "dev-8",
      name: "Serrure Connectée Porte",
      room: "Entrée",
      type: "lock",
      state: true,
      protocol: "Zigbee 3.0",
      battery: 76,
      linkquality: 160,
      topic: "zigbee2mqtt/Entree_Serrure",
    },
  ]);

  // Routines
  const [routines, setRoutines] = useState([
    {
      id: "rot-1",
      name: "Mode Nuit",
      description: "Éteint toutes les lumières & arme l'alarme",
      icon: "Moon",
      active: false,
    },
    {
      id: "rot-2",
      name: "Soirée Cinéma",
      description: "Tamise le Salon & allume le ruban TV",
      icon: "Tv",
      active: true,
    },
    {
      id: "rot-3",
      name: "Départ Maison",
      description: "Coupe prises inutiles & verrouille la porte",
      icon: "Shield",
      active: false,
    },
  ]);

  // Fetch Stats système
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        setPiStats(data);
      }
    } catch (e) {
      console.warn("Erreur fetch stats:", e);
    }
  }, []);

  // Fetch MQTT
  const fetchMqtt = useCallback(async () => {
    try {
      const res = await fetch("/api/mqtt");
      if (res.ok) {
        const data: MqttStatus = await res.json();
        setMqttStatus(data);

        // Mettre à jour les devices localement si payload MQTT reçu
        if (data.devices && data.devices.length > 0) {
          setDevices((prev) =>
            prev.map((dev) => {
              const match = data.devices.find((m) => m.topic === dev.topic);
              if (match && match.payload) {
                const stateVal = match.payload.state;
                const isStateOn = stateVal === "ON" || stateVal === true;
                const linkq = match.payload.linkquality as number | undefined;
                const batt = match.payload.battery as number | undefined;
                const temp = match.payload.temperature as number | undefined;

                return {
                  ...dev,
                  state: typeof isStateOn === "boolean" ? isStateOn : dev.state,
                  linkquality: linkq !== undefined ? linkq : dev.linkquality,
                  battery: batt !== undefined ? batt : dev.battery,
                  value: temp !== undefined ? `${temp}°C` : dev.value,
                };
              }
              return dev;
            })
          );
        }
      }
    } catch (e) {
      console.warn("Erreur fetch MQTT:", e);
    }
  }, []);

  // Fetch Config (services & notes)
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.services)) setServices(data.services);
        if (data.notes !== undefined) setNotes(data.notes);
      }
    } catch (e) {
      console.warn("Erreur fetch config:", e);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchMqtt();
    fetchConfig();

    const intervalStats = setInterval(fetchStats, 3000);
    const intervalMqtt = setInterval(fetchMqtt, 3000);

    return () => {
      clearInterval(intervalStats);
      clearInterval(intervalMqtt);
    };
  }, [fetchStats, fetchMqtt, fetchConfig]);

  // Sauvegarder les services ou notes
  const saveConfigToServer = async (
    newServices?: ServiceShortcut[],
    newNotes?: string
  ) => {
    try {
      const payload = {
        services: newServices !== undefined ? newServices : services,
        notes: newNotes !== undefined ? newNotes : notes,
      };

      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setIsSavedNotes(true);
        setTimeout(() => setIsSavedNotes(false), 2000);
      }
    } catch (e) {
      console.error("Erreur sauvegarde config:", e);
    }
  };

  // Basculer un appareil Zigbee via MQTT
  const toggleDevice = async (id: string) => {
    const dev = devices.find((d) => d.id === id);
    if (!dev) return;

    const nextState = !dev.state;
    setDevices((prev) =>
      prev.map((d) => (d.id === id ? { ...d, state: nextState } : d))
    );

    if (dev.topic) {
      const setTopic = `${dev.topic}/set`;
      const payload = { state: nextState ? "ON" : "OFF" };
      try {
        await fetch("/api/mqtt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: setTopic, payload }),
        });
      } catch (e) {
        console.error("Erreur envoi commande MQTT:", e);
      }
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchStats();
    fetchMqtt();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleAllLightsOff = () => {
    setDevices((prev) =>
      prev.map((d) => (d.type === "light" ? { ...d, state: false } : d))
    );
  };

  // Modal Handlers
  const handleOpenAddModal = () => {
    setEditingId(null);
    setFormName("");
    setFormUrl("http://");
    setFormCategory("Général");
    setFormColor("#10b981");
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (s: ServiceShortcut) => {
    setEditingId(s.id);
    setFormName(s.name);
    setFormUrl(s.url);
    setFormCategory(s.category || "Général");
    setFormColor(s.color || "#10b981");
    setIsModalOpen(true);
  };

  const handleDeleteService = (id: string) => {
    const updated = services.filter((s) => s.id !== id);
    setServices(updated);
    saveConfigToServer(updated, undefined);
  };

  const handleSaveService = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formUrl.trim()) return;

    let updated: ServiceShortcut[] = [];
    if (editingId) {
      updated = services.map((s) =>
        s.id === editingId
          ? { ...s, name: formName, url: formUrl, category: formCategory, color: formColor }
          : s
      );
    } else {
      const newService: ServiceShortcut = {
        id: Date.now().toString(),
        name: formName,
        url: formUrl,
        category: formCategory,
        color: formColor,
      };
      updated = [...services, newService];
    }

    setServices(updated);
    saveConfigToServer(updated, undefined);
    setIsModalOpen(false);
  };

  const filteredDevices =
    selectedRoom === "Tous"
      ? devices
      : devices.filter((d) => d.room === selectedRoom);

  const rooms = ["Tous", "Salon", "Cuisine", "Chambre", "Couloir", "Entrée"];
  const activeLightsCount = devices.filter((d) => d.type === "light" && d.state).length;
  const totalPowerConsumption = devices
    .filter((d) => d.state && d.powerUsage)
    .reduce((acc, curr) => acc + (curr.powerUsage || 0), 45);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Background ambient light effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* HEADER */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 p-5 rounded-3xl shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-cyan-500 text-slate-950 font-bold shadow-lg shadow-emerald-500/20">
              <HomeIcon className="w-6 h-6" />
              <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-slate-900"></span>
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">
                  Domotik<span className="text-emerald-400">Hub</span>
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center gap-1.5">
                  <Radio className="w-3 h-3 animate-pulse" />
                  MQTT & Zigbee2MQTT Active
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                <span>{piStats?.hostname || "Raspberry Pi"}</span>
                <span>•</span>
                <span className="text-slate-300 font-mono">
                  {piStats?.ip || "192.168.1.100"}
                </span>
              </p>
            </div>
          </div>

          {/* Quick Actions & Status */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleRefresh}
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/60 transition-all active:scale-95"
              title="Rafraîchir les données"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`}
              />
            </button>

            <button
              onClick={handleAllLightsOff}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-amber-300 hover:text-amber-200 border border-amber-500/20 transition-all flex items-center gap-2 active:scale-95"
            >
              <Lightbulb className="w-4 h-4 text-amber-400" />
              Éteindre lumières ({activeLightsCount})
            </button>

            <button
              onClick={() => setAlarmArmed(!alarmArmed)}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 border shadow-lg active:scale-95 ${
                alarmArmed
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30 shadow-emerald-500/10"
                  : "bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30 shadow-red-500/10"
              }`}
            >
              {alarmArmed ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Alarme Armée
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  Alarme Désactivée
                </>
              )}
            </button>
          </div>
        </header>

        {/* METRICS DASHBOARD CARDS (Real Hardware Stats) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Raspberry Pi CPU Temp & Usage */}
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700/60 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Processeur Raspberry Pi</span>
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Cpu className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-white">
                  {piStats?.cpu.tempC !== null ? `${piStats?.cpu.tempC}°C` : "N/A"}
                </span>
                <span className="text-xs text-slate-400">Temp CPU</span>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Charge CPU</span>
                  <span className="text-slate-200 font-mono">
                    {piStats?.cpu.usagePercent ?? 0}%
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-400 h-full rounded-full transition-all duration-500"
                    style={{ width: `${piStats?.cpu.usagePercent ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
              <span>{piStats?.cpu.cores ?? 4} Cœurs</span>
              <span>Uptime: {formatUptime(piStats?.uptimeSeconds ?? 0)}</span>
            </div>
          </div>

          {/* Card 2: Memory & Disk Usage */}
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700/60 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">RAM & Stockage</span>
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <HardDrive className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-white">
                  {piStats?.memory.percent ?? 0}%
                </span>
                <span className="text-xs text-slate-400">RAM Utilisée</span>
              </div>
              <p className="text-xs text-cyan-300/80 mt-1">
                {piStats?.memory.usedMb ?? 0} Mo / {piStats?.memory.totalMb ?? 0} Mo
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Disque</span>
              <span className="text-emerald-400 font-mono">
                {piStats?.disk.used ?? "0G"} / {piStats?.disk.total ?? "0G"} ({piStats?.disk.percent ?? 0}%)
              </span>
            </div>
          </div>

          {/* Card 3: MQTT & Zigbee Mesh */}
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700/60 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Broker MQTT / Zigbee</span>
              <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
                <Radio className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-white">
                  {mqttStatus?.connected ? "Connecté" : "Hors ligne"}
                </span>
              </div>
              <p className="text-xs text-violet-300/80 mt-1 font-mono truncate">
                {mqttStatus?.brokerUrl || "mqtt://localhost:1883"}
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Bridge Zigbee2MQTT</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> {mqttStatus?.bridgeState || "online"}
              </span>
            </div>
          </div>

          {/* Card 4: Consommation */}
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700/60 transition-all group">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">Puissance Absorbée</span>
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Zap className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-white">{totalPowerConsumption}</span>
                <span className="text-xs text-amber-400 font-semibold">Watts</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Base Pi + modules actifs
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1 text-emerald-400">
                <TrendingDown className="w-3 h-3" /> -10% vs hier
              </span>
              <span>3 prises Zigbee</span>
            </div>
          </div>
        </div>

        {/* SERVICES RACCOURCIS SECTION (Repris de PiDash / pirasp) */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                Services & Raccourcis Serveur
              </h2>
              <p className="text-xs text-slate-400">Applications hébergées sur le Raspberry Pi</p>
            </div>

            <button
              onClick={handleOpenAddModal}
              className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              <Plus className="w-4 h-4" /> Nouveau Service
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {services.map((service) => {
              const color = service.color || "#10b981";
              return (
                <div
                  key={service.id}
                  className="bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 rounded-xl p-3.5 flex flex-col justify-between gap-3 transition-all hover:scale-[1.02]"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-md"
                      style={{
                        backgroundColor: `${color}20`,
                        borderColor: `${color}40`,
                        color: color,
                        borderWidth: "1px",
                      }}
                    >
                      {service.name ? service.name.charAt(0).toUpperCase() : "S"}
                    </div>
                    <div className="overflow-hidden">
                      <h4 className="text-xs font-semibold text-white truncate">
                        {service.name}
                      </h4>
                      <span className="text-[10px] text-slate-400 truncate block">
                        {service.category || "Général"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                    <a
                      href={service.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
                    >
                      Ouvrir <ExternalLink className="w-3 h-3" />
                    </a>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEditModal(service)}
                        className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
                        title="Modifier"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteService(service.id)}
                        className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* MAIN SECTION: DEVICES GRID & THERMOSTAT / NOTES */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (2 cols): Devices & Controls */}
          <div className="lg:col-span-2 space-y-6">
            {/* Room Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
              {rooms.map((room) => (
                <button
                  key={room}
                  onClick={() => setSelectedRoom(room)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                    selectedRoom === room
                      ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 font-bold"
                      : "bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800/80 hover:border-slate-700"
                  }`}
                >
                  {room === "Tous" ? "Toutes les pièces" : room}
                </button>
              ))}
            </div>

            {/* Devices Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredDevices.map((device) => {
                return (
                  <div
                    key={device.id}
                    className={`relative p-4 rounded-2xl border transition-all duration-200 flex flex-col justify-between gap-4 ${
                      device.state
                        ? "bg-slate-900/80 border-emerald-500/40 shadow-lg shadow-emerald-500/5"
                        : "bg-slate-900/30 border-slate-800/80 opacity-75 hover:opacity-100"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-3 rounded-xl transition-colors ${
                            device.state
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-slate-800/60 text-slate-400 border border-slate-700/40"
                          }`}
                        >
                          {device.type === "light" && <Lightbulb className="w-5 h-5" />}
                          {device.type === "plug" && <Zap className="w-5 h-5" />}
                          {device.type === "climate" && <Thermometer className="w-5 h-5" />}
                          {device.type === "sensor" && <Activity className="w-5 h-5" />}
                          {device.type === "lock" && <Lock className="w-5 h-5" />}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-white">
                            {device.name}
                          </h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-400">{device.room}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                              {device.protocol}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Toggle Button */}
                      {device.type !== "sensor" && (
                        <button
                          onClick={() => toggleDevice(device.id)}
                          className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none flex items-center ${
                            device.state ? "bg-emerald-500" : "bg-slate-700"
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded-full bg-slate-950 shadow-md transform transition-transform duration-200 ease-in-out ${
                              device.state ? "translate-x-6" : "translate-x-0"
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {/* Additional Details & Controls */}
                    <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
                      <div>
                        {device.type === "light" && device.state && (
                          <span className="text-emerald-300 font-medium">
                            Luminosité: {device.value}%
                          </span>
                        )}
                        {device.type === "plug" && (
                          <span className="text-amber-300 font-medium">
                            {device.state ? `${device.powerUsage} W` : "Inactif"}
                          </span>
                        )}
                        {device.type === "sensor" && (
                          <span className="text-cyan-300 font-medium">
                            {device.value}
                          </span>
                        )}
                        {device.type === "climate" && (
                          <span className="text-rose-300 font-medium">
                            Mesuré: {device.value} {device.unit}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        {device.battery !== undefined && (
                          <span>Batt: {device.battery}%</span>
                        )}
                        <span>LQI: {device.linkquality}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Climate Adjuster Widget */}
            <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <Sliders className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Contrôle Thermostat Zigbee
                    </h3>
                    <p className="text-xs text-slate-400">Régulation du chauffage global</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
                  <button
                    onClick={() => setHvacMode("heat")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      hvacMode === "heat"
                        ? "bg-rose-500 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Chauffer
                  </button>
                  <button
                    onClick={() => setHvacMode("auto")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      hvacMode === "auto"
                        ? "bg-emerald-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Auto Eco
                  </button>
                  <button
                    onClick={() => setHvacMode("off")}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      hvacMode === "off"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Off
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                <button
                  onClick={() => setTargetTemp((t) => Number((t - 0.5).toFixed(1)))}
                  className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-lg flex items-center justify-center transition-all active:scale-95 border border-slate-700"
                >
                  -
                </button>

                <div className="text-center">
                  <span className="text-3xl font-extrabold text-white tracking-tight">
                    {targetTemp.toFixed(1)}°C
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">Température Consigne</p>
                </div>

                <button
                  onClick={() => setTargetTemp((t) => Number((t + 0.5).toFixed(1)))}
                  className="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-lg flex items-center justify-center transition-all active:scale-95 border border-slate-700"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Right Column (1 col): Pense-bête & Hardware Specs */}
          <div className="space-y-6">
            {/* PENSE-BÊTE & NOTES (Repris de pirasp) */}
            <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Pense-bête & Notes
                </h3>
                {isSavedNotes && (
                  <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Enregistré !
                  </span>
                )}
              </div>

              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  saveConfigToServer(undefined, e.target.value);
                }}
                rows={6}
                placeholder="Écrivez vos notes ici... (auto-sauvegardé)"
                className="w-full bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60 resize-none font-mono"
              />
            </div>

            {/* Hardware & Network Specs */}
            <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-cyan-400" />
                Matériel & Spécifications
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Hostname</span>
                  <span className="text-slate-200 font-mono">
                    {piStats?.hostname || "raspberrypi"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Plateforme</span>
                  <span className="text-slate-200 font-mono text-[11px] truncate max-w-[180px]">
                    {piStats?.platform || "Linux arm64"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Node.js</span>
                  <span className="text-slate-200 font-mono">
                    {piStats?.nodeVersion || "v20.x"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">IP Locale</span>
                  <span className="text-emerald-400 font-mono font-semibold">
                    {piStats?.ip || "192.168.1.100"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Zigbee Broker</span>
                  <span className="text-violet-400 font-mono">
                    {mqttStatus?.connected ? "Connecté (1883)" : "Reconnexion..."}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL AJOUT / EDIT SERVICE */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">
              {editingId ? "Modifier le service" : "Ajouter un service"}
            </h3>

            <form onSubmit={handleSaveService} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Nom du Service</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ex: Home Assistant"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">URL d&apos;accès</label>
                <input
                  type="text"
                  required
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="http://192.168.1.100:8123"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Catégorie</label>
                <input
                  type="text"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  placeholder="Domotique, Réseau, Médias..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Couleur d&apos;accentuation</label>
                <input
                  type="color"
                  value={formColor}
                  onChange={(e) => setFormColor(e.target.value)}
                  className="w-full h-10 bg-slate-950 border border-slate-800 rounded-xl p-1 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-lg shadow-emerald-500/20"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
