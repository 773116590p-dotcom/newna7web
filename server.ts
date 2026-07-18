import express from "express";
import path from "path";
import ccxt from "ccxt";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import fs from "fs";

const app = express();
app.use(express.json());
const PORT = 3000;

// Env variables (add these to .env.example)
const API_KEY = process.env.BITRUE_API_KEY || "";
const SECRET_KEY = process.env.BITRUE_SECRET_KEY || "";
let SYMBOL = "SRX/XDC";

// Bot State
let currentMode = "OFF";
let params: any = {
  amt: 100,
  amt_bait: 10,
  side: "buy",
  offset_ms: 0,
  cycle_duration: 55,
  w_t: 0.20,
  l_t: 2,
  t_bait_start: 3,
  ms_time: 0,
  bait_offset: 0.0030,
  attack_offset: 0.0003,
  p_real: 0,
  p_bait: 0,
  wait_pulse: 240,
  symbol: "SRX/XDC",
};

let dailyStats = {
  success: 0,
  failed: 0,
  total_amount: 0.0,
  latencies: [] as number[],
  last_date: new Date().toISOString().split("T")[0],
  pulse_idx: 0,
  scissor_step: 0,
};

let lastProcessedTs = 0;
let targetHitTime = 0;
let activeOrders: string[] = [];
let baitOrderId: string | null = null;
let serverTimeOffset = 0.0;
let lastAttackSec = -1;
let currentCycleWt = 0.1;

const publicExchange = new ccxt.bitrue({
  enableRateLimit: false,
});

const privateExchange = new ccxt.bitrue({
  apiKey: API_KEY,
  secret: SECRET_KEY,
  enableRateLimit: false,
});

async function syncBitrueTime() {
  try {
    const t1 = Date.now();
    const serverMs = await publicExchange.fetchTime();
    const t2 = Date.now();
    const networkDelay = (t2 - t1) / 2;
    const estimatedServerTime = serverMs - networkDelay;
    serverTimeOffset = estimatedServerTime - t1;
  } catch (e) {
    console.error("Failed to sync time", e);
  }
}

let systemLogs: { id: number, timestamp: number, message: string, type: 'info' | 'error' | 'success' }[] = [];
let logIdCounter = 0;

function addLog(message: string, type: 'info' | 'error' | 'success' = 'info') {
  systemLogs.unshift({ id: ++logIdCounter, timestamp: Date.now(), message, type });
  if (systemLogs.length > 50) systemLogs.pop();
}

async function fastRawOrder(side: string, amount: number, price: number) {
  if (!API_KEY || !SECRET_KEY) {
     addLog(`❌ خطأ في التنفيذ: مفاتيح تداول API_KEY أو SECRET_KEY غير متوفرة (تم إيقاف نظام المحاكاة بالكامل).`, 'error');
     return null;
  }
  
  const paramsRaw: any = {
    symbol: SYMBOL.replace("/", ""),
    side: side.toUpperCase(),
    type: "LIMIT",
    quantity: String(amount),
    price: String(price),
    timestamp: Date.now(),
  };

  const queryString = Object.keys(paramsRaw)
    .sort()
    .map((k) => `${k}=${paramsRaw[k]}`)
    .join("&");
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(queryString)
    .digest("hex");
  paramsRaw.signature = signature;

  try {
    const response = await fetch("https://openapi.bitrue.com/api/v1/order", {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(paramsRaw),
    });
    const data = await response.json();
    if (data.orderId) {
      addLog(`✅ تم تنفيذ أمر ${side === 'buy' ? 'الشراء' : 'البيع'} بنجاح!`, 'success');
    } else {
      addLog(`❌ خطأ في التنفيذ: ${JSON.stringify(data)}`, 'error');
    }
    return data;
  } catch (e: any) {
    addLog(`❌ خطأ في التنفيذ: ${e.message}`, 'error');
    return null;
  }
}

function getFinalAdaptiveOffset() {
  const userVal = Number(params.offset_ms || 0);
  if (userVal === 0) return 0.0;
  const lats = dailyStats.latencies.slice(-20).filter((l) => l > 10 && l < 500);
  if (lats.length === 0) return userVal;

  if (userVal === 1) return lats.reduce((a, b) => a + b, 0) / lats.length;
  if (userVal === 2) return Math.min(...lats);
  if (userVal === 3) return [...lats].sort((a, b) => a - b)[Math.floor(lats.length / 2)] + 5.0;
  if (userVal === 4) {
    const recent = dailyStats.latencies.slice(-5);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }
  if (userVal === 5) {
    const idx = dailyStats.pulse_idx % 4;
    if (idx === 0) return lats.reduce((a, b) => a + b, 0) / lats.length;
    if (idx === 1) return Math.min(...lats);
    if (idx === 2) return [...lats].sort((a, b) => a - b)[Math.floor(lats.length / 2)] + 5.0;
    const recent = dailyStats.latencies.slice(-5);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }
  return userVal;
}

function getScissorWaitTime() {
  const userWt = Number(params.w_t || 0.20);
  if (userWt !== 0) return { val: userWt, display: `Manual (${userWt}s)` };
  const stepNum = dailyStats.scissor_step % 10;
  const isUpper = dailyStats.pulse_idx % 2 === 0;
  const val = isUpper
    ? Number((0.1 - (stepNum * 0.01) / 2).toFixed(3))
    : Number((0.01 + (stepNum * 0.01) / 2).toFixed(3));
  return { val, display: `Adaptive (${val}s)` };
}

async function silentCancel(oid: string, waitSec: number) {
  await new Promise((r) => setTimeout(r, waitSec * 1000));
  try {
    if (!API_KEY || !SECRET_KEY) return;
    await privateExchange.cancelOrder(oid, SYMBOL);
    dailyStats.failed += 1;
  } catch (e) {
    try {
      if (!API_KEY || !SECRET_KEY) return;
      const order = await privateExchange.fetchOrder(oid, SYMBOL);
      if (order.status === "closed" || (order.filled && order.filled > 0)) {
        dailyStats.success += 1;
        dailyStats.total_amount += order.filled || 0;
        currentMode = "OFF";
        killAllActiveOrders();
      } else {
         dailyStats.failed += 1;
      }
    } catch (err) {}
  }
}

async function killAllActiveOrders() {
  if (baitOrderId) {
    try { if (API_KEY) await privateExchange.cancelOrder(baitOrderId, SYMBOL); } catch (e) {}
    baitOrderId = null;
  }
  for (const oid of activeOrders) {
    try { if (API_KEY) await privateExchange.cancelOrder(oid, SYMBOL); } catch (e) {}
  }
  activeOrders = [];
}

async function attackEngine(pulseId: number) {
  const startAttackTime = Date.now() + serverTimeOffset;
  const durationMs = Number(params.cycle_duration || 55) * 1000;
  const restCycle = Number(params.l_t || 2);
  let pulseMs = (targetHitTime % 1000) / 1000.0;

  dailyStats.pulse_idx += 1;
  if (dailyStats.pulse_idx % 2 !== 0) dailyStats.scissor_step += 1;
  let attackCounter = 0;

  const attackLoop = setInterval(async () => {
    if (currentMode === "OFF") return clearInterval(attackLoop);
    const nowMs = Date.now() + serverTimeOffset;
    if (nowMs - startAttackTime > durationMs) return clearInterval(attackLoop);
    if ((currentMode === "ANALYST" || currentMode === "RADAR") && lastProcessedTs !== pulseId) return clearInterval(attackLoop);

    const userMsTime = Number(params.ms_time || 0);
    if (userMsTime === 0 || userMsTime === 2) {
      pulseMs = (targetHitTime % 1000) / 1000.0;
    } else if (userMsTime === 1) {
      const msGrid = [0, 200, 400, 600, 800, 900];
      pulseMs = msGrid[attackCounter % msGrid.length] / 1000.0;
    } else {
      pulseMs = userMsTime / 1000.0;
    }

    let adaptiveOffsetMs = getFinalAdaptiveOffset();
    const userOffsetVal = Number(params.offset_ms || 0);
    if (userOffsetVal === 6) {
      const offsets = [15.0, 15.0, 15.0, 10.0, 10.0, 10.0, 10.0, 10.0, 10.0, 15.0, 15.0, 15.0];
      adaptiveOffsetMs = offsets[attackCounter % offsets.length];
    } else if (userOffsetVal === 7) {
      const offsets = [45.0, 55.0, 65.0, 75.0, 85.0];
      adaptiveOffsetMs = offsets[attackCounter % offsets.length];
    }

    const offsetSec = adaptiveOffsetMs / 1000.0;
    let targetTriggerSec = pulseMs - offsetSec;
    if (targetTriggerSec < 0) targetTriggerSec += 1;

    const currentSecond = Math.floor(nowMs / 1000);
    const msPart = (nowMs % 1000) / 1000.0;

    if (currentSecond % restCycle === 0 && msPart >= targetTriggerSec && currentSecond !== lastAttackSec) {
      lastAttackSec = currentSecond;
      try {
        const startExec = performance.now();
        const orderResp = await fastRawOrder(params.side, Number(params.amt), Number(params.p_real));
        const latencyMs = performance.now() - startExec;
        
        if (orderResp && orderResp.orderId) {
          const oid = String(orderResp.orderId);
          dailyStats.latencies.push(latencyMs);
          activeOrders.push(oid);
          console.log(`✅ Sent at: ${new Date(nowMs).toISOString()} | Latency: ${latencyMs.toFixed(2)}ms`);
          silentCancel(oid, currentCycleWt);
          attackCounter += 1;
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, 1);
}

async function masterLogic(pulseTs: number, triggerName: string, predictedMsVal: number | null) {
  const userMsTime = Number(params.ms_time || 0);
  if (userMsTime === 1) {
      targetHitTime = Math.floor(targetHitTime * 1000) / 1000;
  } else if (userMsTime === 2 && predictedMsVal !== null) {
      targetHitTime = Math.floor(targetHitTime / 1000) * 1000 + predictedMsVal;
  } else if (userMsTime > 1 && userMsTime !== 2) {
      targetHitTime = Math.floor(targetHitTime / 1000) * 1000 + userMsTime;
  }

  const { val: waitVal } = getScissorWaitTime();
  currentCycleWt = waitVal;

  const baitPreSec = Number(params.t_bait_start || 3);
  let baitSent = false;
  let syncedBefore1s = false;

  const logicLoop = setInterval(async () => {
    if (currentMode === "OFF") return clearInterval(logicLoop);
    const nowMs = Date.now() + serverTimeOffset;

    if (!baitSent && nowMs >= targetHitTime - (baitPreSec * 1000)) {
      baitSent = true;
      try {
        const rawBaitOffset = Number(params.bait_offset || 30);
        const rawAttackOffset = Number(params.attack_offset || 3);

        if (rawBaitOffset > 0 || rawAttackOffset > 0) {
          const bOffset = rawBaitOffset / 10000.0;
          const aOffset = rawAttackOffset / 10000.0;

          // Fetching order book is public - use publicExchange (على العام)
          const ob = await publicExchange.fetchOrderBook(SYMBOL, 1);
          if (params.side === "sell") {
              const marketPrice = ob.asks[0][0];
              params.p_bait = Number((marketPrice - bOffset).toFixed(4));
              params.p_real = Number((params.p_bait + aOffset).toFixed(4));
          } else {
              const marketPrice = ob.bids[0][0];
              params.p_bait = Number((marketPrice + bOffset).toFixed(4));
              params.p_real = Number((params.p_bait - aOffset).toFixed(4));
          }
        }

        const bSide = params.side === "buy" ? "sell" : "buy";
        if (API_KEY && SECRET_KEY) {
          // Placing bait order requires keys - uses privateExchange (بدء الهجوم)
          const o = await privateExchange.createOrder(SYMBOL, "limit", bSide, Number(params.amt_bait), Number(params.p_bait));
          baitOrderId = o.id;
          addLog("🔑 تم تفعيل مفاتيح التداول الخاصة لإطلاق أمر الطعم والبدء بالهجوم", "info");
        } else {
          addLog("❌ خطأ: تعذر إطلاق أمر الطعم لعدم وجود مفاتيح التداول الخاصة (تم إلغاء المحاكاة بالكامل).", "error");
        }
      } catch (e) {
         console.error("Bait error", e);
      }
    }

    if (!syncedBefore1s && nowMs >= targetHitTime - 1000) {
      syncedBefore1s = true;
      syncBitrueTime();
    }

    if (nowMs >= targetHitTime - 100) {
      clearInterval(logicLoop);
      attackEngine(pulseTs);
    }
  }, 10);
}


function calculatePredictedMs(tsNow: number, tsPrev: number, tsBeforePrev: number) {
  const msNow = Math.round(tsNow) % 1000;
  const msPrev = Math.round(tsPrev) % 1000;
  const msDelta = msNow - msPrev;
  let predictedMsInt = msNow + msDelta;
  while (predictedMsInt < 0) predictedMsInt += 1000;
  while (predictedMsInt >= 1000) predictedMsInt -= 1000;
  return predictedMsInt;
}

const PULSE_FILE_PATH = process.env.PULSE_FILE_PATH || "market_master.csv";
let lastPulseFileMtime = 0;

function startFileObserver() {
  setInterval(() => {
    if (currentMode === "OFF") return;
    if (!fs.existsSync(PULSE_FILE_PATH)) return;

    try {
      const stat = fs.statSync(PULSE_FILE_PATH);
      if (stat.mtimeMs <= lastPulseFileMtime) return;
      lastPulseFileMtime = stat.mtimeMs;

      const content = fs.readFileSync(PULSE_FILE_PATH, "utf-8");
      let tsNow = 0, tsPrev = 0, tsBeforePrev = 0;
      let isValid = false;

      let isParsed = false;
      try {
         const data = JSON.parse(content);
         if (Array.isArray(data) && data.length >= 2) {
             tsNow = data[data.length - 1];
             tsPrev = data[data.length - 2];
             if (data.length >= 3) tsBeforePrev = data[data.length - 3];
             isValid = true;
             isParsed = true;
         }
      } catch (e) {
         // Not valid JSON, fallback to CSV parsing
      }

      if (!isParsed) {
         const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('Timestamp'));
         if (lines.length >= 2) {
             tsNow = parseFloat(lines[lines.length - 1].split(',')[0]);
             tsPrev = parseFloat(lines[lines.length - 2].split(',')[0]);
             if (lines.length >= 3) tsBeforePrev = parseFloat(lines[lines.length - 3].split(',')[0]);
             isValid = true;
         }
      }

      if (isValid && tsNow > lastProcessedTs) {
         lastProcessedTs = tsNow;
         killAllActiveOrders();
         const predictedMs = tsBeforePrev > 0 ? calculatePredictedMs(tsNow, tsPrev, tsBeforePrev) : null;
         
         if (currentMode === "ANALYST") {
             targetHitTime = tsNow + (tsNow - tsPrev);
             masterLogic(tsNow, "تحليل نبضة", predictedMs);
         } else if (currentMode === "RADAR") {
             const waitTime = Number(params.wait_pulse || 240);
             targetHitTime = tsNow + (waitTime * 1000);
             masterLogic(tsNow, "رصد نبضة", predictedMs);
         }

         const targetDate = new Date(targetHitTime);
         const targetTimeStr = targetDate.toISOString().substr(11, 12);
         const baitTimeStr = new Date(targetHitTime - (Number(params.t_bait_start) * 1000)).toISOString().substr(11, 8);
         
         const offsetMap: any = {
           0: "إيقاف الخصم (0)",
           1: "متوسط السرعة (#1)",
           2: "أقل سرعة (#2)",
           3: "متوسط متقدم (#3)",
           4: "متوسط آخر 5 (#4)",
           5: "دوران الأنظمة (#5)",
           6: "تناوبي سريع (#6)",
           7: "تناوبي شامل (#7)",
         };
         const offsetSystemStr = offsetMap[params.offset_ms] || `ثابت (${params.offset_ms}ms)`;

         const msTimeStr = params.ms_time == 0 ? "تلقائي (من النبضة)" : 
                           params.ms_time == 1 ? "تدوير منظم" : 
                           params.ms_time == 2 ? "تنبؤ ديناميكي" : `ثابت (${params.ms_time}ms)`;
         
         const sideStr = params.side === "buy" ? "شراء 🟢" : "بيع 🔴";
         const logMsg = `🚀 رصد نبضة جديدة:\n\n💎 زوج العملة: ${SYMBOL}\n⚔️ نوع الهجوم: ${sideStr}\n🎯 هدف الهجوم: ${targetTimeStr}\n🎣 موعد الطعم: ${baitTimeStr}\n🧠 نظام الخصم: ${offsetSystemStr}\n⏱️ وقت المللي ثانية: ${msTimeStr}\n🔄 مدة الهجوم: ${params.cycle_duration}s\n⏳ دورة الراحة: ${params.l_t}s\n⏱️ وقت الإلغاء: ${params.w_t}s`;
         addLog(logMsg, 'info');
      }
    } catch (e) {
       // تجاهل أخطاء القراءة لتجنب توقف السيرفر
    }
  }, 10); // فحص الملف كل 10 مللي ثانية
}

let lastTradeId: number | null = null;
let lastTradesTimestamps: number[] = [];

async function startDeepLogging() {
  const MIN_VOLUME = 3000;
  console.log(`📡 بدأنا تسجيل النبضات الحقيقية فقط (>=${MIN_VOLUME}) في ${SYMBOL}..`);
  
  setInterval(async () => {
    if (currentMode === "OFF") return;
    
    try {
      // Polling real-time trades is public - use publicExchange (على العام)
      const trades = await publicExchange.fetchTrades(SYMBOL, undefined, 50);
      if (trades && trades.length > 0) {
        if (lastTradeId === null) {
          lastTradeId = 0; // للسماح بفحص النبضات السابقة عند بدء التشغيل
        }

        for (const t of trades) {
          if (!t.id || !t.amount || !t.timestamp) continue;
          
          const current_id = parseInt(t.id);
          if (current_id > lastTradeId) {
            const amount = parseFloat(t.amount.toString());
            
            if (amount >= MIN_VOLUME) {
              const tsNow = t.timestamp;
              lastTradesTimestamps.push(tsNow);
              if (lastTradesTimestamps.length > 3) lastTradesTimestamps.shift();
              
              if (tsNow > lastProcessedTs) {
                lastProcessedTs = tsNow;
                killAllActiveOrders();
                
                const tsPrev = lastTradesTimestamps.length >= 2 ? lastTradesTimestamps[lastTradesTimestamps.length - 2] : 0;
                const tsBeforePrev = lastTradesTimestamps.length >= 3 ? lastTradesTimestamps[lastTradesTimestamps.length - 3] : 0;
                
                const predictedMs = tsBeforePrev > 0 ? calculatePredictedMs(tsNow, tsPrev, tsBeforePrev) : null;
                
                let targetTime = 0;
                if (currentMode === "ANALYST") {
                    targetTime = tsNow + (tsNow - tsPrev);
                } else if (currentMode === "RADAR") {
                    const waitTime = Number(params.wait_pulse || 240);
                    targetTime = tsNow + (waitTime * 1000);
                }

                targetHitTime = targetTime;

                // التأكد من أن وقت الهدف لم يمر بعد لتفعيل الهجوم
                if (targetTime > Date.now()) {
                    if (currentMode === "ANALYST") {
                        masterLogic(tsNow, "تحليل نبضة", predictedMs);
                    } else if (currentMode === "RADAR") {
                        masterLogic(tsNow, "رصد نبضة", predictedMs);
                    }

                    const targetDate = new Date(targetHitTime);
                    const targetTimeStr = targetDate.toISOString().substr(11, 12);
                    const baitTimeStr = new Date(targetHitTime - (Number(params.t_bait_start) * 1000)).toISOString().substr(11, 8);
                    
                    const offsetMap: any = {
                      0: "إيقاف الخصم (0)",
                      1: "متوسط السرعة (#1)",
                      2: "أقل السرعة (#2)",
                      3: "متوسط متقدم (#3)",
                      4: "متوسط آخر 5 (#4)",
                      5: "دوران الأنظمة (#5)",
                      6: "تناوبي سريع (#6)",
                      7: "تناوبي شامل (#7)",
                    };
                    const offsetSystemStr = offsetMap[params.offset_ms] || `ثابت (${params.offset_ms}ms)`;

                    const msTimeStr = params.ms_time == 0 ? "تلقائي (من المنصة)" : 
                                      params.ms_time == 1 ? "تدوير منظم" : 
                                      params.ms_time == 2 ? "تنبؤ ديناميكي" : `ثابت (${params.ms_time}ms)`;
                    
                    const sideStr = params.side === "buy" ? "شراء 🟢" : "بيع 🔴";
                    const logMsg = `🚀 رصد نبضة حقيقية من المنصة (${amount}):\n\n💎 زوج العملة: ${SYMBOL}\n⚔️ نوع الهجوم: ${sideStr}\n🎯 هدف الهجوم: ${targetTimeStr}\n🎣 موعد الطعم: ${baitTimeStr}\n🧠 نظام الخصم: ${offsetSystemStr}\n⏱️ وقت المللي ثانية: ${msTimeStr}\n🔄 مدة الهجوم: ${params.cycle_duration}s\n⏳ دورة الراحة: ${params.l_t}s\n⏱️ وقت الإلغاء: ${params.w_t}s`;
                    addLog(logMsg, 'info');
                }
              }
            }
            lastTradeId = current_id;
          }
        }
      }
    } catch (e) {
      // Ignore network errors during polling
    }
  }, 1000); // Check every second as requested
}

// startFileObserver();
startDeepLogging();

// --- API Routes ---

app.get("/api/status", (req, res) => {
  const avgLatency = dailyStats.latencies.length 
    ? dailyStats.latencies.reduce((a, b) => a + b, 0) / dailyStats.latencies.length 
    : 0;

  res.json({
    mode: currentMode,
    stats: { ...dailyStats, avgLatency },
    params,
    targetHitTime,
    activeOrdersCount: activeOrders.length,
    baitOrderId,
    logs: systemLogs,
  });
});

app.post("/api/settings", (req, res) => {
  params = { ...params, ...req.body };
  if (params.symbol) {
    SYMBOL = params.symbol.trim().toUpperCase();
  }
  res.json({ success: true, params });
});

app.post("/api/mode", (req, res) => {
  const { mode } = req.body;
  if (["OFF", "ANALYST", "RADAR"].includes(mode)) {
    currentMode = mode;
    if (mode === "OFF") {
      killAllActiveOrders();
    } else {
      lastProcessedTs = 0; // Reset so it can immediately read the pulse file again
      lastPulseFileMtime = 0; // Reset mtime so it forces a read
      if (API_KEY && SECRET_KEY) {
        addLog("✅ تم تفعيل الرصد والاشتباك الحقيقي بنجاح (مفاتيح التداول نشطة)", "success");
      } else {
        addLog("⚠️ تحذير: لا توجد مفاتيح تداول (API_KEY / SECRET_KEY) نشطة. تم إلغاء نظام المحاكاة بالكامل؛ لن تنجح الصفقات الحقيقية بدونها.", "error");
      }
    }
    res.json({ success: true, mode });
  } else {
    res.status(400).json({ error: "Invalid mode" });
  }
});

app.post("/api/reset", (req, res) => {
  const { target } = req.body;
  if (target === "pulse") dailyStats.pulse_idx = 0;
  if (target === "scissor") dailyStats.scissor_step = 0;
  if (target === "all") {
    dailyStats.pulse_idx = 0;
    dailyStats.scissor_step = 0;
  }
  res.json({ success: true });
});

app.post("/api/trigger", (req, res) => {
  // Simulate a pulse hit
  if (currentMode !== "OFF") {
    const tsNow = Date.now();
    lastProcessedTs = tsNow;
    killAllActiveOrders();
    if (currentMode === "ANALYST") {
       targetHitTime = tsNow + 5000; // 5 seconds from now
       masterLogic(tsNow, "تحليل نبضة", 0);
    } else if (currentMode === "RADAR") {
       const waitTime = Number(params.wait_pulse || 240);
       targetHitTime = tsNow + (waitTime * 1000);
       masterLogic(tsNow, "رصد نبضة", 0);
    }
    res.json({ success: true, message: "Pulse triggered" });
  } else {
    res.status(400).json({ error: "Bot is OFF" });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
