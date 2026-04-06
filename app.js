import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD-bFyWmwOP_sWi7NxGPRwyOyKj4bv-6qw",
  authDomain: "parent-ba408.firebaseapp.com",
  projectId: "parent-ba408",
  storageBucket: "parent-ba408.firebasestorage.app",
  messagingSenderId: "690640400418",
  appId: "1:690640400418:web:f0bbb5a2b779d320669a7b"
};

const approvedAdminEmails = new Set(["252-35-584@diu.edu.bd"]);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
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

let devices = [];
let selectedDeviceId = "";
let currentUser = null;

configStatus.classList.remove("hidden");
configStatus.textContent =
  "Spark-compatible mode: dashboard uses Firebase Auth + Cloud Firestore directly. Cloud Functions are not required.";

signInBtn.addEventListener("click", async () => {
  await signInWithPopup(auth, provider);
});

signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

refreshBtn.addEventListener("click", loadDevices);

commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || !isApprovedAdmin(currentUser)) {
    setCommandResult("Sign in with the approved admin account first.");
    return;
  }

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
    const result = await addDoc(collection(db, "devices", deviceId, "commands"), {
      command,
      args,
      status: "queued",
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    selectedDeviceId = deviceId;
    renderDevices(devices);
    setSelectedDeviceHint(deviceId);
    setCommandResult(
      `Command queued successfully.\n\n${JSON.stringify(
        {
          deviceId,
          command,
          commandId: result.id
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
  currentUser = user;

  if (!user) {
    devices = [];
    selectedDeviceId = "";
    signInBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    refreshBtn.disabled = true;
    renderStats([]);
    renderDevices([]);
    setSelectedDeviceHint("");
    setCommandResult("Sign in with the approved admin account to send commands.");
    return;
  }

  signInBtn.classList.add("hidden");
  signOutBtn.classList.remove("hidden");
  refreshBtn.disabled = true;

  if (!isApprovedAdmin(user)) {
    devices = [];
    selectedDeviceId = "";
    renderStats([]);
    renderDevices([]);
    setSelectedDeviceHint("");
    devicesOutput.innerHTML =
      '<div class="empty-state">This signed-in account is not approved for dashboard access.</div>';
    setCommandResult(
      `Signed in as ${user.email}, but only approved admin emails can use this dashboard.`
    );
    return;
  }

  setCommandResult(`Signed in as ${user.email}. Firestore access is ready.`);
  refreshBtn.disabled = false;
  await loadDevices();
});

async function loadDevices() {
  if (!currentUser || !isApprovedAdmin(currentUser)) {
    devicesOutput.innerHTML =
      '<div class="empty-state">Sign in with the approved admin account to load devices.</div>';
    return;
  }

  try {
    devicesOutput.innerHTML = '<div class="empty-state">Loading devices...</div>';
    const devicesQuery = query(collection(db, "devices"), orderBy("updatedAt", "desc"), limit(50));
    const snapshot = await getDocs(devicesQuery);
    devices = snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
    renderStats(devices);
    renderDevices(devices);
  } catch (error) {
    renderStats([]);
    devicesOutput.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
  }
}

function isApprovedAdmin(user) {
  const email = String(user.email || "").trim().toLowerCase();
  return user.emailVerified && approvedAdminEmails.has(email);
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
    emptyState.textContent = currentUser
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
