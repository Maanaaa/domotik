# 📡 Architecture IoT : Zigbee, Mosquitto & Next.js

Ce document détaille le flux complet de communication entre les équipements Zigbee physiques, le broker MQTT Mosquitto et l'application web Next.js.

---

## 🗺️ Schéma d'Architecture Global

```mermaid
flowchart TD
    subgraph S_EQUIPEMENTS["1. Équipements Physiques Zigbee"]
        CapteurPorte["🚪 Détecteur d'ouverture<br/><i>(Sonoff, TuYa, Aqara...)</i>"]
        Prise["🔌 Prise connectée<br/><i>(Mesure de puissance)</i>"]
        AutreZigbee["💡 Autres objets Zigbee 3.0"]
    end

    subgraph S_HARDWARE["2. Passerelle Matérielle (Raspberry Pi)"]
        SonoffDongle["📡 Clé USB Dongle Sonoff Plus<br/><i>(Coordinateur Zigbee)</i>"]
    end

    subgraph S_MIDDLEWARE["3. Passerelle Logicielle & Broker"]
        Z2M["⚙️ <b>Zigbee2MQTT</b><br/>Traduit les trames radio en JSON"]
        Mosquitto[("📬 <b>Mosquitto MQTT Broker</b><br/>Port 1883 - Topics & Retain")]
    end

    subgraph S_CONTAINER["4. Conteneur Docker Next.js"]
        MqttClient["🔌 <b>mqtt.ts (Node.js)</b><br/>Client MQTT abonné à <code>zigbee2mqtt/#</code>"]
        ApiRoute["⚡ <b>Route API</b><br/><code>/api/mqtt</code> (GET & POST)"]
        ReactUI["🖥️ <b>Dashboard React</b><br/>Affichage temps réel & Couplage"]
    end

    %% Flux radio
    CapteurPorte -->|"Radio Zigbee 3.0"| SonoffDongle
    Prise -->|"Radio Zigbee 3.0"| SonoffDongle
    AutreZigbee -->|"Radio Zigbee 3.0"| SonoffDongle

    %% Flux USB
    SonoffDongle -->|"/dev/ttyUSB0"| Z2M

    %% Flux MQTT
    Z2M -->|"Publish JSON (Payloads)"| Mosquitto
    Mosquitto -->|"Publish vers le JS"| MqttClient

    %% Commandes descendantes
    ReactUI -->|"Bouton (ex: ON/OFF, Appairage)"| ApiRoute
    ApiRoute -->|"Appel MqttManager"| MqttClient
    MqttClient -->|"Publish commande MQTT"| Mosquitto
    Mosquitto -->|"Dispatch vers Zigbee"| Z2M
    Z2M -->|"Ordre radio"| SonoffDongle
    SonoffDongle -->|"Actionneur"| Prise

    %% Flux UI interne
    MqttClient -->|"Mémoire tampon"| ApiRoute
    ApiRoute -->|"Polling / JSON"| ReactUI
```

---

## 📦 Exemples réels de Payloads JSON échangés

### 1. Détecteur d'ouverture de porte (Capteur)
* **Topic :** `zigbee2mqtt/0x8c73dafffeceac07`
* **Direction :** Capteur ➔ Mosquitto ➔ Dashboard JS
* **Payload JSON :**
```json
{
  "contact": true,          // true = Porte FERMÉE | false = Porte OUVERTE
  "battery": 100,           // % restant de la pile
  "battery_low": false,     // Alerte pile faible
  "tamper": false,          // Détection d'arrachement / sabotage
  "linkquality": 207        // Qualité du signal radio (0 à 255)
}
```

---

### 2. Prise connectée (Télémétrie)
* **Topic :** `zigbee2mqtt/0xa4c13810f2d8ffff`
* **Direction :** Prise ➔ Mosquitto ➔ Dashboard JS
* **Payload JSON :**
```json
{
  "state": "ON",            // ON ou OFF
  "power": 30.43,           // Puissance instantanée consommée en Watts
  "current": 0.25,          // Courant en Ampères
  "voltage": 243.64,        // Tension du secteur en Volts
  "energy": 0.0,            // Consommation cumulée en kWh
  "linkquality": 180        // Qualité de réception radio
}
```

---

### 3. Actionnement d'une prise (Commande descendante)
* **Topic :** `zigbee2mqtt/0xa4c13810f2d8ffff/set`
* **Direction :** Dashboard JS ➔ Mosquitto ➔ Prise
* **Payload JSON :**
```json
{
  "state": "TOGGLE"         // ou "ON" / "OFF"
}
```

---

### 4. Gestion de l'Appairage (Couplage par API)
* **Topic :** `zigbee2mqtt/bridge/request/permit_join`
* **Direction :** Dashboard JS ➔ Mosquitto ➔ Clé Sonoff
* **Payload JSON :**
```json
{
  "value": true,            // true = autoriser le couplage, false = verrouiller
  "time": 254               // Durée d'ouverture en secondes
}
```

---

## ⚡ Pourquoi c'est opérationnel dès le démarrage ?

```mermaid
sequenceDiagram
    autonumber
    participant Capteur as 🚪 Capteur Porte
    participant Sonoff as 📡 Clé Sonoff / Z2M
    participant Broker as 📬 Mosquitto (Retain)
    participant JS as ⚡ Backend Next.js (mqtt.ts)
    participant UI as 🖥️ Dashboard Web

    Note over Broker: Mosquitto conserve le dernier état connu (MQTT Retain)
    JS->>Broker: Connexion MQTT (port 1883)
    JS->>Broker: S'abonne à "zigbee2mqtt/#"
    Broker-->>JS: Renvoie immédiatement les derniers Payloads retenus
    JS->>Broker: Envoie requête "bridge/request/devices"
    Broker-->>JS: Renvoie la liste complète des objets associés
    UI->>JS: Charge l'état initial
    JS-->>UI: Statut immédiat : Porte Fermée, Batterie 100%
    Note over UI: Aucun délai d'attente au démarrage !
```
