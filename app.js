import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD-bFyWmwOP_sWi7NxGPRwyOyKj4bv-6qw",
  authDomain: "parent-ba408.firebaseapp.com",
  projectId: "parent-ba408",
  storageBucket: "parent-ba408.firebasestorage.app",
  messagingSenderId: "690640400418",
  appId: "1:690640400418:web:f0bbb5a2b779d320669a7b"
};

const functionBaseUrl = "https://us-central1-parent-ba408.cloudfunctions.net";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const refreshBtn = document.getElementById("refreshBtn");
const configStatus = document.getElementById("configStatus");
const deviceStats = document.getElementById("deviceStats");
const devicesOutput = document.getElementById("devicesOutput");
const commandForm = document.getElementById("commandForm");
const commandResult = document.getElementById("commandResult");
const deviceIdInput = document.getElementById("deviceId");
const commandInput = document.getElementById("command");
const argsInput = document.getElementById("args");
const selectedDeviceHint = document.getElementById("selectedDeviceHint");

let idToken = null;
let devices = [];
let selectedDeviceId = "";

const hasPlaceholderConfig =
  Object.values(firebaseConfig).some((value) => String(value).includes("REPLACE_ME")) ||
  functionBaseUrl.includes("REPLACE_ME");

if (hasPlaceholderConfig) {
  configStatus.classList.remove("hidden");
  configStatus.textContent =
    "Replace the Firebase web config and Cloud Functions URL in web-dashboard/app.js before signing in.";
}

signInBtn.addEventListener("click", async () => {
  await signInWithPopup(auth, provider);
});

signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

refreshBtn.addEventListener("click", loadDevices);

commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const deviceId = deviceIdInput.value.trim();
  const command = commandInput.value.trim();
  let args = {};

  if (!deviceId) {
    setCommandResult("Device ID is required.");
    return;
  }

  try {
    args = JSON.parse(argsInput.value || "{}");
  } catch {
    setCommandResult("Args must be valid JSON.");
    return;
  }

  try {
    setCommandResult("Queueing command...");
    const result = await authedFetch("sendCommand", {
      method: "POST",
      body: JSON.stringify({ deviceId, command, args })
    });

    selectedDeviceId = deviceId;
    renderDevices(devices);
    setSelectedDeviceHint(deviceId);
    setCommandResult(
      `Command queued successfully.\n\n${JSON.stringify(
        {
          deviceId,
          command,
          commandId: result.commandId
        },
        null,
        2
      )}`
    );
  } catch (error) {
    setCommandResult(`Error: ${error.message}`);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    idToken = null;
    devices = [];
    selectedDeviceId = "";
    signInBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    refreshBtn.disabled = true;
    renderStats([]);
    renderDevices([]);
    setSelectedDeviceHint("");
    setCommandResult("Sign in with an admin account to send commands.");
    return;
  }

  idToken = await user.getIdToken(true);
  signInBtn.classList.add("hidden");
  signOutBtn.classList.remove("hidden");
  refreshBtn.disabled = false;
  await loadDevices();
});

async function authedFetch(path, options = {}) {
  if (!idToken) {
    throw new Error("You must sign in first.");
  }

  const response = await fetch(`${functionBaseUrl}/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(options.headers || {})
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function loadDevices() {
  try {
    devicesOutput.innerHTML = '<div class="empty-state">Loading devices...</div>';
    const data = await authedFetch("getOverview", { method: "GET" });
    devices = Array.isArray(data.devices) ? data.devices : [];
    renderStats(devices);
    renderDevices(devices);
  } catch (error) {
    renderStats([]);
    devicesOutput.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
  }
}

function renderStats(deviceList) {
  const activeWindowMs = 15 * 60 * 1000;
  const now = Date.now();
  const activeCount = deviceList.filter((device) => {
    const seenAt = getTimestampMs(device.lastSeenAt || device.updatedAt);
    return seenAt && now - seenAt <= activeWindowMs;
  }).length;

  const staleCount = Math.max(deviceList.length - activeCount, 0);

  const stats = [
    { label: "Total devices", value: deviceList.length },
    { label: "Active in 15m", value: activeCount },
    { label: "Needs review", value: staleCount }
  ];

  deviceStats.innerHTML = "";
  for (const stat of stats) {
    const card = document.createElement("article");
    card.className = "stat-card";

    const label = document.createElement("span");
    label.textContent = stat.label;

    const value = document.createElement("strong");
    value.textContent = String(stat.value);

    card.append(label, value);
    deviceStats.append(card);
  }
}

function renderDevices(deviceList) {
  devicesOutput.innerHTML = "";

  if (!deviceList.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = idToken
      ? "No devices have reported in yet."
      : "Sign in to view device activity.";
    devicesOutput.append(emptyState);
    return;
  }

  const knownSelection = deviceList.some((device) => resolveDeviceId(device) === selectedDeviceId);
  if (!knownSelection) {
    selectedDeviceId = "";
    setSelectedDeviceHint("");
  }

  for (const device of deviceList) {
    const deviceId = resolveDeviceId(device);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `device-card${deviceId === selectedDeviceId ? " selected" : ""}`;
    card.addEventListener("click", () => selectDevice(deviceId));

    const header = document.createElement("div");
    header.className = "device-card-header";

    const title = document.createElement("p");
    title.className = "device-id";
    title.textContent = deviceId;

    const badge = document.createElement("span");
    badge.className = "device-tag";
    badge.textContent = getPresenceLabel(device);

    header.append(title, badge);

    const meta = document.createElement("div");
    meta.className = "device-meta";
    meta.append(
      createMetaRow("Last event", device.lastEventType || "No activity yet"),
      createMetaRow("Last seen", formatTimestamp(device.lastSeenAt)),
      createMetaRow("Updated", formatTimestamp(device.updatedAt))
    );

    card.append(header, meta);
    devicesOutput.append(card);
  }
}

function createMetaRow(labelText, valueText) {
  const row = document.createElement("div");
  row.className = "meta-row";

  const label = document.createElement("span");
  label.textContent = labelText;

  const value = document.createElement("strong");
  value.textContent = valueText;

  row.append(label, value);
  return row;
}

function selectDevice(deviceId) {
  selectedDeviceId = deviceId;
  deviceIdInput.value = deviceId;
  renderDevices(devices);
  setSelectedDeviceHint(deviceId);
  commandInput.focus();
}

function setSelectedDeviceHint(deviceId) {
  selectedDeviceHint.textContent = deviceId
    ? `Selected device: ${deviceId}`
    : "Select a device card or enter a device ID manually.";
}

function setCommandResult(message) {
  commandResult.textContent = message;
}

function resolveDeviceId(device) {
  return device.deviceId || device.id || "unknown-device";
}

function getPresenceLabel(device) {
  const seenAt = getTimestampMs(device.lastSeenAt || device.updatedAt);
  if (!seenAt) {
    return "Unknown";
  }

  const diffMinutes = (Date.now() - seenAt) / (60 * 1000);
  if (diffMinutes <= 15) {
    return "Active";
  }

  if (diffMinutes <= 180) {
    return "Idle";
  }

  return "Offline";
}

function formatTimestamp(timestamp) {
  const millis = getTimestampMs(timestamp);
  if (!millis) {
    return "Not available";
  }

  return new Date(millis).toLocaleString();
}

function getTimestampMs(timestamp) {
  if (!timestamp) {
    return null;
  }

  if (typeof timestamp.toMillis === "function") {
    return timestamp.toMillis();
  }

  if (typeof timestamp.seconds === "number") {
    return timestamp.seconds * 1000;
  }

  if (typeof timestamp._seconds === "number") {
    return timestamp._seconds * 1000;
  }

  if (typeof timestamp === "string" || typeof timestamp === "number") {
    const parsed = new Date(timestamp).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}
