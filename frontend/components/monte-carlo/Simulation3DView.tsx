"use client";

import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Info } from "lucide-react";
import * as THREE from "three";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, ParameterHeatmapPoint, RiskSurfacePoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  points: RiskSurfacePoint[];
  parameterSurface?: ParameterHeatmapPoint[];
  animationProgress: number;
};

type ViewMode = "risk" | "distribution" | "robustness" | "parameter";

function SurfaceMesh({
  points,
  parameterSurface,
  theme,
  mode,
  animationProgress,
}: Props & { mode: ViewMode }) {
  const palette = getMonteCarloPalette(theme);
  const activePoints = mode === "parameter" && parameterSurface?.length
    ? parameterSurface.map((item) => ({
        drift: item.xValue / 100,
        volatility: item.yValue / 100,
        score: item.robustness,
        expectedReturn: item.score / 100,
        cvar: item.drawdown,
      }))
    : points;
  const scoreMin = Math.min(...activePoints.map((item) => item.score));
  const scoreMax = Math.max(...activePoints.map((item) => item.score));

  const colorScale = useMemo(() => {
    return (score: number) => {
      const ratio = scoreMax === scoreMin ? 0.5 : (score - scoreMin) / (scoreMax - scoreMin);
      return new THREE.Color().lerpColors(new THREE.Color(palette.surfaceLow), new THREE.Color(palette.surfaceHigh), ratio);
    };
  }, [palette.surfaceHigh, palette.surfaceLow, scoreMax, scoreMin]);

  return (
    <group position={[0, -1.3, 0]}>
      {activePoints.map((point, index) => {
        const x = (point.drift + 0.02) * 22 - 2.2;
        const z = point.volatility * 10 - 2.3;
        const baseHeight =
          mode === "risk"
            ? point.score / 28
            : mode === "distribution"
              ? (point.expectedReturn * 14) + 1.4
              : mode === "parameter"
                ? point.score / 30
              : (100 - point.cvar * 220) / 28;
        const height = Math.max(0.2, baseHeight * Math.max(0.08, animationProgress));
        return (
          <mesh key={`${point.drift}-${point.volatility}-${index}`} position={[x, height / 2, z]}>
            <boxGeometry args={[0.62, height, 0.62]} />
            <meshStandardMaterial color={colorScale(point.score)} roughness={0.3} metalness={0.18} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function Simulation3DView({ theme, points, parameterSurface, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);
  const [mode, setMode] = useState<ViewMode>("risk");

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="ivq-section-label">3D Visualization Mode</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Risk surface, return landscape, robustness terrain
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="3D-Darstellung fuer Praesentationen: Risikooberflaeche, Return-Landschaft und Robustheits-Terrain.">
          <Info size={13} /> Three.js
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ["risk", "Risk Surface"],
          ["distribution", "Distribution Landscape"],
          ["robustness", "Robustness Terrain"],
          ["parameter", "Parameter Surface"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="ivq-segment-btn"
            onClick={() => setMode(value as ViewMode)}
            style={mode === value ? { borderColor: palette.accent, color: palette.heading } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="h-[320px] overflow-hidden rounded-[18px] border" style={{ borderColor: palette.border, background: theme === "dark" ? "rgba(10,8,6,0.55)" : "rgba(6,14,30,0.55)" }}>
        <Canvas camera={{ position: [6, 6, 8], fov: 42 }}>
          <ambientLight intensity={1.1} />
          <directionalLight position={[5, 8, 6]} intensity={1.8} />
          <SurfaceMesh points={points} parameterSurface={parameterSurface} theme={theme} mode={mode} animationProgress={animationProgress} />
          <gridHelper args={[12, 12, palette.accent, palette.chartGrid]} position={[0, -1.2, 0]} />
          <OrbitControls enablePan={false} minDistance={5} maxDistance={14} />
        </Canvas>
      </div>
    </section>
  );
}
