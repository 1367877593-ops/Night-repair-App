const navButtons = Array.from(document.querySelectorAll("[data-view]"));
const views = Array.from(document.querySelectorAll(".view"));
const sleepForm = document.querySelector("#sleepForm");
const foodChoices = Array.from(document.querySelectorAll("[data-food]"));
const breathButton = document.querySelector("#breathButton");
const breathCircle = document.querySelector("#breathCircle");
const refreshAnalysis = document.querySelector("#refreshAnalysis");

const state = {
  sleepMinutes: 320,
  level: "中度熬夜",
  debt: -1.7,
  score: 68,
  reasons: ["工作加班", "刷手机"],
  energy: "tired"
};

const foodMap = {
  麻辣烫: ["少油少辣，别加重口味汤底。", "加鸡蛋、豆腐、瘦肉和青菜。", "不要再配奶茶，下午 3 点后停止咖啡因。"],
  汉堡炸鸡: ["如果必须吃，选小份套餐，别加甜饮。", "晚餐改清淡，避免今天困倦继续放大。", "下午安排短休息，不要靠第二杯咖啡硬撑。"],
  米饭套餐: ["优先选择饭 + 肉/蛋/豆制品 + 蔬菜。", "少油少辣，避免太咸。", "吃到七八分饱，下午更不容易犯困。"],
  轻食沙拉: ["轻食不要只吃菜叶，加鸡胸肉、鸡蛋或豆制品。", "保留一点主食，比如玉米、土豆或全麦面包。", "不要用高糖饮料补能量。"],
  便利店: ["饭团 + 茶叶蛋 + 无糖酸奶。", "三明治 + 牛奶。", "关东煮选豆腐、蛋、蔬菜，少喝汤。"],
  夜宵: ["真的饿就选小份粥、牛奶、酸奶、鸡蛋或小面包。", "避免烧烤、炸鸡、火锅和高糖奶茶。", "吃完留一点消化时间再睡。"]
};

const foodTitles = {
  麻辣烫: "麻辣烫可以点，但要改点法",
  汉堡炸鸡: "今天不太适合炸鸡汉堡",
  米饭套餐: "米饭套餐是今天比较稳的选择",
  轻食沙拉: "轻食可以，但不要只吃菜叶",
  便利店: "便利店也能组合出恢复餐",
  夜宵: "夜宵不是禁止，而是别让它继续影响睡眠"
};

let breathRunning = false;
let breathTimer = null;

function switchView(viewId) {
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  views.forEach((view) => view.classList.toggle("active", view.id === viewId));
}

function minutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function duration(start, end) {
  let wake = minutes(end);
  const sleep = minutes(start);
  if (wake <= sleep) wake += 1440;
  return wake - sleep;
}

function formatDuration(total) {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${hour} 小时 ${minute} 分`;
}

function classify(total, sleepTime) {
  const sleepMinute = minutes(sleepTime) < 720 ? minutes(sleepTime) + 1440 : minutes(sleepTime);
  if (total < 270 || sleepMinute >= 1620) return "重度熬夜";
  if (total < 360 || sleepMinute >= 1530) return "中度熬夜";
  if (total < 420 || sleepMinute >= 1470) return "轻度熬夜";
  return "正常";
}

function computeScore(total, level, energy) {
  let score = 100 - Math.max(0, 420 - total) * 0.12;
  if (level === "轻度熬夜") score -= 8;
  if (level === "中度熬夜") score -= 18;
  if (level === "重度熬夜") score -= 30;
  if (energy === "tired") score -= 5;
  if (energy === "bad") score -= 12;
  return Math.max(30, Math.min(96, Math.round(score)));
}

function updateGlobalAnalysis() {
  const debtText = `${state.debt > 0 ? "+" : ""}${state.debt}h`;
  document.querySelector("#scoreValue").textContent = state.score;
  document.querySelector("#scoreLabel").textContent = state.level;
  document.querySelector("#todayDuration").textContent = `${Math.floor(state.sleepMinutes / 60)}h${state.sleepMinutes % 60}m`;
  document.querySelector("#todayDebt").textContent = `睡眠债 ${debtText}`;
  document.querySelector("#recoveryScore").textContent = `${state.score} 分`;
  document.querySelector("#recoveryBasis").textContent = `当前前提：${state.level}，睡眠债 ${debtText}，上午能量波动，午后困倦风险高。`;

  if (state.level === "正常") {
    document.querySelector("#analysisTitle").textContent = "今天属于“保持节奏日”";
    document.querySelector("#analysisSummary").textContent = "昨晚睡眠基本达标，今天重点是保持饮食和咖啡节奏，不需要过度补觉。晚上继续固定睡前收尾即可。";
    document.querySelector("#todayRisk").textContent = "低风险";
    document.querySelector("#priorityAction").textContent = "保持节奏";
    document.querySelector("#napTitle").textContent = "可选短休息";
    document.querySelector("#napAdvice").textContent = "如果午后困，可以闭眼 10-15 分钟，不需要刻意补长觉。";
  } else {
    document.querySelector("#analysisTitle").textContent = "今天属于“熬夜后恢复日”";
    document.querySelector("#analysisSummary").textContent = "睡眠不足叠加早餐只喝咖啡，今天容易出现上午能量波动、午后困倦和重口味饮食冲动。建议先稳定能量，中午外卖降损，晚上提前收尾。";
    document.querySelector("#todayRisk").textContent = state.level === "重度熬夜" ? "安全与困倦" : "午后困倦";
    document.querySelector("#priorityAction").textContent = state.level === "重度熬夜" ? "安全 + 短休" : "补水 + 午睡";
    document.querySelector("#napTitle").textContent = "短午睡，不长补觉";
    document.querySelector("#napAdvice").textContent = state.level === "重度熬夜"
      ? "午睡 20 分钟左右，今天避免疲劳驾驶和高风险操作。"
      : "午睡 15-25 分钟，避免超过 30 分钟。今晚目标是回到稳定起床时间。";
  }
}

function updateSleep(event) {
  event.preventDefault();
  const sleepTime = document.querySelector("#sleepTime").value;
  const wakeTime = document.querySelector("#wakeTime").value;
  const total = duration(sleepTime, wakeTime);
  const level = classify(total, sleepTime);
  const energy = document.querySelector("#energy").value;
  const debt = Math.round(((total - 420) / 60) * 10) / 10;
  state.sleepMinutes = total;
  state.level = level;
  state.debt = debt;
  state.energy = energy;
  state.score = computeScore(total, level, energy);

  document.querySelector("#sleepLevel").textContent = level;
  document.querySelector("#durationText").textContent = formatDuration(total);
  document.querySelector("#debtText").textContent = `${debt > 0 ? "+" : ""}${debt} 小时`;
  document.querySelector("#sleepSuggestion").textContent = "状态已同步到饮食、补救、轻运动、睡前舒缓和周报模块。";
  updateGlobalAnalysis();
}

function updateFood(food) {
  document.querySelector("#foodTitle").textContent = foodTitles[food];
  document.querySelector("#foodAdvice").innerHTML = foodMap[food].map((item) => `<li>${item}</li>`).join("");
  foodChoices.forEach((button) => button.classList.toggle("active", button.dataset.food === food));
}

function startBreath() {
  clearInterval(breathTimer);
  breathRunning = !breathRunning;
  if (!breathRunning) {
    breathButton.textContent = "开始呼吸";
    breathCircle.className = "breath-circle";
    breathCircle.textContent = "吸气";
    return;
  }

  breathButton.textContent = "暂停呼吸";
  const phases = [
    ["吸气", "expand", 4000],
    ["停住", "hold", 2000],
    ["呼气", "shrink", 6000]
  ];
  let index = 0;
  const next = () => {
    const [text, className, delay] = phases[index % phases.length];
    breathCircle.className = `breath-circle ${className}`;
    breathCircle.textContent = text;
    index += 1;
    breathTimer = setTimeout(next, delay);
  };
  next();
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

sleepForm.addEventListener("submit", updateSleep);

foodChoices.forEach((button) => {
  button.addEventListener("click", () => updateFood(button.dataset.food));
});

refreshAnalysis.addEventListener("click", () => {
  refreshAnalysis.textContent = "分析已刷新";
  updateGlobalAnalysis();
  setTimeout(() => {
    refreshAnalysis.textContent = "重新生成分析";
  }, 1200);
});

breathButton.addEventListener("click", startBreath);

updateGlobalAnalysis();
