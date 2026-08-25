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
