const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const appState = { view: "today", selectedSymptoms: [], caffeine: [], screenshotImport: null, screenshotUrl: null, activeRecordId: null };
const PROFILE_KEY = "nightRepair.profile.v1";
const FEEDBACK_KEY = "nightRepair.feedback.v1";
const EXPERIMENTS_KEY = "nightRepair.experiments.v1";
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
  const done = experiment.observations.filter((item) => item.adherence === "done" && Number.isFinite(item.value)).map((item) => item.value);
  const missed = experiment.observations.filter((item) => item.adherence === "missed" && Number.isFinite(item.value)).map((item) => item.value);
  if (done.length < 5 || missed.length < 5) return { ...experiment, status: "active", doneCount: done.length, missedCount: missed.length };
  const doneMedian = median(done);
  const missedMedian = median(missed);
  const improvement = experiment.lowerIsBetter ? (missedMedian - doneMedian) / Math.max(1, missedMedian) : (doneMedian - missedMedian) / Math.max(1, missedMedian);
  return { ...experiment, status: improvement >= 0.15 ? "effective" : "ineffective", doneCount: done.length, missedCount: missed.length, doneMedian, missedMedian, improvement };
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
  q("#halfLifeNote").textContent = profile.caffeineSensitive ? "依据敏感度自述，等待历史记录校准" : "默认工作参数，等待历史记录校准";
  q("#cutoffParam").textContent = calculateCutoff(q("#plannedSleep")?.value || "01:00", halfLife);
  q("#openProfile").textContent = profile.age >= 65 ? "65+" : "ME";
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

function resolveHalfLife(profile) {
  let halfLife = profile?.caffeineSensitive ? 6.5 : 5;
  const experiment = readJson(EXPERIMENTS_KEY, []).find((item) => item.id === "caffeine_cutoff" && item.status === "effective");
  if (experiment?.improvement >= 0.3) halfLife = Math.min(7, halfLife + 0.5);
  return halfLife;
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
  const halfLife = resolveHalfLife(profile);
  const caffeineNow = caffeineRemaining(appState.caffeine, analysisNow, halfLife);
  const caffeineAtSleep = caffeineRemaining(appState.caffeine, plannedDate, halfLife);
  const caffeineTotal = appState.caffeine.reduce((sum, item) => sum + item.mg, 0);
  const caffeineBaseline = recentCaffeineBaseline(previousRecords, analysisNow);
  const caffeineGap = caffeineBaseline === null ? null : caffeineTotal - caffeineBaseline;
  const hydration = q('input[name="hydration"]:checked').value;
  const lastMeal = { time: q("#lastMealTime").value, weight: q("#lastMealWeight").value };
  return {
    profile, onset, wake, plannedSleep, tstMinutes, sleepNeed, debtMinutes,
    awakeMinutes: Math.max(0, Math.round((analysisNow - wakeDate) / 60000)),
    caffeineNow, caffeineAtSleep, caffeineTotal, caffeineBaseline, caffeineGap, halfLife, hydration, lastMeal,
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
  q("#stateScore").textContent = Math.max(25, Math.round(100 - sleepPenalty - caffeinePenalty - mealPenalty));
  q("#scoreBreakdown").innerHTML = `<li>睡眠债 −${Math.round(sleepPenalty)}</li><li>咖啡因时点 −${Math.round(caffeinePenalty)}</li><li>夜间进食 −${mealPenalty}</li>`;
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
  q("#caffeineNowValue").textContent = `${Math.round(facts.caffeineNow)}mg`;
  q("#caffeineSleepValue").textContent = `${Math.round(facts.caffeineAtSleep)}mg`;
  q("#caffeineCutoffValue").textContent = calculateCutoff(facts.plannedSleep, halfLife);
  if (facts.caffeineBaseline == null) q("#caffeineStatusNote").textContent = `按 ${halfLife.toFixed(1)} 小时半衰期估算；再有 3 次记录后开始比较同一时段。`;
  else {
    const direction = facts.caffeineGap > 0 ? "多" : facts.caffeineGap < 0 ? "少" : "相同";
    q("#caffeineStatusNote").textContent = direction === "相同" ? `与近 7 次同一时段中位数相同；半衰期参数 ${halfLife.toFixed(1)} 小时。` : `比近 7 次同一时段中位数${direction}约 ${Math.round(Math.abs(facts.caffeineGap))}mg；半衰期参数 ${halfLife.toFixed(1)} 小时。`;
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
    [addToTime(facts.wake, 30), lightCopy[0], lightCopy[1], "light"],
    [calculateCutoff(facts.plannedSleep, halfLife), "今日咖啡截止线", `按你的 ${halfLife.toFixed(1)} 小时参数估算，睡前残留约 ${Math.round(facts.caffeineAtSleep)}mg。`],
    [addToTime(facts.wake, 270), "20 分钟小睡窗口", `自动配 ${addToTime(facts.wake, 290)} 唤醒。`, "nap"],
    [addToTime(facts.plannedSleep, -180), "停止进食", "给消化和体温下降留出时间。"],
    [addToTime(facts.plannedSleep, -90), windDownCopy[0], windDownCopy[1], "winddown"],
  ];
  q("#timelineList").innerHTML = items.map((item, index) => `<label class="timeline-item ${index === 0 ? "active" : ""}"><input class="timeline-check" type="checkbox" data-timeline="${index}" data-kind="${item[3] || "routine"}" /><input class="timeline-time" type="time" value="${item[0]}" aria-label="${item[1]}提醒时间" /><span><strong>${item[1]}</strong><small>${item[2]}</small></span><b>${index === 0 ? "接下来" : "稍后"}</b></label>`).join("");
  bindTimeline();
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
    input.closest(".timeline-item").classList.toggle("done", input.checked);
    const feedback = readJson(FEEDBACK_KEY, []);
    feedback.push({ date: new Date().toISOString(), timeline: input.dataset.timeline, done: input.checked });
    writeJson(FEEDBACK_KEY, feedback.slice(-100));
    updateRepairScore();
  }));
  qa(".timeline-time").forEach((input) => input.addEventListener("change", () => showToast("提醒时间已更新；重新导出日历即可生效。")));
}

function updateRepairScore() {
  const count = qa(".done-button.is-done").length + qa(".timeline-check:checked").length;
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
    date: localDateKey(sleepDates.midpoint),
    source: appState.screenshotImport ? "screenshot" : "manual",
    confidence: appState.screenshotImport ? 1 : 1,
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
    if (Array.isArray(payload.feedback)) writeJson(FEEDBACK_KEY, payload.feedback.slice(-100));
    if (Array.isArray(payload.experiments)) saveExperiments(payload.experiments);
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
  const events = qa(".timeline-item").slice(0, 5).flatMap((item, index) => {
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
  conclusions.forEach((item) => cards.push(`<article class="conclusion-card ${item.status === "effective" ? "verified" : "empty"}"><span>${item.status === "effective" ? "这条对你有效" : "对你没有观察到差异"}</span><h3>${item.title}</h3><p>${item.metric}中位数：执行 ${item.doneMedian}${item.unit}，未执行 ${item.missedMedian}${item.unit}。</p><div><b>执行 n=${item.doneCount}</b><b>未执行 n=${item.missedCount}</b></div></article>`));
  if (active) cards.push(`<article class="conclusion-card testing"><span>正在验证</span><h3>${active.title}</h3><p>${active.action}。执行与未执行各至少记录 5 次，才会晋升或撤回。</p><div><b>执行 ${active.doneCount || 0}/5</b><b>未执行 ${active.missedCount || 0}/5</b></div><progress value="${Math.min(10, (active.doneCount || 0) + (active.missedCount || 0))}" max="10"></progress></article>`);
  if (missing[0]) cards.push(`<article class="conclusion-card empty"><span>下一项实验</span><h3>${missing[0].title}</h3><p>${missing[0].action}，追踪“${missing[0].metric}”。</p><button class="secondary-button" data-start-experiment="${missing[0].id}" type="button">开始实验</button></article>`);
  q("#experimentGrid").innerHTML = cards.join("") || `<article class="conclusion-card empty"><span>暂无实验</span><h3>从一条具体建议开始验证</h3></article>`;
  q("#experimentGrid").closest(".section-block").querySelector(".counter").textContent = conclusions.length ? `${conclusions.length} 条个人结论` : "正在积累证据";
  qa("[data-start-experiment]").forEach((button) => button.addEventListener("click", () => startExperiment(button.dataset.startExperiment)));

  q("#followupCard").hidden = !active;
  if (active) {
    q("#followupQuestion").textContent = active.question;
    q("#followupContext").textContent = `实验：${active.title}。请先填结果，再说明昨天是否执行。`;
    q("#followupMetricLabel").childNodes[0].textContent = active.metric;
    q("#followupMetricUnit").textContent = active.unit;
    q("#followupMetric").value = "";
    q("#followupMetric").max = active.unit.includes("1–5") ? "5" : "300";
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
  experiments[index].observations.push({ date: new Date().toISOString(), adherence, value });
  experiments[index] = evaluateExperiment(experiments[index]);
  saveExperiments(experiments);
  renderExperiments();
  if (experiments[index].status === "effective") showToast("证据已达到门槛：这条对你有效，已加入个人方案。 ");
  else if (experiments[index].status === "ineffective") showToast("没有观察到差异：这条已从你的方案中移除。 ");
  else showToast("这次结果已记下，实验继续。 ");
}

function updatePatterns(records) {
  q("#recordCount").textContent = records.length;
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
  renderExperiments();
}

function handleScreenshot(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) { showToast("请选择图片格式的睡眠报告。"); return; }
  if (appState.screenshotUrl) URL.revokeObjectURL(appState.screenshotUrl);
  appState.screenshotUrl = URL.createObjectURL(file);
  q("#screenshotPreview").src = appState.screenshotUrl;
  q("#importedSleep").value = q("#sleepOnset").value;
  q("#importedWake").value = q("#wakeTime").value;
  q("#importedDeep").value = "";
  q("#importedRem").value = "";
  const filename = file.name.toLowerCase();
  const vendorHints = [["huawei", "huawei"], ["华为", "huawei"], ["xiaomi", "xiaomi"], ["小米", "xiaomi"], ["garmin", "garmin"], ["oppo", "oppo"], ["honor", "honor"], ["荣耀", "honor"]];
  const matchedVendor = vendorHints.find(([hint]) => filename.includes(hint))?.[1] || "unknown";
  q("#importedVendor").value = matchedVendor;
  q("#importedConfidence").value = matchedVendor === "unknown" ? "待人工确认" : "本机文件名线索 · 低";
  q("#screenshotDialog").showModal();
}

async function renderSupplements() {
  try {
    const response = await fetch("./supplements.json");
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
    const count = qa(".done-button.is-done").length + qa(".timeline-check:checked").length;
    q("#repairScore").innerHTML = `${Math.min(5, count)}<em>/5</em>`;
  }));

  qa(".timeline-check").forEach((input) => input.addEventListener("change", () => {
    input.closest(".timeline-item").classList.toggle("done", input.checked);
  }));

  qa("[data-adherence]").forEach((button) => button.addEventListener("click", () => recordExperimentObservation(button.dataset.adherence)));
}

qa("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
q("#openProfile").addEventListener("click", () => switchView("patterns"));
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
q("#cancelScreenshot").addEventListener("click", () => {
  q("#screenshotDialog").close();
  if (appState.screenshotUrl) URL.revokeObjectURL(appState.screenshotUrl);
  appState.screenshotUrl = null;
  q("#screenshotInput").value = "";
});
q("#confirmScreenshot").addEventListener("click", () => {
  if (!q("#importedSleep").value || !q("#importedWake").value) { showToast("请先确认入睡和起床时间。 "); return; }
  q("#sleepOnset").value = q("#importedSleep").value;
  q("#wakeTime").value = q("#importedWake").value;
  appState.screenshotImport = {
    vendor: q("#importedVendor").value,
    deepMinutes: q("#importedDeep").value ? Number(q("#importedDeep").value) : null,
    remMinutes: q("#importedRem").value ? Number(q("#importedRem").value) : null,
  };
  q("#screenshotDialog").close();
  if (appState.screenshotUrl) URL.revokeObjectURL(appState.screenshotUrl);
  appState.screenshotUrl = null;
  switchView("record");
  showToast("截图字段已由你确认；生成归因时才会写入记录。 ");
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
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
