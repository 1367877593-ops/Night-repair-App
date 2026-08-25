import test from "node:test";
import assert from "node:assert/strict";
import worker, { normalizeReminders, normalizeSubscription, processDueReminders } from "../src/index.js";

class MemoryKv {
  constructor() { this.values = new Map(); }
  async put(key, value) { this.values.set(key, value); }
  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async delete(key) { this.values.delete(key); }
  async list({ prefix = "" } = {}) {
    return { keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}

const subscription = {
  endpoint: "https://push.example.test/subscription/opaque-id",
  expirationTime: null,
  keys: {
    p256dh: "B".repeat(88),
    auth: "A".repeat(22),
  },
};

function makeEnv() {
  return {
    PUSH_SUBSCRIPTIONS: new MemoryKv(),
    ALLOWED_ORIGINS: "https://1367877593-ops.github.io,http://127.0.0.1:8787",
    VAPID_PUBLIC_KEY: "public-key",
    VAPID_PRIVATE_KEY: "private-key",
    VAPID_SUBJECT: "mailto:test@example.com",
    DISABLE_WELCOME: "true",
  };
}

test("validates subscriptions and expands a nap into a wake reminder", () => {
  assert.equal(normalizeSubscription(subscription).endpoint, subscription.endpoint);
  const now = Date.now();
  const reminders = normalizeReminders([{ id: "nap", scheduledAt: new Date(now + 60_000).toISOString() }], now);
  assert.deepEqual(reminders.map((item) => item.id), ["nap", "nap-wake"]);
  assert.equal(new Date(reminders[1].scheduledAt) - new Date(reminders[0].scheduledAt), 20 * 60 * 1000);
});

test("subscription endpoint rejects unapproved origins", async () => {
  const response = await worker.fetch(new Request("https://worker.test/subscriptions", {
    method: "POST",
    headers: { origin: "https://malicious.example", "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "device_identifier_123", subscription, reminders: [] }),
  }), makeEnv(), { waitUntil() {} });
  assert.equal(response.status, 403);
});

test("stores only technical push data and sends due generic reminders", async () => {
  const env = makeEnv();
  const scheduledAt = new Date(Date.now() + 60_000);
  const response = await worker.fetch(new Request("https://worker.test/subscriptions", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:8787", "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: "device_identifier_123",
      subscription,
      reminders: [{ id: "light", scheduledAt: scheduledAt.toISOString() }],
    }),
  }), env, { waitUntil() {} });
  assert.equal(response.status, 201);
  assert.equal([...env.PUSH_SUBSCRIPTIONS.values.values()].some((value) => value.includes("symptoms")), false);

  const sent = [];
  const result = await processDueReminders(env, scheduledAt, async (_env, target, reminderId) => sent.push({ target, reminderId }));
  assert.equal(result.sent, 1);
  assert.deepEqual(sent.map((item) => item.reminderId), ["light"]);

  await worker.fetch(new Request("https://worker.test/subscriptions", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:8787", "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "device_identifier_123", subscription, reminders: [{ id: "light", scheduledAt: scheduledAt.toISOString() }] }),
  }), env, { waitUntil() {} });
  const duplicate = await processDueReminders(env, scheduledAt, async () => sent.push({ reminderId: "duplicate" }));
  assert.equal(duplicate.sent, 0);
  assert.equal(sent.length, 1);
});
