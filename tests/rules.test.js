const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appPath = path.join(__dirname, "..", "app.js");
const source = fs.readFileSync(appPath, "utf8");
const bindingStart = source.indexOf('\nqa("[data-view]").forEach((button) => button.addEventListener');
assert.ok(bindingStart > 0, "expected browser binding marker");

const context = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(source.slice(0, bindingStart), context, { filename: appPath });

function run(expression) {
  return vm.runInContext(expression, context);
}

test("adds blood sugar, low light and phase-conflict factors only from explicit facts", () => {
  const factors = run(`scoreFactors({
    symptoms: ["注意力涣散", "想吃甜的"], debtMinutes: 0,
    caffeineNow: 0, caffeineAtSleep: 0, caffeineGap: null,
    hydration: "normal", awakeMinutes: 180,
    lastMeal: { weight: "light" }, mealToSleep: 600,
    recentMealPattern: "highCarb", outdoorLightStatus: "none",
    phaseConflictMinutes: 120, energy: "very", stageContext: null
  })`);
  assert.deepEqual(Array.from(factors, (item) => item.id), ["bloodSugar", "phaseConflict", "lowLight"]);
});

test("mood and OSA safety routes do not leak ordinary recovery actions", () => {
  const facts = `{ symptoms: [], caffeineNow: 0, caffeineAtSleep: 0, hoursToSleep: 10, plannedSleep: "01:00", halfLife: 5, debtMinutes: 0 }`;
  const mood = run(`generateActions(${facts}, [], [{ type: "mood" }])`);
  const osa = run(`generateActions(${facts}, [], [{ type: "osa" }])`);
  assert.deepEqual(Array.from(mood, (item) => item.kind), ["mood"]);
  assert.deepEqual(Array.from(osa, (item) => item.kind), ["osa"]);
});

test("structural safety detects the documented three-day mood route", () => {
  const notices = run(`assessStructuralSafety({
    profile: { goal: "energy", classification: { socialJetlag: 0 } },
    tstMinutes: 360, energy: "normal", osaFlags: [],
    mood: "low", earlyWake: true, drivingToday: false,
    onset: "02:00", wake: "07:30", recordDayShift: 0
  }, [
    { date: "2026-08-23", mood: "low", earlyWake: true },
    { date: "2026-08-24", mood: "low", earlyWake: true }
  ])`);
  assert.equal(notices.some((item) => item.type === "mood"), true);
});

test("structural safety detects seven-day fatigue with multiple OSA flags", () => {
  const notices = run(`assessStructuralSafety({
    profile: { goal: "fatigue", classification: { socialJetlag: 30 } },
    tstMinutes: 450, energy: "very", osaFlags: ["snore", "apnea"],
    mood: "normal", earlyWake: false, drivingToday: false,
    onset: "02:00", wake: "07:30", recordDayShift: 0
  }, [
    { date: "2026-08-19", energy: "very" },
    { date: "2026-08-20", energy: "very" },
    { date: "2026-08-21", energy: "very" },
    { date: "2026-08-22", energy: "very" },
    { date: "2026-08-23", energy: "very" },
    { date: "2026-08-24", energy: "very" }
  ])`);
  assert.equal(notices.some((item) => item.type === "osa"), true);
});

test("editing the current sleep day does not count the old copy as another day", () => {
  const notices = run(`assessStructuralSafety({
    profile: { goal: "energy", classification: { socialJetlag: 0 } },
    tstMinutes: 360, energy: "normal", osaFlags: [],
    mood: "low", earlyWake: true, drivingToday: false,
    onset: "02:00", wake: "07:30", recordDayShift: 0
  }, [
    { date: "2026-08-24", mood: "low", earlyWake: true },
    { date: "2026-08-25", mood: "low", earlyWake: true }
  ])`);
  assert.equal(notices.some((item) => item.type === "mood"), false);
});

test("push schedule contains only pending reminder type and execution time", () => {
  const schedule = run(`pushScheduleFromPlan({
    date: "2026-08-25",
    profileType: "D+",
    reminders: [
      { id: "light", time: "09:30", title: "private title", description: "private health detail", enabled: true, result: null },
      { id: "caffeine", time: "14:00", title: "done", enabled: true, result: "done" },
      { id: "meal", time: "22:00", enabled: false, result: null }
    ]
  }, new Date("2026-08-25T08:00:00").getTime())`);
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].id, "light");
  assert.deepEqual(Object.keys(schedule[0]).sort(), ["id", "scheduledAt"]);
});

test("nap edits keep the wake label and cross-midnight calendar event aligned", () => {
  assert.equal(run(`addMinutesToClock("23:50", 20)`), "00:10");
  assert.equal(run(`napWakeDescription("13:40")`), "自动配 14:00 唤醒。");
  const calendar = run(`buildCalendar({
    date: "2026-08-25",
    reminders: [
      { id: "nap", kind: "nap", time: "23:50", title: "小睡,窗口", description: "stale", enabled: true },
      { id: "meal", kind: "meal", time: "22:00", title: "不应导出", description: "disabled", enabled: false }
    ]
  })`);
  assert.match(calendar, /DTSTART:20260825T235000/u);
  assert.match(calendar, /DESCRIPTION:自动配 00:10 唤醒。/u);
  assert.match(calendar, /DTSTART:20260826T001000/u);
  assert.match(calendar, /SUMMARY:小睡\\,窗口/u);
  assert.equal((calendar.match(/BEGIN:VEVENT/gu) || []).length, 2);
  assert.doesNotMatch(calendar, /不应导出/u);
});

test("cloud screenshot fields are revalidated in the browser before display", () => {
  const result = run(`normalizeCloudScreenshotResult({
    vendor: "unexpected-vendor", sleep: "25:99", wake: "08:16",
    deepMinutes: 84, remMinutes: 999, confidence: 1,
    name: "must be dropped", heartRate: 72
  })`);
  assert.equal(result.vendor, "unknown");
  assert.equal(result.sleep, null);
  assert.equal(result.wake, "08:16");
  assert.equal(result.deepMinutes, 84);
  assert.equal(result.remMinutes, null);
  assert.equal(result.confidence, 0.85);
  assert.deepEqual(Object.keys(result).sort(), ["confidence", "deepMinutes", "fieldCount", "remMinutes", "sleep", "vendor", "wake"]);
});

test("AI explanation summary contains enums only and drops unknown health fields", () => {
  const summary = run(`buildExplanationSummary({
    profileType: "D+", debtMinutes: 145, caffeineAtSleep: 37,
    symptoms: ["头痛", "心慌", "姓名：测试"], exactSleepTime: "01:42"
  }, [
    { id: "sleepDebt", score: 76, evidence: "睡眠债 145 分钟" },
    { id: "caffeineResidual", score: 52, evidence: "残留 37mg" },
    { id: "unknownFactor", score: 99, evidence: "private" }
  ], [
    { kind: "water", title: "先补水" },
    { kind: "caffeine", title: "截止时间 13:00" },
    { kind: "medicine", title: "不应发送" }
  ])`);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), {
    profileType: "D+", debtBand: "high", caffeineBand: "medium", confidenceBand: "high",
    factors: ["sleepDebt", "caffeineResidual"], actions: ["water", "caffeine"], symptoms: ["头痛", "心慌"],
  });
  assert.equal(JSON.stringify(summary).includes("145"), false);
  assert.equal(JSON.stringify(summary).includes("01:42"), false);
  assert.equal(JSON.stringify(summary).includes("姓名"), false);
});
