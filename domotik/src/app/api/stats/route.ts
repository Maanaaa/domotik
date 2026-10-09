import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import { exec } from "child_process";

let prevCpus = os.cpus();

function getCpuUsage(): number {
  const currentCpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (let i = 0; i < currentCpus.length; i++) {
    const cpu = currentCpus[i];
    const prevCpu = prevCpus[i] || cpu;

    if (!cpu || !prevCpu) continue;

    const idle = cpu.times.idle - prevCpu.times.idle;
    let total = 0;
    for (const type in cpu.times) {
      const key = type as keyof typeof cpu.times;
      total += cpu.times[key] - prevCpu.times[key];
    }

    totalIdle += idle;
    totalTick += total;
  }

  prevCpus = currentCpus;
  const usage = totalTick === 0 ? 0 : Math.round((1 - totalIdle / totalTick) * 100);
  return Math.min(100, Math.max(0, usage));
}

function getCpuTemperature(): Promise<number | null> {
  return new Promise((resolve) => {
    // 1. Essayer le fichier thermal zone Linux (Raspberry Pi/Debian standard)
    const thermalPath = "/sys/class/thermal/thermal_zone0/temp";
    if (fs.existsSync(thermalPath)) {
      try {
        const rawTemp = fs.readFileSync(thermalPath, "utf8");
        const temp = parseFloat(rawTemp) / 1000;
        if (!isNaN(temp) && temp > 0) {
          return resolve(Math.round(temp * 10) / 10);
        }
      } catch {
        // Fallback vcgencmd si échec de lecture
      }
    }

    // 2. Essayer l'utilitaire Raspberry Pi officiel `vcgencmd measure_temp`
    exec("vcgencmd measure_temp", (error, stdout) => {
      if (!error && stdout) {
        const match = stdout.match(/temp=([0-9.]+)/);
        if (match && match[1]) {
          return resolve(parseFloat(match[1]));
        }
      }

      // 3. Fallback pour dev / macOS
      if (process.platform === "darwin") {
        return resolve(43.2);
      }

      resolve(null);
    });
  });
}

function getDiskUsage(): Promise<{ total: string; used: string; free: string; percent: number }> {
  return new Promise((resolve) => {
    exec("df -h /", (error, stdout) => {
      if (error || !stdout) {
        return resolve({ total: "N/A", used: "N/A", free: "N/A", percent: 0 });
      }

      try {
        const lines = stdout.trim().split("\n");
        if (lines.length >= 2 && lines[1]) {
          const parts = lines[1].split(/\s+/);
          const sizeIndex = 1;
          const usedIndex = 2;
          const availIndex = 3;
          const capacityIndex = parts.findIndex((p) => p.endsWith("%"));

          const total = parts[sizeIndex] || "N/A";
          const used = parts[usedIndex] || "N/A";
          const free = parts[availIndex] || "N/A";
          const percentStr = capacityIndex !== -1 && parts[capacityIndex] ? parts[capacityIndex].replace("%", "") : "0";

          return resolve({
            total,
            used,
            free,
            percent: parseInt(percentStr, 10) || 0,
          });
        }
      } catch {
        // Ignorer erreur de parse
      }
      resolve({ total: "N/A", used: "N/A", free: "N/A", percent: 0 });
    });
  });
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    if (!iface) continue;
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias && alias.family === "IPv4" && !alias.internal && alias.address !== "127.0.0.1") {
        return alias.address;
      }
    }
  }
  return "127.0.0.1";
}

// GET /api/stats - Données temps réel du Raspberry Pi
export async function GET() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPercent = Math.round((usedMem / totalMem) * 100);

  const temp = await getCpuTemperature();
  const disk = await getDiskUsage();
  const cpuUsage = getCpuUsage();

  return NextResponse.json({
    hostname: os.hostname(),
    platform: `${os.type()} ${os.arch()} (${os.release()})`,
    nodeVersion: process.version,
    ip: getLocalIp(),
    uptimeSeconds: Math.floor(os.uptime()),
    cpu: {
      usagePercent: cpuUsage,
      tempC: temp,
      cores: os.cpus().length,
      model: os.cpus()[0]?.model ?? "ARM Processor",
      loadAvg: os.loadavg().map((l) => Math.round(l * 100) / 100),
    },
    memory: {
      totalBytes: totalMem,
      usedBytes: usedMem,
      freeBytes: freeMem,
      usedMb: Math.round(usedMem / (1024 * 1024)),
      totalMb: Math.round(totalMem / (1024 * 1024)),
      percent: memPercent,
    },
    disk,
  });
}
