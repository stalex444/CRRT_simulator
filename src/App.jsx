import React, { useState, useEffect } from 'react';

// ============================================
// CRRT PRACTICE SIMULATOR - COMPLETE UNIFIED EDITION
// All features: Scenarios, FF Analysis, Drug Dosing, Quiz, Filter Change
// ============================================

// Physiology Engine
const Phys = {
  plasmaFlow: (bfr, hct) => bfr * (1 - hct / 100),
  plasmaFlowAtFilter: (bfr, hct, pfr) => bfr * (1 - hct / 100) + pfr / 60,
  hctAtFilter: (bfr, hct, pfr) => (bfr * (hct / 100)) / (bfr + pfr / 60) * 100,
  filtrationFraction: (bfr, hct, pfr, eff) => {
    const pf = bfr * (1 - hct / 100) + pfr / 60;
    return pf > 0 ? ((eff / 60) / pf) * 100 : 0;
  },
  postFilterHct: (bfr, hct, pfr, eff) => {
    const rbc = bfr * (hct / 100);
    const post = bfr + pfr / 60 - eff / 60;
    return post > 0 ? Math.min(70, (rbc / post) * 100) : 70;
  },
  
  // TMP - More responsive to all parameters
  calcTMP: (bfr, hct, ff, effluent, filterAge, clot) => {
    // Base TMP around 100
    let tmp = 80;
    // BFR effect: higher flow = higher TMP (significant effect)
    tmp += (bfr - 150) * 0.3;
    // Effluent effect: more removal = higher TMP
    tmp += (effluent - 1500) * 0.02;
    // Hematocrit effect: thicker blood = higher TMP
    tmp += Math.max(0, hct - 30) * 3;
    // FF effect: high FF = much higher TMP (exponential)
    if (ff > 20) tmp += Math.pow(ff - 20, 1.5) * 2;
    // Filter age effect
    tmp += filterAge * 5;
    // Clotting effect
    tmp += clot * 150;
    return Math.max(50, Math.min(450, tmp));
  },
  
  // Access pressure - more responsive to BFR
  calcAccess: (bfr) => {
    // More negative with higher BFR
    return Math.max(-350, Math.min(-20, -30 - bfr * 0.25));
  },
  
  // Return pressure - responds to BFR and clotting
  calcReturn: (bfr, clot) => {
    return Math.min(400, 20 + bfr * 0.2 + clot * 150);
  },
  
  // Delta P - responds to BFR, clotting, and hematocrit
  calcDeltaP: (bfr, clot, hct) => {
    let dp = 20;
    dp += (bfr - 150) * 0.15;
    dp += clot * 200;
    dp += Math.max(0, hct - 30) * 2;
    return Math.max(10, Math.min(300, dp));
  },
  
  filterEff: (age, c, ff) => Math.max(0.3, Math.exp(-age / 72) * (1 - c * 0.5) * (ff > 25 ? 1 - (ff - 25) * 0.01 : 1)),
};

const getFFStatus = (ff) => {
  if (ff < 20) return { col: '#00ff88', st: 'OPTIMAL', msg: 'Low clotting risk', life: '48-72h' };
  if (ff < 25) return { col: '#88ff00', st: 'GOOD', msg: 'Acceptable', life: '24-48h' };
  if (ff < 30) return { col: '#ffcc00', st: 'HIGH', msg: 'Add PFR', life: '12-24h' };
  if (ff < 35) return { col: '#ff8800', st: 'VERY HIGH', msg: 'Add PFR now!', life: '6-12h' };
  return { col: '#ff4444', st: 'CRITICAL', msg: 'Filter will clot!', life: '<6h' };
};

// Scenarios
const scenarios = {
  hyperkalemia: { name: "Critical Hyperkalemia", cat: "Electrolyte", desc: "62M crush injury, K+ 7.8, peaked T-waves", pt: { wt: 80, k: 7.8, na: 138, bun: 120, cr: 8.5, ca: 1.05, hct: 32, lf: 0.9 }, tips: ["Max dialysate for K+ removal", "Use K+ 0-2 dialysate", "Watch for rebound"] },
  cardiorenal: { name: "Cardiorenal Syndrome", cat: "Volume", desc: "78F CHF, +18kg fluid, MAP 58", pt: { wt: 88, k: 5.4, na: 126, bun: 95, cr: 4.8, ca: 1.1, hct: 28, lf: 0.6 }, tips: ["Start slow UF 50-100 mL/h", "Lower BFR reduces cardiac demand", "Watch for ODS"] },
  citrate: { name: "Citrate Toxicity", cat: "Anticoag", desc: "55M liver failure, Total:iCa = 3.5", pt: { wt: 90, k: 4.2, na: 144, bun: 65, cr: 3.8, ca: 0.82, hct: 30, lf: 0.15 }, tips: ["Ratio >2.5 = citrate accumulation", "Reduce citrate or switch anticoag", "Metabolic alkalosis is a clue"] },
  highFF: { name: "High Filtration Fraction", cat: "Filter", desc: "High Hct causing rapid clotting - learn FF", pt: { wt: 70, k: 5.2, na: 140, bun: 80, cr: 5.0, ca: 1.15, hct: 44, lf: 0.9 }, tips: ["High Hct = less plasma = high FF", "Add PFR to dilute blood", "Target FF <25%"] },
  rhabdo: { name: "Rhabdomyolysis", cat: "Toxin", desc: "28M found down, CK 185,000", pt: { wt: 85, k: 6.9, na: 132, bun: 65, cr: 6.8, ca: 0.95, hct: 42, lf: 0.85 }, tips: ["High replacement for myoglobin clearance", "AVOID early calcium", "Watch rebound hypercalcemia"] },
  tls: { name: "Tumor Lysis Syndrome", cat: "Oncology", desc: "19F Burkitt post-chemo, K+ 7.2, Phos 12.5", pt: { wt: 62, k: 7.2, na: 136, bun: 75, cr: 5.2, ca: 0.85, hct: 26, lf: 0.9 }, tips: ["Very high dialysate needed", "TLS = K↑ Phos↑ UA↑ Ca↓", "May need prolonged CRRT"] },
  sepsis: { name: "Septic AKI", cat: "Critical Care", desc: "58M necrotizing pancreatitis, 3 pressors", pt: { wt: 95, k: 5.1, na: 141, bun: 85, cr: 5.4, ca: 1.1, hct: 29, lf: 0.5 }, tips: ["Standard dose 20-25 mL/kg/h", "High-volume HF NOT proven", "Expect hemodynamic instability"] },
  filter: { name: "Filter Clotting", cat: "Circuit", desc: "42h filter, TMP 120→340 over 6h", pt: { wt: 75, k: 5.8, na: 140, bun: 110, cr: 6.2, ca: 1.1, hct: 38, lf: 0.8 }, tips: ["Rising TMP = membrane fouling", "Rising ΔP = fiber clotting", "Add PFR to extend life"] }
};

// Quiz
const quiz = [
  { q: "Target filtration fraction to minimize clotting?", o: ["<15%", "<25%", "<35%", "<50%"], a: 1, x: "FF <25% is optimal. Higher causes hemoconcentration." },
  { q: "How does PFR affect filtration fraction?", o: ["Increases", "Decreases", "No effect", "Variable"], a: 1, x: "PFR dilutes blood before filter, increasing plasma flow and lowering FF." },
  { q: "For K+ 7.5, which parameter is most important?", o: ["BFR", "Dialysate flow", "Replacement", "Net UF"], a: 1, x: "K+ is small - cleared by DIFFUSION. Higher dialysate = more clearance." },
  { q: "Total:iCa ratio 3.5 indicates?", o: ["Normal", "Citrate accumulation", "Hypercalcemia", "Lab error"], a: 1, x: "Ratio >2.5 = citrate accumulation. Citrate chelates ionized Ca." },
  { q: "TMP rising but ΔP stable - what's happening?", o: ["Fiber clotting", "Membrane fouling", "Catheter issue", "Air"], a: 1, x: "Rising TMP + stable ΔP = membrane surface fouling, not fiber clotting." },
  { q: "In rhabdomyolysis with low Ca, give IV calcium?", o: ["Always", "Never", "Only if symptomatic", "Only if K normal"], a: 2, x: "Early Ca deposits in muscle. Treat only if symptomatic (tetany, seizures)." }
];

// Filter change steps
const fcSteps = [
  { t: "Preparation", a: ["Gather new kit", "Document settings", "Pre-prime if possible"], c: "Never rush" },
  { t: "Stop Therapy", a: ["Press STOP", "Clamp arterial FIRST", "Clamp venous"], c: "ARTERIAL FIRST prevents air" },
  { t: "Return Blood", a: ["Connect saline", "Run pump 100 mL/min", "Push blood back"], c: "Skip if clotted!" },
  { t: "Disconnect", a: ["Clamp catheter", "Disconnect lines", "Cap lumens"], c: "Never leave lumens open" },
  { t: "Connect New", a: ["Check no air", "Connect arterial then venous"], c: "Check all connections" },
  { t: "Start", a: ["Enter Rx", "Start at 100", "Increase gradually"], c: "Start SLOW" }
];

// Components
const Gauge = ({ label, value, min, max, inverted = false }) => {
  // Real PrisMax style vertical bar gauge with red/yellow/green zones
  const range = max - min;
  const pct = Math.max(0, Math.min(100, ((value - min) / range) * 100));
  
  // For Access (negative), low values are good. For others, middle is good.
  // Access: -350 to 0, good is around -50 to -150
  // Return: 0 to 400, good is around 50-200
  // TMP: 0 to 500, good is around 50-250
  // ΔP: 0 to 500, good is around 0-100
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px', background: '#000814', borderRadius: '4px', border: '1px solid #0066aa', minWidth: '58px' }}>
      <span style={{ fontSize: '10px', color: '#44aaff', fontWeight: '600', marginBottom: '4px' }}>{label}</span>
      <div style={{ position: 'relative', width: '28px', height: '80px', background: '#001020', borderRadius: '3px', border: '1px solid #004488' }}>
        {/* Color zones - red at top, yellow middle, green at bottom (or inverted for Access) */}
        {inverted ? (
          <>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '26px', background: 'linear-gradient(to bottom, #00aa00, #88cc00)', borderRadius: '2px 2px 0 0' }}/>
            <div style={{ position: 'absolute', top: '26px', left: 0, right: 0, height: '28px', background: 'linear-gradient(to bottom, #aaaa00, #cccc00)' }}/>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '26px', background: 'linear-gradient(to bottom, #cc4400, #aa0000)', borderRadius: '0 0 2px 2px' }}/>
          </>
        ) : (
          <>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '26px', background: 'linear-gradient(to bottom, #aa0000, #cc4400)', borderRadius: '2px 2px 0 0' }}/>
            <div style={{ position: 'absolute', top: '26px', left: 0, right: 0, height: '28px', background: 'linear-gradient(to bottom, #cccc00, #aaaa00)' }}/>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '26px', background: 'linear-gradient(to bottom, #88cc00, #00aa00)', borderRadius: '0 0 2px 2px' }}/>
          </>
        )}
        {/* Triangle markers showing current position */}
        <div style={{ 
          position: 'absolute', 
          left: '-8px', 
          top: `${inverted ? pct : (100 - pct)}%`, 
          transform: 'translateY(-50%)',
          width: 0, height: 0,
          borderTop: '6px solid transparent',
          borderBottom: '6px solid transparent',
          borderLeft: '8px solid white'
        }}/>
        <div style={{ 
          position: 'absolute', 
          right: '-8px', 
          top: `${inverted ? pct : (100 - pct)}%`, 
          transform: 'translateY(-50%)',
          width: 0, height: 0,
          borderTop: '6px solid transparent',
          borderBottom: '6px solid transparent',
          borderRight: '8px solid white'
        }}/>
      </div>
      {/* Scale labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '7px', color: '#4488aa', marginTop: '2px' }}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {/* Current value */}
      <div style={{ fontSize: '14px', color: '#ffffff', fontWeight: '700', fontFamily: 'monospace', marginTop: '2px' }}>{Math.round(value)}</div>
      <div style={{ fontSize: '8px', color: '#88aacc' }}>mmHg</div>
    </div>
  );
};

const FFPanel = ({ bfr, hct, eff }) => {
  const ff = Phys.filtrationFraction(bfr, hct, 0, eff);
  const s = getFFStatus(ff);
  const pf = Phys.plasmaFlow(bfr, hct);
  return (
    <div style={{ background: '#0a1525', border: `2px solid ${s.col}55`, borderRadius: '6px', padding: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#99ccff' }}>🔬 Filtration Fraction</span>
        <span style={{ fontSize: '9px', padding: '2px 8px', background: `${s.col}33`, border: `1px solid ${s.col}`, borderRadius: '10px', color: s.col, fontWeight: '700' }}>{s.st}</span>
      </div>
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <div style={{ position: 'relative', width: '70px', height: '70px', margin: '0 auto' }}>
          <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#1a2a3a" strokeWidth="8"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke={s.col} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${Math.min(ff, 50) * 5} 251`} strokeDashoffset="63" style={{ transition: 'all 0.5s' }}/>
          </svg>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <div style={{ fontSize: '18px', fontWeight: '700', color: s.col, fontFamily: 'monospace' }}>{ff.toFixed(1)}%</div>
          </div>
        </div>
        <div style={{ fontSize: '8px', color: s.col, fontWeight: '600' }}>{s.msg}</div>
      </div>
      <div style={{ fontSize: '8px', background: '#0a1218', borderRadius: '4px', padding: '5px', border: '1px solid #2a3a4a' }}>
        <div style={{ color: '#aabbcc', marginBottom: '3px', fontWeight: '600' }}>Equation:</div>
        <div style={{ color: '#88ddff', fontFamily: 'monospace', fontSize: '7px', lineHeight: '1.4' }}>
          FF = (UF Rate ÷ 60) ÷ Plasma Flow × 100<br/>
          FF = ({eff} ÷ 60) ÷ {pf.toFixed(1)} × 100<br/>
          <span style={{ color: s.col, fontWeight: '700' }}>FF = {ff.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
};

const CalculationsPanel = ({ set, pt, ff }) => {
  const eff = set.dialysate + set.replacement + set.netUF;
  const plasmaFlow = set.bfr * (1 - pt.hct / 100);
  
  // Effluent dose in mL/kg/hr
  const effDose = pt.wt > 0 ? eff / pt.wt : 0;
  
  // Clearance approximation (for small solutes like urea)
  // In CVVHDF: Clearance ≈ Dialysate flow + Ultrafiltration (convection)
  const clearance = (set.dialysate + set.replacement + set.netUF) / 60; // mL/min
  
  // Post-filter hematocrit
  // RBC volume stays constant, but plasma is removed
  const rbcFlow = set.bfr * (pt.hct / 100);
  const postFilterFlow = set.bfr - (eff / 60);
  const postFilterHct = postFilterFlow > 0 ? Math.min(70, (rbcFlow / postFilterFlow) * 100) : 70;
  
  return (
    <div style={{ background: '#0f1520', border: '1px solid #3a5a7a', borderRadius: '6px', padding: '8px' }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: '#ffcc66', marginBottom: '8px' }}>📊 Calculations</div>
      
      {/* Effluent Dose */}
      <div style={{ background: '#0a1218', borderRadius: '4px', padding: '6px', marginBottom: '6px', border: '1px solid #2a4a5a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
          <span style={{ fontSize: '9px', color: '#99aabb' }}>Effluent Dose:</span>
          <span style={{ fontSize: '14px', color: effDose >= 20 && effDose <= 25 ? '#00ff88' : effDose < 20 ? '#ffcc00' : '#ff8844', fontWeight: '700', fontFamily: 'monospace' }}>{effDose.toFixed(1)} <span style={{ fontSize: '9px' }}>mL/kg/hr</span></span>
        </div>
        <div style={{ fontSize: '7px', color: '#6688aa', fontFamily: 'monospace' }}>
          = ({set.dialysate} + {set.replacement} + {set.netUF}) ÷ {pt.wt} kg
        </div>
        <div style={{ fontSize: '7px', color: '#88aacc', marginTop: '2px' }}>Target: 20-25 mL/kg/hr (KDIGO)</div>
      </div>
      
      {/* Clearance */}
      <div style={{ background: '#0a1218', borderRadius: '4px', padding: '6px', marginBottom: '6px', border: '1px solid #2a4a5a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
          <span style={{ fontSize: '9px', color: '#99aabb' }}>Clearance (Urea):</span>
          <span style={{ fontSize: '14px', color: '#88ddff', fontWeight: '700', fontFamily: 'monospace' }}>{clearance.toFixed(1)} <span style={{ fontSize: '9px' }}>mL/min</span></span>
        </div>
        <div style={{ fontSize: '7px', color: '#6688aa', fontFamily: 'monospace' }}>
          = (Dial + Post + UF) ÷ 60<br/>
          = ({set.dialysate} + {set.replacement} + {set.netUF}) ÷ 60
        </div>
      </div>
      
      {/* Post-filter Hematocrit */}
      <div style={{ background: '#0a1218', borderRadius: '4px', padding: '6px', border: '1px solid #2a4a5a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
          <span style={{ fontSize: '9px', color: '#99aabb' }}>Post-Filter Hct:</span>
          <span style={{ fontSize: '14px', color: postFilterHct > 50 ? '#ff4444' : postFilterHct > 45 ? '#ffcc00' : '#88ff88', fontWeight: '700', fontFamily: 'monospace' }}>{postFilterHct.toFixed(1)}%</span>
        </div>
        <div style={{ fontSize: '7px', color: '#6688aa', fontFamily: 'monospace' }}>
          = (BFR × Hct) ÷ (BFR - UF/60)<br/>
          = ({set.bfr} × {pt.hct}%) ÷ ({set.bfr} - {(eff/60).toFixed(1)})<br/>
          = {rbcFlow.toFixed(1)} ÷ {postFilterFlow.toFixed(1)}
        </div>
        <div style={{ fontSize: '7px', color: postFilterHct > 50 ? '#ff8888' : '#88aacc', marginTop: '2px' }}>
          {postFilterHct > 50 ? '⚠️ High! Risk of clotting' : postFilterHct > 45 ? '⚠️ Elevated' : '✓ Normal range'}
        </div>
      </div>
    </div>
  );
};

const Circuit = ({ set, pr, fs, run, ff, pt }) => {
  const ffs = getFFStatus(ff);
  const sp = set.bfr / 250;
  return (
    <svg viewBox="0 0 520 180" style={{ width: '100%', height: '100%', background: 'linear-gradient(180deg, #001428 0%, #001a30 100%)', borderRadius: '6px' }}>
      <defs>
        <linearGradient id="bgPre" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#0066cc"/><stop offset="100%" stopColor="#003366"/></linearGradient>
        <linearGradient id="bgDia" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#00cc44"/><stop offset="100%" stopColor="#006622"/></linearGradient>
        <linearGradient id="bgRep" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#cc4488"/><stop offset="100%" stopColor="#662244"/></linearGradient>
        <linearGradient id="bgUF" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#ccaa00"/><stop offset="100%" stopColor="#554400"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="1.5" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      
      {/* Patient icon */}
      <ellipse cx="30" cy="55" rx="18" ry="22" fill="#2a4a6a" stroke="#4a8aff" strokeWidth="2"/>
      <ellipse cx="30" cy="105" rx="22" ry="28" fill="#2a4a6a" stroke="#4a8aff" strokeWidth="2"/>
      <text x="30" y="110" textAnchor="middle" fill="#88ccff" fontSize="9" fontWeight="600">PATIENT</text>

      {/* Access line - dark red */}
      <path d="M 55 80 L 85 80 L 85 65 L 105 65" fill="none" stroke="#990000" strokeWidth="7" strokeLinecap="round"/>
      
      {/* Blood pump */}
      <g transform="translate(105, 42)">
        <circle cx="22" cy="22" r="22" fill="#cc0000" stroke="#ff4444" strokeWidth="2" filter="url(#glow)"/>
        <circle cx="22" cy="22" r="15" fill="none" stroke="#220000" strokeWidth="3"/>
        <g style={{ transformOrigin: '22px 22px', animation: run ? `spin ${2.5/sp}s linear infinite` : 'none' }}>
          <rect x="17" y="2" width="10" height="14" rx="2" fill="#440000"/>
          <rect x="17" y="28" width="10" height="14" rx="2" fill="#440000"/>
        </g>
      </g>
      <text x="127" y="90" textAnchor="middle" fill="#ff6666" fontSize="11" fontWeight="700">{set.bfr}</text>
      <text x="127" y="100" textAnchor="middle" fill="#ff9999" fontSize="8">mL/min</text>

      {/* Pre (PBP) Bag */}
      <g transform="translate(75, 5)">
        <rect x="0" y="0" width="38" height="42" rx="4" fill="url(#bgPre)" stroke="#44aaff" strokeWidth="2"/>
        <rect x="4" y="4" width="30" height="28" rx="2" fill="#0088ff" opacity="0.5"/>
        <text x="19" y="20" textAnchor="middle" fill="#ffffff" fontSize="10" fontWeight="700">{set.pbp}</text>
        <text x="19" y="54" textAnchor="middle" fill="#66ccff" fontSize="9" fontWeight="700">Pre</text>
        <line x1="19" y1="42" x2="19" y2="48" stroke="#44aaff" strokeWidth="2"/>
      </g>

      {/* Line to filter */}
      <path d="M 152 65 L 185 65" fill="none" stroke="#aa0000" strokeWidth="7" strokeLinecap="round"/>

      {/* UF Rate Bag - at START of filter (left side) */}
      <g transform="translate(175, 110)">
        <rect x="0" y="0" width="55" height="42" rx="4" fill="url(#bgUF)" stroke="#ffcc00" strokeWidth="2"/>
        <text x="27" y="16" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="600">UF Rate</text>
        <text x="27" y="34" textAnchor="middle" fill="#ffff88" fontSize="14" fontWeight="700">{set.netUF}</text>
        <line x1="27" y1="0" x2="27" y2="-8" stroke="#ffcc00" strokeWidth="2"/>
      </g>

      {/* FILTER - HORIZONTAL - larger */}
      <g transform="translate(185, 40)">
        <rect x="0" y="0" width="110" height="50" rx="6" fill="#0a1a2a" stroke={ffs.col} strokeWidth="3"/>
        <rect x="5" y="5" width="100" height="40" rx="4" fill="#051525"/>
        {[0,1,2,3,4,5,6,7,8].map(i => (
          <line key={i} x1={12 + i*11} y1="10" x2={12 + i*11} y2="40" stroke="#ff8800" strokeWidth="3" opacity={Math.max(0.2, 1 - fs.clot * 0.8)} strokeLinecap="round"/>
        ))}
        <text x="55" y="62" textAnchor="middle" fill={ffs.col} fontSize="12" fontWeight="700" filter="url(#glow)">FF {ff.toFixed(0)}%</text>
      </g>

      {/* Dialysate Bag - at END of filter (right side, on top) */}
      <g transform="translate(260, 0)">
        <rect x="0" y="0" width="42" height="38" rx="4" fill="url(#bgDia)" stroke="#44ff88" strokeWidth="2"/>
        <rect x="4" y="4" width="34" height="24" rx="2" fill="#00ff66" opacity="0.5"/>
        <text x="21" y="22" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">{set.dialysate}</text>
        <text x="21" y="50" textAnchor="middle" fill="#66ff99" fontSize="9" fontWeight="700">Dial</text>
        <line x1="21" y1="38" x2="21" y2="42" stroke="#44ff88" strokeWidth="2"/>
      </g>

      {/* Line from filter to replacement */}
      <path d="M 300 65 L 350 65" fill="none" stroke="#ff2222" strokeWidth="7" strokeLinecap="round"/>

      {/* Replacement Bag - Post-filter */}
      <g transform="translate(350, 10)">
        <rect x="0" y="0" width="42" height="48" rx="4" fill="url(#bgRep)" stroke="#ff88aa" strokeWidth="2"/>
        <rect x="4" y="4" width="34" height="32" rx="2" fill="#ff6699" opacity="0.5"/>
        <text x="21" y="18" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="600">Post</text>
        <text x="21" y="32" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">{set.replacement}</text>
        <line x1="21" y1="48" x2="21" y2="58" stroke="#ff88aa" strokeWidth="2" strokeDasharray="3,2"/>
      </g>

      {/* Return to patient */}
      <path d="M 395 65 L 440 65 L 440 140 L 55 140" fill="none" stroke="#ff2222" strokeWidth="7" strokeLinecap="round"/>

      {/* Animated blood particles */}
      {run && [0,1,2,3].map(i => (
        <circle key={i} r="5" fill="#ff0000" filter="url(#glow)">
          <animateMotion dur={`${3.5/sp}s`} repeatCount="indefinite" begin={`${i*0.9/sp}s`} path="M 55 80 L 85 80 L 85 65 L 300 65 L 395 65 L 440 65 L 440 140 L 55 140"/>
        </circle>
      ))}

      {/* Pressure displays at bottom */}
      <g transform="translate(70, 158)">
        <rect x="-28" y="0" width="56" height="20" rx="3" fill="#200000" stroke="#ff6666" strokeWidth="1"/>
        <text x="0" y="9" textAnchor="middle" fill="#ff8888" fontSize="7">ACCESS</text>
        <text x="0" y="18" textAnchor="middle" fill="#ff4444" fontSize="10" fontWeight="700">{Math.round(pr.access)}</text>
      </g>
      <g transform="translate(170, 158)">
        <rect x="-28" y="0" width="56" height="20" rx="3" fill="#201500" stroke="#ffaa44" strokeWidth="1"/>
        <text x="0" y="9" textAnchor="middle" fill="#ffcc88" fontSize="7">TMP</text>
        <text x="0" y="18" textAnchor="middle" fill="#ffaa00" fontSize="10" fontWeight="700">{Math.round(pr.tmp)}</text>
      </g>
      <g transform="translate(270, 158)">
        <rect x="-28" y="0" width="56" height="20" rx="3" fill="#151500" stroke="#aaaa44" strokeWidth="1"/>
        <text x="0" y="9" textAnchor="middle" fill="#cccc88" fontSize="7">ΔP</text>
        <text x="0" y="18" textAnchor="middle" fill="#aaaa00" fontSize="10" fontWeight="700">{Math.round(pr.deltaP)}</text>
      </g>
      <g transform="translate(420, 158)">
        <rect x="-28" y="0" width="56" height="20" rx="3" fill="#002000" stroke="#66ff66" strokeWidth="1"/>
        <text x="0" y="9" textAnchor="middle" fill="#88ff88" fontSize="7">RETURN</text>
        <text x="0" y="18" textAnchor="middle" fill="#44ff44" fontSize="10" fontWeight="700">{Math.round(pr.return)}</text>
      </g>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
};

const ScenPanel = ({ sc, cur, onSel }) => (
  <div style={{ background: '#0f1f15', border: '1px solid #4a8a4a', borderRadius: '5px', padding: '5px' }}>
    <div style={{ fontSize: '10px', fontWeight: '700', color: '#66ff99', marginBottom: '4px' }}>📚 Scenarios</div>
    <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
      {Object.entries(sc).map(([k, s]) => (
        <button key={k} onClick={() => onSel(k)} style={{ width: '100%', padding: '4px 6px', marginBottom: '2px', background: cur === k ? '#2a5a2a' : '#0a1510', border: cur === k ? '1px solid #00ff88' : '1px solid #3a5a3a', borderRadius: '3px', color: cur === k ? '#00ff88' : '#aaddaa', cursor: 'pointer', textAlign: 'left', fontSize: '8px' }}>
          <div style={{ fontWeight: cur === k ? '700' : '500' }}>{s.name}</div>
        </button>
      ))}
    </div>
  </div>
);

const PatientInputs = ({ pt, setPt }) => (
  <div style={{ background: '#0f1525', border: '1px solid #4a6a8a', borderRadius: '5px', padding: '10px' }}>
    <div style={{ fontSize: '11px', fontWeight: '700', color: '#99ccff', marginBottom: '10px' }}>👤 Patient Settings</div>
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '10px', color: '#88aacc', marginBottom: '4px' }}>Weight (kg)</div>
      <input 
        type="number" 
        value={pt.wt} 
        onChange={e => setPt(p => ({...p, wt: Number(e.target.value)}))}
        min={30} max={200} step={1}
        style={{ width: '100%', padding: '8px', background: '#0a1520', border: '2px solid #44aaff', borderRadius: '4px', color: '#44aaff', fontSize: '16px', fontWeight: '700', textAlign: 'center', fontFamily: 'monospace' }}
      />
    </div>
    <div>
      <div style={{ fontSize: '10px', color: '#88aacc', marginBottom: '4px' }}>Hematocrit (%)</div>
      <input 
        type="number" 
        value={pt.hct} 
        onChange={e => setPt(p => ({...p, hct: Number(e.target.value)}))}
        min={15} max={55} step={1}
        style={{ width: '100%', padding: '8px', background: '#0a1520', border: '2px solid #ff8888', borderRadius: '4px', color: '#ff8888', fontSize: '16px', fontWeight: '700', textAlign: 'center', fontFamily: 'monospace' }}
      />
    </div>
  </div>
);

const TeachPanel = ({ sc, set, ff }) => {
  if (!sc) return <div style={{ background: '#0a1a28', border: '1px solid #3a5a7a', borderRadius: '5px', padding: '10px', textAlign: 'center' }}><div style={{ fontSize: '28px' }}>🎓</div><div style={{ fontSize: '11px', color: '#99bbdd' }}>Select a scenario to begin</div></div>;
  const fb = [];
  if (ff > 30) fb.push({ t: 'c', m: `FF ${ff.toFixed(1)}% too high!` });
  else if (ff > 25) fb.push({ t: 'w', m: `FF ${ff.toFixed(1)}% elevated` });
  return (
    <div style={{ background: '#0a1a28', border: '1px solid #3a5a7a', borderRadius: '5px', padding: '8px', maxHeight: '180px', overflowY: 'auto' }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: '#ffdd66', marginBottom: '3px' }}>{sc.name}</div>
      <div style={{ fontSize: '9px', color: '#bbccdd', marginBottom: '5px', lineHeight: '1.3' }}>{sc.desc}</div>
      {fb.map((f, i) => <div key={i} style={{ padding: '4px 6px', marginBottom: '3px', background: f.t === 'c' ? '#3a1a1a' : '#3a3a1a', border: `1px solid ${f.t === 'c' ? '#ff5555' : '#ffcc00'}`, borderRadius: '4px', fontSize: '9px', color: f.t === 'c' ? '#ff7777' : '#ffee77', fontWeight: '600' }}>{f.t === 'c' ? '🚨' : '⚠️'} {f.m}</div>)}
      <div style={{ fontSize: '9px', color: '#99aabb', fontWeight: '600', marginTop: '4px' }}>Key Points:</div>
      <ul style={{ margin: '4px 0 0 0', paddingLeft: '14px', fontSize: '9px', color: '#aaccee', lineHeight: '1.4' }}>{sc.tips.map((t, i) => <li key={i} style={{ marginBottom: '2px' }}>{t}</li>)}</ul>
    </div>
  );
};



const QuizModal = ({ onClose }) => {
  const [i, setI] = useState(0);
  const [sel, setSel] = useState(null);
  const [sh, setSh] = useState(false);
  const [sc, setSc] = useState(0);
  const q = quiz[i];
  const ans = (x) => { if (sh) return; setSel(x); setSh(true); if (x === q.a) setSc(s => s + 1); };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
      <div style={{ background: '#0f1f30', border: '2px solid #2a5a8a', borderRadius: '8px', padding: '12px', maxWidth: '400px', width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#88ccff' }}>📝 Quiz ({i + 1}/{quiz.length})</div>
          <button onClick={onClose} style={{ background: '#3a2a2a', border: '1px solid #8a4a4a', borderRadius: '3px', color: '#ff8888', padding: '2px 8px', cursor: 'pointer', fontSize: '9px' }}>Close</button>
        </div>
        <div style={{ fontSize: '11px', color: '#e0e8f0', marginBottom: '8px' }}>{q.q}</div>
        {q.o.map((o, x) => (
          <button key={x} onClick={() => ans(x)} style={{ width: '100%', padding: '6px', marginBottom: '4px', background: sh ? (x === q.a ? '#1a3a1a' : x === sel ? '#3a1a1a' : '#0a1520') : '#0a1520', border: `1px solid ${sh ? (x === q.a ? '#00ff88' : x === sel ? '#ff4444' : '#2a3a4a') : '#2a3a4a'}`, borderRadius: '4px', color: '#e0e8f0', cursor: sh ? 'default' : 'pointer', textAlign: 'left', fontSize: '10px' }}>
            {String.fromCharCode(65 + x)}. {o} {sh && x === q.a && '✓'}
          </button>
        ))}
        {sh && <div style={{ background: '#0f1a25', border: '1px solid #2a4a6a', borderRadius: '4px', padding: '6px', marginBottom: '8px', fontSize: '9px', color: '#aabbcc' }}>💡 {q.x}</div>}
        {sh && i < quiz.length - 1 && <button onClick={() => { setI(i + 1); setSel(null); setSh(false); }} style={{ width: '100%', padding: '8px', background: '#2a4a6a', border: 'none', borderRadius: '4px', color: '#88ccff', cursor: 'pointer', fontSize: '11px' }}>Next →</button>}
        {sh && i === quiz.length - 1 && <div style={{ textAlign: 'center', color: '#00ff88' }}>Done! Score: {sc}/{quiz.length}</div>}
      </div>
    </div>
  );
};

const FCModal = ({ onClose }) => {
  const [s, setS] = useState(0);
  const st = fcSteps[s];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
      <div style={{ background: '#0f1f30', border: '2px solid #2a5a8a', borderRadius: '8px', padding: '12px', maxWidth: '400px', width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#88ccff' }}>🔄 Filter Change</div>
          <button onClick={onClose} style={{ background: '#3a2a2a', border: '1px solid #8a4a4a', borderRadius: '3px', color: '#ff8888', padding: '2px 8px', cursor: 'pointer', fontSize: '9px' }}>Close</button>
        </div>
        <div style={{ display: 'flex', gap: '2px', marginBottom: '8px' }}>{fcSteps.map((_, i) => <div key={i} onClick={() => setS(i)} style={{ flex: 1, height: '4px', background: i <= s ? '#00ff88' : '#2a3a4a', borderRadius: '2px', cursor: 'pointer' }} />)}</div>
        <div style={{ background: '#0a1520', borderRadius: '4px', padding: '8px', marginBottom: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#ffcc00', marginBottom: '4px' }}>Step {s + 1}: {st.t}</div>
          <ul style={{ margin: 0, paddingLeft: '14px', fontSize: '9px', color: '#aabbcc' }}>{st.a.map((a, i) => <li key={i}>{a}</li>)}</ul>
          <div style={{ marginTop: '6px', padding: '4px', background: '#2a1a1a', border: '1px solid #ff6666', borderRadius: '3px', fontSize: '8px', color: '#ff9999' }}>⚠️ {st.c}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setS(Math.max(0, s - 1))} disabled={s === 0} style={{ flex: 1, padding: '6px', background: '#2a4a6a', border: 'none', borderRadius: '3px', color: '#88aacc', cursor: 'pointer', fontSize: '10px' }}>← Back</button>
          <button onClick={() => setS(Math.min(fcSteps.length - 1, s + 1))} style={{ flex: 1, padding: '6px', background: '#2a6a2a', border: 'none', borderRadius: '3px', color: '#88ff88', cursor: 'pointer', fontSize: '10px' }}>{s === fcSteps.length - 1 ? '✓ Done' : 'Next →'}</button>
        </div>
      </div>
    </div>
  );
};

// Main App
export default function CRRTSimulator() {
  const [set, setSet] = useState({ pbp: 2000, bfr: 250, dialysate: 1500, replacement: 500, netUF: 100, run: false });
  const [pt, setPt] = useState({ wt: 80, hct: 35 });
  const [fs, setFs] = useState({ age: 0, clot: 0 });
  const [curSc, setCurSc] = useState(null);
  const [time, setTime] = useState(0);
  const [spd, setSpd] = useState(1);
  const [showQ, setShowQ] = useState(false);
  const [showFC, setShowFC] = useState(false);

  const upd = (k, v) => {
    setSet(p => ({ ...p, [k]: v }));
  };
  
  // Calculate all derived values directly - NO useEffect needed for immediate response
  const eff = set.dialysate + set.replacement + set.netUF;
  const ff = Phys.filtrationFraction(set.bfr, pt.hct, 0, eff);  // No PFR, so pass 0
  
  // Pressures calculated directly from current state - updates immediately
  const pr = {
    access: Phys.calcAccess(set.bfr),
    return: Phys.calcReturn(set.bfr, fs.clot),
    tmp: Phys.calcTMP(set.bfr, pt.hct, ff, eff, fs.age, fs.clot),
    deltaP: Phys.calcDeltaP(set.bfr, fs.clot, pt.hct)
  };

  const loadSc = (k) => {
    const s = scenarios[k];
    setCurSc(k);
    setPt(p => ({ ...p, ...s.pt }));
    setFs({ age: 0, clot: 0 });
    setTime(0);
  };

  // Simulation timer - only updates filter age and clotting over time
  useEffect(() => {
    if (!set.run) return;
    const iv = setInterval(() => {
      setTime(t => t + spd);
      setFs(f => {
        const newAge = f.age + spd / 3600;
        const ffFactor = ff > 25 ? 1 + (ff - 25) * 0.05 : 1;
        const clotRate = 0.0001 * (pt.hct / 35) * ffFactor;
        return { age: newAge, clot: Math.min(1, f.clot + clotRate * spd) };
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [set.run, spd, pt.hct, ff]);

  const fmt = s => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

  return (
    <div style={{ width: '100%', minHeight: '100vh', background: 'linear-gradient(135deg, #080f1a 0%, #0c1525 100%)', fontFamily: 'system-ui', color: '#e0e8f0', padding: '6px', boxSizing: 'border-box' }}>
      {showQ && <QuizModal onClose={() => setShowQ(false)} />}
      {showFC && <FCModal onClose={() => setShowFC(false)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: '#121f30', borderRadius: '5px', marginBottom: '6px', border: '1px solid #2a4a6a', flexWrap: 'wrap', gap: '6px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: '700', background: 'linear-gradient(90deg, #00ddff, #00ff88)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>CRRT Simulator</div>
          <div style={{ fontSize: '7px', color: '#00ff88' }}>Complete: Scenarios • FF • Drugs • Quiz • Filter Change</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '8px', color: '#6a8a9a' }}>Filter: <span style={{ color: '#ffcc00' }}>{fs.age.toFixed(1)}h</span></span>
          <span style={{ fontSize: '8px', color: '#6a8a9a' }}>Time: <span style={{ color: '#88aacc' }}>{fmt(time)}</span></span>
          <button onClick={() => setShowQ(true)} style={{ padding: '3px 8px', background: '#4a3a6a', border: '1px solid #6a4a8a', borderRadius: '3px', color: '#cc88ff', cursor: 'pointer', fontSize: '8px' }}>📝Quiz</button>
          <button onClick={() => setShowFC(true)} style={{ padding: '3px 8px', background: '#3a4a6a', border: '1px solid #4a6a8a', borderRadius: '3px', color: '#88ccff', cursor: 'pointer', fontSize: '8px' }}>🔄Filter</button>
          <select value={spd} onChange={e => setSpd(Number(e.target.value))} style={{ padding: '2px 4px', background: '#1a2a3a', border: '1px solid #3a5a7a', borderRadius: '2px', color: '#88ccff', fontSize: '8px' }}>
            <option value={1}>1x</option><option value={60}>1m/s</option><option value={600}>10m/s</option>
          </select>
          <button onClick={() => upd('run', !set.run)} style={{ padding: '4px 10px', fontSize: '9px', fontWeight: '700', background: set.run ? '#cc0000' : '#00cc00', border: 'none', borderRadius: '3px', color: 'white', cursor: 'pointer' }}>{set.run ? '⏹' : '▶'}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 200px', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <ScenPanel sc={scenarios} cur={curSc} onSel={loadSc} />
          <PatientInputs pt={pt} setPt={setPt} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ height: '195px', border: '1px solid #2a4a6a', borderRadius: '6px', overflow: 'hidden' }}>
            <Circuit set={set} pr={pr} fs={fs} run={set.run} ff={ff} pt={pt} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', background: '#0f1a25', borderRadius: '5px', padding: '8px', border: '1px solid #2a4a5a' }}>
            {[
              ['Pre', 'pbp', '#44bbff', 'mL/h', 10, 0, 3000],
              ['BFR', 'bfr', '#ff7777', 'mL/min', 1, 50, 450],
              ['Dial', 'dialysate', '#77ff77', 'mL/h', 10, 0, 4000],
              ['Post', 'replacement', '#ff88bb', 'mL/h', 10, 0, 3000],
              ['UF Rate', 'netUF', '#ffcc44', 'mL/h', 1, 0, 500]
            ].map(([l, k, c, unit, step, min, max]) => (
              <div key={k} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: c, fontWeight: '700', marginBottom: '2px' }}>{l}</div>
                <input 
                  type="number" 
                  value={set[k]} 
                  onChange={e => upd(k, Number(e.target.value))}
                  step={step}
                  min={min}
                  max={max}
                  style={{ width: '65px', padding: '6px 4px', background: '#0a1520', border: `2px solid ${c}`, borderRadius: '4px', color: c, fontSize: '16px', fontWeight: '700', textAlign: 'center', fontFamily: 'monospace' }} 
                />
                <div style={{ fontSize: '9px', color: '#99aabb', marginTop: '2px' }}>{unit}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around', background: '#000a14', borderRadius: '5px', padding: '6px', border: '1px solid #004488' }}>
            <Gauge label="Access" value={pr.access} min={-350} max={0} inverted={true} />
            <Gauge label="Return" value={pr.return} min={0} max={400} inverted={false} />
            <Gauge label="TMP" value={pr.tmp} min={0} max={500} inverted={false} />
            <Gauge label="ΔP" value={pr.deltaP} min={0} max={500} inverted={false} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <FFPanel bfr={set.bfr} hct={pt.hct} eff={eff} />
          <CalculationsPanel set={set} pt={pt} ff={ff} />
          <TeachPanel sc={curSc ? scenarios[curSc] : null} set={set} ff={ff} />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '5px', fontSize: '7px', color: '#4a6a8a' }}>CRRT Simulator - Complete Edition | Educational Use Only</div>
    </div>
  );
}
