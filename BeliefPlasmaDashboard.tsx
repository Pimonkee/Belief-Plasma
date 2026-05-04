import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Tooltip, Cell
} from 'recharts';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface Vector2D { x: number; y: number; }

interface Agent {
  id: string;
  belief: number[];
  pos: Vector2D;
  history: number[][];
  color: string;
}

interface SwarmMetrics {
  coherence: number;
  structuralCoherence: number;
  entropy: number;
  divergence: number;
  curvature: number;
  lambda_t: number;
  phase: 'stable' | 'emerging' | 'decaying' | 'ignition';
}

interface SimulationSnapshot {
  step: number;
  agents: Agent[];
  metrics: SwarmMetrics;
  flux: number;
  shocks: Array<{ step: number; flux: number }>;
  terrain: number[][];
}

interface EngineConfig {
  agentCount: number;
  coupling: number;
  lambda0: number;
  kappa: number;
  tauH: number;
  timeScale: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1: COSMIC — Synthetic Muon Flux
// ═══════════════════════════════════════════════════════════════════════════

class SyntheticFlux {
  private lambda = 3;
  private burstChance = 0.03;

  private poissonSample(): number {
    const L = Math.exp(-this.lambda);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  getFlux(): number {
    const base = this.poissonSample();
    const burst = Math.random() < this.burstChance ? Math.floor(Math.random() * 10) + 5 : 0;
    return base + burst;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2: FIELD — Nonlinear Terrain
// ═══════════════════════════════════════════════════════════════════════════

class GradientField {
  private size = 50;
  private grid: number[][];

  constructor() {
    this.grid = [];
    for (let y = 0; y < this.size; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.size; x++) {
        const nx = (x / this.size) * 4 - 2;
        const ny = (y / this.size) * 4 - 2;
        row.push(this.terrain(nx, ny));
      }
      this.grid.push(row);
    }
  }

  terrain(x: number, y: number): number {
    const r = Math.sqrt(x * x + y * y);
    return Math.sin(3 * x) * Math.cos(2 * y) + 0.4 * Math.sin(5 * r);
  }

  gradient(x: number, y: number): Vector2D {
    const h = 0.01;
    return {
      x: (this.terrain(x + h, y) - this.terrain(x - h, y)) / (2 * h),
      y: (this.terrain(x, y + h) - this.terrain(x, y - h)) / (2 * h)
    };
  }

  getGrid(): number[][] { return this.grid; }
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3: AGENT — Belief Dynamics on Curved Manifold
// ═══════════════════════════════════════════════════════════════════════════

class BeliefAgentImpl implements Agent {
  id: string;
  belief: number[];
  pos: Vector2D;
  history: number[][];
  color: string;
  private maxHistory = 50;

  constructor(id: string, color: string) {
    this.id = id;
    this.belief = Array(8).fill(0).map(() => (Math.random() - 0.5) * 0.3);
    this.pos = { x: Math.random() * 4 - 2, y: Math.random() * 4 - 2 };
    this.history = [];
    this.color = color;
  }

  update(
    field: GradientField,
    flux: number,
    meanBelief: number[],
    coupling: number,
    embedding: number[],
    lambda_t: number,
    cohGradient: number
  ): void {
    const grad = field.gradient(this.pos.x, this.pos.y);
    const noise = Array(8).fill(0).map(() => (Math.random() - 0.5) * 0.05);

    // Observer curvature: |∇A|² where dA[d] = (meanBelief[d] - belief[d]) * |cohGradient|
    // Manifold metric deformation: g_ij = δ_ij + λ·(∂A/∂b_i)(∂A/∂b_j)
    const dA = this.belief.map((b, d) => (meanBelief[d] - b) * Math.abs(cohGradient));
    const gradASq = dA.reduce((s, v) => s + v * v, 0);
    const curvatureContrib = lambda_t * gradASq;

    this.belief = this.belief.map((b, i) => {
      const memory      = 0.80 * b;
      const learning    = 0.10 * (embedding[i] || 0);
      const exploration = 0.15 * (i < 2 ? [grad.x, grad.y][i] : 0) * (flux / 3);
      const sync        = coupling * (meanBelief[i] - b);
      const obsCurve    = curvatureContrib * Math.sign(meanBelief[i] - b);
      return Math.max(-1, Math.min(1, memory + learning + exploration + sync + obsCurve + noise[i]));
    });

    this.pos.x = Math.max(-2, Math.min(2, this.pos.x + grad.x * 0.05));
    this.pos.y = Math.max(-2, Math.min(2, this.pos.y + grad.y * 0.05));

    this.history.push([...this.belief]);
    if (this.history.length > this.maxHistory) this.history.shift();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 4: SWARM — Emergent Metrics + Phase Detection
// ═══════════════════════════════════════════════════════════════════════════

class SwarmDynamics {
  private window: SwarmMetrics[] = [];
  private windowSize = 200;

  computeMetrics(agents: Agent[], lambda_t: number): SwarmMetrics {
    const N = agents.length;

    // Variance Coherence (C)
    const beliefVars = Array(8).fill(0).map((_, dim) => {
      const vals = agents.map(a => a.belief[dim]);
      const mean = vals.reduce((a, b) => a + b, 0) / N;
      return vals.reduce((s, v) => s + (v - mean) ** 2, 0) / N;
    });
    const avgVar = beliefVars.reduce((a, b) => a + b, 0) / 8;
    const coherence = Math.max(0, Math.min(1, 1 - avgVar));

    // Structural Coherence (S) — mean pairwise cosine similarity
    let S = 0;
    if (N > 1) {
      let pairCount = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          if (i === j) continue;
          const bi = agents[i].belief, bj = agents[j].belief;
          const dot = bi.reduce((s, v, d) => s + v * bj[d], 0);
          const magI = Math.sqrt(bi.reduce((s, v) => s + v * v, 0));
          const magJ = Math.sqrt(bj.reduce((s, v) => s + v * v, 0));
          if (magI > 0 && magJ > 0) { S += dot / (magI * magJ); pairCount++; }
        }
      }
      S = pairCount > 0 ? S / pairCount : 0;
    }

    const entropy = Math.sqrt(avgVar);
    const prevC = this.window.length > 0 ? this.window[this.window.length - 1].coherence : coherence;
    const divergence = Math.abs(coherence - prevC);

    let curvature = 0;
    if (this.window.length >= 2) {
      const c0 = this.window[this.window.length - 2].coherence;
      curvature = Math.abs(coherence - 2 * prevC + c0);
    }

    // Phase detection — four phases including ignition
    let phase: SwarmMetrics['phase'] = 'stable';
    if (this.window.length >= 25) {
      const recent = this.window.slice(-25);
      const oldMean = recent.slice(0, 12).reduce((s, m) => s + m.coherence, 0) / 12;
      const newMean = recent.slice(12).reduce((s, m) => s + m.coherence, 0) / 13;
      const oldS = recent.slice(0, 12).reduce((s, m) => s + m.structuralCoherence, 0) / 12;
      const newS = recent.slice(12).reduce((s, m) => s + m.structuralCoherence, 0) / 13;
      const change = newMean - oldMean;
      const sChange = newS - oldS;

      // Ignition: rapid simultaneous rise in both C and S — curvature cascade
      if (change > 0.25 && sChange > 0.20) phase = 'ignition';
      else if (change > 0.12) phase = 'emerging';
      else if (change < -0.12) phase = 'decaying';
    }

    const metrics: SwarmMetrics = { coherence, structuralCoherence: S, entropy, divergence, curvature, lambda_t, phase };
    this.window.push(metrics);
    if (this.window.length > this.windowSize) this.window.shift();
    return metrics;
  }

  getHistory(): SwarmMetrics[] { return [...this.window]; }
  
  getCoherenceGradient(): number {
    if (this.window.length < 3) return 0;
    const n = this.window.length;
    return this.window[n - 1].coherence - this.window[n - 3].coherence;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════════════════

const AGENT_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e91e63','#ff9800'];

class BeliefPlasmaEngine {
  private flux = new SyntheticFlux();
  private field = new GradientField();
  private agents: BeliefAgentImpl[];
  private swarm = new SwarmDynamics();
  private config: EngineConfig;
  private step = 0;
  private shocks: Array<{ step: number; flux: number }> = [];
  private shockHistory: Array<{ t: number; magnitude: number }> = [];

  constructor(cfg: EngineConfig) {
    this.config = cfg;
    this.agents = Array.from({ length: cfg.agentCount }, (_, i) =>
      new BeliefAgentImpl(`A${i}`, AGENT_COLORS[i % AGENT_COLORS.length])
    );
  }

  private computeLambdaT(): number {
    const now = this.step;
    const { tauH, kappa, lambda0 } = this.config;
    const H = this.shockHistory.reduce((sum, s) => sum + s.magnitude * Math.exp(-(now - s.t) / tauH), 0);
    return lambda0 + kappa * H;
  }

  tick(): SimulationSnapshot {
    for (let t = 0; t < this.config.timeScale; t++) {
      const f = this.flux.getFlux();
      if (f > 10) {
        this.shocks.push({ step: this.step, flux: f });
        this.shockHistory.push({ t: this.step, magnitude: (f - 10) / 15 });
        if (this.shocks.length > 20) this.shocks.shift();
        // Prune old shock history (older than 5 * tauH)
        this.shockHistory = this.shockHistory.filter(s => (this.step - s.t) < 5 * this.config.tauH);
      }

      const lambda_t = this.computeLambdaT();
      const cohGradient = this.swarm.getCoherenceGradient();

      const meanBelief = Array(8).fill(0).map((_, i) =>
        this.agents.reduce((s, a) => s + a.belief[i], 0) / this.agents.length
      );
      const embedding = Array(8).fill(0).map(() => (Math.random() - 0.5) * 0.1);

      this.agents.forEach(a =>
        a.update(this.field, f, meanBelief, this.config.coupling, embedding, lambda_t, cohGradient)
      );
      this.step++;
    }

    const lambda_t = this.computeLambdaT();
    const metrics = this.swarm.computeMetrics(this.agents, lambda_t);

    return {
      step: this.step,
      agents: this.agents.map(a => ({ ...a, belief: [...a.belief], pos: { ...a.pos }, history: [] })),
      metrics,
      flux: this.flux.getFlux(),
      shocks: [...this.shocks],
      terrain: this.field.getGrid()
    };
  }

  getHistory() { return this.swarm.getHistory(); }
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════

function usePlasmaEngine(config: EngineConfig) {
  const engineRef = useRef<BeliefPlasmaEngine | null>(null);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null);
  const [history, setHistory] = useState<SwarmMetrics[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>(['Observer-Curved Swarm System initialized. Manifold ready.']);

  useEffect(() => { engineRef.current = new BeliefPlasmaEngine(config); }, []);

  useEffect(() => {
    if (!isRunning || !engineRef.current) return;
    let rafId: number;
    let lastLog = 0;

    const loop = () => {
      const snap = engineRef.current!.tick();
      setSnapshot(snap);
      setHistory(engineRef.current!.getHistory());

      const now = Date.now();
      if (now - lastLog > 800) {
        const { phase, coherence, structuralCoherence, lambda_t } = snap.metrics;
        if (phase === 'ignition') {
          setLogs(p => [`t=${snap.step} 🔥 IGNITION CASCADE — C=${coherence.toFixed(3)} S=${structuralCoherence.toFixed(3)} λ=${lambda_t.toFixed(3)}`, ...p.slice(0, 12)]);
          lastLog = now;
        } else if (snap.shocks.length && snap.shocks[snap.shocks.length - 1].step === snap.step - 1) {
          setLogs(p => [`t=${snap.step} ⚡ Conceptual shock — flux=${snap.shocks[snap.shocks.length-1].flux} λ→${lambda_t.toFixed(3)}`, ...p.slice(0, 12)]);
          lastLog = now;
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(rafId);
  }, [isRunning]);

  const toggle = useCallback(() => setIsRunning(r => !r), []);
  const reset = useCallback(() => {
    engineRef.current = new BeliefPlasmaEngine(config);
    setSnapshot(null);
    setHistory([]);
    setLogs(['Observer-Curved Swarm System reset. Manifold reconfigured.']);
  }, [config]);

  return { snapshot, history, isRunning, toggle, reset, logs };
}

// ═══════════════════════════════════════════════════════════════════════════
// UI: TERRAIN HEATMAP
// ═══════════════════════════════════════════════════════════════════════════

const TerrainHeatmap: React.FC<{ terrain: number[][]; agents: Agent[] }> = ({ terrain, agents }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !terrain.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    const cW = W / terrain[0].length, cH = H / terrain.length;

    ctx.fillStyle = '#020205';
    ctx.fillRect(0, 0, W, H);

    for (let y = 0; y < terrain.length; y++) {
      for (let x = 0; x < terrain[y].length; x++) {
        const v = terrain[y][x];
        const n = (v + 1.4) / 2.8;
        ctx.fillStyle = `hsl(${220 + n * 60}, 70%, ${10 + n * 20}%)`;
        ctx.fillRect(x * cW, y * cH, cW + 1, cH + 1);
      }
    }

    agents.forEach(agent => {
      const px = ((agent.pos.x + 2) / 4) * W;
      const py = ((agent.pos.y + 2) / 4) * H;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = agent.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + agent.belief[0] * 20, py + agent.belief[1] * 20);
      ctx.strokeStyle = agent.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }, [terrain, agents]);

  return (
    <canvas ref={canvasRef} width={280} height={280}
      style={{ border: '1px solid #1a1a3a', borderRadius: 4, background: '#020205', width: '100%', height: 'auto' }} />
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// UI: METRICS PANEL (C + S + entropy + divergence)
// ═══════════════════════════════════════════════════════════════════════════

const MetricsPanel: React.FC<{ history: SwarmMetrics[] }> = ({ history }) => {
  const data = history.slice(-150).map((m, i) => ({
    i,
    C: +m.coherence.toFixed(3),
    S: +m.structuralCoherence.toFixed(3),
    entropy: +m.entropy.toFixed(3),
    div: +(m.divergence * 5).toFixed(3)
  }));

  return (
    <div style={{ height: 190, background: '#050510', borderRadius: 4, padding: '6px 0' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00ff88" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4488ff" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#4488ff" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ff4444" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#ff4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis domain={[-1, 1]} hide />
          <Tooltip contentStyle={{ background: '#0a0a1a', border: '1px solid #222', fontSize: 10 }} />
          <Area type="monotone" dataKey="C" stroke="#00ff88" fill="url(#gC)" strokeWidth={2} dot={false} name="C (variance)" />
          <Area type="monotone" dataKey="S" stroke="#4488ff" fill="url(#gS)" strokeWidth={2} dot={false} name="S (structural)" />
          <Area type="monotone" dataKey="entropy" stroke="#ff4444" fill="url(#gE)" strokeWidth={1.5} dot={false} name="Entropy" />
          <Line type="monotone" dataKey="div" stroke="#ffee44" strokeWidth={1} dot={false} name="Divergence×5" />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 9, color: '#555', marginTop: 3, padding: '0 8px' }}>
        <span style={{ color: '#00ff88' }}>● C</span>
        <span style={{ color: '#4488ff' }}>● S</span>
        <span style={{ color: '#ff4444' }}>● Entropy</span>
        <span style={{ color: '#ffee44' }}>● Div×5</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// UI: HYSTERESIS MONITOR (λ_t over time)
// ═══════════════════════════════════════════════════════════════════════════

const HysteresisMonitor: React.FC<{ history: SwarmMetrics[]; lambda0: number }> = ({ history, lambda0 }) => {
  const data = history.slice(-150).map((m, i) => ({ i, lambda_t: +m.lambda_t.toFixed(4) }));

  return (
    <div style={{ height: 120, background: '#050510', borderRadius: 4, padding: '6px 0' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <XAxis dataKey="i" hide />
          <YAxis domain={[lambda0 * 0.9, 'auto']} hide />
          <Tooltip contentStyle={{ background: '#0a0a1a', border: '1px solid #222', fontSize: 10 }} />
          <Line type="monotone" dataKey="lambda_t" stroke="#cc88ff" strokeWidth={2} dot={false} name="λ_t" />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ textAlign: 'center', fontSize: 9, color: '#7744aa', marginTop: 2 }}>
        λ_t = λ₀ + κ·H(t) — Hysteresis Memory
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// UI: PHASE SPACE
// ═══════════════════════════════════════════════════════════════════════════

const PhaseSpace: React.FC<{ agents: Agent[] }> = ({ agents }) => (
  <div style={{ height: 190, background: '#050510', borderRadius: 4, padding: '6px 0' }}>
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
        <XAxis type="number" dataKey="x" domain={[-1, 1]} hide />
        <YAxis type="number" dataKey="y" domain={[-1, 1]} hide />
        <ZAxis type="number" dataKey="z" range={[60, 200]} />
        {agents.map((a, i) => (
          <Scatter key={a.id}
            data={[{ x: a.belief[0], y: a.belief[1], z: 100 }]}
            fill={a.color}
            name={a.id}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
    <div style={{ textAlign: 'center', fontSize: 9, color: '#444', marginTop: 2 }}>
      Phase Space — belief[0] × belief[1] (curved manifold)
    </div>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

const PHASE_COLOR = { stable: '#4488ff', emerging: '#00ff88', decaying: '#ff4444', ignition: '#ff88ff' };

export default function BeliefPlasmaDashboard() {
  const [coupling, setCoupling] = useState(0.05);
  const [lambda0, setLambda0] = useState(0.10);
  const [agentCount, setAgentCount] = useState(5);
  const [deltaZero, setDeltaZero] = useState(false);

  const config = useMemo<EngineConfig>(() => ({
    agentCount,
    coupling: deltaZero ? 0 : coupling,
    lambda0,
    kappa: 0.5,
    tauH: 30,
    timeScale: 1
  }), [agentCount, coupling, lambda0, deltaZero]);

  const { snapshot, history, isRunning, toggle, reset, logs } = usePlasmaEngine(config);
  const m = snapshot?.metrics;

  return (
    <div style={{ background: '#020205', color: '#ccc', minHeight: '100vh', fontFamily: '"Courier New", monospace', padding: 16, boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <h1 style={{ color: '#00ffff', margin: '0 0 2px', fontSize: 20, textShadow: '0 0 18px rgba(0,255,255,0.35)', letterSpacing: 2 }}>
          ⛪ BELIEF PLASMA — OCSS v2.0
        </h1>
        <div style={{ color: '#445577', fontSize: 10, letterSpacing: 1 }}>
          Observer-Curved Swarm Systems · First Instance · Verdant Neuro Research
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 12 }}>
        <button onClick={toggle} style={{
          padding: '8px 18px', fontFamily: 'monospace', fontSize: 13,
          background: isRunning ? '#2a1a1a' : '#0a2a2a',
          color: isRunning ? '#ff6666' : '#66ffaa',
          border: `1px solid ${isRunning ? '#ff4444' : '#44ff88'}`,
          borderRadius: 4, cursor: 'pointer'
        }}>
          {isRunning ? '⏸ PAUSE' : '▶ IGNITE'}
        </button>
        <button onClick={reset} style={{
          padding: '8px 14px', fontFamily: 'monospace', fontSize: 13,
          background: '#1a1a2a', color: '#8888ff', border: '1px solid #333a6a', borderRadius: 4, cursor: 'pointer'
        }}>↺ RESET</button>

        {/* Sliders */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <label style={{ fontSize: 10, color: '#666' }}>
            δ={deltaZero ? '0 (exp)' : coupling.toFixed(2)}
            <input type="range" min={0.01} max={0.15} step={0.01} value={coupling}
              onChange={e => setCoupling(+e.target.value)}
              style={{ width: 70, marginLeft: 6 }} />
          </label>
          <label style={{ fontSize: 10, color: '#cc88ff' }}>
            λ₀={lambda0.toFixed(2)}
            <input type="range" min={0} max={0.20} step={0.01} value={lambda0}
              onChange={e => setLambda0(+e.target.value)}
              style={{ width: 70, marginLeft: 6 }} />
          </label>
          <label style={{ fontSize: 10, color: '#aaaaff' }}>
            N={agentCount}
            <input type="range" min={2} max={12} step={1} value={agentCount}
              onChange={e => setAgentCount(+e.target.value)}
              style={{ width: 60, marginLeft: 6 }} />
          </label>
          <label style={{ fontSize: 10, color: '#ff9944', cursor: 'pointer' }}>
            <input type="checkbox" checked={deltaZero} onChange={e => setDeltaZero(e.target.checked)}
              style={{ marginRight: 4 }} />
            δ=0 experiment
          </label>
        </div>
      </div>

      {/* Status Bar */}
      {m && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center',
          background: '#070712', padding: '8px 12px', borderRadius: 4,
          marginBottom: 14, fontSize: 11, border: '1px solid #1a1a2a'
        }}>
          <span>t=<b style={{ color: '#00ffff' }}>{snapshot!.step}</b></span>
          <span>flux=<b style={{ color: snapshot!.flux > 10 ? '#ff4444' : '#ffaa44' }}>{snapshot!.flux}</b></span>
          <span>C=<b style={{ color: '#00ff88' }}>{m.coherence.toFixed(3)}</b></span>
          <span>S=<b style={{ color: '#4488ff' }}>{m.structuralCoherence.toFixed(3)}</b></span>
          <span>λ_t=<b style={{ color: '#cc88ff' }}>{m.lambda_t.toFixed(3)}</b></span>
          <span>Phase=<b style={{ color: PHASE_COLOR[m.phase] }}>{m.phase.toUpperCase()}</b></span>
          {deltaZero && <span style={{ color: '#ff9944' }}>⚗ δ=0 MODE</span>}
        </div>
      )}

      {/* C vs S consensus alert */}
      {m && m.coherence > 0.7 && m.structuralCoherence < 0.3 && (
        <div style={{ background: 'rgba(255,100,0,0.12)', border: '1px solid #ff6600', borderRadius: 4, padding: '6px 12px', marginBottom: 10, fontSize: 10, color: '#ff8844', textAlign: 'center' }}>
          ⚠ FALSE CONSENSUS — High variance coherence (C={m.coherence.toFixed(2)}) but low structural alignment (S={m.structuralCoherence.toFixed(2)})
        </div>
      )}

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, maxWidth: 1100, margin: '0 auto' }}>

        {/* Terrain */}
        <div style={{ background: '#0a0a15', padding: 12, borderRadius: 8, border: '1px solid #1a1a2a' }}>
          <div style={{ color: '#4488ff', fontSize: 11, marginBottom: 8, letterSpacing: 1 }}>LAYER 2 · FIELD</div>
          {snapshot && <TerrainHeatmap terrain={snapshot.terrain} agents={snapshot.agents} />}
          <div style={{ fontSize: 8, color: '#333', marginTop: 4 }}>M(x,y) = sin(3x)cos(2y) + 0.4·sin(5√(x²+y²))</div>
        </div>

        {/* Metrics */}
        <div style={{ background: '#0a0a15', padding: 12, borderRadius: 8, border: '1px solid #1a1a2a' }}>
          <div style={{ color: '#aa44ff', fontSize: 11, marginBottom: 8, letterSpacing: 1 }}>LAYER 4 · SWARM METRICS</div>
          <MetricsPanel history={history} />
          <div style={{ marginTop: 10 }}>
            <div style={{ color: '#7744aa', fontSize: 11, marginBottom: 6, letterSpacing: 1 }}>HYSTERESIS MONITOR — λ_t</div>
            <HysteresisMonitor history={history} lambda0={lambda0} />
          </div>
        </div>

        {/* Phase Space */}
        <div style={{ background: '#0a0a15', padding: 12, borderRadius: 8, border: '1px solid #1a1a2a' }}>
          <div style={{ color: '#44ff88', fontSize: 11, marginBottom: 8, letterSpacing: 1 }}>LAYER 3 · PHASE SPACE</div>
          {snapshot && <PhaseSpace agents={snapshot.agents} />}
          <div style={{ marginTop: 10 }}>
            <div style={{ color: '#ff6644', fontSize: 11, marginBottom: 6, letterSpacing: 1 }}>AGENT STATUS</div>
            <div style={{ maxHeight: 120, overflowY: 'auto' }}>
              {snapshot?.agents.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', borderBottom: '1px solid #111', fontSize: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                  <span style={{ color: '#666', width: 24 }}>{a.id}</span>
                  <span style={{ color: '#888' }}>({a.pos.x.toFixed(2)},{a.pos.y.toFixed(2)})</span>
                  <span style={{ color: '#555', marginLeft: 'auto' }}>|b|={Math.sqrt(a.belief.reduce((s, v) => s + v * v, 0)).toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Observance Log */}
      <div style={{ maxWidth: 1100, margin: '14px auto 0', background: '#070712', borderRadius: 6, border: '1px solid #1a1a2a', overflow: 'hidden' }}>
        <div style={{ padding: '7px 14px', background: '#040408', borderBottom: '1px solid #1a1a2a', fontSize: 10, color: '#00ffff', letterSpacing: 2 }}>
          OBSERVANCE LOG
        </div>
        <div style={{ maxHeight: 120, overflowY: 'auto', padding: 10 }}>
          {logs.map((log, i) => (
            <div key={i} style={{ fontSize: 10, color: i === 0 ? '#ccc' : '#444', marginBottom: 3 }}>{log}</div>
          ))}
        </div>
      </div>

      {/* Footer: Six-Term Equation */}
      <div style={{ textAlign: 'center', padding: '18px 0 8px', fontSize: 10, color: '#333', fontFamily: 'monospace' }}>
        <div style={{ marginBottom: 4 }}>
          b<sub>t+1</sub> = 0.80·b<sub>t</sub> + 0.10·e<sub>t</sub> + 0.15·∇M·(μ/3) + δ·(b̄−b<sub>t</sub>) + λ<sub>t</sub>|∇A|² + η
        </div>
        <div style={{ fontSize: 8, color: '#222' }}>
          Memory · Learning · Exploration · Synchronization · Observer Curvature · Noise
        </div>
        <div style={{ fontSize: 8, color: '#1a1a3a', marginTop: 6 }}>
          g_ij = δ_ij + λ·(∂A/∂b_i)(∂A/∂b_j) — Riemannian Belief Manifold · Verdant Neuro Research 2026
        </div>
      </div>
    </div>
  );
}
