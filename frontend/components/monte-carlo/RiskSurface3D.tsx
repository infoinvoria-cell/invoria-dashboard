"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Info } from "lucide-react";
import * as THREE from "three";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, RiskSurfacePoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  points: RiskSurfacePoint[];
};

function SurfaceBars({ points, theme }: Props) {
  const palette = getMonteCarloPalette(theme);
  const scoreMin = Math.min(...points.map((item) => item.score));
  const scoreMax = Math.max(...points.map((item) => item.score));

  const colorScale = useMemo(() => {
    return (score: number) => {
      const ratio = scoreMax === scoreMin ? 0.5 : (score - scoreMin) / (scoreMax - scoreMin);
      return new THREE.Color().lerpColors(new THREE.Color(palette.surfaceLow), new THREE.Color(palette.surfaceHigh), ratio);
    };
  }, [palette.surfaceHigh, palette.surfaceLow, scoreMax, scoreMin]);

  return (
    <group position={[0, -1.2, 0]}>
      {points.map((point, index) => {
        const x = (point.drift + 0.02) * 22 - 2.2;
        const z = point.volatility * 10 - 2.3;
        const height = point.score / 28;
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

export default function RiskSurface3D({ theme, points }: Props) {
  const palette = getMonteCarloPalette(theme);

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="ivq-section-label">3D Risk Landscape</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Drift / volatility robustness surface
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="3D risk landscape illustrating expected return and tail risk sensitivity across drift and volatility assumptions.">
          <Info size={13} /> Three.js
        </span>
      </div>

      <div className="h-[320px] overflow-hidden rounded-[18px] border" style={{ borderColor: palette.border, background: theme === "dark" ? "rgba(10,8,6,0.55)" : "rgba(6,14,30,0.55)" }}>
        <Canvas camera={{ position: [6, 6, 8], fov: 42 }}>
          <ambientLight intensity={1.1} />
          <directionalLight position={[5, 8, 6]} intensity={1.8} />
          <SurfaceBars points={points} theme={theme} />
          <gridHelper args={[12, 12, palette.accent, palette.chartGrid]} position={[0, -1.2, 0]} />
          <OrbitControls enablePan={false} minDistance={5} maxDistance={14} />
        </Canvas>
      </div>
    </section>
  );
}
