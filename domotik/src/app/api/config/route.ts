import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "data", "config.json");

interface ConfigData {
  title: string;
  services: Array<{
    id: string;
    name: string;
    url: string;
    category?: string;
    color?: string;
    icon?: string;
  }>;
  notes: string;
}

const defaultConfig: ConfigData = {
  title: "Mon Raspberry Pi Hub",
  services: [
    {
      id: "1",
      name: "Pi-hole",
      url: "http://192.168.1.100/admin",
      category: "Sécurité & Réseau",
      color: "#10b981",
    },
    {
      id: "2",
      name: "Home Assistant",
      url: "http://192.168.1.100:8123",
      category: "Domotique",
      color: "#0ea5e9",
    },
    {
      id: "3",
      name: "Portainer",
      url: "http://192.168.1.100:9000",
      category: "Administration",
      color: "#6366f1",
    },
    {
      id: "4",
      name: "Plex Media",
      url: "http://192.168.1.100:32400",
      category: "Médias",
      color: "#f59e0b",
    },
    {
      id: "5",
      name: "Transmission",
      url: "http://192.168.1.100:9091",
      category: "Téléchargements",
      color: "#ec4899",
    },
  ],
  notes: "📌 Pense-bête Raspberry Pi :\n- IP Fixe : 192.168.1.100\n- Update : sudo apt update && sudo apt upgrade -y\n- Zigbee2MQTT Broker: mqtt://localhost:1883",
};

function loadConfig(): ConfigData {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Erreur lecture config.json:", e);
  }
  return defaultConfig;
}

function saveConfig(data: ConfigData): boolean {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("Erreur sauvegarde config.json:", e);
    return false;
  }
}

export async function GET() {
  return NextResponse.json(loadConfig());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const current = loadConfig();

    const newConfig: ConfigData = {
      title: body.title !== undefined ? body.title : current.title,
      services: Array.isArray(body.services) ? body.services : current.services,
      notes: body.notes !== undefined ? body.notes : current.notes,
    };

    if (saveConfig(newConfig)) {
      return NextResponse.json({ success: true, config: newConfig });
    } else {
      return NextResponse.json({ error: "Impossible de sauvegarder la config" }, { status: 500 });
    }
  } catch (error) {
    console.error("Erreur API config POST:", error);
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
}
