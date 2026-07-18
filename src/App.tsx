import React, { useEffect, useState } from "react";
import { Brain, Radar, Play, StopCircle, Settings, Activity, ArrowRight } from "lucide-react";
import { BotMode, BotParams, BotStatus } from "./types";

export default function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [params, setParams] = useState<BotParams | null>(null);
  const [currentProfile, setCurrentProfile] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  const loadProfile = (profileId: string) => {
    setCurrentProfile(profileId);
    
    // Load from localStorage or use defaults
    const loadedParams: any = {};
    const fields = [
      'side', 'p_real', 'amt', 'p_bait', 'amt_bait', 
      't_bait_start', 'cycle_duration', 'wait_pulse', 
      'offset_ms', 'w_t', 'l_t', 'ms_time', 
      'bait_offset', 'attack_offset', 'symbol'
    ];
    
    fields.forEach(f => {
      const val = localStorage.getItem(`${profileId}_${f}`);
      if (val !== null) {
        if (f === 'side' || f === 'symbol') loadedParams[f] = val;
        else loadedParams[f] = Number(val);
      }
    });

    // Provide sensible defaults if not in localStorage
    if (Object.keys(loadedParams).length === 0) {
       loadedParams.side = "buy";
       loadedParams.p_real = 2.118;
       loadedParams.amt = 4900;
       loadedParams.p_bait = 2.1175;
       loadedParams.amt_bait = 1;
       loadedParams.t_bait_start = 3;
       loadedParams.cycle_duration = 55;
       loadedParams.wait_pulse = 240;
       loadedParams.offset_ms = 100;
       loadedParams.w_t = 0.2;
       loadedParams.l_t = 1.05;
       loadedParams.ms_time = 0;
       loadedParams.bait_offset = 30;
       loadedParams.attack_offset = 3;
       loadedParams.symbol = "SRX/XDC";
    }

    if (!loadedParams.symbol) {
       loadedParams.symbol = "SRX/XDC";
    }

    setParams(loadedParams as BotParams);
  };

  const setMode = async (mode: BotMode) => {
    await fetch("/api/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    fetchStatus();
  };

  const updateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!params || !currentProfile) return;

    // Save to localStorage
    Object.keys(params).forEach(k => {
      localStorage.setItem(`${currentProfile}_${k}`, String((params as any)[k]));
    });

    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    fetchStatus();
    alert("✅ تم حفظ الإعدادات بنجاح");
  };

  const triggerPulse = async () => {
    await fetch("/api/trigger", { method: "POST" });
    fetchStatus();
  };

  const resetCounter = async (target: string) => {
    await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    fetchStatus();
  };

  if (!status) return <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center text-white">جاري التحميل...</div>;

  if (!currentProfile) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] text-white p-4 md:p-8 font-sans flex flex-col items-center justify-center" dir="rtl">
        <h3 className="text-2xl text-[#4ecca3] font-bold mb-8">اختر لوحة التحكم</h3>
        <div className="flex flex-col gap-6 w-full max-w-sm">
          <button 
            onClick={() => loadProfile("1")} 
            className="h-24 text-4xl bg-[#0f3460] text-[#4ecca3] border-2 border-[#4ecca3] rounded-2xl hover:bg-[#16213e] transition-colors"
          >
            1
          </button>
          <button 
            onClick={() => loadProfile("2")} 
            className="h-24 text-4xl bg-[#0f3460] text-[#4ecca3] border-2 border-[#4ecca3] rounded-2xl hover:bg-[#16213e] transition-colors"
          >
            2
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-slate-200 p-4 md:p-8 font-sans" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row items-center justify-between bg-[#16213e] p-6 rounded-2xl border border-[#0f3460] shadow-xl">
          <div className="flex items-center gap-4">
            <button onClick={() => setCurrentProfile(null)} className="bg-slate-800 p-2 rounded-lg hover:bg-slate-700 transition-colors">
              <ArrowRight size={20} className="text-slate-300" />
            </button>
            <div className="w-12 h-12 bg-blue-600/20 text-[#4ecca3] rounded-full flex items-center justify-center border border-[#4ecca3]/30">
              <Activity size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">نظام القنص (بروفايل {currentProfile})</h1>
              <p className="text-sm text-slate-400 font-mono">{status?.params?.symbol || "SRX/XDC"}</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 mt-4 md:mt-0">
            <button 
              onClick={() => setMode("ANALYST")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${status.mode === "ANALYST" ? "bg-blue-600 text-white shadow-lg shadow-blue-900/50" : "bg-[#0f3460] text-slate-300 hover:bg-blue-900/40"}`}
            >
              <Brain size={18} />
              بواسطة المحلل
            </button>
            <button 
              onClick={() => setMode("RADAR")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${status.mode === "RADAR" ? "bg-purple-600 text-white shadow-lg shadow-purple-900/50" : "bg-[#0f3460] text-slate-300 hover:bg-purple-900/40"}`}
            >
              <Radar size={18} />
              بواسطة الرادار
            </button>
            <button 
              onClick={() => setMode("OFF")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${status.mode === "OFF" ? "bg-red-600 text-white shadow-lg shadow-red-900/50" : "bg-[#0f3460] text-red-400 hover:bg-red-900/40"}`}
            >
              <StopCircle size={18} />
              إيقاف كلي
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Stats Column */}
          <div className="space-y-6">
            <div className="bg-[#16213e] p-6 rounded-2xl border border-[#0f3460] shadow-xl">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Activity size={18} className="text-[#4ecca3]"/>
                إحصائيات اليوم
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#1a1a2e] p-4 rounded-xl border border-slate-800/50">
                  <p className="text-xs text-slate-400 mb-1">نجاح</p>
                  <p className="text-2xl font-mono text-[#4ecca3]">{status.stats.success}</p>
                </div>
                <div className="bg-[#1a1a2e] p-4 rounded-xl border border-slate-800/50">
                  <p className="text-xs text-slate-400 mb-1">فشل</p>
                  <p className="text-2xl font-mono text-red-400">{status.stats.failed}</p>
                </div>
                <div className="bg-[#1a1a2e] p-4 rounded-xl border border-slate-800/50 col-span-2 flex justify-between items-center">
                  <div>
                    <p className="text-xs text-slate-400 mb-1">متوسط السرعة</p>
                    <p className="text-xl font-mono text-blue-400">{status.stats.avgLatency.toFixed(2)} <span className="text-sm">ms</span></p>
                  </div>
                  <div className="text-left">
                    <p className="text-xs text-slate-400 mb-1">الكمية</p>
                    <p className="text-xl font-mono text-amber-400">{status.stats.total_amount}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[#0f3460] flex justify-between items-center text-sm">
                 <span className="text-slate-400">حالة البوت:</span>
                 <span className={`px-2 py-1 rounded font-mono text-xs ${status.mode === "OFF" ? "bg-red-900/30 text-red-400" : "bg-emerald-900/30 text-emerald-400"}`}>
                   {status.mode}
                 </span>
              </div>
            </div>

            <div className="bg-[#16213e] p-6 rounded-2xl border border-[#0f3460] shadow-xl">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Settings size={18} className="text-slate-400"/>
                العدادات والأنظمة
              </h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-[#1a1a2e] p-3 rounded-xl border border-slate-800/50">
                  <div>
                    <p className="text-sm text-slate-300">عداد الدوران</p>
                    <p className="text-xs text-slate-500 font-mono">Pulse: {status.stats.pulse_idx}</p>
                  </div>
                  <button onClick={() => resetCounter("pulse")} className="text-xs bg-[#0f3460] hover:bg-blue-900/60 px-3 py-1.5 rounded-lg transition-colors text-slate-300">تصفير R1</button>
                </div>
                <div className="flex items-center justify-between bg-[#1a1a2e] p-3 rounded-xl border border-slate-800/50">
                  <div>
                    <p className="text-sm text-slate-300">عداد المقص</p>
                    <p className="text-xs text-slate-500 font-mono">Scissor: {status.stats.scissor_step}</p>
                  </div>
                  <button onClick={() => resetCounter("scissor")} className="text-xs bg-[#0f3460] hover:bg-blue-900/60 px-3 py-1.5 rounded-lg transition-colors text-slate-300">تصفير R2</button>
                </div>
                <button onClick={() => resetCounter("all")} className="w-full text-sm bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-900/30 py-2 rounded-xl transition-colors">
                  تصفير الجميع RR
                </button>
                
                {status.mode !== "OFF" && (
                  <button onClick={triggerPulse} className="w-full mt-2 text-sm bg-purple-900/20 text-purple-400 hover:bg-purple-900/40 border border-purple-900/30 py-2 rounded-xl transition-colors flex justify-center items-center gap-2">
                    <Play size={14} /> إرسال نبضة اختبارية (رصد حقيقي)
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Settings Column */}
          {params && (
            <div className="lg:col-span-2 bg-[#16213e] p-6 rounded-2xl border border-[#0f3460] shadow-xl">
              <h2 className="text-xl font-bold text-[#4ecca3] mb-6 flex items-center gap-2 pb-3 border-b border-[#0f3460]">
                ⚔️ لوحة تحكم القنص
              </h2>
              
              <form onSubmit={updateSettings} className="space-y-6">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">زوج العملة المستهدف (Symbol):</label>
                    <input 
                      type="text" placeholder="SRX/XDC"
                      value={params.symbol || ""} 
                      onChange={e => setParams({...params, symbol: e.target.value})}
                      className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-3 text-sm text-white focus:border-[#4ecca3] outline-none font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">نوع الهجوم الأساسي:</label>
                    <select 
                      value={params.side} 
                      onChange={e => setParams({...params, side: e.target.value as "buy" | "sell"})}
                      className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-3 text-sm text-white focus:border-[#4ecca3] outline-none"
                    >
                      <option value="buy">شراء (BUY 🟢) -{">"} الطعم بيع</option>
                      <option value="sell">بيع (SELL 🔴) -{">"} الطعم شراء</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="text-[#fca311] font-bold text-sm border-b border-dashed border-[#333] pb-1">🎯 الهجوم الكبير (الهدف)</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">سعر الدخول:</label>
                      <input 
                        type="number" step="any" placeholder="2.118"
                        value={params.p_real} 
                        onChange={e => setParams({...params, p_real: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">الكمية:</label>
                      <input 
                        type="number" step="any" placeholder="4900"
                        value={params.amt} 
                        onChange={e => setParams({...params, amt: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">فارق الطعم التلقائي (نقاط):</label>
                      <input 
                        type="number" step="any" placeholder="30"
                        value={params.bait_offset} 
                        onChange={e => setParams({...params, bait_offset: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">فارق الهجوم التلقائي (نقاط):</label>
                      <input 
                        type="number" step="any" placeholder="3"
                        value={params.attack_offset} 
                        onChange={e => setParams({...params, attack_offset: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="text-[#fca311] font-bold text-sm border-b border-dashed border-[#333] pb-1">🎣 الطعم المعاكس (Bait)</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">سعر الطعم الاحتياطي:</label>
                      <input 
                        type="number" step="any" placeholder="2.1175"
                        value={params.p_bait} 
                        onChange={e => setParams({...params, p_bait: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">کمية الطعم:</label>
                      <input 
                        type="number" step="any" placeholder="1"
                        value={params.amt_bait} 
                        onChange={e => setParams({...params, amt_bait: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">الطعم قبل الهجوم بـ (ث):</label>
                      <input 
                        type="number" step="any"
                        value={params.t_bait_start} 
                        onChange={e => setParams({...params, t_bait_start: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">مدة الهجوم (ث):</label>
                      <input 
                        type="number" step="any"
                        value={params.cycle_duration} 
                        onChange={e => setParams({...params, cycle_duration: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="text-[#fca311] font-bold text-sm border-b border-dashed border-[#333] pb-1">⏱️ توقيت النبضة</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">وقت الانتظار (Wait Pulse):</label>
                      <input 
                        type="number" step="any" placeholder="240"
                        value={params.wait_pulse} 
                        onChange={e => setParams({...params, wait_pulse: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">خصم الملي ثانية:</label>
                      <input 
                        type="number" step="any"
                        value={params.offset_ms} 
                        onChange={e => setParams({...params, offset_ms: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">وقت المللي ثانيه:</label>
                    <input 
                      type="number" step="any" placeholder="0 = تلقائي، 1 = تدوير، أو قيمة ثابتة"
                      value={params.ms_time} 
                      onChange={e => setParams({...params, ms_time: Number(e.target.value)})}
                      className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">وقت الإغلاق (إلغاء):</label>
                      <input 
                        type="number" step="any"
                        value={params.w_t} 
                        onChange={e => setParams({...params, w_t: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">وقت التكرار (الراحة):</label>
                      <input 
                        type="number" step="any"
                        value={params.l_t} 
                        onChange={e => setParams({...params, l_t: Number(e.target.value)})}
                        className="w-full bg-[#1a1a2e] border border-[#1b262c] rounded-xl px-4 py-2 text-sm text-white focus:border-[#4ecca3] outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 mt-2">
                  <button type="submit" className="w-full bg-[#4ecca3] hover:bg-[#45b791] text-[#1a1a2e] px-8 py-3 rounded-xl font-bold text-lg transition-transform hover:scale-[0.98] shadow-lg">
                    💾 حفظ الإعدادات
                  </button>
                </div>
              </form>
            </div>
          )}

        </div>

        {/* Logs Section */}
        <div className="bg-[#16213e] p-6 rounded-2xl border border-[#0f3460] shadow-xl mt-6">
          <h2 className="text-xl font-bold text-[#4ecca3] mb-4 flex items-center gap-2 pb-3 border-b border-[#0f3460]">
            <Activity size={20} />
            سجل العمليات
          </h2>
          <div className="bg-[#1a1a2e] rounded-xl border border-slate-800/50 p-4 h-64 overflow-y-auto font-mono text-sm space-y-3">
            {status.logs && status.logs.length > 0 ? (
              status.logs.map((log) => (
                <div key={log.id} className={`p-3 rounded-lg border flex gap-3 ${
                  log.type === 'error' ? 'bg-red-900/20 border-red-900/50 text-red-400' :
                  log.type === 'success' ? 'bg-emerald-900/20 border-emerald-900/50 text-[#4ecca3]' :
                  'bg-blue-900/10 border-blue-900/30 text-blue-300'
                }`}>
                  <span className="text-xs opacity-50 pt-0.5 whitespace-nowrap">
                    {new Date(log.timestamp).toISOString().substr(11, 8)}
                  </span>
                  <div className="whitespace-pre-wrap leading-relaxed font-sans">{log.message}</div>
                </div>
              ))
            ) : (
              <div className="text-slate-500 text-center py-8 font-sans">لا توجد عمليات مسجلة حتى الآن</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

