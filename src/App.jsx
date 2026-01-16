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
  ureaClearance: (bfr, dial, uf, fe = 1) => Math.min(bfr, ((dial / 60) * (1 - Math.exp(-bfr / (dial / 60 + 10))) + uf / 60) * fe),
  circuitCa: (pbp, bfr) => Math.max(0.1, Math.min(1.5, 1.2 - ((pbp / 60) * 4 / 1000 / 3) / bfr * 1000)),
  calcTMP: (base, age, bfr, hct, ac, pfr, ff, effluent) => {
    // TMP responds to: BFR, effluent rate, FF, filter age, anticoagulation
    const bfrFactor = 1 + (bfr - 150) * 0.002; // Higher BFR = higher TMP
    const effFactor = 1 + (effluent - 1500) * 0.0003; // Higher effluent = higher TMP
    const hctFactor = 1 + Math.max(0, hct - 30) * 0.02;
    const ffFactor = ff > 20 ? 1 + (ff - 20) * 0.015 : 1; // High FF increases TMP
    const ageFactor = 1 + age * 0.02; // Filter ages over time
    const acFactor = 2 - ac; // Poor anticoag = higher TMP
    return base * bfrFactor * effFactor * hctFactor * ffFactor * ageFactor * acFactor;
  },
  calcAccess: (bfr, p = 0.9) => Math.max(-350, -40 - bfr * 0.12 - (1 - p) * 180),
  calcReturn: (bfr, c) => Math.min(400, 25 + bfr * 0.12 + c * 120),
  calcDeltaP: (bfr, c, hct) => Math.min(250, 15 + bfr * 0.08 + c * 180 + Math.max(0, hct - 30) * 1.5),
  filterEff: (age, c, ff) => Math.max(0.3, Math.exp(-age / 72) * (1 - c * 0.5) * (ff > 25 ? 1 - (ff - 25) * 0.01 : 1)),
  drugs: {
    vancomycin: { n: '15-20 mg/kg q8-12h', c: '500-750 mg q12h + levels', note: 'Target trough 15-20', cl: (e, f) => (e / 60) * 0.45 * 0.8 * f },
    meropenem: { n: '1g q8h', c: '1g q8h or 500mg q6h', note: 'Extended infusion preferred', cl: (e, f) => (e / 60) * 0.98 * 0.95 * f },
    piperacillin: { n: '4.5g q6h', c: '4.5g q8h', note: 'Time-dependent killing', cl: (e, f) => (e / 60) * 0.7 * 0.9 * f },
    gentamicin: { n: '5-7 mg/kg q24h', c: '2-3 mg/kg q24-48h + levels', note: 'Follow peak/trough', cl: (e, f) => (e / 60) * 0.95 * 0.95 * f },
    fluconazole: { n: '400-800mg daily', c: '400-800mg daily', note: 'Load 800mg first', cl: (e, f) => (e / 60) * 0.89 * 0.95 * f }
  }
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

const FFPanel = ({ bfr, hct, pfr, eff }) => {
  const ff = Phys.filtrationFraction(bfr, hct, pfr, eff);
  const s = getFFStatus(ff);
  const pf = Phys.plasmaFlow(bfr, hct);
  const pff = Phys.plasmaFlowAtFilter(bfr, hct, pfr);
  return (
    <div style={{ background: '#0a1525', border: `2px solid ${s.col}55`, borderRadius: '6px', padding: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#99ccff' }}>🔬 Filtration Fraction</span>
        <span style={{ fontSize: '9px', padding: '2px 8px', background: `${s.col}33`, border: `1px solid ${s.col}`, borderRadius: '10px', color: s.col, fontWeight: '700' }}>{s.st}</span>
      </div>
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <div style={{ position: 'relative', width: '80px', height: '80px', margin: '0 auto' }}>
          <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#1a2a3a" strokeWidth="8"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke={s.col} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${Math.min(ff, 50) * 5} 251`} strokeDashoffset="63" style={{ transition: 'all 0.5s' }}/>
          </svg>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <div style={{ fontSize: '22px', fontWeight: '700', color: s.col, fontFamily: 'monospace' }}>{ff.toFixed(1)}%</div>
          </div>
        </div>
        <div style={{ fontSize: '9px', color: s.col, fontWeight: '600' }}>{s.msg}</div>
        <div style={{ fontSize: '8px', color: '#99aabb' }}>Est. filter life: {s.life}</div>
      </div>
      <div style={{ fontSize: '8px', background: '#0a1218', borderRadius: '4px', padding: '6px', border: '1px solid #2a3a4a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}><span style={{ color: '#99aabb' }}>Plasma flow:</span><span style={{ color: '#88ddff', fontFamily: 'monospace', fontWeight: '600' }}>{pf.toFixed(0)} mL/min</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}><span style={{ color: '#99aabb' }}>+ PFR:</span><span style={{ color: '#ffdd66', fontFamily: 'monospace', fontWeight: '600' }}>+{(pfr/60).toFixed(1)}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #3a4a5a', paddingTop: '3px', marginTop: '2px' }}><span style={{ color: '#99aabb' }}>At filter:</span><span style={{ color: '#66ffff', fontFamily: 'monospace', fontWeight: '700' }}>{pff.toFixed(0)} mL/min</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#99aabb' }}>Effluent:</span><span style={{ color: '#ffdd66', fontFamily: 'monospace', fontWeight: '600' }}>{(eff/60).toFixed(1)} mL/min</span></div>
      </div>
    </div>
  );
};

const Circuit = ({ set, pr, fs, run, ff }) => {
  const ffs = getFFStatus(ff);
  const sp = set.bfr / 250;
  const bagHeight = 38;
  return (
    <svg viewBox="0 0 520 135" style={{ width: '100%', height: '100%', background: 'linear-gradient(180deg, #001428 0%, #001a30 100%)', borderRadius: '6px' }}>
      <defs>
        <linearGradient id="bgPBP" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#0066cc"/><stop offset="100%" stopColor="#003366"/></linearGradient>
        <linearGradient id="bgPFR" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#ccaa00"/><stop offset="100%" stopColor="#665500"/></linearGradient>
        <linearGradient id="bgDia" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#00cc44"/><stop offset="100%" stopColor="#006622"/></linearGradient>
        <linearGradient id="bgRep" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#cc4488"/><stop offset="100%" stopColor="#662244"/></linearGradient>
        <linearGradient id="bgEff" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#ccaa00"/><stop offset="100%" stopColor="#554400"/></linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="1.5" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      
      {/* Patient icon */}
      <ellipse cx="28" cy="42" rx="15" ry="18" fill="#2a4a6a" stroke="#4a8aff" strokeWidth="2"/>
      <ellipse cx="28" cy="80" rx="19" ry="24" fill="#2a4a6a" stroke="#4a8aff" strokeWidth="2"/>
      <text x="28" y="84" textAnchor="middle" fill="#88ccff" fontSize="7" fontWeight="600">PATIENT</text>

      {/* Access line - dark red */}
      <path d="M 50 65 L 75 65 L 75 52 L 95 52" fill="none" stroke="#990000" strokeWidth="6" strokeLinecap="round"/>
      
      {/* Blood pump */}
      <g transform="translate(95, 32)">
        <circle cx="18" cy="18" r="18" fill="#cc0000" stroke="#ff4444" strokeWidth="2" filter="url(#glow)"/>
        <circle cx="18" cy="18" r="12" fill="none" stroke="#220000" strokeWidth="3"/>
        <g style={{ transformOrigin: '18px 18px', animation: run ? `spin ${2.5/sp}s linear infinite` : 'none' }}>
          <rect x="14" y="2" width="8" height="12" rx="2" fill="#440000"/>
          <rect x="14" y="22" width="8" height="12" rx="2" fill="#440000"/>
        </g>
      </g>
      <text x="113" y="70" textAnchor="middle" fill="#ff6666" fontSize="9" fontWeight="700">{set.bfr}</text>
      <text x="113" y="78" textAnchor="middle" fill="#ff9999" fontSize="6">mL/min</text>

      {/* PBP Bag */}
      <g transform="translate(70, 2)">
        <rect x="0" y="0" width="32" height={bagHeight} rx="4" fill="url(#bgPBP)" stroke="#44aaff" strokeWidth="2"/>
        <rect x="4" y="4" width="24" height={bagHeight - 12} rx="2" fill="#0088ff" opacity="0.5"/>
        <text x="16" y={bagHeight + 10} textAnchor="middle" fill="#66ccff" fontSize="8" fontWeight="700">PBP</text>
        <line x1="16" y1={bagHeight} x2="16" y2={bagHeight + 2} stroke="#44aaff" strokeWidth="2"/>
      </g>

      {/* Line to filter */}
      <path d="M 135 52 L 200 52" fill="none" stroke="#aa0000" strokeWidth="6" strokeLinecap="round"/>

      {/* PFR Bag */}
      <g transform="translate(155, 2)">
        <rect x="0" y="0" width="32" height={bagHeight} rx="4" fill="url(#bgPFR)" stroke="#ffdd44" strokeWidth="2"/>
        <rect x="4" y={4 + (bagHeight - 12) * (1 - Math.min(1, set.pfr/1500))} width="24" height={(bagHeight - 12) * Math.min(1, set.pfr/1500)} rx="2" fill="#ffcc00" opacity="0.7"/>
        <text x="16" y={bagHeight + 10} textAnchor="middle" fill="#ffdd44" fontSize="8" fontWeight="700">PFR</text>
        <text x="16" y={bagHeight + 18} textAnchor="middle" fill="#ffee88" fontSize="7">{set.pfr}</text>
        <line x1="16" y1={bagHeight} x2="16" y2="52" stroke="#ffdd44" strokeWidth="2" strokeDasharray="3,2"/>
      </g>

      {/* FILTER */}
      <g transform="translate(205, 22)">
        <rect x="0" y="0" width="60" height="60" rx="5" fill="#0a1a2a" stroke={ffs.col} strokeWidth="3"/>
        <rect x="5" y="5" width="50" height="50" rx="3" fill="#051525"/>
        {[0,1,2,3,4,5].map(i => (
          <line key={i} x1="10" y1={12 + i*8} x2="50" y2={12 + i*8} stroke="#ff8800" strokeWidth="3" opacity={Math.max(0.2, 1 - fs.clot * 0.8)} strokeLinecap="round"/>
        ))}
        <text x="30" y="72" textAnchor="middle" fill={ffs.col} fontSize="10" fontWeight="700" filter="url(#glow)">FF {ff.toFixed(0)}%</text>
      </g>

      {/* Dialysate Bag */}
      <g transform="translate(220, -8)">
        <rect x="0" y="0" width="32" height="28" rx="4" fill="url(#bgDia)" stroke="#44ff88" strokeWidth="2"/>
        <rect x="4" y="4" width="24" height="16" rx="2" fill="#00ff66" opacity="0.5"/>
        <text x="16" y="20" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="700">{set.dialysate}</text>
        <line x1="16" y1="28" x2="16" y2="30" stroke="#44ff88" strokeWidth="2"/>
      </g>

      {/* Return line */}
      <path d="M 270 52 L 340 52" fill="none" stroke="#ff2222" strokeWidth="6" strokeLinecap="round"/>

      {/* Replacement Bag */}
      <g transform="translate(305, 2)">
        <rect x="0" y="0" width="32" height={bagHeight} rx="4" fill="url(#bgRep)" stroke="#ff88aa" strokeWidth="2"/>
        <rect x="4" y="4" width="24" height={bagHeight - 12} rx="2" fill="#ff6699" opacity="0.5"/>
        <text x="16" y={bagHeight + 10} textAnchor="middle" fill="#ffaacc" fontSize="8" fontWeight="700">Rep</text>
        <text x="16" y={bagHeight + 18} textAnchor="middle" fill="#ffccdd" fontSize="7">{set.replacement}</text>
        <line x1="16" y1={bagHeight} x2="16" y2="52" stroke="#ff88aa" strokeWidth="2" strokeDasharray="3,2"/>
      </g>

      {/* Return to patient */}
      <path d="M 360 52 L 410 52 L 410 100 L 50 100" fill="none" stroke="#ff2222" strokeWidth="6" strokeLinecap="round"/>

      {/* Effluent line and bag */}
      <path d="M 235 85 L 235 110 L 280 110" fill="none" stroke="#ddaa00" strokeWidth="4"/>
      <g transform="translate(280, 95)">
        <rect x="0" y="0" width="50" height="32" rx="4" fill="url(#bgEff)" stroke="#ffcc00" strokeWidth="2"/>
        <text x="25" y="14" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="600">Effluent</text>
        <text x="25" y="26" textAnchor="middle" fill="#ffff88" fontSize="10" fontWeight="700">{set.dialysate + set.replacement + set.pfr + set.netUF}</text>
      </g>

      {/* Animated blood particles */}
      {run && [0,1,2,3].map(i => (
        <circle key={i} r="4" fill="#ff0000" filter="url(#glow)">
          <animateMotion dur={`${3.5/sp}s`} repeatCount="indefinite" begin={`${i*0.9/sp}s`} path="M 50 65 L 75 65 L 75 52 L 270 52 L 340 52 L 410 52 L 410 100 L 50 100"/>
        </circle>
      ))}

      {/* Pressure displays at bottom */}
      <g transform="translate(60, 112)">
        <rect x="-25" y="0" width="50" height="18" rx="3" fill="#200000" stroke="#ff6666" strokeWidth="1"/>
        <text x="0" y="8" textAnchor="middle" fill="#ff8888" fontSize="6">ACCESS</text>
        <text x="0" y="16" textAnchor="middle" fill="#ff4444" fontSize="9" fontWeight="700">{Math.round(pr.access)}</text>
      </g>
      <g transform="translate(175, 112)">
        <rect x="-25" y="0" width="50" height="18" rx="3" fill="#201500" stroke="#ffaa44" strokeWidth="1"/>
        <text x="0" y="8" textAnchor="middle" fill="#ffcc88" fontSize="6">TMP</text>
        <text x="0" y="16" textAnchor="middle" fill="#ffaa00" fontSize="9" fontWeight="700">{Math.round(pr.tmp)}</text>
      </g>
      <g transform="translate(380, 112)">
        <rect x="-25" y="0" width="50" height="18" rx="3" fill="#002000" stroke="#66ff66" strokeWidth="1"/>
        <text x="0" y="8" textAnchor="middle" fill="#88ff88" fontSize="6">RETURN</text>
        <text x="0" y="16" textAnchor="middle" fill="#44ff44" fontSize="9" fontWeight="700">{Math.round(pr.return)}</text>
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
  <div style={{ background: '#0f1525', border: '1px solid #4a6a8a', borderRadius: '5px', padding: '8px' }}>
    <div style={{ fontSize: '10px', fontWeight: '700', color: '#99ccff', marginBottom: '8px' }}>👤 Patient Settings</div>
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontSize: '9px', color: '#88aacc', marginBottom: '3px' }}>Weight (kg)</div>
      <input 
        type="number" 
        value={pt.wt} 
        onChange={e => setPt(p => ({...p, wt: Number(e.target.value)}))}
        min={30} max={200} step={1}
        style={{ width: '100%', padding: '6px', background: '#0a1520', border: '2px solid #44aaff', borderRadius: '4px', color: '#44aaff', fontSize: '14px', fontWeight: '700', textAlign: 'center', fontFamily: 'monospace' }}
      />
    </div>
    <div>
      <div style={{ fontSize: '9px', color: '#88aacc', marginBottom: '3px' }}>Hematocrit (%)</div>
      <input 
        type="number" 
        value={pt.hct} 
        onChange={e => setPt(p => ({...p, hct: Number(e.target.value)}))}
        min={15} max={55} step={1}
        style={{ width: '100%', padding: '6px', background: '#0a1520', border: '2px solid #ff8888', borderRadius: '4px', color: '#ff8888', fontSize: '14px', fontWeight: '700', textAlign: 'center', fontFamily: 'monospace' }}
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
  const [set, setSet] = useState({ pbp: 2000, bfr: 250, pfr: 0, dialysate: 1500, replacement: 500, netUF: 100, run: true });
  const [pt, setPt] = useState({ wt: 80, k: 5.5, na: 140, bun: 80, cr: 5.0, ca: 1.15, hct: 35, lf: 0.9 });
  const [fs, setFs] = useState({ age: 0, clot: 0 });
  const [pr, setPr] = useState({ access: -80, return: 70, tmp: 120, deltaP: 45 });
  const [curSc, setCurSc] = useState(null);
  const [time, setTime] = useState(0);
  const [spd, setSpd] = useState(1);
  const [showQ, setShowQ] = useState(false);
  const [showFC, setShowFC] = useState(false);

  const upd = (k, v) => {
    setSet(p => ({ ...p, [k]: v }));
  };
  
  const eff = set.dialysate + set.replacement + set.pfr + set.netUF;
  const ff = Phys.filtrationFraction(set.bfr, pt.hct, set.pfr, eff);

  // Immediate pressure response to settings
  useEffect(() => {
    const ac = set.pbp > 1500 ? 0.8 : 0.6;
    setPr(p => ({
      access: Phys.calcAccess(set.bfr),
      return: Phys.calcReturn(set.bfr, fs.clot),
      tmp: Math.min(450, Phys.calcTMP(80, fs.age, set.bfr, pt.hct, ac, set.pfr, ff, eff)),
      deltaP: Phys.calcDeltaP(set.bfr, fs.clot, pt.hct)
    }));
  }, [set.bfr, set.pbp, set.pfr, set.dialysate, set.replacement, set.netUF, pt.hct, fs.age, fs.clot, ff, eff]);

  const loadSc = (k) => {
    const s = scenarios[k];
    setCurSc(k);
    setPt(p => ({ ...p, ...s.pt }));
    setFs({ age: 0, clot: 0 });
    setTime(0);
  };

  useEffect(() => {
    if (!set.run) return;
    const iv = setInterval(() => {
      setTime(t => t + spd);
      setFs(f => {
        const na = f.age + spd / 3600;
        const ac = set.pbp > 1500 ? 0.8 : 0.6;
        const fff = ff > 25 ? 1 + (ff - 25) * 0.05 : 1;
        const cr = 0.0002 * (1 - ac) * (pt.hct / 35) * fff;
        return { age: na, clot: Math.min(1, f.clot + cr * spd) };
      });
      setPr(p => {
        const ac = set.pbp > 1500 ? 0.8 : 0.6;
        const currentEff = set.dialysate + set.replacement + set.pfr + set.netUF;
        return { 
          access: Phys.calcAccess(set.bfr), 
          return: Phys.calcReturn(set.bfr, fs.clot), 
          tmp: Math.min(450, Phys.calcTMP(80, fs.age, set.bfr, pt.hct, ac, set.pfr, ff, currentEff)), 
          deltaP: Phys.calcDeltaP(set.bfr, fs.clot, pt.hct) 
        };
      });
    }, 1000);
    }, 1000);
    return () => clearInterval(iv);
  }, [set, spd, fs, pt, ff, time]);

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

      <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 170px', gap: '6px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <ScenPanel sc={scenarios} cur={curSc} onSel={loadSc} />
          <PatientInputs pt={pt} setPt={setPt} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ height: '145px', border: '1px solid #2a4a6a', borderRadius: '6px', overflow: 'hidden' }}>
            <Circuit set={set} pr={pr} fs={fs} run={set.run} ff={ff} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px', background: '#0f1a25', borderRadius: '5px', padding: '6px', border: '1px solid #2a4a5a' }}>
            {[
              ['PBP', 'pbp', '#44bbff', 'mL/h', 10, 0, 3000],
              ['BFR', 'bfr', '#ff7777', 'mL/min', 1, 50, 450],
              ['PFR', 'pfr', '#ffdd44', 'mL/h', 10, 0, 2000],
              ['Dial', 'dialysate', '#77ff77', 'mL/h', 10, 0, 4000],
              ['Rep', 'replacement', '#ff88bb', 'mL/h', 10, 0, 3000],
              ['UF', 'netUF', '#66ffff', 'mL/h', 1, 0, 500]
            ].map(([l, k, c, unit, step, min, max]) => (
              <div key={k} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '8px', color: c, fontWeight: '600' }}>{l}</div>
                <input 
                  type="number" 
                  value={set[k]} 
                  onChange={e => upd(k, Number(e.target.value))}
                  step={step}
                  min={min}
                  max={max}
                  style={{ width: '50px', padding: '4px 2px', background: '#0a1520', border: `2px solid ${c}`, borderRadius: '4px', color: c, fontSize: '13px', fontWeight: '700', textAlign: 'center', fontFamily: 'monospace' }} 
                />
                <div style={{ fontSize: '7px', color: '#99aabb', marginTop: '1px' }}>{unit}</div>
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
          <FFPanel bfr={set.bfr} hct={pt.hct} pfr={set.pfr} eff={eff} />
          <TeachPanel sc={curSc ? scenarios[curSc] : null} set={set} ff={ff} />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '5px', fontSize: '7px', color: '#4a6a8a' }}>CRRT Simulator - Complete Edition | Educational Use Only</div>
    </div>
  );
}
