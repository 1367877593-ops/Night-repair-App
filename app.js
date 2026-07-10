const TARGET_SLEEP_MINUTES = 420;
const STORAGE_KEY = "nightRepairAppStateV1";

const defaultState = {
  sleepRecords: [],
  mealRecords: [],
  todoDump: "",
  agentSettings: {
    mode: "mock",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
    useProxy: false
  }
};

let state = loadState();
let currentView = "today";
let activeAgent = "recovery";
const menuAgentMap = {
  today: "recovery",
  food: "diet",
  analysis: "analysis",
  soothe: "soothe",
  exercise: "exercise"
};
let audioContext = null;
let noiseNode = null;
let noiseGain = null;
let noiseTimer = null;
let breathInterval = null;
let breathRemaining = 180;
let breathRunning = false;
let relaxInterval = null;
let relaxRemaining = 600;
let relaxRunning = false;
let relaxStep = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function todayISO(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      ...defaultState,
      ...stored,
      agentSettings: {
        ...defaultState.agentSettings,
        ...(stored?.agentSettings || {})
      }
    };
  } catch {
    return { ...defaultState };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function toMinutes(value) {
  if (!value) return 0;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeNightMinute(value) {
  const minutes = toMinutes(value);
  return minutes < 12 * 60 ? minutes + 24 * 60 : minutes;
}

function durationBetween(start, end) {
  const startMin = toMinutes(start);
  let endMin = toMinutes(end);
  if (endMin <= startMin) endMin += 24 * 60;
  return endMin - startMin;
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return "--";
  const abs = Math.abs(Math.round(minutes));
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${minutes < 0 ? "-" : ""}${hours} 小时 ${mins} 分`;
}

function formatDebt(minutes) {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours > 0 ? "+" : ""}${hours} 小时`;
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function classifySleep(duration, sleepTime) {
  const lateBoundary = normalizeNightMinute(sleepTime);
  if (duration < 270 || lateBoundary >= 27 * 60) return "重度熬夜";
  if (duration < 360 || lateBoundary >= 25.5 * 60) return "中度熬夜";
  if (duration < 420 || lateBoundary >= 24.5 * 60) return "轻度熬夜";
  return "正常";
}

function calculateScore(record, meal) {
  if (!record) return null;
  let score = 100;
  score -= Math.max(0, TARGET_SLEEP_MINUTES - record.sleepDurationMinutes) * 0.12;
  score -= Number(record.wakeCount || 0) * 4;
  if (record.sleepLevel === "轻度熬夜") score -= 8;
  if (record.sleepLevel === "中度熬夜") score -= 18;
  if (record.sleepLevel === "重度熬夜") score -= 30;
  if (record.energyLevel === "tired") score -= 5;
  if (record.energyLevel === "bad") score -= 12;
  if (record.focusLevel === "bad") score -= 5;
  if (record.headache) score -= 5;

  if (meal) {
    if (meal.breakfast === "没吃" || meal.breakfast === "只喝咖啡") score -= 6;
    if (["炸鸡/汉堡", "烧烤/夜宵", "奶茶/甜品"].includes(meal.lunchCategory)) score -= 5;
    if (meal.lateSnack === "重油重辣" || meal.lateSnack === "甜品/奶茶") score -= 6;
    if (Number(meal.coffeeCount) >= 3) score -= 4;
    if (toMinutes(meal.lastCaffeineTime) >= 15 * 60) score -= 5;
    if (meal.waterIntake === "偏少") score -= 3;
  }

  return Math.max(30, Math.min(96, Math.round(score)));
}

function getLatestRecord(collection) {
  return [...collection].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function getMealForDate(date) {
  return state.mealRecords.find((item) => item.date === date) || null;
}

function getRisk(record, meal) {
  if (!record) return "--";
  const risks = [];
  if (["中度熬夜", "重度熬夜"].includes(record.sleepLevel)) risks.push("午后困倦");
  if (record.focusLevel === "bad" || record.energyLevel === "bad") risks.push("专注下降");
  if (meal && ["没吃", "只喝咖啡"].includes(meal.breakfast)) risks.push("上午能量波动");
  if (meal && ["重油重辣", "甜品/奶茶"].includes(meal.lateSnack)) risks.push("今晚入睡变慢");
  return risks.slice(0, 3).join("、") || "保持节奏";
}

function buildAdvice(record, meal) {
  if (!record) {
    return [
      {
        title: "先完成第一步",
        items: ["记录昨晚入睡和起床时间，系统会判断熬夜等级。", "如果今天也记录饮食，补救卡会给出外卖、一人餐和咖啡建议。"]
      }
    ];
  }

  const levelAdvice = {
    正常: {
      sleep: ["保持今天的节奏，上午晒光 10 分钟即可。", "如果午后犯困，闭眼休息 10-15 分钟。", "今晚继续按原计划进入睡前模式。"],
      work: ["今天可以安排正常工作节奏。", "把睡眠表现好的原因记录下来，方便复用。"]
    },
    轻度熬夜: {
      sleep: ["上午晒光 10 分钟，帮助身体启动。", "午睡可选，控制在 15-20 分钟。", "晚上提前 15 分钟进入睡前模式。"],
      work: ["上午先处理确定性任务。", "高强度任务放在精神回升后。"]
    },
    中度熬夜: {
      sleep: ["午睡 15-25 分钟，不要超过 30 分钟。", "今天不要长时间补觉，避免晚上更难睡。", "今晚提前 20-30 分钟进入睡前舒缓。"],
      work: ["上午先做简单、确定性的任务。", "下午避免安排高风险决策，给自己留一点缓冲。"]
    },
    重度熬夜: {
      sleep: ["午睡 20 分钟左右，不建议睡太久。", "今晚目标不是报复性补觉，而是回到稳定起床时间。", "如果长期严重睡眠不足或白天不可控嗜睡，建议咨询专业人士。"],
      work: ["今天避免疲劳驾驶和高风险操作。", "重要决策尽量延后，上午只做必要且低认知负荷的任务。"]
    }
  };

  const caffeine = getCaffeineAdvice(record, meal);
  const diet = getDietAdvice(record, meal);
  const evening = [
    "睡前 30 分钟进入低刺激模式，减少刷手机和强工作输入。",
    "做 3 分钟呼吸训练，或使用轻雨白噪音。",
    "把明天待办写下来，减少脑内循环。"
  ];

  return [
    { title: "睡眠补救", items: levelAdvice[record.sleepLevel].sleep },
    { title: "饮食补救", items: diet },
    { title: "咖啡因建议", items: caffeine },
    { title: "工作/学习建议", items: levelAdvice[record.sleepLevel].work },
    { title: "今晚修复", items: evening }
  ];
}

function getDietAdvice(record, meal) {
  const advice = [];
  const level = record.sleepLevel;

  if (!meal) {
    advice.push("今天建议补一条饮食记录，系统会结合外卖、夜宵和咖啡给出更具体建议。");
    advice.push("熬夜后优先选择主食 + 蛋白质 + 蔬菜的组合。");
    return advice;
  }

  if (meal.breakfast === "没吃") {
    advice.push("早餐没吃时，上午容易能量波动，可以补一个饭团/鸡蛋/酸奶这类简单组合。");
  } else if (meal.breakfast === "只喝咖啡") {
    advice.push("不要只靠咖啡启动，建议加一点主食或蛋白质，避免空腹猛喝。");
  } else {
    advice.push("早餐已经有记录，今天重点是午晚餐别太油太晚。");
  }

  if (meal.lunchType === "外卖") {
    if (["炸鸡/汉堡", "烧烤/夜宵", "奶茶/甜品"].includes(meal.lunchCategory)) {
      advice.push("午餐偏高油高糖，晚餐建议清淡一些，避免今天的困倦继续放大。");
    } else if (meal.lunchCategory === "麻辣烫/冒菜") {
      advice.push("如果点麻辣烫/冒菜，建议少油少辣，加鸡蛋、豆腐、瘦肉和青菜。");
    } else if (meal.lunchCategory === "沙拉/轻食") {
      advice.push("轻食不要只吃菜叶，记得补主食和蛋白质。");
    } else {
      advice.push("外卖优先保持米饭/面类主食 + 蛋白质 + 蔬菜的组合。");
    }
  }

  if (meal.lunchType === "一人简单餐" || meal.dinnerType === "一人简单餐") {
    advice.push("一人餐可以选鸡蛋面、速冻水饺加青菜、饭团加茶叶蛋、燕麦加牛奶。");
  }

  if (meal.lateSnack === "重油重辣" || meal.lateSnack === "甜品/奶茶") {
    advice.push("今晚尽量避开大份烧烤、炸鸡、重辣和高糖奶茶，真的饿就吃小份粥、牛奶、酸奶或鸡蛋。");
  } else if (meal.lateSnack === "清淡小份") {
    advice.push("夜宵控制得比较轻，继续保持小份、温和、别吃到很撑。");
  }

  if (toMinutes(meal.dinnerTime) >= 21 * 60) {
    advice.push("晚饭偏晚，睡前避免再吃到很撑，给身体留出消化时间。");
  }

  if (meal.waterIntake === "偏少" || level === "重度熬夜") {
    advice.push("今天先补水，不要用咖啡完全替代喝水。");
  }

  return advice.slice(0, 5);
}

function getCaffeineAdvice(record, meal) {
  if (!meal) {
    if (record.sleepLevel === "重度熬夜") return ["不要靠大量咖啡硬撑。咖啡可以短暂提神，但可能让今晚更难恢复。", "如果要喝，尽量安排在上午。"];
    return ["如果需要咖啡，建议安排在上午或午饭后早些时候。", "15:00 后尽量避免咖啡、浓茶和奶茶。"];
  }

  const items = [];
  const count = Number(meal.coffeeCount || 0);
  const late = toMinutes(meal.lastCaffeineTime) >= 15 * 60;
  if (count === 0) {
    items.push("今天没有咖啡因记录，如果精神还可以，可以不用额外补。");
  } else if (count >= 3) {
    items.push("今天咖啡/奶茶偏多，不建议继续加量，避免晚上更难恢复。");
  } else {
    items.push("咖啡可以帮助启动，但不要连续多杯硬撑。");
  }
  if (late) {
    items.push("最后一杯咖啡因在 15:00 后，今晚建议提前进入睡前舒缓。");
  } else {
    items.push("15:00 后尽量避免咖啡、浓茶和奶茶。");
  }
  if (meal.breakfast === "只喝咖啡") {
    items.push("明早尽量不要空腹只喝咖啡，可以搭配鸡蛋、面包、饭团或酸奶。");
  }
  return items;
}

function sectionHTML(sections) {
  return sections.map((section) => `
    <article class="advice-box">
      <h3>${section.title}</h3>
      <ul>${section.items.map((item) => `<li>${item}</li>`).join("")}</ul>
    </article>
  `).join("");
}

function makeSleepRecord(form) {
  const date = $("#sleepDate").value;
  const sleepTime = $("#sleepTime").value;
  const wakeTime = $("#wakeTime").value;
  const duration = durationBetween(sleepTime, wakeTime);
  const reasons = $$("#reasonGroup input:checked").map((input) => input.value);
  const sleepLevel = classifySleep(duration, sleepTime);
  return {
    id: makeId(),
    date,
    bedTime: $("#bedTime").value,
    sleepTime,
    wakeTime,
    sleepDurationMinutes: duration,
    wakeCount: Number($("#wakeCount").value || 0),
    lateNightReason: reasons.length ? reasons : ["未记录"],
    energyLevel: $("#energyLevel").value,
    moodLevel: $("#moodLevel").value,
    focusLevel: $("#focusLevel").value,
    headache: $("#headache").checked,
    sleepLevel,
    sleepDebtMinutes: duration - TARGET_SLEEP_MINUTES,
    createdAt: new Date().toISOString()
  };
}

function makeMealRecord() {
  return {
    id: makeId(),
    date: $("#mealDate").value,
    breakfast: $("#breakfast").value,
    lunchType: $("#lunchType").value,
    lunchCategory: $("#lunchCategory").value,
    dinnerTime: $("#dinnerTime").value,
    dinnerType: $("#dinnerType").value,
    lateSnack: $("#lateSnack").value,
    coffeeCount: Number($("#coffeeCount").value || 0),
    lastCaffeineTime: $("#lastCaffeineTime").value,
    waterIntake: $("#waterIntake").value,
    createdAt: new Date().toISOString()
  };
}

function upsert(collection, item) {
  const index = collection.findIndex((oldItem) => oldItem.date === item.date);
  if (index >= 0) collection.splice(index, 1, item);
  else collection.push(item);
  collection.sort((a, b) => a.date.localeCompare(b.date));
}

function renderAll() {
  const latestSleep = getLatestRecord(state.sleepRecords);
  const meal = latestSleep ? getMealForDate(latestSleep.date) : getLatestRecord(state.mealRecords);
  const score = calculateScore(latestSleep, meal);
  const advice = buildAdvice(latestSleep, meal);

  if (latestSleep) {
    $("#todaySummary").textContent = `昨晚睡了 ${formatDuration(latestSleep.sleepDurationMinutes)}，属于${latestSleep.sleepLevel}。今天先把损失降下来。`;
    $("#homeScore").textContent = score;
    $("#homeLevel").textContent = latestSleep.sleepLevel;
    $("#homeDuration").textContent = formatDuration(latestSleep.sleepDurationMinutes);
    $("#homeDebt").textContent = formatDebt(latestSleep.sleepDebtMinutes);
    $("#homeRisk").textContent = getRisk(latestSleep, meal);
    $("#homeCardTitle").textContent = `${latestSleep.sleepLevel}后的今日恢复方案`;
  } else {
    $("#todaySummary").textContent = "先记录昨晚睡眠，系统会生成今日补救方案。";
    $("#homeScore").textContent = "--";
    $("#homeLevel").textContent = "等待记录";
    $("#homeDuration").textContent = "--";
    $("#homeDebt").textContent = "--";
    $("#homeRisk").textContent = "--";
    $("#homeCardTitle").textContent = "先记录昨晚睡眠";
  }

  $("#homeAdvice").innerHTML = sectionHTML(advice.slice(0, 3));
  $("#todoDump").value = state.todoDump || "";
  renderAgentSettings();
  renderReport();
}

function renderReport() {
  const dates = Array.from({ length: 7 }, (_, index) => todayISO(index - 6));
  const sleepRecords = dates.map((date) => state.sleepRecords.find((item) => item.date === date)).filter(Boolean);
  const mealRecords = dates.map((date) => state.mealRecords.find((item) => item.date === date)).filter(Boolean);

  const avg = sleepRecords.length
    ? Math.round(sleepRecords.reduce((sum, item) => sum + item.sleepDurationMinutes, 0) / sleepRecords.length)
    : null;
  const lateCount = sleepRecords.filter((item) => item.sleepLevel !== "正常").length;
  const snackCount = mealRecords.filter((item) => item.lateSnack && item.lateSnack !== "没有").length;
  const lateCaffeine = mealRecords.filter((item) => toMinutes(item.lastCaffeineTime) >= 15 * 60).length;

  $("#reportAvgSleep").textContent = avg ? formatDuration(avg) : "--";
  $("#reportLateCount").textContent = sleepRecords.length ? `${lateCount} 天` : "--";
  $("#reportSnackCount").textContent = mealRecords.length ? `${snackCount} 次` : "--";
  $("#reportCaffeineLate").textContent = mealRecords.length ? `${lateCaffeine} 次` : "--";

  $("#sleepChart").innerHTML = dates.map((date) => {
    const record = state.sleepRecords.find((item) => item.date === date);
    const minutes = record ? record.sleepDurationMinutes : 0;
    const height = record ? Math.max(12, Math.min(100, (minutes / 540) * 100)) : 4;
    const label = date.slice(5).replace("-", "/");
    return `
      <div class="bar">
        <div class="bar-fill" style="height:${height}%"></div>
        <small>${record ? formatDuration(minutes).replace(" 小时 ", "h").replace(" 分", "m") : "无"}</small>
        <small>${label}</small>
      </div>
    `;
  }).join("");

  const reasonCounts = {};
  sleepRecords.forEach((record) => {
    record.lateNightReason.forEach((reason) => {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });
  });
  const topReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  $("#reasonTags").innerHTML = topReasons.length
    ? topReasons.map(([reason, count]) => `<span>${reason} ${count} 次</span>`).join("")
    : "<span>暂无熬夜原因</span>";

  if (!sleepRecords.length) {
    $("#reportTitle").textContent = "暂无足够记录";
    $("#reportSummary").textContent = "保存几天睡眠和饮食记录后，这里会生成作息规律总结。";
    return;
  }

  const reasonText = topReasons.length ? `最常见熬夜原因是 ${topReasons[0][0]}。` : "暂未记录熬夜原因。";
  const dinnerLate = mealRecords.filter((item) => toMinutes(item.dinnerTime) >= 21 * 60).length;
  $("#reportTitle").textContent = `最近 7 天有 ${lateCount} 天熬夜`;
  $("#reportSummary").textContent = `本周平均睡眠 ${formatDuration(avg)}，${reasonText} 饮食上有 ${dinnerLate} 次晚饭晚于 21:00，${snackCount} 次夜宵，${lateCaffeine} 次咖啡因晚于 15:00。下周建议优先调整晚饭时间、晚咖啡和睡前手机使用。`;
}

const agentDefinitions = {
  recovery: {
    label: "今日恢复 Agent",
    role: "你是夜后修复 App 的今日恢复 Agent，负责把睡眠、饮食、咖啡因、午睡、任务安排整合成今天可执行的补救方案。"
  },
  diet: {
    label: "饮食 Agent",
    role: "你是夜后修复 App 的饮食 Agent，负责外卖、一人餐、夜宵、早餐和咖啡因建议。目标不是减肥，而是帮助熬夜人群减少白天崩溃感和晚上继续睡不着。"
  },
  analysis: {
    label: "作息分析 Agent",
    role: "你是夜后修复 App 的作息分析 Agent，负责根据最近记录识别熬夜模式、主要诱因和下周可执行的修复策略。"
  },
  soothe: {
    label: "睡前舒缓 Agent",
    role: "你是夜后修复 App 的睡前舒缓 Agent，负责用温和、不说教的方式帮助用户做睡前收尾、待办清空、呼吸和低刺激准备。"
  },
  exercise: {
    label: "轻运动 Agent",
    role: "你是夜后修复 App 的轻运动 Agent，负责给熬夜后、久坐后、午后困倦或睡前场景推荐低负担活动方案。不要追求健身效果，目标是恢复精神、缓解僵硬、帮助入睡。"
  }
};

function getRecentRecords(collection, count = 7) {
  return [...collection].sort((a, b) => b.date.localeCompare(a.date)).slice(0, count);
}

function buildAgentContext() {
  const latestSleep = getLatestRecord(state.sleepRecords);
  const latestMeal = latestSleep ? getMealForDate(latestSleep.date) : getLatestRecord(state.mealRecords);
  const score = calculateScore(latestSleep, latestMeal);
  const advice = latestSleep ? buildAdvice(latestSleep, latestMeal) : [];
  const recentSleep = getRecentRecords(state.sleepRecords);
  const recentMeals = getRecentRecords(state.mealRecords);

  return {
    today: todayISO(),
    latestSleep,
    latestMeal,
    recoveryScore: score,
    currentRuleAdvice: advice,
    recentSleep,
    recentMeals,
    todoDump: state.todoDump || ""
  };
}

function buildAgentSystemPrompt(agentId) {
  const agent = agentDefinitions[agentId] || agentDefinitions.recovery;
  return `${agent.role}

你必须遵守：
1. 用中文回答，语气温和、现实、不说教。
2. 输出要具体可执行，优先按“现在/上午/中午/下午/晚上”或清单组织。
3. 不能做医疗诊断；如果用户描述长期严重失眠、频繁呼吸暂停、白天不可控嗜睡、胸闷头晕等明显风险，只能建议咨询专业人士。
4. 规则引擎负责底线，AI 负责解释和个性化。不要推翻明确的安全规则，例如重度熬夜后避免疲劳驾驶、15:00 后减少咖啡因、睡前避免剧烈运动。
5. 不要要求用户做复杂记录或复杂烹饪，要适配打工人、外卖、一人餐、便利店场景。
6. 回答控制在 300-500 字以内，除非用户明确要求详细方案。`;
}

function buildAgentUserContent(userPrompt) {
  const context = buildAgentContext();
  return `用户问题：
${userPrompt}

当前 App 数据上下文：
${JSON.stringify(context, null, 2)}

请结合数据和用户问题回答。如果数据不足，先说明缺什么，但仍然给一个可执行的保守建议。`;
}

function renderAgentSettings() {
  const settings = state.agentSettings || defaultState.agentSettings;
  $("#agentMode").value = settings.mode || "mock";
  $("#agentModel").value = settings.model || defaultState.agentSettings.model;
  $("#agentBaseUrl").value = settings.baseUrl || defaultState.agentSettings.baseUrl;
  $("#agentApiKey").value = settings.apiKey || "";
}

function saveAgentSettings() {
  const baseUrl = $("#agentBaseUrl").value.trim().replace(/\/$/, "") || defaultState.agentSettings.baseUrl;
  state.agentSettings = {
    mode: $("#agentMode").value,
    model: $("#agentModel").value.trim() || defaultState.agentSettings.model,
    baseUrl,
    apiKey: $("#agentApiKey").value.trim(),
    useProxy: baseUrl.endsWith("/api") || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")
  };
  saveState();
  const msg = state.agentSettings.mode === "api"
    ? "配置已保存。现在可以使用真实接口调用。"
    : "配置已保存。当前为本地模拟模式，不会调用外部接口。";
  $("#agentOutput").textContent = msg;
}

function getPromptEl(viewId) {
  const map = { today: "agentPrompt", food: "foodPrompt", analysis: "analysisPrompt", soothe: "soothePrompt", exercise: "exercisePrompt" };
  return map[viewId] || "agentPrompt";
}

function getOutputEl(viewId) {
  const map = { today: "agentOutput", food: "foodOutput", analysis: "analysisOutput", soothe: "sootheOutput", exercise: "exerciseOutput" };
  return map[viewId] || "agentOutput";
}

function fillAgentPromptWithCurrentData() {
  const latestSleep = getLatestRecord(state.sleepRecords);
  const meal = latestSleep ? getMealForDate(latestSleep.date) : getLatestRecord(state.mealRecords);
  const promptEl = getPromptEl(currentView);
  if (!latestSleep) {
    $(`#${promptEl}`).value = "我还没有记录睡眠，请告诉我第一天应该怎么开始使用这个 App。";
    return;
  }
  const mealText = meal
    ? `早餐：${meal.breakfast}，午餐：${meal.lunchType}/${meal.lunchCategory}，晚饭时间：${meal.dinnerTime}，夜宵：${meal.lateSnack}，咖啡/奶茶：${meal.coffeeCount} 杯，最后一杯 ${meal.lastCaffeineTime}`
    : "今天还没有饮食记录";
  $(`#${promptEl}`).value = `昨晚 ${latestSleep.sleepTime} 入睡，${latestSleep.wakeTime} 起床，睡了 ${formatDuration(latestSleep.sleepDurationMinutes)}，属于${latestSleep.sleepLevel}，原因是${latestSleep.lateNightReason.join("、")}。${mealText}。请结合我的情况，给我今天从现在到睡前的恢复方案。`;
}

async function callAgentAPI(agentId, prompt) {
  const settings = state.agentSettings || defaultState.agentSettings;
  const useProxy = Boolean(settings.useProxy || settings.baseUrl.endsWith("/api"));
  if (settings.mode !== "api" || (!settings.apiKey && !useProxy)) {
    return localAgentResponse(agentId, prompt);
  }

  const url = `${settings.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json"
  };
  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: "system", content: buildAgentSystemPrompt(agentId) },
        { role: "user", content: buildAgentUserContent(prompt) }
      ],
      temperature: 0.55
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`接口返回 ${response.status}：${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("接口没有返回可读内容，请检查模型名或接口格式。");
  return content;
}

function localAgentResponse(agentId, prompt) {
  const context = buildAgentContext();
  const latestSleep = context.latestSleep;
  const latestMeal = context.latestMeal;

  if (!latestSleep) {
    return "本地模拟 Agent：\n\n你还没有保存睡眠记录。建议先记录昨晚入睡、起床、夜醒次数和熬夜原因；如果今天也记录早餐、外卖、咖啡和夜宵，补救卡会更贴近你的真实状态。";
  }

  if (agentId === "diet") {
    const mealLine = latestMeal
      ? `你今天的饮食记录是：早餐${latestMeal.breakfast}，午餐${latestMeal.lunchType}/${latestMeal.lunchCategory}，夜宵${latestMeal.lateSnack}，咖啡因${latestMeal.coffeeCount}杯。`
      : "你今天还没有饮食记录。";
    return `本地模拟饮食 Agent：\n\n${mealLine}\n\n建议：\n1. 熬夜后不要只靠咖啡硬撑，优先补一点主食和蛋白质。\n2. 如果点外卖，优先选米饭套餐、清汤面、粥类或轻食加蛋白质。\n3. 如果想点麻辣烫，建议少油少辣，加鸡蛋、豆腐、瘦肉和青菜，不建议配奶茶。\n4. 晚上真的饿，可以选小份粥、牛奶、酸奶、鸡蛋或小份面包，别吃到很撑。`;
  }

  if (agentId === "analysis") {
    const recent = context.recentSleep;
    const lateCount = recent.filter((item) => item.sleepLevel !== "正常").length;
    const reasons = {};
    recent.forEach((item) => item.lateNightReason.forEach((reason) => {
      reasons[reason] = (reasons[reason] || 0) + 1;
    }));
    const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || "未记录";
    return `本地模拟作息分析 Agent：\n\n最近 ${recent.length} 条睡眠记录里，有 ${lateCount} 次属于熬夜。最常见原因是「${topReason}」。\n\n下周建议：\n1. 先不要强行早睡，先设置一个“收尾时间”，比如睡前 30 分钟停止高刺激输入。\n2. 如果主要原因是工作，把未完成事项写到睡前待办里，减少脑内循环。\n3. 如果主要原因是刷手机，先做 10 分钟低刺激替代，而不是直接要求自己立刻睡。\n4. 每天只提前 15-20 分钟，比一次性大幅调整更容易坚持。`;
  }

  if (agentId === "soothe") {
    return "本地模拟睡前舒缓 Agent：\n\n现在先不追求马上睡着。请做一个简单收尾：\n1. 写下明天最重要的 3 件事，把它们从脑子里移到纸面上。\n2. 放下肩膀，松开下巴和眉心。\n3. 跟随 4 秒吸气、2 秒停住、6 秒呼气，做 5 轮。\n4. 如果还是有念头出现，只需要知道它来了，然后把注意力带回呼气。";
  }

  if (agentId === "exercise") {
    return `本地模拟轻运动 Agent：\n\n你昨晚属于${latestSleep.sleepLevel}，今天不建议做高强度训练。给你一个 8 分钟低负担方案：\n1. 颈部左右放松 1 分钟。\n2. 肩胛后缩和扩胸 2 分钟。\n3. 站起来慢走或原地踏步 2 分钟。\n4. 小腿和腿后侧拉伸 2 分钟。\n5. 最后 1 分钟慢呼吸。\n\n如果有头晕、胸闷或明显不适，直接停止。`;
  }

  const advice = buildAdvice(latestSleep, latestMeal)
    .map((section) => `【${section.title}】\n${section.items.map((item) => `- ${item}`).join("\n")}`)
    .join("\n\n");
  return `本地模拟今日恢复 Agent：\n\n你昨晚睡了 ${formatDuration(latestSleep.sleepDurationMinutes)}，属于${latestSleep.sleepLevel}，睡眠债 ${formatDebt(latestSleep.sleepDebtMinutes)}。\n\n${advice}\n\n你问的是：${prompt || "今天怎么补救"}\n\n重点：今天不要用意志力硬扛，先把咖啡、午睡、外卖和睡前收尾安排得更稳。`;
}

async function runAgent() {
  const promptEl = getPromptEl(currentView);
  const outputEl = getOutputEl(currentView);
  const prompt = $(`#${promptEl}`).value.trim();
  if (!prompt) {
    $(`#${outputEl}`).textContent = "先输入一个问题，或者点击上方的快捷问题。";
    return;
  }

  $(`#${outputEl}`).textContent = "Agent 正在结合当前记录生成建议...";
  try {
    const content = await callAgentAPI(activeAgent, prompt);
    $(`#${outputEl}`).textContent = content;
  } catch (error) {
    $(`#${outputEl}`).textContent = `真实接口调用失败：${error.message}\n\n已切换为本地模拟结果：\n\n${localAgentResponse(activeAgent, prompt)}`;
  }
}

function switchView(view) {
  currentView = view;
  activeAgent = menuAgentMap[view] || "recovery";
  $$(".view").forEach((node) => node.classList.toggle("active", node.id === `view-${view}`));
  $$("[data-nav]").forEach((node) => {
    if (node.tagName === "BUTTON") node.classList.toggle("active", node.dataset.nav === view);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setInitialDates() {
  $("#sleepDate").value = todayISO();
  $("#mealDate").value = todayISO();
}

function fillDemoSleep() {
  $("#sleepDate").value = todayISO();
  $("#bedTime").value = "00:50";
  $("#sleepTime").value = "01:35";
  $("#wakeTime").value = "07:00";
  $("#wakeCount").value = "1";
  $("#energyLevel").value = "tired";
  $("#moodLevel").value = "normal";
  $("#focusLevel").value = "bad";
  $("#headache").checked = false;
  $$("#reasonGroup input").forEach((input) => {
    input.checked = ["工作加班", "刷手机"].includes(input.value);
  });
}

function fillDemoMeal() {
  $("#mealDate").value = todayISO();
  $("#breakfast").value = "只喝咖啡";
  $("#lunchType").value = "外卖";
  $("#lunchCategory").value = "麻辣烫/冒菜";
  $("#dinnerTime").value = "21:30";
  $("#dinnerType").value = "外卖";
  $("#lateSnack").value = "重油重辣";
  $("#coffeeCount").value = "2";
  $("#lastCaffeineTime").value = "16:30";
  $("#waterIntake").value = "偏少";
}

function seedDemoData() {
  const sleepSamples = [
    ["-6", "00:20", "07:30", ["工作加班"], "轻度熬夜"],
    ["-5", "01:10", "07:10", ["刷手机"], "轻度熬夜"],
    ["-4", "01:45", "07:00", ["工作加班", "焦虑"], "中度熬夜"],
    ["-3", "23:55", "07:20", ["未记录"], "正常"],
    ["-2", "02:20", "07:00", ["追剧"], "中度熬夜"],
    ["-1", "00:40", "07:15", ["社交"], "轻度熬夜"],
    ["0", "01:35", "07:00", ["工作加班", "刷手机"], "中度熬夜"]
  ];

  state.sleepRecords = sleepSamples.map(([offset, sleepTime, wakeTime, reasons]) => {
    const duration = durationBetween(sleepTime, wakeTime);
    return {
      id: makeId(),
      date: todayISO(Number(offset)),
      bedTime: sleepTime,
      sleepTime,
      wakeTime,
      sleepDurationMinutes: duration,
      wakeCount: Number(offset) === -4 ? 2 : 1,
      lateNightReason: reasons,
      energyLevel: Number(offset) === 0 ? "tired" : "good",
      moodLevel: "normal",
      focusLevel: Number(offset) === 0 ? "bad" : "normal",
      headache: false,
      sleepLevel: classifySleep(duration, sleepTime),
      sleepDebtMinutes: duration - TARGET_SLEEP_MINUTES,
      createdAt: new Date().toISOString()
    };
  });

  state.mealRecords = sleepSamples.map(([offset], index) => ({
    id: makeId(),
    date: todayISO(Number(offset)),
    breakfast: index % 3 === 0 ? "只喝咖啡" : "简单吃了",
    lunchType: "外卖",
    lunchCategory: index % 4 === 0 ? "麻辣烫/冒菜" : "米饭套餐",
    dinnerTime: index % 2 === 0 ? "21:20" : "19:30",
    dinnerType: index % 2 === 0 ? "外卖" : "一人简单餐",
    lateSnack: index % 3 === 0 ? "重油重辣" : "没有",
    coffeeCount: index % 2 === 0 ? 2 : 1,
    lastCaffeineTime: index % 2 === 0 ? "16:30" : "13:20",
    waterIntake: index % 2 === 0 ? "偏少" : "正常",
    createdAt: new Date().toISOString()
  }));

  saveState();
  renderAll();
}

function startNoise() {
  audioContext = audioContext || new AudioContext();
  const bufferSize = 2 * audioContext.sampleRate;
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    output[i] = Math.random() * 2 - 1;
  }

  noiseNode = audioContext.createBufferSource();
  noiseGain = audioContext.createGain();
  noiseGain.gain.value = 0.045;
  noiseNode.buffer = noiseBuffer;
  noiseNode.loop = true;
  noiseNode.connect(noiseGain);
  noiseGain.connect(audioContext.destination);
  noiseNode.start();
  $("#noiseToggle").textContent = "停止白噪音";
}

function stopNoise() {
  if (noiseNode) {
    noiseNode.stop();
    noiseNode.disconnect();
  }
  noiseNode = null;
  noiseGain = null;
  clearTimeout(noiseTimer);
  $("#noiseToggle").textContent = "播放白噪音";
}

function updateBreathUI() {
  const circle = $("#breathCircle");
  const phase = breathRemaining % 12;
  circle.classList.remove("expand", "hold", "shrink");
  if (phase >= 8) {
    circle.classList.add("expand");
    $("#breathText").textContent = "吸气";
  } else if (phase >= 6) {
    circle.classList.add("hold");
    $("#breathText").textContent = "停住";
  } else {
    circle.classList.add("shrink");
    $("#breathText").textContent = "呼气";
  }
  const minutes = String(Math.floor(breathRemaining / 60)).padStart(2, "0");
  const seconds = String(breathRemaining % 60).padStart(2, "0");
  $("#breathTimer").textContent = `${minutes}:${seconds}`;
}

function toggleBreath() {
  if (breathRunning) {
    clearInterval(breathInterval);
    breathRunning = false;
    $("#breathToggle").textContent = "继续呼吸";
    return;
  }
  breathRunning = true;
  $("#breathToggle").textContent = "暂停呼吸";
  updateBreathUI();
  breathInterval = setInterval(() => {
    breathRemaining -= 1;
    if (breathRemaining <= 0) {
      clearInterval(breathInterval);
      breathRunning = false;
      breathRemaining = 180;
      $("#breathToggle").textContent = "再来一次";
      $("#breathText").textContent = "完成";
      $("#breathCircle").classList.remove("expand", "hold", "shrink");
      $("#breathTimer").textContent = "03:00";
      return;
    }
    updateBreathUI();
  }, 1000);
}

const relaxSteps = [
  ["从肩颈开始放松", "慢慢放下肩膀，松开下巴和眉心。你不需要马上睡着，只需要让身体先降速。"],
  ["放松手臂和手掌", "感觉手臂变重，手指不用抓住任何东西。把今天剩下的紧绷慢慢放掉。"],
  ["放松胸口和腹部", "让呼吸变得浅一点、慢一点。吸气时不用用力，呼气时多放掉一点。"],
  ["放松腿部和脚掌", "从大腿到小腿，再到脚趾，逐段松开。身体越沉，脑子越不用忙。"],
  ["收尾", "如果还有念头出现，只要知道它来了，然后让它先放在旁边。现在可以准备睡了。"]
];

function renderRelaxStep() {
  const [title, text] = relaxSteps[relaxStep % relaxSteps.length];
  $("#relaxStepTitle").textContent = title;
  $("#relaxStepText").textContent = text;
  const minutes = String(Math.floor(relaxRemaining / 60)).padStart(2, "0");
  const seconds = String(relaxRemaining % 60).padStart(2, "0");
  $("#relaxTimer").textContent = `${minutes}:${seconds}`;
}

function toggleRelax() {
  if (relaxRunning) {
    clearInterval(relaxInterval);
    relaxRunning = false;
    $("#relaxToggle").textContent = "继续放松";
    return;
  }
  relaxRunning = true;
  $("#relaxToggle").textContent = "暂停放松";
  renderRelaxStep();
  relaxInterval = setInterval(() => {
    relaxRemaining -= 1;
    const nextStep = Math.min(4, Math.floor((600 - relaxRemaining) / 120));
    if (nextStep !== relaxStep) {
      relaxStep = nextStep;
      renderRelaxStep();
    }
    if (relaxRemaining <= 0) {
      clearInterval(relaxInterval);
      relaxRunning = false;
      relaxRemaining = 600;
      relaxStep = 0;
      $("#relaxToggle").textContent = "再来一次";
      $("#relaxTimer").textContent = "完成";
      $("#relaxStepTitle").textContent = "放松完成";
      $("#relaxStepText").textContent = "现在可以关掉屏幕，保持低刺激环境，给身体一点入睡时间。";
      return;
    }
    renderRelaxStep();
  }, 1000);
}

function bindEvents() {
  $$("[data-nav]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      switchView(node.dataset.nav);
    });
  });

  $("#sleepForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const record = makeSleepRecord(event.currentTarget);
    upsert(state.sleepRecords, record);
    saveState();
    renderAll();
    switchView("today");
  });

  $("#mealForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const record = makeMealRecord();
    upsert(state.mealRecords, record);
    saveState();
    renderAll();
    switchView("food");
  });

  $("#fillDemoSleep").addEventListener("click", fillDemoSleep);
  $("#fillDemoMeal").addEventListener("click", fillDemoMeal);
  $("#seedDemoData").addEventListener("click", seedDemoData);

  $("#noiseToggle").addEventListener("click", () => {
    if (noiseNode) stopNoise();
    else startNoise();
  });

  $("#noiseTimer").addEventListener("click", () => {
    if (!noiseNode) startNoise();
    clearTimeout(noiseTimer);
    noiseTimer = setTimeout(stopNoise, 10 * 60 * 1000);
    $("#noiseTimer").textContent = "已设置 10 分钟关闭";
  });

  $("#breathToggle").addEventListener("click", toggleBreath);
  $("#breathReset").addEventListener("click", () => {
    clearInterval(breathInterval);
    breathRemaining = 180;
    breathRunning = false;
    $("#breathToggle").textContent = "开始呼吸";
    $("#breathText").textContent = "吸气";
    $("#breathTimer").textContent = "03:00";
    $("#breathCircle").classList.remove("expand", "hold", "shrink");
  });

  $("#relaxToggle").addEventListener("click", toggleRelax);
  $("#relaxNext").addEventListener("click", () => {
    relaxStep = (relaxStep + 1) % relaxSteps.length;
    renderRelaxStep();
  });

  $("#saveTodo").addEventListener("click", () => {
    state.todoDump = $("#todoDump").value.trim();
    saveState();
    $("#todoHint").textContent = "已保存。今晚先把这些事放在这里。";
  });

  $("#saveAgentSettings").addEventListener("click", saveAgentSettings);
  $("#useDeepSeekPreset").addEventListener("click", () => {
    $("#agentMode").value = "api";
    $("#agentBaseUrl").value = "https://api.deepseek.com";
    $("#agentModel").value = "deepseek-v4-flash";
    state.agentSettings.useProxy = false;
    $("#agentOutput").textContent = "已填入 DeepSeek 官方接口参数。请粘贴 API Key 后点击“保存配置”。";
  });
  $("#useLocalProxyPreset").addEventListener("click", () => {
    $("#agentMode").value = "api";
    $("#agentBaseUrl").value = "http://localhost:8787/api";
    $("#agentModel").value = "deepseek-v4-flash";
    $("#agentApiKey").value = "";
    state.agentSettings.useProxy = true;
    $("#agentOutput").textContent = "已切到本地代理模式。请用终端启动 server.js，并在启动命令里设置 DEEPSEEK_API_KEY。";
  });
  $("#clearAgentKey").addEventListener("click", () => {
    state.agentSettings.apiKey = "";
    state.agentSettings.mode = "mock";
    state.agentSettings.useProxy = false;
    saveState();
    renderAgentSettings();
    $("#agentOutput").textContent = "已清除 API Key，并切回本地模拟模式。";
  });

  // 睡眠表单折叠切换
  $("#toggleSleepForm").addEventListener("click", () => {
    const panel = $("#sleepFormPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    if (panel.style.display !== "none") {
      $("#sleepDate").value = todayISO();
      panel.scrollIntoView({ behavior: "smooth" });
    }
  });

  // 各视图 Agent 运行按钮
  $("#runAgent").addEventListener("click", runAgent);
  $("#runFoodAgent").addEventListener("click", runAgent);
  $("#runAnalysisAgent").addEventListener("click", runAgent);
  $("#runSootheAgent").addEventListener("click", runAgent);
  $("#runExerciseAgent").addEventListener("click", runAgent);

  // 用当前数据生成问题
  $("#agentUseCurrent").addEventListener("click", fillAgentPromptWithCurrentData);

  // 各视图 Agent 提示输入框 Enter 键
  ["agentPrompt", "foodPrompt", "analysisPrompt", "soothePrompt", "exercisePrompt"].forEach((id) => {
    const el = $(`#${id}`);
    if (el) {
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          runAgent();
        }
      });
    }
  });

  // 各视图快捷问题按钮
  ["recoveryChips", "foodChips", "analysisChips", "sootheChips", "exerciseChips"].forEach((chipsId) => {
    const container = $(`#${chipsId}`);
    if (container) {
      container.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          const promptEl = getPromptEl(currentView);
          $(`#${promptEl}`).value = button.dataset.prompt;
        });
      });
    }
  });

  // 各视图复制结果按钮
  const copyPairs = [
    ["copyAgentOutput", "agentOutput"],
    ["copyFoodOutput", "foodOutput"],
    ["copyAnalysisOutput", "analysisOutput"],
    ["copySootheOutput", "sootheOutput"],
    ["copyExerciseOutput", "exerciseOutput"]
  ];
  copyPairs.forEach(([btnId, outId]) => {
    const btn = $(`#${btnId}`);
    if (btn) {
      btn.addEventListener("click", async () => {
        const text = $(`#${outId}`).textContent.trim();
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          $(`#${outId}`).textContent = `${text}\n\n[已复制到剪贴板]`;
        } catch {
          $(`#${outId}`).textContent = `${text}\n\n[当前浏览器不允许自动复制，请手动选择文本复制]`;
        }
      });
    }
  });
}

function init() {
  setInitialDates();
  bindEvents();
  renderAgentSettings();
  renderRelaxStep();
  if (!state.sleepRecords.length) {
    fillDemoSleep();
  }
  renderAll();
}

init();
