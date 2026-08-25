import webpush from "web-push";

const SUBSCRIPTION_TTL = 60 * 60 * 24 * 60;
const DUE_TTL = 60 * 60 * 48;
const MAX_REMINDERS = 5;
const REMINDER_IDS = new Set(["light", "caffeine", "nap", "meal", "winddown"]);
const PUSH_COPY = {
  welcome: { title: "夜后修复提醒已开启", body: "只会按你选择的时间发送轻提醒。", tag: "night-repair-welcome" },
  light: { title: "夜后修复 · 光照提醒", body: "现在可以去户外接触一会儿自然光。", tag: "night-repair-light" },
  caffeine: { title: "夜后修复 · 咖啡截止", body: "这是你设置的今日咖啡因截止提醒。", tag: "night-repair-caffeine" },
  nap: { title: "夜后修复 · 小睡窗口", body: "短小睡现在开始；20 分钟后请起床。", tag: "night-repair-nap" },
  "nap-wake": { title: "夜后修复 · 小睡结束", body: "20 分钟到了，现在起床可以避开更重的睡眠惯性。", tag: "night-repair-nap-wake" },
  meal: { title: "夜后修复 · 停止进食", body: "这是你设置的停止进食时间。", tag: "night-repair-meal" },
  winddown: { title: "夜后修复 · 睡前收尾", body: "调暗灯光，给今晚的睡眠留出过渡。", tag: "night-repair-winddown" },
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  return Boolean(origin && allowedOrigins(env).includes(origin));
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function subscriptionKey(endpoint) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return `subscription:${base64Url(digest)}`;
}

function minuteBucket(value) {
  return value.toISOString().slice(0, 16).replaceAll("-", "").replace("T", "").replace(":", "");
}

function dueKey(date, subscriptionId, reminderId) {
  return `due:${minuteBucket(date)}:${subscriptionId.slice("subscription:".length)}:${reminderId}`;
}

function validDeviceId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{16,80}$/u.test(value);
}

export function normalizeSubscription(value) {
  if (!value || typeof value !== "object") throw new Error("invalid_subscription");
  const endpoint = String(value.endpoint || "");
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("invalid_endpoint"); }
  if (url.protocol !== "https:") throw new Error("invalid_endpoint");
  const p256dh = String(value.keys?.p256dh || "");
  const auth = String(value.keys?.auth || "");
  if (p256dh.length < 40 || auth.length < 10) throw new Error("invalid_keys");
  return { endpoint, expirationTime: value.expirationTime || null, keys: { p256dh, auth } };
}

export function normalizeReminders(reminders, now = Date.now()) {
  if (!Array.isArray(reminders) || reminders.length > MAX_REMINDERS) throw new Error("invalid_reminders");
  const earliest = now - 2 * 60 * 1000;
  const latest = now + 48 * 60 * 60 * 1000;
  const normalized = [];
  reminders.forEach((item) => {
    if (!item || !REMINDER_IDS.has(item.id)) throw new Error("invalid_reminder_id");
    const scheduledAt = new Date(item.scheduledAt);
    const timestamp = scheduledAt.getTime();
    if (!Number.isFinite(timestamp) || timestamp < earliest || timestamp > latest) return;
    normalized.push({ id: item.id, scheduledAt: scheduledAt.toISOString() });
    if (item.id === "nap") normalized.push({ id: "nap-wake", scheduledAt: new Date(timestamp + 20 * 60 * 1000).toISOString() });
  });
  return normalized;
}

function vapidDetails(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error("vapid_not_configured");
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}

export async function sendPush(env, subscription, reminderId) {
  const copy = PUSH_COPY[reminderId] || PUSH_COPY.winddown;
  return webpush.sendNotification(subscription, JSON.stringify({ ...copy, url: env.APP_URL || "/Night-repair-App/#today", reminderId }), {
    vapidDetails: vapidDetails(env),
    TTL: 15 * 60,
    urgency: reminderId === "nap-wake" ? "high" : "normal",
    topic: copy.tag.slice(0, 32),
  });
}

async function deleteSchedule(env, record) {
  await Promise.all((record?.scheduleKeys || []).map((key) => env.PUSH_SUBSCRIPTIONS.delete(key)));
}

async function saveSubscription(env, payload) {
  if (!validDeviceId(payload.deviceId)) throw new Error("invalid_device_id");
  const subscription = normalizeSubscription(payload.subscription);
  const reminders = normalizeReminders(payload.reminders || []);
  const key = await subscriptionKey(subscription.endpoint);
  const existing = await env.PUSH_SUBSCRIPTIONS.get(key, "json");
  if (existing && existing.deviceId !== payload.deviceId) throw new Error("subscription_conflict");
  await deleteSchedule(env, existing);
  const scheduleKeys = reminders.map((item) => dueKey(new Date(item.scheduledAt), key, item.id));
  const record = { schemaVersion: 1, deviceId: payload.deviceId, subscription, reminders, scheduleKeys, updatedAt: new Date().toISOString() };
  await env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify(record), { expirationTtl: SUBSCRIPTION_TTL });
  await Promise.all(reminders.map((item, index) => env.PUSH_SUBSCRIPTIONS.put(scheduleKeys[index], JSON.stringify({ subscriptionKey: key, reminderId: item.id, scheduledAt: item.scheduledAt }), { expirationTtl: DUE_TTL })));
  return { key, record, isNew: !existing };
}

async function removeSubscription(env, endpoint, deviceId) {
  const key = await subscriptionKey(endpoint);
  const record = await env.PUSH_SUBSCRIPTIONS.get(key, "json");
  if (!record) return false;
  if (record.deviceId !== deviceId) throw new Error("device_mismatch");
  await deleteSchedule(env, record);
  await env.PUSH_SUBSCRIPTIONS.delete(key);
  return true;
}

async function listKeys(env, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await env.PUSH_SUBSCRIPTIONS.list({ prefix, cursor });
    keys.push(...page.keys.map((item) => item.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function removeExpiredPush(env, subscriptionKeyValue, record) {
  await deleteSchedule(env, record);
  await env.PUSH_SUBSCRIPTIONS.delete(subscriptionKeyValue);
}

export async function processDueReminders(env, now = new Date(), sender = sendPush) {
  const dueNames = new Set();
  for (let offset = 0; offset <= 2; offset += 1) {
    const minute = new Date(now.getTime() - offset * 60 * 1000);
    (await listKeys(env, `due:${minuteBucket(minute)}:`)).forEach((name) => dueNames.add(name));
  }
  const result = { scanned: dueNames.size, sent: 0, removed: 0, failed: 0 };
  for (const name of dueNames) {
    const due = await env.PUSH_SUBSCRIPTIONS.get(name, "json");
    if (!due || new Date(due.scheduledAt).getTime() > now.getTime() + 30 * 1000) continue;
    const record = await env.PUSH_SUBSCRIPTIONS.get(due.subscriptionKey, "json");
    if (!record) { await env.PUSH_SUBSCRIPTIONS.delete(name); continue; }
    const sentKey = `sent:${due.subscriptionKey.slice("subscription:".length)}:${due.reminderId}:${due.scheduledAt}`;
    if (await env.PUSH_SUBSCRIPTIONS.get(sentKey)) { await env.PUSH_SUBSCRIPTIONS.delete(name); continue; }
    try {
      await sender(env, record.subscription, due.reminderId);
      await env.PUSH_SUBSCRIPTIONS.put(sentKey, "1", { expirationTtl: DUE_TTL });
      await env.PUSH_SUBSCRIPTIONS.delete(name);
      result.sent += 1;
    } catch (error) {
      if ([404, 410].includes(Number(error?.statusCode))) {
        await removeExpiredPush(env, due.subscriptionKey, record);
        result.removed += 1;
      } else result.failed += 1;
    }
  }
  return result;
}

async function parseBody(request) {
  const size = Number(request.headers.get("content-length") || 0);
  if (size > 32_000) throw new Error("payload_too_large");
  return request.json();
}

function errorStatus(message) {
  if (["subscription_conflict", "device_mismatch"].includes(message)) return 409;
  if (message === "payload_too_large") return 413;
  return 400;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return originAllowed(request, env) ? new Response(null, { status: 204, headers: cors }) : json({ error: "origin_not_allowed" }, 403);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "night-repair-push" }, 200, cors);
    if (url.pathname === "/vapid-public-key" && request.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY || "" }, 200, cors);
    if (!["POST", "DELETE"].includes(request.method) || url.pathname !== "/subscriptions") return json({ error: "not_found" }, 404, cors);
    if (!originAllowed(request, env)) return json({ error: "origin_not_allowed" }, 403);
    try {
      const payload = await parseBody(request);
      if (request.method === "POST") {
        const saved = await saveSubscription(env, payload);
        if (saved.isNew && env.DISABLE_WELCOME !== "true") ctx.waitUntil(sendPush(env, saved.record.subscription, "welcome").catch(() => {}));
        return json({ ok: true, reminders: saved.record.reminders.length }, 201, cors);
      }
      const subscription = normalizeSubscription(payload.subscription);
      const removed = await removeSubscription(env, subscription.endpoint, payload.deviceId);
      return json({ ok: true, removed }, 200, cors);
    } catch (error) {
      return json({ error: error?.message || "invalid_request" }, errorStatus(error?.message), cors);
    }
  },

  async scheduled(controller, env) {
    return processDueReminders(env, new Date(controller.scheduledTime));
  },
};
