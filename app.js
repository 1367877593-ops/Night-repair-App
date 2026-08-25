const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const appState = { view: "today", selectedSymptoms: [], caffeine: [], screenshotImport: null, screenshotUrl: null, activeRecordId: null };
const PROFILE_KEY = "nightRepair.profile.v1";
const FEEDBACK_KEY = "nightRepair.feedback.v1";
const EXPERIMENTS_KEY = "nightRepair.experiments.v1";
const REMINDER_KEY = "nightRepair.reminders.v1";
const EXPERIMENT_REMINDER_MAP = { caffeine_cutoff: "caffeine", morning_light: "light", meal_cutoff: "meal" };
let onboardingStep = 1;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function toMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function sleepDuration(start, end) {
  const from = toMinutes(start);
  let to = toMinutes(end);
  if (to <= from) to += 1440;
  return to - from;
}

function sleepMidpoint(start, end) {
  return (toMinutes(start) + sleepDuration(start, end) / 2) % 1440;
}

function circularDifference(a, b) {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

const TYPE_CONTENT = {
  A: ["偶发型", "昨晚失控，不等于你一直做错了。", "你的基线基本正常。今天做急性补救，重点是别让一次熬夜变成连续几天。"],
  B: ["慢性不足型", "问题更像是时长不够，不是技巧不够。", "先为睡眠腾出真实时间，再谈咖啡、光照和其他工具。"],
  C: ["稳定晚相位型", "你不是熬夜，只是稳定地睡得晚。", "这个模式本身不构成问题；更值得留意的是日照、进食时间和维生素 D。"],
  D: ["社会时差型", "你不是不自律，是两个作息在来回拉扯。", "自由日大幅补觉会放大下周的漂移。策略是稳定锚点，而不是禁止补觉。"],
  "D+": ["相位冲突型", "你不是不自律，是生物钟与日程在拉扯。", "自然入睡时间偏晚，但早上必须按时清醒。真正的策略是用几周做相位前移，不承诺一周解决。"],
  E: ["轮班型", "你的相位被外部日程反复推动。", "这不是普通熬夜。当前先保护锚定睡眠、通勤避光和定向光照；不会因为钟点不同给你打低分。"],
};

const TYPE_PROTOCOLS = {
  A: { duration: "今天就做三件", note: "一次失控不等于基线坏了。今天降低损失，同时避免用长补觉把今晚继续推迟。", items: [["醒后", "先补光与水", "醒后 30 分钟内接触户外光，再分次补水。"], ["午后", "只选短小睡", "需要时睡 10–20 分钟；避开 30–60 分钟惯性区。"], ["睡前", "保护今晚", "按个体截止线停咖啡，睡前 3 小时结束进食。"]] },
  B: { duration: "先连续保护 2 周", note: "慢性不足型的问题更像是睡眠机会不够。补剂和技巧不能替代真实的睡眠窗口。", items: [["第一优先", "腾出睡眠窗口", "先把可睡时间逐步增加到接近个人需求估计。"], ["白天", "咖啡只做限时变量", "不靠不断加量填补长期不足，保留个体截止线。"], ["每周", "看中位数，不看单晚", "用 7 天睡眠时长中位数判断是否真的增加。"]] },
  C: { duration: "保护稳定晚相位", note: "你不是熬夜，这个稳定模式本身不构成问题。需要管理的是日照不足、夜间进食和长期维生素 D 风险。", items: [["醒后", "户外光照 20 分钟", "按你的实际醒来时间算早晨，不按社会钟点评价。"], ["清醒期", "把主餐放在活跃窗口", "避免临睡前集中吃重食，不使用道德化饮食目标。"], ["长期", "关注日照与维 D", "优先增加日照；怀疑缺乏时先检测，不自行上高剂量。"]] },
  D: { duration: "先稳定一个锚点", note: "自由日不需要完全复制工作日，但中点漂移压到 1 小时左右，通常比禁止补觉更可持续。", items: [["每天", "固定一个起床锚点", "自由日与受约束日的起床差先逐步缩小。"], ["醒后", "用光照固定相位", "起床后尽早接触户外光，让锚点更容易坚持。"], ["周报", "观察中点漂移", "不追求每晚完美，只看 7 天最大漂移是否下降。"]] },
  "D+": { duration: "按 3–6 周推进", note: "相位前移是数周工程。极低剂量褪黑素只作为相位工具，时点错误可能推向反方向；补剂闸门命中时不展示或建议。", items: [["固定", "起床后强光 20 分钟", "用连续的早段光照推动相位，不依赖单日早睡。"], ["晚间", "提前降低光照", "目标睡前 90 分钟调暗环境与屏幕亮度。"], ["推进", "每次只前移 15–30 分钟", "连续稳定后再移动下一步，不承诺一周解决。"]] },
  E: { duration: "夜班 / 轮班专用", note: "勿扰时段、光照和进食全部按你的班次相位计算，不按白天或夜晚的社会钟点评分。", items: [["主睡眠", "建立锚定睡眠", "无论班次怎么变，尽量保留一段每天重叠的核心睡眠。"], ["光照", "上班前增光，班后避光", "清醒前段用光；下班通勤减少强光，回家后遮光降温。"], ["咖啡与进食", "相对班次计时", "咖啡按计划睡眠倒推截止线，主餐放在清醒前半段。"]] },
};

const EXPERIMENT_CATALOG = {
  caffeine_cutoff: { id: "caffeine_cutoff", title: "提前结束咖啡因", action: "按个体截止线停止咖啡因", metric: "入睡耗时", unit: "分钟", lowerIsBetter: true, question: "昨晚躺下多久睡着？" },
  morning_light: { id: "morning_light", title: "醒后户外光照 15 分钟", action: "醒后 30 分钟内到户外", metric: "上午困倦", unit: "1–5 分", lowerIsBetter: true, question: "今天上午的困倦是几分？" },
  meal_cutoff: { id: "meal_cutoff", title: "睡前 3 小时停止进食", action: "按时间线结束进食", metric: "夜醒次数", unit: "次", lowerIsBetter: true, question: "昨晚醒了几次？" },
};

function getExperiments() {
  const stored = readJson(EXPERIMENTS_KEY, null);
  if (stored?.length) return stored;
  const seeded = [{ ...EXPERIMENT_CATALOG.caffeine_cutoff, status: "active", startedAt: new Date().toISOString(), observations: [] }];
  writeJson(EXPERIMENTS_KEY, seeded);
  return seeded;
}

function saveExperiments(experiments) {
  writeJson(EXPERIMENTS_KEY, experiments);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function evaluateExperiment(experiment) {
  const observations = uniqueExperimentObservations(experiment.observations);
  const done = observations.filter((item) => item.adherence === "done" && Number.isFinite(item.value)).map((item) => item.value);
  const missed = observations.filter((item) => item.adherence === "missed" && Number.isFinite(item.value)).map((item) => item.value);
  if (done.length < 5 || missed.length < 5) return { ...experiment, observations, status: "active", doneCount: done.length, missedCount: missed.length };
  const doneMedian = median(done);
  const missedMedian = median(missed);
  const improvement = experiment.lowerIsBetter ? (missedMedian - doneMedian) / Math.max(1, missedMedian) : (doneMedian - missedMedian) / Math.max(1, missedMedian);
  return { ...experiment, observations, status: improvement >= 0.15 ? "effective" : "ineffective", concludedAt: experiment.concludedAt || new Date().toISOString(), doneCount: done.length, missedCount: missed.length, doneMedian, missedMedian, improvement };
}

function classifyProfile(input) {
  const workDuration = sleepDuration(input.workSleep, input.workWake);
  const freeDuration = sleepDuration(input.freeSleep, input.freeWake);
  const workMidpoint = sleepMidpoint(input.workSleep, input.workWake);
  const freeMidpoint = sleepMidpoint(input.freeSleep, input.freeWake);
  const socialJetlag = circularDifference(workMidpoint, freeMidpoint);
  const weightedSleep = (workDuration * 5 + freeDuration * 2) / 7;

  let type;
  if (["shift", "night"].includes(input.schedule)) type = "E";
  else if (socialJetlag >= 120) type = "D";
  else if (freeMidpoint >= 270 && input.schedule === "free" && socialJetlag < 60) type = "C";
  else if (freeMidpoint >= 270 && input.schedule === "fixed") type = "D+";
  else if (weightedSleep < 390 && ["months", "always"].includes(input.duration)) type = "B";
  else if (input.duration === "recent") type = "A";
  else type = "B";

  return { type, workDuration, freeDuration, workMidpoint, freeMidpoint, socialJetlag, weightedSleep };
}

function updateProfileUI(profile) {
  if (!profile) return;
  const content = TYPE_CONTENT[profile.classification.type];
  q("#profileTypeCode").textContent = profile.classification.type;
  q("#profileTypeTitle").textContent = content[1];
  q("#profileTypeText").textContent = content[2];
  q(".profile-type-card .eyebrow").textContent = content[0];
  q("#sleepNeedParam").textContent = `${Math.floor(profile.classification.freeDuration / 60)}h${String(Math.round(profile.classification.freeDuration % 60)).padStart(2, "0")}m`;
  const halfLife = resolveHalfLife(profile);
  q("#halfLifeParam").textContent = `${halfLife.toFixed(1)}h`;
  const calibration = profile.caffeineCalibration;
  q("#halfLifeNote").textContent = calibration?.status === "personalized"
    ? `基于 ${calibration.sampleCount} 组历史配对 · ${calibration.confidence === "high" ? "高" : "中"}置信度`
    : profile.caffeineSensitive ? "依据敏感度自述，等待历史记录校准" : "默认工作参数，等待历史记录校准";
  q("#cutoffParam").textContent = calculateCutoff(q("#plannedSleep")?.value || "01:00", halfLife);
  q("#openProfile").textContent = profile.age >= 65 ? "65+" : "ME";
  const type = profile.classification.type;
  if (type === "E") {
    q("#todayTitle").textContent = "先保护你的锚定睡眠。";
    q("#heroPromise").textContent = "你的白天不一定在白天。所有光照、咖啡和勿扰时段都会按班次相位计算，不按钟点评判。";
  } else if (type === "C") {
    q("#todayTitle").textContent = "保持规律，不用和晚相位对抗。";
    q("#heroPromise").textContent = "稳定晚相位本身不构成问题。今天重点保护日照、进食窗口和你自己的睡眠锚点。";
  } else {
    q("#todayTitle").textContent = "今天先把损失降下来。";
    q("#heroPromise").textContent = "睡眠债不能完全补回。今天的重点，是缓解当下的不适，同时保护今晚的睡眠。";
  }
  if (q("#supplementGate")) {
    q("#supplementGate").hidden = !profile.supplementGate;
    q("#supplementGrid").hidden = profile.supplementGate;
  }
}

function setOnboardingStep(step) {
  onboardingStep = step;
  qa(".onboarding-step").forEach((section) => section.classList.toggle("active", Number(section.dataset.step) === step));
  q("#onboardingProgress").textContent = `${step} / 3`;
  q("#onboardingBack").hidden = step === 1;
  q("#onboardingNext").textContent = step === 3 ? "查看我的分型" : "下一步";
  q("#onboardingError").textContent = "";
}

function openOnboarding() {
  setOnboardingStep(1);
  const existing = readJson(PROFILE_KEY, null);
  if (existing) {
    q("#ageInput").value = existing.age;
    q("#pregnantCheck").checked = Boolean(existing.pregnantOrNursing);
    q("#medicationCheck").checked = Boolean(existing.medication);
    q("#conditionCheck").checked = Boolean(existing.condition);
    q("#caffeineSensitiveCheck").checked = Boolean(existing.caffeineSensitive);
    const restoreRadio = (name, value) => { const input = q(`input[name="${name}"][value="${value}"]`); if (input) input.checked = true; };
    restoreRadio("schedule", existing.schedule);
    restoreRadio("duration", existing.duration);
    restoreRadio("goal", existing.goal);
    ["workSleep", "workWake", "freeSleep", "freeWake"].forEach((id) => { if (existing[id]) q(`#${id}`).value = existing[id]; });
  }
  if (!q("#onboardingDialog").open) q("#onboardingDialog").showModal();
}

function completeOnboarding() {
  const selected = (name) => q(`input[name="${name}"]:checked`)?.value;
  const data = {
    schemaVersion: 1,
    age: Number(q("#ageInput").value),
    supplementGate: q("#pregnantCheck").checked || q("#medicationCheck").checked || q("#conditionCheck").checked,
    pregnantOrNursing: q("#pregnantCheck").checked,
    medication: q("#medicationCheck").checked,
    condition: q("#conditionCheck").checked,
    caffeineSensitive: q("#caffeineSensitiveCheck").checked,
    schedule: selected("schedule"),
    workSleep: q("#workSleep").value,
    workWake: q("#workWake").value,
    freeSleep: q("#freeSleep").value,
    freeWake: q("#freeWake").value,
    duration: selected("duration"),
    goal: selected("goal"),
    updatedAt: new Date().toISOString(),
  };
  const previous = readJson(PROFILE_KEY, null);
  const gateChanged = previous && ["pregnantOrNursing", "medication", "condition"].some((key) => Boolean(previous[key]) !== Boolean(data[key]));
  if (gateChanged && !window.confirm("你正在修改会影响补剂内容显示的健康状态。确认保存这次修改吗？")) return;
  data.classification = classifyProfile(data);
  writeJson(PROFILE_KEY, data);
  updateProfileUI(data);
  getRecords().then(updatePatterns).catch(() => renderTypeProtocol(data));
  q("#onboardingDialog").close();
  showToast(`已完成分型：${TYPE_CONTENT[data.classification.type][0]}。`);
}

function advanceOnboarding() {
  if (onboardingStep === 1) {
    const age = Number(q("#ageInput").value);
    if (!age) { q("#onboardingError").textContent = "请先填写年龄。"; return; }
    if (age < 18) {
      q("#onboardingError").innerHTML = "夜后修复当前只适用于成年人。青少年需要 8–10 小时睡眠，成人规则可能给出错误结论，因此这里不会继续放行。";
      return;
    }
    if (age > 120) { q("#onboardingError").textContent = "请检查年龄是否填写正确。"; return; }
  }
  if (onboardingStep < 3) setOnboardingStep(onboardingStep + 1); else completeOnboarding();
}

function openRecordsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("nightRepair", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sleepRecords")) db.createObjectStore("sleepRecords", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRecord(record) {
  const db = await openRecordsDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("sleepRecords", "readwrite");
    const store = transaction.objectStore("sleepRecords");
    const request = store.getAll();
    request.onsuccess = () => {
      request.result.filter((item) => item.date === record.date && item.id !== record.id).forEach((item) => store.delete(item.id));
      store.put(record);
    };
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getRecords() {
  const db = await openRecordsDb();
  const records = await new Promise((resolve, reject) => {
    const request = db.transaction("sleepRecords").objectStore("sleepRecords").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records.sort((a, b) => a.date.localeCompare(b.date));
}

function isoForTime(time, dayShift = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayShift);
  const [hour, minute] = time.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function selectedRecordDayShift() {
  return Number(q("#recordDay")?.value || 0);
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftedDateKey(days, from = new Date()) {
  const date = new Date(from);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function experimentObservationDay(observation) {
  if (observation.day) return observation.day;
  const date = new Date(observation.date);
  return Number.isNaN(date.getTime()) ? "" : localDateKey(date);
}

function uniqueExperimentObservations(observations = []) {
  const byDay = new Map();
  observations.forEach((observation, index) => {
    const day = experimentObservationDay(observation) || `legacy-${index}`;
    byDay.set(day, { ...observation, day });
  });
  return [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

function linkedReminderAdherence(experiment, plans = readJson(REMINDER_KEY, []), targetDay = shiftedDateKey(-1)) {
  const reminderId = EXPERIMENT_REMINDER_MAP[experiment?.id];
  if (!reminderId || !experiment) return null;
  const startedDay = experiment.startedAt ? localDateKey(new Date(experiment.startedAt)) : null;
  if (startedDay && targetDay < startedDay) return null;
  const plan = plans.find((item) => item.date === targetDay);
  const reminder = plan?.reminders?.find((item) => item.id === reminderId && item.enabled !== false);
  if (!reminder || !["done", "missed"].includes(reminder.result)) return null;
  return { adherence: reminder.result, date: targetDay, reminderId, source: "reminder" };
}

function sleepIntervalDates(onset, wake, dayShift = 0) {
  const now = new Date();
  const wakeDate = new Date(now);
  wakeDate.setDate(wakeDate.getDate() + dayShift);
  const [wakeHour, wakeMinute] = wake.split(":").map(Number);
  wakeDate.setHours(wakeHour, wakeMinute, 0, 0);
  if (dayShift === 0 && wakeDate > now) wakeDate.setDate(wakeDate.getDate() - 1);
  const onsetDate = new Date(wakeDate);
  const [onsetHour, onsetMinute] = onset.split(":").map(Number);
  onsetDate.setHours(onsetHour, onsetMinute, 0, 0);
  if (onsetDate >= wakeDate) onsetDate.setDate(onsetDate.getDate() - 1);
  const midpoint = new Date((onsetDate.getTime() + wakeDate.getTime()) / 2);
  return { onsetDate, wakeDate, midpoint };
}

function uniqueRecordsByDate(records) {
  const byDate = new Map();
  records.forEach((record) => {
    const current = byDate.get(record.date);
    const recordStamp = new Date(record.updatedAt || record.createdAt || 0).getTime();
    const currentStamp = current ? new Date(current.updatedAt || current.createdAt || 0).getTime() : -1;
    if (!current || recordStamp > currentStamp || (recordStamp === currentStamp && String(record.id) > String(current.id))) byDate.set(record.date, record);
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function recordMidpointMinutes(record) {
  const onset = new Date(record.sleepOnset);
  const wake = new Date(record.wakeTime);
  if (Number.isNaN(onset.getTime()) || Number.isNaN(wake.getTime())) return null;
  const midpoint = new Date((onset.getTime() + wake.getTime()) / 2);
  return midpoint.getHours() * 60 + midpoint.getMinutes();
}

function circularStats(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  const reference = valid[0];
  const unwrapped = valid.map((value) => {
    let adjusted = value;
    while (adjusted - reference > 720) adjusted -= 1440;
    while (reference - adjusted > 720) adjusted += 1440;
    return adjusted;
  });
  const center = ((median(unwrapped) % 1440) + 1440) % 1440;
  const distances = valid.map((value) => circularDifference(value, center));
  let span = 0;
  valid.forEach((a) => valid.forEach((b) => { span = Math.max(span, circularDifference(a, b)); }));
  return { center, distances, span, maxDrift: Math.max(...distances), regularDays: distances.filter((value) => value <= 30).length };
}

function formatClockMinutes(value) {
  const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function deriveRecordClassification(records, profile) {
  const recent = uniqueRecordsByDate(records).slice(-14);
  if (recent.length < 14 || !profile) return null;
  const midpointStats = circularStats(recent.map(recordMidpointMinutes));
  const medianTst = median(recent.map((record) => Number(record.tstMinutes)).filter(Number.isFinite));
  let type;
  if (["shift", "night"].includes(profile.schedule)) type = "E";
  else if (midpointStats?.span >= 120) type = "D";
  else if (midpointStats?.center >= 270 && profile.schedule === "free" && midpointStats.span < 60) type = "C";
  else if (midpointStats?.center >= 270 && profile.schedule === "fixed") type = "D+";
  else if (medianTst < 390) type = "B";
  else type = "A";
  return { type, medianTst, midpoint: midpointStats?.center ?? null, span: midpointStats?.span ?? null, signature: recent.map((record) => `${record.date}:${record.tstMinutes}`).join("|") };
}

function reclassifyProfile(records) {
  const profile = readJson(PROFILE_KEY, null);
  const derived = deriveRecordClassification(records, profile);
  if (!profile || !derived) return profile;
  if (profile.recordReclassification?.signature !== derived.signature) {
    const previousType = profile.classification.type;
    profile.classification = { ...profile.classification, type: derived.type, source: "records", recalculatedAt: new Date().toISOString() };
    profile.recordReclassification = { ...derived, previousType, recalculatedAt: new Date().toISOString() };
    profile.typeMigrations = [...(profile.typeMigrations || []), { from: previousType, to: derived.type, date: new Date().toISOString() }].slice(-12);
    writeJson(PROFILE_KEY, profile);
  }
  return profile;
}

function updateCaffeineCalibration(records, profile) {
  if (!profile) return profile;
  const calibration = calibrateCaffeineHalfLife(records);
  const previous = profile.caffeineCalibration;
  if (previous?.signature !== calibration.signature || previous?.status !== calibration.status || previous?.halfLife !== calibration.halfLife) {
    profile.caffeineCalibration = { ...calibration, updatedAt: new Date().toISOString() };
    writeJson(PROFILE_KEY, profile);
  }
  return profile;
}

function formatMinutes(value) {
  const hours = Math.floor(Math.abs(value) / 60);
  const minutes = Math.round(Math.abs(value) % 60);
  return `${hours ? `${hours} 小时 ` : ""}${minutes} 分`;
}

function caffeineRemaining(entries, targetTime, halfLife = 5) {
  return entries.reduce((total, entry) => {
    const elapsedHours = Math.max(0, (targetTime - new Date(entry.time)) / 36e5);
    return total + entry.mg * Math.pow(0.5, elapsedHours / halfLife);
  }, 0);
}

function plannedSleepDateForRecord(record) {
  const plannedSleep = record.ruleFacts?.plannedSleep;
  const wakeDate = new Date(record.wakeTime);
  if (!plannedSleep || Number.isNaN(wakeDate.getTime())) return null;
  const [hour, minute] = plannedSleep.split(":").map(Number);
  const target = new Date(wakeDate);
  target.setHours(hour, minute, 0, 0);
  if (target <= wakeDate) target.setDate(target.getDate() + 1);
  return target;
}

function caffeineCalibrationSamples(records) {
  const ordered = uniqueRecordsByDate(records);
  const samples = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const plannedDate = plannedSleepDateForRecord(current);
    const actualOnset = new Date(next.sleepOnset);
    if (!plannedDate || Number.isNaN(actualOnset.getTime())) continue;
    const delayMinutes = Math.round((actualOnset - plannedDate) / 60000);
    if (delayMinutes < -120 || delayMinutes > 360) continue;
    samples.push({
      date: current.date,
      entries: current.caffeine || [],
      plannedDate,
      delayMinutes: Math.max(0, delayMinutes),
      caffeineTotal: (current.caffeine || []).reduce((sum, item) => sum + Number(item.mg || 0), 0),
    });
  }
  return samples;
}

function pearsonCorrelation(xs, ys) {
  if (xs.length < 2 || xs.length !== ys.length) return 0;
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let xSquare = 0;
  let ySquare = 0;
  xs.forEach((x, index) => {
    const xDelta = x - xMean;
    const yDelta = ys[index] - yMean;
    numerator += xDelta * yDelta;
    xSquare += xDelta ** 2;
    ySquare += yDelta ** 2;
  });
  return xSquare && ySquare ? numerator / Math.sqrt(xSquare * ySquare) : 0;
}

function linearFitRmse(xs, ys) {
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const variance = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  const slope = variance ? xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0) / variance : 0;
  const intercept = yMean - slope * xMean;
  const mse = xs.reduce((sum, value, index) => sum + (ys[index] - (intercept + slope * value)) ** 2, 0) / xs.length;
  return { rmse: Math.sqrt(mse), slope };
}

function calibrateCaffeineHalfLife(records) {
  const samples = caffeineCalibrationSamples(records);
  const caffeinatedDays = samples.filter((sample) => sample.caffeineTotal > 0).length;
  const signature = samples.map((sample) => `${sample.date}:${sample.caffeineTotal}:${sample.delayMinutes}`).join("|");
  if (samples.length < 7 || caffeinatedDays < 4) return { status: "collecting", sampleCount: samples.length, caffeinatedDays, signature };
  const delays = samples.map((sample) => sample.delayMinutes);
  if (Math.max(...delays) - Math.min(...delays) < 15) return { status: "low_variation", sampleCount: samples.length, caffeinatedDays, signature };
  const candidates = [];
  for (let halfLife = 3; halfLife <= 7; halfLife += 0.25) {
    const residuals = samples.map((sample) => caffeineRemaining(sample.entries, sample.plannedDate, halfLife));
    if (Math.max(...residuals) - Math.min(...residuals) < 25) continue;
    const correlation = pearsonCorrelation(residuals, delays);
    const fit = linearFitRmse(residuals, delays);
    if (fit.slope > 0) candidates.push({ halfLife, correlation, rmse: fit.rmse });
  }
  if (!candidates.length) return { status: "low_variation", sampleCount: samples.length, caffeinatedDays, signature };
  candidates.sort((a, b) => a.rmse - b.rmse);
  const best = candidates[0];
  if (best.correlation < 0.35) return { status: "weak_signal", sampleCount: samples.length, caffeinatedDays, correlation: best.correlation, signature };
  return {
    status: "personalized",
    halfLife: Math.round(best.halfLife * 4) / 4,
    sampleCount: samples.length,
    caffeinatedDays,
    correlation: best.correlation,
    rmse: best.rmse,
    confidence: samples.length >= 14 && best.correlation >= 0.6 ? "high" : "medium",
    signature,
  };
}

function resolveHalfLife(profile, records = []) {
  const liveCalibration = records.length ? calibrateCaffeineHalfLife(records) : null;
  const calibration = liveCalibration?.status === "personalized" ? liveCalibration : profile?.caffeineCalibration;
  if (calibration?.status === "personalized") return calibration.halfLife;
  return profile?.caffeineSensitive ? 6.5 : 5;
}

function caffeineBeforeMinute(record, minuteOfDay) {
  return (record.caffeine || []).reduce((sum, entry) => {
    const time = new Date(entry.time);
    return time.getHours() * 60 + time.getMinutes() <= minuteOfDay ? sum + Number(entry.mg || 0) : sum;
  }, 0);
}

function recentCaffeineBaseline(records, referenceTime) {
  const recent = records.slice(-7);
  if (recent.length < 3) return null;
  return median(recent.map((record) => caffeineBeforeMinute(record, referenceTime.getHours() * 60 + referenceTime.getMinutes())));
}

function stageVendorLabel(vendor) {
  return { huawei: "华为运动健康", xiaomi: "小米运动健康", garmin: "Garmin Connect", oppo: "OPPO 健康", honor: "荣耀运动健康", other: "其他设备" }[vendor] || "未识别设备";
}

function sleepStageSample(stages, tstMinutes, date = "") {
  const tst = Number(tstMinutes);
  const deepMinutes = Number.isFinite(stages?.deepMinutes) ? stages.deepMinutes : null;
  const remMinutes = Number.isFinite(stages?.remMinutes) ? stages.remMinutes : null;
  if (!stages?.vendor || stages.vendor === "unknown" || !Number.isFinite(tst) || tst <= 0 || (deepMinutes === null && remMinutes === null)) return null;
  if ((deepMinutes !== null && deepMinutes > tst) || (remMinutes !== null && remMinutes > tst) || (deepMinutes || 0) + (remMinutes || 0) > tst) return null;
  return {
    date,
    vendor: stages.vendor,
    tstMinutes: tst,
    deepMinutes,
    remMinutes,
    deepPercent: deepMinutes === null ? null : deepMinutes / tst * 100,
    remPercent: remMinutes === null ? null : remMinutes / tst * 100,
  };
}

function stageBaselineForVendor(records, vendor) {
  const samples = uniqueRecordsByDate(records).map((record) => sleepStageSample(record.stages, record.tstMinutes, record.date)).filter((sample) => sample?.vendor === vendor).slice(-14);
  const deepValues = samples.map((sample) => sample.deepPercent).filter(Number.isFinite);
  const remValues = samples.map((sample) => sample.remPercent).filter(Number.isFinite);
  return {
    vendor,
    samples,
    sampleCount: samples.length,
    deepCount: deepValues.length,
    remCount: remValues.length,
    deepMedian: deepValues.length >= 5 ? median(deepValues) : null,
    remMedian: remValues.length >= 5 ? median(remValues) : null,
  };
}

function analyzeCurrentSleepStages(stages, tstMinutes, previousRecords) {
  const current = sleepStageSample(stages, tstMinutes);
  if (!current) return null;
  const baseline = stageBaselineForVendor(previousRecords, current.vendor);
  return {
    ...current,
    baselineCount: baseline.sampleCount,
    deepBaseline: baseline.deepMedian,
    remBaseline: baseline.remMedian,
    deepDelta: baseline.deepMedian === null || current.deepPercent === null ? null : current.deepPercent - baseline.deepMedian,
    remDelta: baseline.remMedian === null || current.remPercent === null ? null : current.remPercent - baseline.remMedian,
  };
}

function gapMinutes(fromTime, toTime) {
  let gap = toMinutes(toTime) - toMinutes(fromTime);
  if (gap < 0) gap += 1440;
  return gap;
}

function buildFacts(previousRecords = []) {
  const profile = readJson(PROFILE_KEY, null);
  const onset = q("#sleepOnset").value;
  const wake = q("#wakeTime").value;
  const plannedSleep = q("#plannedSleep").value;
  const tstMinutes = sleepDuration(onset, wake);
  const sleepNeed = profile?.classification?.freeDuration || 450;
  const debtMinutes = Math.max(0, sleepNeed - tstMinutes);
  const recordDayShift = selectedRecordDayShift();
  const now = new Date();
  const analysisNow = new Date(now);
  analysisNow.setDate(analysisNow.getDate() + recordDayShift);
  const sleepDates = sleepIntervalDates(onset, wake, recordDayShift);
  const wakeDate = sleepDates.wakeDate;
  let plannedDate = new Date(analysisNow);
  const [plannedHour, plannedMinute] = plannedSleep.split(":").map(Number);
  plannedDate.setHours(plannedHour, plannedMinute, 0, 0);
  if (plannedDate <= analysisNow) plannedDate.setDate(plannedDate.getDate() + 1);
  const halfLife = resolveHalfLife(profile, previousRecords);
  const caffeineNow = caffeineRemaining(appState.caffeine, analysisNow, halfLife);
  const caffeineAtSleep = caffeineRemaining(appState.caffeine, plannedDate, halfLife);
  const caffeineTotal = appState.caffeine.reduce((sum, item) => sum + item.mg, 0);
  const caffeineBaseline = recentCaffeineBaseline(previousRecords, analysisNow);
  const caffeineGap = caffeineBaseline === null ? null : caffeineTotal - caffeineBaseline;
  const stageContext = analyzeCurrentSleepStages(appState.screenshotImport, tstMinutes, previousRecords);
  const hydration = q('input[name="hydration"]:checked').value;
  const lastMeal = { time: q("#lastMealTime").value, weight: q("#lastMealWeight").value };
  return {
    profile, onset, wake, plannedSleep, tstMinutes, sleepNeed, debtMinutes,
    awakeMinutes: Math.max(0, Math.round((analysisNow - wakeDate) / 60000)),
    caffeineNow, caffeineAtSleep, caffeineTotal, caffeineBaseline, caffeineGap, halfLife, hydration, lastMeal, stageContext,
    mealToSleep: gapMinutes(lastMeal.time, plannedSleep),
    hoursToSleep: (plannedDate - now) / 36e5,
    symptoms: [...appState.selectedSymptoms],
    energy: q("#energyLevel").value,
    mood: q("#moodState").value,
    drivingToday: q("#drivingToday").checked,
    earlyWake: q("#earlyWake").checked,
    osaFlags: qa('#osaGrid input:checked').map((input) => input.value), recordDayShift,
  };
}

function assessStructuralSafety(facts, previousRecords) {
  const notices = [];
  const profile = facts.profile;
  const stableSleep = facts.tstMinutes >= 420 && (profile?.classification?.socialJetlag ?? 999) < 60;
  const fatigueDays = previousRecords.slice(-6).filter((record) => ["very", "extreme"].includes(record.energy)).length + (["very", "extreme"].includes(facts.energy) ? 1 : 0);
  if (profile?.goal === "fatigue" && stableSleep && fatigueDays >= 7 && facts.osaFlags.length >= 2) {
    notices.push({ type: "osa", title: "这不像单纯的睡眠不足。", body: "你的睡眠时长并不差，但白天仍然疲惫，且轻量筛查命中了多项风险。建议预约睡眠门诊或做一次睡眠监测；这里不会用恢复技巧掩盖它。" });
  }
  const recentLow = previousRecords.slice(-2).filter((record) => record.mood === "low" && record.earlyWake).length;
  if (facts.mood === "low" && facts.earlyWake && recentLow >= 2) {
    notices.push({ type: "mood", title: "这可能超出作息能解决的范围。", body: "连续低落、早醒和长期失眠同时出现时，更适合寻求心理或精神健康专业支持。这里暂停用分数评价你。" });
  }
  if (facts.energy === "extreme" && facts.drivingToday) {
    notices.push({ type: "driving", title: "今天先不要开车或操作机械。", body: "明显嗜睡会降低反应速度和判断力，咖啡不能可靠抵消风险。优先改用公共交通、打车或请人协助。" });
  }
  return notices;
}

function renderStructuralNotices(notices) {
  const notice = q("#structuralNotice");
  notice.hidden = !notices.length;
  notice.innerHTML = notices.map((item) => `<article data-safety="${item.type}"><strong>${item.title}</strong><p>${item.body}</p></article>`).join("");
  q(".score-pair").classList.toggle("score-paused", notices.some((item) => item.type === "mood"));
}

const FACTOR_COPY = {
  sleepDebt: ["睡眠不足带来的交感激活", "睡眠不足会暂时抬高警觉系统，也会放大心慌、烦躁、怕冷和食欲变化。这不是你意志力不够。"],
  caffeineResidual: ["咖啡因残留偏高", "你此刻体内仍有较多咖啡因。即使感觉能睡着，它也可能影响今晚的深睡与入睡节奏。"],
  withdrawal: ["咖啡因戒断", "你平时这个时间已有咖啡因摄入，今天明显减少。停用后 12–24 小时出现的头痛常被误判成熬夜后遗症。"],
  dehydration: ["饮水不足", "清醒数小时后仍然饮水偏少，会放大头痛、心慌、恶心和肌肉酸沉。"],
  inertia: ["睡眠惯性", "起床后 45 分钟内，大脑仍可能处在睡眠惯性中。这个阶段的迟钝不代表今天都会这样。"],
  appetite: ["睡眠不足后的食欲变化", "想吃甜的不是意志力问题。睡眠不足会压低瘦素、抬高胃饥饿素，这是生理反应。"],
  lateMeal: ["夜间进食影响", "末次进食距离计划入睡较近且份量偏重，可能增加恶心、夜醒和晨起沉重感。"],
  eyeStrain: ["屏幕眼疲劳", "长时屏幕与睡眠不足叠加时，眼干和头痛更容易一起出现。"],
  deepBelowBaseline: ["深睡比例低于你的同设备基线", "这次设备估算的深睡比例比你自己同一设备的历史中位数低。分期本身有误差，因此这里只提示与咖啡因残留同时出现的关联，不把它当作因果或诊断。"],
  remBelowBaseline: ["REM 比例低于你的同设备基线", "这次 REM 比例低于你自己同一设备的历史中位数，可能帮助解释睡够仍觉得情绪或注意力没有恢复。这里只看个人趋势，不跨设备比较。"],
};

function scoreFactors(facts) {
  const scores = [];
  const has = (name) => facts.symptoms.includes(name);
  const add = (id, score, evidence) => { if (score >= 24) scores.push({ id, score, evidence }); };
  add("sleepDebt", facts.debtMinutes >= 120 ? 55 + ["心慌", "情绪烦躁", "怕冷", "注意力涣散"].filter(has).length * 12 : 0, `睡眠债 −${formatMinutes(facts.debtMinutes)}`);
  add("caffeineResidual", facts.caffeineNow >= 150 ? 60 + ["心慌", "胸闷", "情绪烦躁"].filter(has).length * 10 : 0, `当前残留约 ${Math.round(facts.caffeineNow)}mg`);
  add("withdrawal", has("头痛") && facts.caffeineGap !== null && facts.caffeineGap <= -80 ? 58 : 0, `比近 7 次同一时段少约 ${Math.round(Math.abs(facts.caffeineGap || 0))}mg`);
  add("dehydration", facts.hydration === "low" && facts.awakeMinutes >= 240 ? 46 + ["头痛", "心慌", "恶心", "肌肉酸沉"].filter(has).length * 9 : 0, `清醒 ${formatMinutes(facts.awakeMinutes)} · 饮水偏少`);
  add("inertia", facts.awakeMinutes < 45 ? 48 + ["注意力涣散", "恶心", "情绪烦躁"].filter(has).length * 8 : 0, `起床仅 ${facts.awakeMinutes} 分钟`);
  add("appetite", facts.debtMinutes >= 120 && has("想吃甜的") ? 62 : 0, `睡眠债 ${Math.round(facts.debtMinutes / 60 * 10) / 10} 小时`);
  add("lateMeal", facts.lastMeal.weight === "heavy" && facts.mealToSleep < 120 ? 52 + (has("恶心") ? 15 : 0) : 0, `末次进食距睡前 ${formatMinutes(facts.mealToSleep)}`);
  add("eyeStrain", has("眼干") ? 42 + (has("头痛") ? 12 : 0) : 0, "眼干与头痛同时出现");
  add("deepBelowBaseline", facts.stageContext?.deepDelta <= -5 && facts.caffeineAtSleep >= 40 ? 48 : 0, `同设备近 ${facts.stageContext?.baselineCount || 0} 次中位数相比 ${Math.round(facts.stageContext?.deepDelta || 0)} 个百分点 · 睡前咖啡因约 ${Math.round(facts.caffeineAtSleep)}mg`);
  const remSymptoms = ["注意力涣散", "情绪烦躁"].filter(has).length + (["very", "extreme"].includes(facts.energy) ? 1 : 0);
  add("remBelowBaseline", facts.stageContext?.remDelta <= -5 && remSymptoms ? 44 + remSymptoms * 5 : 0, `同设备近 ${facts.stageContext?.baselineCount || 0} 次中位数相比 ${Math.round(facts.stageContext?.remDelta || 0)} 个百分点`);
  return scores.sort((a, b) => b.score - a.score).slice(0, 3);
}

function getConfidence(score) {
  if (score >= 70) return ["最可能", "高置信度"];
  if (score >= 48) return ["也可能", "中置信度"];
  return ["不排除", "低置信度"];
}

function calculateCutoff(plannedSleep, halfLife = 5) {
  const clearanceMinutes = halfLife * 60 * Math.log2(140 / 50);
  let value = Math.round(toMinutes(plannedSleep) - clearanceMinutes);
  if (value < 0) value += 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function generateActions(facts, factors, safetyNotices = []) {
  const actions = [];
  const has = (symptom) => facts.symptoms.includes(symptom);
  const add = (priority, title, body, verify, kind) => actions.push({ priority, title, body, verify, kind });

  if (safetyNotices.some((item) => item.type === "driving")) add(100, "今天不要开车或操作机械", "极度疲惫时，咖啡不能恢复判断与反应能力。优先改用公共交通或请人协助。", "今天是否避开了高风险操作？", "safety");
  if (safetyNotices.some((item) => item.type === "osa")) add(98, "预约睡眠监测或睡眠门诊", "这组表现需要排查睡眠呼吸问题，不继续叠加一般恢复技巧。", "是否完成了咨询或预约？", "osa");
  if (safetyNotices.some((item) => item.type === "mood")) add(97, "联系可信任的人或专业支持", "先把持续低落交给能够提供支持的人，不要求你靠作息技巧独自解决。", "今天是否联系到支持？", "mood");
  if (factors.some((item) => item.id === "dehydration") || has("头痛") || has("心慌")) add(90, "先补 500ml 水", "分几次喝完；大量出汗或口干明显时，可以选择低糖电解质饮品。", "明早头痛有没有缓解？", "water");

  const caffeineBlocked = facts.caffeineNow >= 150 || facts.hoursToSleep < 8 || has("心慌");
  if (caffeineBlocked) add(84, "今天不再增加咖啡因", `预计睡前仍残留约 ${Math.round(facts.caffeineAtSleep)}mg。先用光照、短走动和补水保持清醒。`, "昨晚躺下多久睡着？", "caffeine");
  else add(78, `如果要喝，${calculateCutoff(facts.plannedSleep, facts.halfLife)} 前结束`, "把咖啡因当作需要计量和限时的变量；单次不超过 200mg。", "昨晚躺下多久睡着？", "caffeine");

  if (facts.debtMinutes >= 90 && facts.hoursToSleep >= 4) add(70, "安排 20 分钟小睡", "只选 10–20 分钟或完整 90 分钟；避免 30–60 分钟的睡眠惯性区。", "下午精神比上午好吗？", "nap");
  if (has("想吃甜的") || factors.some((item) => item.id === "lateMeal")) add(64, "午饭保留主食，加一份蛋白质", "不做热量惩罚。用稳定的一餐降低下午的血糖波动。", "下午的饮食冲动有没有减轻？", "meal");
  if (has("眼干")) add(55, "离开屏幕 10 分钟", "看向远处并眨眼，让眼睛先降负荷。", "眼干和头痛有没有缓解？", "eyes");
  return actions.sort((a, b) => b.priority - a.priority).slice(0, 3);
}

function renderAnalysis(facts, factors, actions) {
  q("#sampleBanner").hidden = true;
  const title = factors.length === 1 ? "更可能来自这件事" : `更可能来自这 ${factors.length} 件事`;
  q("#attributionTitle").textContent = title;
  q("#attributionCards").innerHTML = factors.map((factor, index) => {
    const [lead, confidence] = getConfidence(factor.score);
    const [name, copy] = FACTOR_COPY[factor.id];
    return `<article class="reason-card ${index === 0 ? "primary-reason" : ""}"><div class="card-kicker"><span>${lead}</span><b>${confidence}</b></div><h3>${name}</h3><p>${copy}</p><div class="evidence-line"><span>判断依据</span><strong>${factor.evidence}</strong><i style="--fill:${Math.min(92, factor.score)}%"></i></div></article>`;
  }).join("") || `<article class="reason-card primary-reason"><div class="card-kicker"><span>数据不足</span><b>保持诚实</b></div><h3>暂时没有足够依据做归因</h3><p>再记录一两项症状或今天的饮水与咖啡因，系统不会为了凑数硬给结论。</p></article>`;

  q("#actionList").innerHTML = actions.map((action, index) => `<article class="action-card"><span class="action-number">${String(index + 1).padStart(2, "0")}</span><div><strong>${action.title}</strong><p>${action.body}</p><small>验证：${action.verify}</small></div><button class="done-button" data-action="${action.kind}" type="button" aria-pressed="false">去做</button></article>`).join("");
  bindActionButtons();

  const sleepPenalty = Math.min(35, facts.debtMinutes * 0.12);
  const caffeinePenalty = Math.min(20, facts.caffeineAtSleep * 0.12);
  const mealPenalty = facts.mealToSleep < 120 && facts.lastMeal.weight === "heavy" ? 10 : 0;
  const profileType = facts.profile?.classification?.type || facts.profileType || "A";
  const scoreFloor = ["C", "E"].includes(profileType) ? 65 : 25;
  q("#stateScore").textContent = Math.max(scoreFloor, Math.round(100 - sleepPenalty - caffeinePenalty - mealPenalty));
  q("#scoreBreakdown").innerHTML = `<li>睡眠债 −${Math.round(sleepPenalty)}</li><li>咖啡因时点 −${Math.round(caffeinePenalty)}</li><li>夜间进食 −${mealPenalty}</li>${["C", "E"].includes(profileType) ? "<li>晚相位 / 夜班不扣分</li>" : ""}`;
  renderCaffeineStatus(facts);
  renderTimeline(facts);
}

function renderAttributionFeedback(recordId) {
  appState.activeRecordId = recordId || null;
  const status = q("#attributionFeedbackStatus");
  const existing = readJson(FEEDBACK_KEY, []).findLast((item) => item.type === "attribution" && item.recordId === recordId);
  qa("[data-attribution-feedback]").forEach((button) => button.classList.toggle("active", existing?.accurate === (button.dataset.attributionFeedback === "yes")));
  status.textContent = existing ? "已记下；它会帮助我们回标归因权重。" : "你的反馈只保存在本机。";
}

function saveAttributionFeedback(accurate) {
  if (!appState.activeRecordId) { showToast("完成一次记录后才能反馈真实归因。"); return; }
  const feedback = readJson(FEEDBACK_KEY, []).filter((item) => !(item.type === "attribution" && item.recordId === appState.activeRecordId));
  feedback.push({ type: "attribution", recordId: appState.activeRecordId, accurate, date: new Date().toISOString() });
  writeJson(FEEDBACK_KEY, feedback.slice(-200));
  renderAttributionFeedback(appState.activeRecordId);
  showToast("已记下这次反馈，只保存在你的设备。 ");
}

function renderCaffeineStatus(facts) {
  const halfLife = Number(facts.halfLife || resolveHalfLife(readJson(PROFILE_KEY, null)));
  const calibration = readJson(PROFILE_KEY, null)?.caffeineCalibration;
  const parameterSource = calibration?.status === "personalized" ? "历史校准参数" : "工作参数";
  q("#caffeineNowValue").textContent = `${Math.round(facts.caffeineNow)}mg`;
  q("#caffeineSleepValue").textContent = `${Math.round(facts.caffeineAtSleep)}mg`;
  q("#caffeineCutoffValue").textContent = calculateCutoff(facts.plannedSleep, halfLife);
  if (facts.caffeineBaseline == null) q("#caffeineStatusNote").textContent = `按 ${halfLife.toFixed(1)} 小时${parameterSource}估算；再有 3 次记录后开始比较同一时段。`;
  else {
    const direction = facts.caffeineGap > 0 ? "多" : facts.caffeineGap < 0 ? "少" : "相同";
    q("#caffeineStatusNote").textContent = direction === "相同" ? `与近 7 次同一时段中位数相同；${parameterSource} ${halfLife.toFixed(1)} 小时。` : `比近 7 次同一时段中位数${direction}约 ${Math.round(Math.abs(facts.caffeineGap))}mg；${parameterSource} ${halfLife.toFixed(1)} 小时。`;
  }
  q("#halfLifeParam").textContent = `${halfLife.toFixed(1)}h`;
  q("#cutoffParam").textContent = calculateCutoff(facts.plannedSleep, halfLife);
}

function renderTimeline(facts) {
  const addToTime = (time, minutesToAdd) => {
    const value = (toMinutes(time) + minutesToAdd + 1440) % 1440;
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  };
  const type = facts.profile?.classification?.type || facts.profileType || "A";
  const halfLife = Number(facts.halfLife || resolveHalfLife(readJson(PROFILE_KEY, null)));
  const lightCopy = type === "E" ? ["醒后定向光照 20 分钟", "按你的班次锚定清醒，不按社会钟点判断白天。"] : type === "C" ? ["醒后户外光照 20 分钟", "保护稳定晚相位，同时补足日照暴露。"] : type === "D+" ? ["起床后强光 20 分钟", "相位前移需要连续数周，今天只做一个锚点。"] : ["户外光照 15 分钟", "起床后光照，不透支今晚。"];
  const windDownCopy = type === "E" ? ["通勤避光与睡前降温", "接近锚定睡眠时减少强光，必要时佩戴遮光镜。"] : type === "D+" ? ["晚间控光与收尾", "把灯光调暗，减少高亮屏幕，配合相位前移。"] : ["睡前降温与收尾", "关低灯光，清空待办，做 3 分钟呼吸。"];
  const items = [
    { id: "light", time: addToTime(facts.wake, 30), title: lightCopy[0], description: lightCopy[1], kind: "light" },
    { id: "caffeine", time: calculateCutoff(facts.plannedSleep, halfLife), title: "今日咖啡截止线", description: `按你的 ${halfLife.toFixed(1)} 小时参数估算，睡前残留约 ${Math.round(facts.caffeineAtSleep)}mg。`, kind: "caffeine" },
    { id: "nap", time: addToTime(facts.wake, 270), title: "20 分钟小睡窗口", description: `自动配 ${addToTime(facts.wake, 290)} 唤醒。`, kind: "nap" },
    { id: "meal", time: addToTime(facts.plannedSleep, -180), title: "停止进食", description: "给消化和体温下降留出时间。", kind: "meal" },
    { id: "winddown", time: addToTime(facts.plannedSleep, -90), title: windDownCopy[0], description: windDownCopy[1], kind: "winddown" },
  ];
  const date = localDateKey(new Date());
  const plans = readJson(REMINDER_KEY, []);
  const savedPlan = plans.find((plan) => plan.date === date);
  const fatigue = !savedPlan && hasReminderFatigue(plans, date);
  const defaultLimit = fatigue ? 3 : 5;
  const experimentOutcomes = getExperiments().map(evaluateExperiment);
  q("#timelineList").innerHTML = items.map((item, index) => {
    const saved = savedPlan?.reminders?.find((entry) => entry.id === item.id);
    const experiment = experimentOutcomes.find((entry) => EXPERIMENT_REMINDER_MAP[entry.id] === item.id);
    const safetyOverride = item.id === "caffeine" && (facts.caffeineNow >= 150 || facts.symptoms.includes("心慌"));
    const personalizedDefault = experiment?.status === "effective";
    const personalizedRemoval = experiment?.status === "ineffective" && !safetyOverride;
    const enabled = saved ? saved.enabled !== false : personalizedRemoval ? false : personalizedDefault || index < defaultLimit;
    const result = saved?.result || "";
    const conclusionNote = safetyOverride && experiment?.status === "ineffective" ? "安全信号覆盖了实验撤回，今天仍保留。" : personalizedDefault ? "已验证对你有效，默认保留。" : personalizedRemoval ? "实验未观察到差异，默认关闭；可手动勾选。" : "";
    return `<article class="timeline-item ${index === 0 ? "active" : ""} ${enabled ? "" : "disabled"} ${result === "done" ? "done" : result === "missed" ? "missed" : ""}" data-reminder-id="${item.id}" data-result="${result}"><input class="timeline-check" type="checkbox" ${enabled ? "checked" : ""} data-kind="${item.kind}" aria-label="选择${item.title}提醒" /><input class="timeline-time" type="time" value="${saved?.time || item.time}" aria-label="${item.title}提醒时间" /><span><strong>${item.title}</strong><small>${item.description}</small>${conclusionNote ? `<em class="conclusion-note">${conclusionNote}</em>` : ""}</span><div class="timeline-feedback"><button type="button" data-reminder-result="done" class="${result === "done" ? "active" : ""}">做了</button><button type="button" data-reminder-result="missed" class="${result === "missed" ? "active" : ""}">没做</button></div></article>`;
  }).join("");
  q("#reminderPlanStatus").textContent = savedPlan ? "今天的提醒计划已保存在本机；修改后请再次保存。" : fatigue ? "连续 3 天没有反馈，今天先降为 3 条；你仍可重新勾选。" : "默认全选；修改后一次保存。小睡仍会额外生成唤醒事件。";
  bindTimeline();
  updateReminderCount();
  updateRepairScore();
}

function hasReminderFatigue(plans, date) {
  const previous = plans.filter((plan) => plan.date < date).sort((a, b) => a.date.localeCompare(b.date)).slice(-3);
  return previous.length === 3 && previous.every((plan) => (plan.reminders || []).filter((item) => item.enabled !== false).every((item) => !item.result));
}

function collectReminderPlan() {
  return {
    schemaVersion: 1,
    date: localDateKey(new Date()),
    profileType: readJson(PROFILE_KEY, null)?.classification?.type || "A",
    savedAt: new Date().toISOString(),
    reminders: qa(".timeline-item").slice(0, 5).map((item) => ({
      id: item.dataset.reminderId,
      time: q(".timeline-time", item).value,
      title: q("strong", item).textContent,
      description: q("small", item).textContent,
      kind: q(".timeline-check", item).dataset.kind || "routine",
      enabled: q(".timeline-check", item).checked,
      result: item.dataset.result || null,
    })),
  };
}

function saveReminderPlan(silent = false) {
  const plan = collectReminderPlan();
  const plans = readJson(REMINDER_KEY, []).filter((item) => item.date !== plan.date);
  plans.push(plan);
  writeJson(REMINDER_KEY, plans.sort((a, b) => a.date.localeCompare(b.date)).slice(-60));
  q("#reminderPlanStatus").textContent = `已保存 ${plan.reminders.filter((item) => item.enabled).length} 条提醒；数据只在本机。`;
  q("#saveReminders").classList.remove("dirty");
  if (!silent) showToast("今天的提醒已一次保存；日历会使用这些时间。 ");
}

function updateReminderCount() {
  const count = qa(".timeline-check:checked").length;
  q("#reminderCount").textContent = `${count} 条已选`;
}

function markReminderDirty() {
  updateReminderCount();
  q("#saveReminders").classList.add("dirty");
  q("#reminderPlanStatus").textContent = "有未保存的修改；确认后会覆盖今天的本机提醒计划。";
}

function recordReminderResult(item, result) {
  item.dataset.result = result;
  item.classList.toggle("done", result === "done");
  item.classList.toggle("missed", result === "missed");
  qa("[data-reminder-result]", item).forEach((button) => button.classList.toggle("active", button.dataset.reminderResult === result));
  const feedback = readJson(FEEDBACK_KEY, []);
  feedback.push({ type: "reminder", reminderId: item.dataset.reminderId, result, date: new Date().toISOString() });
  writeJson(FEEDBACK_KEY, feedback.slice(-200));
  saveReminderPlan(true);
  updateRepairScore();
  showToast(result === "done" ? "已记下：做了。" : "已记下：没做。不会扣分，也不会清零。 ");
}

function bindActionButtons() {
  qa(".done-button").forEach((button) => button.addEventListener("click", () => {
    const done = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(done));
    button.classList.toggle("is-done", done);
    button.textContent = done ? "已做" : "去做";
    const feedback = readJson(FEEDBACK_KEY, []);
    feedback.push({ date: new Date().toISOString(), action: button.dataset.action || "demo", done });
    writeJson(FEEDBACK_KEY, feedback.slice(-100));
    updateRepairScore();
  }));
}

function bindTimeline() {
  qa(".timeline-check").forEach((input) => input.addEventListener("change", () => {
    input.closest(".timeline-item").classList.toggle("disabled", !input.checked);
    markReminderDirty();
  }));
  qa(".timeline-time").forEach((input) => input.addEventListener("change", markReminderDirty));
  qa("[data-reminder-result]").forEach((button) => button.addEventListener("click", () => recordReminderResult(button.closest(".timeline-item"), button.dataset.reminderResult)));
}

function updateRepairScore() {
  const count = qa(".done-button.is-done").length + qa('.timeline-item[data-result="done"]').length;
  q("#repairScore").innerHTML = `${Math.min(5, count)}<em>/5</em>`;
}

async function submitQuickRecord(event) {
  event.preventDefault();
  const redflags = qa('#redflagGrid input:checked').map((input) => input.value);
  if (redflags.length) {
    q("#safetyMessage").textContent = `你勾选了：${redflags.join("、")}。请立即联系当地急救服务或尽快就医，不要自行驾车。`;
    q("#safetyDialog").showModal();
    return;
  }
  const previousRecords = await getRecords().catch(() => []);
  const facts = buildFacts(previousRecords);
  const safetyNotices = assessStructuralSafety(facts, previousRecords);
  const factors = scoreFactors(facts);
  const actions = generateActions(facts, factors, safetyNotices);
  const sleepDates = sleepIntervalDates(facts.onset, facts.wake, facts.recordDayShift);
  const record = {
    schemaVersion: 1,
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    updatedAt: new Date().toISOString(),
    date: localDateKey(sleepDates.midpoint),
    source: appState.screenshotImport ? "screenshot" : "manual",
    confidence: appState.screenshotImport?.recordConfidence ?? 1,
    sleepOnset: sleepDates.onsetDate.toISOString(),
    wakeTime: sleepDates.wakeDate.toISOString(),
    tstMinutes: facts.tstMinutes,
    sleepLatencyMinutes: null,
    awakenings: Number(q("#awakenings").value || 0),
    stages: appState.screenshotImport ? { deepMinutes: appState.screenshotImport.deepMinutes, lightMinutes: null, remMinutes: appState.screenshotImport.remMinutes, awakeMinutes: null, vendorScore: null, vendor: appState.screenshotImport.vendor } : { deepMinutes: null, lightMinutes: null, remMinutes: null, awakeMinutes: null, vendorScore: null, vendor: null },
    symptoms: facts.symptoms,
    mood: facts.mood,
    focus: facts.symptoms.includes("注意力涣散") ? "poor" : "normal",
    energy: facts.energy,
    drivingToday: facts.drivingToday,
    earlyWake: facts.earlyWake,
    osaFlags: facts.osaFlags,
    caffeine: appState.caffeine,
    hydration: facts.hydration,
    lastMeal: { time: isoForTime(facts.lastMeal.time, facts.recordDayShift - 1), weight: facts.lastMeal.weight },
    outdoorLight: { minutes: 0, withinHoursOfWake: null },
    importMeta: appState.screenshotImport ? {
      method: appState.screenshotImport.method,
      extractionConfidence: appState.screenshotImport.extractionConfidence,
      confirmedByUser: true,
      confirmedAt: appState.screenshotImport.confirmedAt,
      image: appState.screenshotImport.image,
    } : null,
    notes: "",
    derived: { debtMinutes: facts.debtMinutes, caffeineAtSleep: facts.caffeineAtSleep, caffeineBaseline: facts.caffeineBaseline, caffeineGap: facts.caffeineGap, halfLife: facts.halfLife },
    ruleFacts: {
      onset: facts.onset, wake: facts.wake, plannedSleep: facts.plannedSleep,
      tstMinutes: facts.tstMinutes, sleepNeed: facts.sleepNeed, debtMinutes: facts.debtMinutes,
      awakeMinutes: facts.awakeMinutes, caffeineNow: facts.caffeineNow,
      caffeineAtSleep: facts.caffeineAtSleep, caffeineTotal: facts.caffeineTotal, caffeineBaseline: facts.caffeineBaseline, caffeineGap: facts.caffeineGap, halfLife: facts.halfLife,
      hydration: facts.hydration, lastMeal: facts.lastMeal, mealToSleep: facts.mealToSleep,
      hoursToSleep: facts.hoursToSleep, symptoms: facts.symptoms,
      energy: facts.energy, mood: facts.mood, drivingToday: facts.drivingToday, earlyWake: facts.earlyWake, osaFlags: facts.osaFlags,
      stageContext: facts.stageContext,
      profileType: facts.profile?.classification?.type || "A",
    },
    safetyNotices,
    attribution: factors,
    actions,
  };
  try {
    await saveRecord(record);
    appState.activeRecordId = record.id;
    appState.screenshotImport = null;
    renderStructuralNotices(safetyNotices);
    renderAnalysis(facts, factors, actions);
    const records = await getRecords();
    updatePatterns(records);
    switchView("today");
    showToast(facts.recordDayShift < 0 ? "昨天的记录已补录；同日旧记录已自动更新。" : "记录已保存在你的设备，并生成了今天的归因。 ");
  } catch {
    showToast("记录暂时无法写入本地数据库，请稍后重试。");
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportJson() {
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: readJson(PROFILE_KEY, null),
    records: await getRecords(),
    feedback: readJson(FEEDBACK_KEY, []),
    experiments: getExperiments(),
    reminderPlans: readJson(REMINDER_KEY, []),
  };
  downloadFile(`night-repair-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
  showToast("JSON 备份已生成。文件包含健康敏感信息，请妥善保管。");
}

async function exportCsv() {
  const records = await getRecords();
  const rows = [["date", "tstMinutes", "awakenings", "symptoms", "hydration", "caffeineMg", "sleepDebtMinutes"]];
  records.forEach((record) => rows.push([
    record.date, record.tstMinutes, record.awakenings,
    (record.symptoms || []).join("|"), record.hydration,
    (record.caffeine || []).reduce((sum, item) => sum + item.mg, 0),
    record.derived?.debtMinutes ?? "",
  ]));
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadFile(`night-repair-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
  showToast("CSV 已生成。缺失日不会被写成 0。");
}

async function importJsonFile(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.records)) throw new Error("unsupported");
    if (payload.profile?.schemaVersion === 1) writeJson(PROFILE_KEY, payload.profile);
    if (Array.isArray(payload.feedback)) writeJson(FEEDBACK_KEY, payload.feedback.slice(-200));
    if (Array.isArray(payload.experiments)) saveExperiments(payload.experiments);
    if (Array.isArray(payload.reminderPlans)) writeJson(REMINDER_KEY, payload.reminderPlans.slice(-60));
    for (const record of payload.records) {
      if (record.schemaVersion === 1 && record.id && record.date) await saveRecord(record);
    }
    updateProfileUI(readJson(PROFILE_KEY, null));
    const records = await getRecords();
    updatePatterns(records);
    showToast(`已导入 ${records.length} 条本地记录。`);
  } catch {
    showToast("导入失败：文件版本或内容不符合夜后修复格式。");
  } finally {
    q("#importJson").value = "";
  }
}

function buildCalendar() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const events = qa(".timeline-item").slice(0, 5).filter((item) => q(".timeline-check", item)?.checked).flatMap((item, index) => {
    const editableTime = q(".timeline-time", item);
    const time = (editableTime ? editableTime.value : q("time", item).textContent).replace(":", "") + "00";
    const title = q("strong", item).textContent;
    const description = q("small", item).textContent;
    const main = ["BEGIN:VEVENT", `UID:night-repair-${ymd}-${index}@local`, `DTSTAMP:${ymd}T000000`, `DTSTART:${ymd}T${time}`, `SUMMARY:${title}`, `DESCRIPTION:${description}`, "END:VEVENT"].join("\r\n");
    if (q(".timeline-check", item)?.dataset.kind !== "nap") return [main];
    const wakeValue = (Number(time.slice(0, 2)) * 60 + Number(time.slice(2, 4)) + 20) % 1440;
    const wakeTime = `${String(Math.floor(wakeValue / 60)).padStart(2, "0")}${String(wakeValue % 60).padStart(2, "0")}00`;
    const wake = ["BEGIN:VEVENT", `UID:night-repair-${ymd}-${index}-wake@local`, `DTSTAMP:${ymd}T000000`, `DTSTART:${ymd}T${wakeTime}`, "SUMMARY:小睡结束，请起床", "DESCRIPTION:避免进入 30–60 分钟睡眠惯性区。", "END:VEVENT"].join("\r\n");
    return [main, wake];
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Night Repair//CN", ...events, "END:VCALENDAR"].join("\r\n");
}

function renderExperiments() {
  let experiments = getExperiments().map(evaluateExperiment);
  saveExperiments(experiments);
  const active = experiments.find((item) => item.status === "active");
  const conclusions = experiments.filter((item) => ["effective", "ineffective"].includes(item.status));
  const missing = Object.values(EXPERIMENT_CATALOG).filter((item) => !experiments.some((experiment) => experiment.id === item.id));
  const cards = [];
  conclusions.forEach((item) => cards.push(`<article class="conclusion-card ${item.status === "effective" ? "verified" : "empty"}"><span>${item.status === "effective" ? "这条对你有效" : "对你没有观察到差异"}</span><h3>${item.title}</h3><p>${item.metric}中位数：执行 ${item.doneMedian}${item.unit}，未执行 ${item.missedMedian}${item.unit}。</p><p class="plan-effect">${item.status === "effective" ? "已进入默认时间线" : "已从默认时间线退出；安全规则仍可临时覆盖"}</p><div><b>执行 n=${item.doneCount}</b><b>未执行 n=${item.missedCount}</b></div></article>`));
  if (active) cards.push(`<article class="conclusion-card testing"><span>正在验证</span><h3>${active.title}</h3><p>${active.action}。执行与未执行各至少记录 5 次，才会晋升或撤回。</p><div><b>执行 ${active.doneCount || 0}/5</b><b>未执行 ${active.missedCount || 0}/5</b></div><progress value="${Math.min(10, (active.doneCount || 0) + (active.missedCount || 0))}" max="10"></progress></article>`);
  if (missing[0]) cards.push(`<article class="conclusion-card empty"><span>下一项实验</span><h3>${missing[0].title}</h3><p>${missing[0].action}，追踪“${missing[0].metric}”。</p><button class="secondary-button" data-start-experiment="${missing[0].id}" type="button">开始实验</button></article>`);
  q("#experimentGrid").innerHTML = cards.join("") || `<article class="conclusion-card empty"><span>暂无实验</span><h3>从一条具体建议开始验证</h3></article>`;
  q("#experimentGrid").closest(".section-block").querySelector(".counter").textContent = conclusions.length ? `${conclusions.length} 条个人结论` : "正在积累证据";
  qa("[data-start-experiment]").forEach((button) => button.addEventListener("click", () => startExperiment(button.dataset.startExperiment)));

  q("#followupCard").hidden = !active;
  if (active) {
    const targetDay = shiftedDateKey(-1);
    const linked = linkedReminderAdherence(active, readJson(REMINDER_KEY, []), targetDay);
    const existing = uniqueExperimentObservations(active.observations).find((item) => item.day === targetDay);
    const suggested = existing?.adherence || linked?.adherence || null;
    q("#followupQuestion").textContent = active.question;
    q("#followupContext").textContent = existing ? `实验：${active.title}。昨日结果已记录；再次提交会更新，不会重复计数。` : linked ? `实验：${active.title}。已从昨日提醒带入依从性，只需填写结果并确认。` : `实验：${active.title}。昨日提醒没有反馈，请填写结果并手动选择做了或没做。`;
    q("#followupAdherenceSource").textContent = existing ? `昨日已记录：${existing.adherence === "done" ? "做了" : "没做"}` : linked ? `昨日提醒：${linked.adherence === "done" ? "做了" : "没做"}` : "未找到昨日提醒反馈";
    q("#followupMetricLabel").childNodes[0].textContent = active.metric;
    q("#followupMetricUnit").textContent = active.unit;
    q("#followupMetric").value = existing?.value ?? "";
    q("#followupMetric").max = active.unit.includes("1–5") ? "5" : "300";
    qa("[data-adherence]").forEach((button) => button.classList.toggle("active", button.dataset.adherence === suggested));
  }
}

function startExperiment(id) {
  const experiments = getExperiments();
  if (experiments.some((item) => item.status === "active")) {
    showToast("先完成当前实验，避免同时改变多个变量。 ");
    return;
  }
  const template = EXPERIMENT_CATALOG[id];
  if (!template) return;
  experiments.push({ ...template, status: "active", startedAt: new Date().toISOString(), observations: [] });
  saveExperiments(experiments);
  renderExperiments();
  showToast(`已开始实验：${template.title}。`);
}

function recordExperimentObservation(adherence) {
  const value = Number(q("#followupMetric").value);
  if (!Number.isFinite(value) || value < 0) { showToast("请先填写这次的观测结果。 "); return; }
  const experiments = getExperiments();
  const index = experiments.findIndex((item) => item.status === "active");
  if (index < 0) return;
  const day = shiftedDateKey(-1);
  const startedDay = experiments[index].startedAt ? localDateKey(new Date(experiments[index].startedAt)) : null;
  if (startedDay && day < startedDay) { showToast("实验从今天开始，明天才能记录第一组结果。 "); return; }
  const linked = linkedReminderAdherence(experiments[index], readJson(REMINDER_KEY, []), day);
  const observations = uniqueExperimentObservations(experiments[index].observations);
  const replacing = observations.some((item) => item.day === day);
  experiments[index].observations = observations.filter((item) => item.day !== day);
  experiments[index].observations.push({ date: new Date().toISOString(), day, adherence, value, adherenceSource: linked?.adherence === adherence ? "reminder" : "manual" });
  experiments[index] = evaluateExperiment(experiments[index]);
  saveExperiments(experiments);
  renderExperiments();
  if (experiments[index].status === "effective") showToast("证据已达到门槛：这条对你有效，已加入个人方案。 ");
  else if (experiments[index].status === "ineffective") showToast("没有观察到差异：这条已从你的方案中移除。 ");
  else showToast(replacing ? "昨日结果已更新，没有重复计数。 " : "这次结果已记下，实验继续。 ");
}

function renderWeeklyReport(records) {
  const recent = uniqueRecordsByDate(records).slice(-7);
  q("#weeklyWindow").textContent = recent.length ? `近 ${recent.length} 个睡眠日` : "等待记录";
  if (recent.length < 3) {
    ["#weeklyTst", "#weeklyMidpoint", "#weeklyDrift", "#weeklyRegularDays"].forEach((selector) => { q(selector).textContent = "—"; });
    q("#weeklyNarrative").textContent = `数据不足：再记录 ${3 - recent.length} 个独立睡眠日后开始生成周报。缺失日不会按 0 处理。`;
    return;
  }
  const tst = recent.map((record) => Number(record.tstMinutes)).filter(Number.isFinite);
  const midpointStats = circularStats(recent.map(recordMidpointMinutes));
  const medianTst = median(tst);
  q("#weeklyTst").textContent = `${Math.floor(medianTst / 60)}h${String(Math.round(medianTst % 60)).padStart(2, "0")}m`;
  q("#weeklyMidpoint").textContent = formatClockMinutes(midpointStats.center);
  q("#weeklyDrift").textContent = formatMinutes(midpointStats.span);
  q("#weeklyRegularDays").textContent = `${midpointStats.regularDays}/${recent.length}`;

  const earlier = uniqueRecordsByDate(records).slice(-14, -7);
  let comparison = "继续积累下一周后，才会出现前后对比。";
  if (earlier.length >= 3) {
    const earlierTst = median(earlier.map((record) => Number(record.tstMinutes)).filter(Number.isFinite));
    const delta = Math.round(medianTst - earlierTst);
    comparison = Math.abs(delta) < 15 ? "睡眠时长与上一窗口基本持平。" : `睡眠时长中位数比上一窗口${delta > 0 ? "增加" : "减少"} ${formatMinutes(delta)}。`;
  }
  const regularity = midpointStats.span <= 60 ? "这周的相位相对稳定。" : midpointStats.span <= 120 ? "相位有波动，但仍有可见锚点。" : "中点漂移超过 2 小时，优先稳定一个起床锚点。";
  q("#weeklyNarrative").textContent = `${regularity}${comparison}`;
}

function renderSleepStageTrend(records) {
  const samples = uniqueRecordsByDate(records).map((record) => sleepStageSample(record.stages, record.tstMinutes, record.date)).filter(Boolean);
  const latest = samples.at(-1);
  q("#stageVendor").textContent = latest ? stageVendorLabel(latest.vendor) : "等待截图记录";
  if (!latest) {
    q("#stageSampleCount").textContent = "0 / 5";
    q("#stageDeepMedian").textContent = "—";
    q("#stageRemMedian").textContent = "—";
    q("#stageLatestDelta").textContent = "—";
    q("#stageNarrative").textContent = "导入并确认睡眠截图后开始积累；厂商总分不会进入计算。";
    return;
  }
  const baseline = stageBaselineForVendor(records, latest.vendor);
  q("#stageSampleCount").textContent = baseline.sampleCount >= 5 ? `${baseline.sampleCount} 次` : `${baseline.sampleCount} / 5`;
  q("#stageDeepMedian").textContent = baseline.deepMedian === null ? "—" : `${Math.round(baseline.deepMedian)}%`;
  q("#stageRemMedian").textContent = baseline.remMedian === null ? "—" : `${Math.round(baseline.remMedian)}%`;
  if (baseline.deepMedian === null && baseline.remMedian === null) {
    q("#stageLatestDelta").textContent = "—";
    q("#stageNarrative").textContent = `已有 ${baseline.sampleCount} 次 ${stageVendorLabel(latest.vendor)} 记录；至少 5 次同设备有效分期后才建立个人基线。`;
    return;
  }
  const deepDelta = latest.deepPercent === null || baseline.deepMedian === null ? null : latest.deepPercent - baseline.deepMedian;
  const remDelta = latest.remPercent === null || baseline.remMedian === null ? null : latest.remPercent - baseline.remMedian;
  const parts = [deepDelta === null ? null : `深睡 ${deepDelta >= 0 ? "+" : ""}${Math.round(deepDelta)}`, remDelta === null ? null : `REM ${remDelta >= 0 ? "+" : ""}${Math.round(remDelta)}`].filter(Boolean);
  q("#stageLatestDelta").textContent = parts.length ? parts.join(" / ") : "—";
  q("#stageNarrative").textContent = `只与 ${stageVendorLabel(latest.vendor)} 的近 ${baseline.sampleCount} 次记录比较，单位为占总睡眠的百分点；设备分期仅作趋势参考，不是诊断。`;
}

function renderTypeProtocol(profile) {
  const type = profile?.classification?.type || "A";
  const protocol = TYPE_PROTOCOLS[type] || TYPE_PROTOCOLS.A;
  q("#protocolEyebrow").textContent = `${TYPE_CONTENT[type][0]} · 按你的相位安排`;
  q("#protocolTitle").textContent = type === "E" ? "夜班 / 轮班专项方案" : "你的专项方案";
  q("#protocolDuration").textContent = protocol.duration;
  q("#protocolGrid").innerHTML = protocol.items.map((item) => `<article class="protocol-card"><span>${item[0]}</span><strong>${item[1]}</strong><p>${item[2]}</p></article>`).join("");
  let note = protocol.note;
  if (type === "D+" && profile.supplementGate) note = "相位前移按数周推进：起床后强光、晚间控光与逐步前移。你的档案已关闭补剂内容，需要时请咨询医生或药师。";
  q("#protocolNote").textContent = note;
}

function renderReturnWelcome(records) {
  const latest = uniqueRecordsByDate(records).at(-1);
  if (!latest) { q("#returnBanner").hidden = true; return; }
  const latestDate = new Date(`${latest.date}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const gapDays = Math.floor((today - latestDate) / 864e5);
  q("#returnBanner").hidden = gapDays < 3;
  if (gapDays >= 3) q("#sampleBanner").hidden = true;
}

function renderCaffeineLearning(profile, records) {
  const calibration = profile?.caffeineCalibration || calibrateCaffeineHalfLife(records);
  const sampleCount = calibration.sampleCount || 0;
  q("#calibrationProgress").value = Math.min(sampleCount, 7);
  q("#calibrationPairs").textContent = calibration.status === "personalized" ? `${sampleCount} 组` : `${sampleCount} / 7`;

  if (calibration.status === "personalized") {
    const confidence = calibration.confidence === "high" ? "高" : "中";
    q("#calibrationLabel").textContent = "已启用个人参数";
    q("#caffeineLearningText").textContent = `历史配对支持 ${calibration.halfLife.toFixed(1)} 小时的行为工作参数；新记录的残留与截止线会使用它。`;
    q("#calibrationEvidence").textContent = `相关强度 r=${calibration.correlation.toFixed(2)} · ${confidence}置信度。它不是代谢检测，也不用于医学诊断。`;
    return;
  }

  q("#calibrationLabel").textContent = calibration.status === "collecting" ? "正在积累配对" : "暂不改写默认参数";
  q("#caffeineLearningText").textContent = "系统会把某天的咖啡因摄入与下一次实际入睡偏移配对；证据不足时继续使用默认或敏感度参数。";
  if (calibration.status === "low_variation") {
    q("#calibrationEvidence").textContent = "现有摄入或入睡偏移变化太小，无法可靠区分 3–7 小时候选参数。";
  } else if (calibration.status === "weak_signal") {
    q("#calibrationEvidence").textContent = `当前相关强度仅 r=${Number(calibration.correlation || 0).toFixed(2)}，没有把偶然波动当作个体差异。`;
  } else {
    q("#calibrationEvidence").textContent = `已有 ${calibration.caffeinatedDays || 0} 个有咖啡因的配对日；至少需要 7 组配对，其中 4 天含咖啡因。`;
  }
}

function updatePatterns(records) {
  records = uniqueRecordsByDate(records);
  let profile = reclassifyProfile(records) || readJson(PROFILE_KEY, null);
  profile = updateCaffeineCalibration(records, profile);
  if (profile) updateProfileUI(profile);
  renderCaffeineLearning(profile, records);
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  q("#recordCount").textContent = records.filter((record) => record.date.startsWith(monthKey)).length;
  if (records.length && records.length < 5) {
    q("#phaseDays").innerHTML = `<div><small>当前</small><i style="--x:50%"></i><span>${records.length} 天</span></div>`;
    q(".phase-chart > p").innerHTML = `数据不足：再记录 <strong>${5 - records.length} 天</strong>，才能开始比较睡眠中点。缺失日不会按 0 处理。`;
  } else if (records.length >= 5) {
    const points = records.slice(-7).map((record) => {
      const midpoint = new Date((new Date(record.sleepOnset).getTime() + new Date(record.wakeTime).getTime()) / 2);
      const minutes = midpoint.getHours() * 60 + midpoint.getMinutes();
      const x = Math.max(2, Math.min(98, ((minutes - 120) / 240) * 100));
      return { label: new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${record.date}T12:00:00`)), time: `${String(midpoint.getHours()).padStart(2, "0")}:${String(midpoint.getMinutes()).padStart(2, "0")}`, minutes, x };
    });
    q("#phaseDays").innerHTML = points.map((point) => `<div><small>${point.label}</small><i style="--x:${point.x}%"></i><span>${point.time}</span></div>`).join("");
    const drift = Math.max(...points.map((point) => point.minutes)) - Math.min(...points.map((point) => point.minutes));
    q(".phase-chart > p").innerHTML = `近 ${points.length} 次记录的睡眠中点最大漂移 <strong>${formatMinutes(drift)}</strong>。只和你自己的设备与基线比较。`;
  }
  const latest = records.at(-1);
  if (latest?.ruleFacts && latest?.attribution && latest?.actions) {
    renderStructuralNotices(latest.safetyNotices || []);
    const hydratedFacts = { ...latest.ruleFacts, halfLife: latest.ruleFacts.halfLife || resolveHalfLife(readJson(PROFILE_KEY, null)), caffeineBaseline: latest.ruleFacts.caffeineBaseline ?? null, caffeineGap: latest.ruleFacts.caffeineGap ?? null };
    renderAnalysis(hydratedFacts, latest.attribution, latest.actions);
    renderAttributionFeedback(latest.id);
  } else {
    renderAttributionFeedback(null);
  }
  const remaining = Math.max(0, 14 - records.length);
  if (profile) {
    const recalculation = profile.recordReclassification;
    q("#profileBasis").textContent = remaining ? `问卷初始分型；再记录 ${remaining} 个独立睡眠日后用真实数据重算。` : recalculation?.previousType && recalculation.previousType !== profile.classification.type ? `已用最近 14 个睡眠日重算：从 ${recalculation.previousType} 迁移到 ${profile.classification.type}。迁移本身也是进步。` : "已基于最近 14 个独立睡眠日重算；缺失日未按 0 处理。";
    renderTypeProtocol(profile);
  }
  renderWeeklyReport(records);
  renderSleepStageTrend(records);
  renderReturnWelcome(records);
  renderExperiments();
}

const SCREENSHOT_TEMPLATES = [
  { id: "huawei", label: "华为运动健康", hints: ["华为运动健康", "huawei health", "huawei"] },
  { id: "xiaomi", label: "小米运动健康", hints: ["小米运动健康", "小米健康", "mi fitness", "zepp life", "xiaomi", "小米"] },
  { id: "garmin", label: "Garmin Connect", hints: ["garmin connect", "garmin"] },
  { id: "oppo", label: "OPPO 健康", hints: ["oppo 健康", "oppo health", "oppo"] },
  { id: "honor", label: "荣耀运动健康", hints: ["荣耀运动健康", "honor health", "honor", "荣耀"] },
];

function normalizeSleepReportText(text = "") {
  return text.replaceAll("：", ":").replace(/[\t\r]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/[ ]{2,}/g, " ").trim();
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectScreenshotVendor(text = "", filename = "") {
  const haystack = `${text}\n${filename}`.toLowerCase();
  return SCREENSHOT_TEMPLATES.find((template) => template.hints.some((hint) => haystack.includes(hint.toLowerCase()))) || null;
}

function timeNearLabels(text, labels) {
  const timePattern = "([01]?\\d|2[0-3]):([0-5]\\d)";
  for (const label of labels) {
    const escaped = escapePattern(label);
    const after = text.match(new RegExp(`${escaped}[^\\d]{0,18}${timePattern}`, "i"));
    const before = text.match(new RegExp(`${timePattern}[^\\d]{0,12}${escaped}`, "i"));
    const match = after || before;
    if (match) {
      const hour = after ? match[1] : match[1];
      const minute = after ? match[2] : match[2];
      return `${String(Number(hour)).padStart(2, "0")}:${minute}`;
    }
  }
  return null;
}

function minutesNearLabels(text, labels) {
  for (const label of labels) {
    const index = text.toLowerCase().indexOf(label.toLowerCase());
    if (index < 0) continue;
    const segment = text.slice(index + label.length, index + label.length + 42);
    const hours = segment.match(/(\d{1,2})\s*(?:小时|h)(?:\s*(\d{1,2})\s*(?:分钟|分|min))?/i);
    if (hours) return Number(hours[1]) * 60 + Number(hours[2] || 0);
    const minutes = segment.match(/(\d{1,3})\s*(?:分钟|分|min)/i);
    if (minutes) return Number(minutes[1]);
  }
  return null;
}

function parseSleepReportText(rawText, filename = "") {
  const text = normalizeSleepReportText(rawText);
  const vendor = detectScreenshotVendor(text, filename);
  let sleep = timeNearLabels(text, ["入睡时间", "入睡", "睡着", "bedtime", "sleep start"]);
  let wake = timeNearLabels(text, ["起床时间", "醒来时间", "醒来", "起床", "wake up", "wake time"]);
  let usedUnlabeledTimes = false;
  if (!sleep || !wake) {
    const candidates = [...text.matchAll(/(?:^|\D)((?:[01]?\d|2[0-3]):[0-5]\d)(?!\d)/g)].map((match) => match[1]);
    const unique = [...new Set(candidates)];
    if (unique.length === 2 && vendor) {
      sleep ||= unique[0].padStart(5, "0");
      wake ||= unique[1].padStart(5, "0");
      usedUnlabeledTimes = true;
    }
  }
  const deepMinutes = minutesNearLabels(text, ["深睡眠", "深睡", "deep sleep", "deep"]);
  const remMinutes = minutesNearLabels(text, ["快速眼动", "REM 睡眠", "REM", "rapid eye movement"]);
  const fieldCount = [sleep, wake, deepMinutes, remMinutes].filter((value) => value !== null).length;
  let confidence = (vendor ? 0.18 : 0) + (sleep ? 0.24 : 0) + (wake ? 0.24 : 0) + (deepMinutes !== null ? 0.12 : 0) + (remMinutes !== null ? 0.12 : 0);
  if (usedUnlabeledTimes) confidence -= 0.12;
  confidence = Math.max(0.05, Math.min(0.9, confidence));
  return { vendor: vendor?.id || "unknown", sleep, wake, deepMinutes, remMinutes, confidence, fieldCount, usedUnlabeledTimes };
}

function confidenceText(value) {
  if (value >= 0.72) return `本机解析 · 高（${Math.round(value * 100)}%）`;
  if (value >= 0.45) return `本机解析 · 中（${Math.round(value * 100)}%）`;
  if (value > 0.1) return `本机线索 · 低（${Math.round(value * 100)}%）`;
  return "待人工确认";
}

function applyScreenshotExtraction(result, method) {
  if (result.vendor !== "unknown") q("#importedVendor").value = result.vendor;
  if (result.sleep) q("#importedSleep").value = result.sleep;
  if (result.wake) q("#importedWake").value = result.wake;
  if (result.deepMinutes !== null) q("#importedDeep").value = result.deepMinutes;
  if (result.remMinutes !== null) q("#importedRem").value = result.remMinutes;
  q("#importedConfidence").value = confidenceText(result.confidence);
  appState.screenshotDraft = { ...(appState.screenshotDraft || {}), ...result, method };
  q("#screenshotRecognitionStatus").textContent = result.fieldCount >= 2 ? `已在本机找到 ${result.fieldCount} 个字段，请逐项确认。` : "没有足够字段可自动填写，请手动确认或粘贴截图文字。";
}

async function getLocalImageInfo(file) {
  const bitmap = await createImageBitmap(file);
  const info = { width: bitmap.width, height: bitmap.height, bytes: file.size };
  bitmap.close?.();
  return info;
}

async function detectTextOnDevice(file) {
  if (!("TextDetector" in window)) return { status: "unsupported", text: "" };
  try {
    const bitmap = await createImageBitmap(file);
    const blocks = await new TextDetector().detect(bitmap);
    bitmap.close?.();
    return { status: "detected", text: blocks.map((block) => block.rawValue || "").filter(Boolean).join("\n") };
  } catch {
    return { status: "failed", text: "" };
  }
}

async function handleScreenshot(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) { showToast("请选择图片格式的睡眠报告。"); return; }
  if (file.size > 15 * 1024 * 1024) { showToast("图片超过 15MB，请先在手机中裁剪后再试。 "); return; }
  if (appState.screenshotUrl) URL.revokeObjectURL(appState.screenshotUrl);
  appState.screenshotUrl = URL.createObjectURL(file);
  q("#screenshotPreview").src = appState.screenshotUrl;
  q("#screenshotPreview").hidden = false;
  q("#importedSleep").value = q("#sleepOnset").value;
  q("#importedWake").value = q("#wakeTime").value;
  q("#importedDeep").value = "";
  q("#importedRem").value = "";
  q("#importedVendor").value = "unknown";
  q("#importedConfidence").value = "正在本机解析";
  q("#screenshotOcrText").value = "";
  q("#screenshotRecognitionStatus").textContent = "正在检查本机识别能力；原图不会离开此设备。";
  appState.screenshotDraft = { method: "manual", confidence: 0.05, image: null };
  q("#screenshotDialog").showModal();
  try {
    const info = await getLocalImageInfo(file);
    appState.screenshotDraft.image = info;
    q("#screenshotImageMeta").textContent = `${info.width} × ${info.height} · ${(info.bytes / 1024 / 1024).toFixed(1)}MB · 原图不保存`;
  } catch {
    q("#screenshotImageMeta").textContent = "无法读取图片尺寸；原图仍不会上传或保存。";
  }
  const nativeResult = await detectTextOnDevice(file);
  if (nativeResult.status === "detected" && nativeResult.text.trim()) {
    applyScreenshotExtraction(parseSleepReportText(nativeResult.text, file.name), "device-text");
  } else {
    applyScreenshotExtraction(parseSleepReportText("", file.name), nativeResult.status === "unsupported" ? "filename+manual" : "device-text-failed");
    q("#screenshotRecognitionStatus").textContent = nativeResult.status === "unsupported" ? "此浏览器没有本机文字识别；可粘贴手机“复制文字”的结果，或直接人工确认。" : "本机文字识别没有读出内容；可粘贴识别文字或直接人工确认。";
  }
}

function openTextScreenshotImport() {
  q("#screenshotPreview").hidden = true;
  q("#importedSleep").value = q("#sleepOnset").value;
  q("#importedWake").value = q("#wakeTime").value;
  q("#importedDeep").value = "";
  q("#importedRem").value = "";
  q("#importedVendor").value = "unknown";
  q("#importedConfidence").value = "待人工确认";
  q("#screenshotOcrText").value = "";
  q("#screenshotRecognitionStatus").textContent = "粘贴手机从截图中复制出的文字，解析仍只在本机完成。";
  q("#screenshotImageMeta").textContent = "未读取原图，不会保存识别文字";
  q(".text-fallback").open = true;
  appState.screenshotDraft = { method: "pasted-text", confidence: 0.05, image: null };
  q("#screenshotDialog").showModal();
}

async function renderSupplements() {
  try {
    const response = await fetch("./supplements.json?v=20260825-1");
    if (!response.ok) throw new Error("load failed");
    const entries = await response.json();
    q("#supplementGrid").innerHTML = entries.map((item) => `<details><summary><span>${item.badge}</span><strong>${item.name} ${item.english}</strong><small>查看八字段</small></summary><dl><dt>常见形式</dt><dd>${item.form}</dd><dt>作用机制</dt><dd>${item.mechanism}</dd><dt>常见区间</dt><dd>${item.range}</dd><dt>UL 上限</dt><dd>${item.ul}</dd><dt>服用时机</dt><dd>${item.timing}</dd><dt>禁忌与相互作用</dt><dd>${item.contraindications}</dd><dt>证据强度</dt><dd>${item.evidence}</dd><dt>审阅状态</dt><dd>原型内容；正式上线前须由具备资质者复核。</dd></dl></details>`).join("");
  } catch {
    q("#supplementGrid").innerHTML = `<p class="supplement-gate">证据资料暂时无法载入。行为与食物建议不受影响。</p>`;
  }
}

async function checkNotificationConditions() {
  const status = q("#notificationStatus");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) { status.textContent = "此浏览器不支持网页提醒，请使用日历文件。"; return; }
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone) { status.textContent = "请先添加到主屏，再从主屏打开。"; return; }
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  status.textContent = permission === "granted" ? "提醒条件已满足；正式 Web Push 仍需后端订阅服务。" : "未获得通知权限；可继续使用日历提醒。";
}

function showToast(message) {
  const toast = q("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function switchView(viewId) {
  appState.view = viewId;
  qa(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  qa("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  history.replaceState(null, "", `#${viewId}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupToday() {
  const now = new Date();
  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  q("#todayDate").textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()]}`;
  const hour = now.getHours();
  q("#greeting").textContent = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  qa(".done-button").forEach((button) => button.addEventListener("click", () => {
    const done = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(done));
    button.classList.toggle("is-done", done);
    button.textContent = done ? "已做" : "去做";
    const count = qa(".done-button.is-done").length + qa('.timeline-item[data-result="done"]').length;
    q("#repairScore").innerHTML = `${Math.min(5, count)}<em>/5</em>`;
  }));

  bindTimeline();

  qa("[data-adherence]").forEach((button) => button.addEventListener("click", () => recordExperimentObservation(button.dataset.adherence)));
}

qa("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
q("#openProfile").addEventListener("click", () => switchView("patterns"));
q("#saveReminders").addEventListener("click", () => saveReminderPlan());
q("#downloadIcs").addEventListener("click", () => downloadFile(`night-repair-${new Date().toISOString().slice(0, 10)}.ics`, buildCalendar(), "text/calendar;charset=utf-8"));
qa(".info-dot").forEach((button) => button.addEventListener("click", () => showToast(button.closest("article").classList.contains("repair-score") ? "修复分只计算今天完成的行动。" : "状态分只解释当前负担，不评价你做得好不好。")));
q("#onboardingNext").addEventListener("click", advanceOnboarding);
q("#onboardingBack").addEventListener("click", () => setOnboardingStep(Math.max(1, onboardingStep - 1)));
q("#redoOnboarding").addEventListener("click", openOnboarding);
q("#quickRecordForm").addEventListener("submit", submitQuickRecord);
q("#recordDay").addEventListener("change", () => {
  appState.caffeine = [];
  qa("[data-drink]").forEach((button) => button.classList.remove("selected"));
  q("#drinkLog").textContent = selectedRecordDayShift() < 0 ? "正在补录昨天；还没有记录咖啡因" : "还没有记录咖啡因";
});
qa("[data-attribution-feedback]").forEach((button) => button.addEventListener("click", () => saveAttributionFeedback(button.dataset.attributionFeedback === "yes")));
q("#closeSafety").addEventListener("click", () => q("#safetyDialog").close());
q("#exportJson").addEventListener("click", exportJson);
q("#exportCsv").addEventListener("click", exportCsv);
q("#importJson").addEventListener("change", (event) => event.target.files[0] && importJsonFile(event.target.files[0]));
q("#screenshotInput").addEventListener("change", (event) => handleScreenshot(event.target.files[0]));
q("#openScreenshotText").addEventListener("click", openTextScreenshotImport);
q("#parseScreenshotText").addEventListener("click", () => {
  const text = q("#screenshotOcrText").value.trim();
  if (!text) { showToast("请先粘贴手机从截图中复制出的文字。 "); return; }
  applyScreenshotExtraction(parseSleepReportText(text), "pasted-text");
});
q("#cancelScreenshot").addEventListener("click", () => {
  q("#screenshotDialog").close();
  if (appState.screenshotUrl) URL.revokeObjectURL(appState.screenshotUrl);
  appState.screenshotUrl = null;
  appState.screenshotDraft = null;
  q("#screenshotOcrText").value = "";
  q("#screenshotInput").value = "";
});
q("#confirmScreenshot").addEventListener("click", () => {
  if (!q("#importedSleep").value || !q("#importedWake").value) { showToast("请先确认入睡和起床时间。 "); return; }
  const sleepMinutes = sleepDuration(q("#importedSleep").value, q("#importedWake").value);
  const deepMinutes = q("#importedDeep").value ? Number(q("#importedDeep").value) : null;
  const remMinutes = q("#importedRem").value ? Number(q("#importedRem").value) : null;
  if ((deepMinutes !== null && deepMinutes > sleepMinutes) || (remMinutes !== null && remMinutes > sleepMinutes) || ((deepMinutes || 0) + (remMinutes || 0) > sleepMinutes)) { showToast("深睡与 REM 不能超过本次睡眠总时长，请修正后再确认。 "); return; }
  q("#sleepOnset").value = q("#importedSleep").value;
  q("#wakeTime").value = q("#importedWake").value;
  appState.screenshotImport = {
    vendor: q("#importedVendor").value,
    deepMinutes,
    remMinutes,
    method: appState.screenshotDraft?.method || "manual",
    extractionConfidence: appState.screenshotDraft?.confidence || 0.05,
    recordConfidence: 1,
    confirmedAt: new Date().toISOString(),
    image: appState.screenshotDraft?.image || null,
  };
  q("#screenshotDialog").close();
  if (appState.screenshotUrl) URL.revokeObjectURL(appState.screenshotUrl);
  appState.screenshotUrl = null;
  appState.screenshotDraft = null;
  q("#screenshotOcrText").value = "";
  q("#screenshotInput").value = "";
  switchView("record");
  showToast("截图字段已由你确认；原图已释放，生成归因时只写入结构化字段。 ");
});
q("#enableNotifications").addEventListener("click", checkNotificationConditions);
qa("[data-symptom]").forEach((button) => button.addEventListener("click", () => {
  const symptom = button.dataset.symptom;
  const selected = appState.selectedSymptoms.includes(symptom);
  appState.selectedSymptoms = selected ? appState.selectedSymptoms.filter((item) => item !== symptom) : [...appState.selectedSymptoms, symptom];
  button.classList.toggle("selected", !selected);
}));
qa("[data-drink]").forEach((button) => button.addEventListener("click", () => {
  const entryTime = new Date();
  entryTime.setDate(entryTime.getDate() + selectedRecordDayShift());
  const entry = { time: entryTime.toISOString(), mg: Number(button.dataset.mg), item: button.dataset.drink };
  appState.caffeine.push(entry);
  button.classList.add("selected");
  q("#drinkLog").textContent = appState.caffeine.map((item) => `${item.item} ${item.mg}mg`).join(" · ");
  showToast(`已记录 ${entry.item}，约 ${entry.mg}mg 咖啡因。`);
}));

setupToday();
renderSupplements();
const savedProfile = readJson(PROFILE_KEY, null);
updateProfileUI(savedProfile);
const initialView = location.hash.slice(1);
if (["today", "record", "patterns"].includes(initialView)) switchView(initialView);
if (!savedProfile) setTimeout(openOnboarding, 180);
getRecords().then(updatePatterns).catch(() => {});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js?v=20260825-1").catch(() => {}));
