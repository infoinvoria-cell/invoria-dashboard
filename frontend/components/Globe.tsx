"use client";

import { OrbitControls, Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { Color } from "three";

type GlobeMarker = {
  id: string;
  lat: number;
  lng: number;
  color?: string;
};

type GlobeProps = {
  markers: GlobeMarker[];
};

function latLngToPosition(lat: number, lng: number, radius: number) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return [x, y, z] as const;
}

export default function Globe({ markers }: GlobeProps) {
  const markerData = useMemo(
    () =>
      markers
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
        .slice(0, 120)
        .map((item) => ({
          id: item.id,
          position: latLngToPosition(item.lat, item.lng, 1.03),
          color: new Color(item.color || "#4d87fe"),
        })),
    [markers],
  );

  return (
    <div className="globe-wrap">
      <Canvas camera={{ position: [0, 0, 2.45], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 1, 1]} intensity={1.05} color="#8fb8ff" />
        <pointLight position={[-2, -1.2, -1]} intensity={0.45} color="#2962ff" />

        <mesh>
          <sphereGeometry args={[1, 80, 80]} />
          <meshStandardMaterial color="#071a3d" metalness={0.2} roughness={0.75} />
        </mesh>

        <mesh>
          <sphereGeometry args={[1.01, 80, 80]} />
          <meshStandardMaterial color="#1d5cff" transparent opacity={0.07} emissive="#2962ff" emissiveIntensity={0.2} />
        </mesh>

        {markerData.map((marker) => (
          <mesh key={marker.id} position={marker.position}>
            <sphereGeometry args={[0.018, 12, 12]} />
            <meshStandardMaterial color={marker.color} emissive={marker.color} emissiveIntensity={0.65} />
          </mesh>
        ))}

        <Stars radius={16} depth={30} count={1200} factor={2.2} saturation={0} fade speed={0.45} />
        <OrbitControls enablePan={false} autoRotate autoRotateSpeed={0.4} minDistance={1.8} maxDistance={3.2} />
      </Canvas>
    </div>
  );
}
