// The home page's 3D hero: a glass shield guarding a BTC coin, with USDC coins in orbit. Plain three.js through
// react-three-fiber, no external models or HDR files: the reflections come from three's built-in RoomEnvironment.
import { Canvas, useFrame, useThree, type ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type Props = { theme: "light" | "dark"; active: boolean; still: boolean };

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function shieldShape(k = 1) {
  const s = new THREE.Shape();
  s.moveTo(0, 1.55 * k);
  s.bezierCurveTo(0.5 * k, 1.28 * k, 0.95 * k, 1.2 * k, 1.3 * k, 1.14 * k);
  s.lineTo(1.3 * k, 0.15 * k);
  s.bezierCurveTo(1.3 * k, -0.78 * k, 0.72 * k, -1.36 * k, 0, -1.72 * k);
  s.bezierCurveTo(-0.72 * k, -1.36 * k, -1.3 * k, -0.78 * k, -1.3 * k, 0.15 * k);
  s.lineTo(-1.3 * k, 1.14 * k);
  s.bezierCurveTo(-0.95 * k, 1.2 * k, -0.5 * k, 1.28 * k, 0, 1.55 * k);
  return s;
}

/** A coin face drawn on a canvas: a glyph on a radial gradient. */
function coinTexture(glyph: string, from: string, to: string, glyphColor: string) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return undefined;
  const grad = g.createRadialGradient(size * 0.38, size * 0.32, size * 0.05, size / 2, size / 2, size / 2);
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 34, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = glyphColor;
  g.font = `700 ${size * 0.5}px "Space Grotesk Variable", "Inter Variable", system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(glyph, size / 2, size / 2 + size * 0.02);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function Coin({ radius, glyph, edge, from, to, spin = 0.6, ...props }: { radius: number; glyph: string; edge: string; from: string; to: string; spin?: number } & ThreeElements["group"]) {
  const ref = useRef<THREE.Group>(null);
  const tex = useMemo(() => coinTexture(glyph, from, to, "#ffffff"), [glyph, from, to]);
  useEffect(() => () => tex?.dispose(), [tex]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * spin;
  });
  const t = radius * 0.2;
  return (
    <group {...props}>
      <group ref={ref}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[radius, radius, t, 64]} />
          <meshStandardMaterial color={edge} metalness={0.85} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0, t / 2 + 0.002]}>
          <circleGeometry args={[radius * 0.94, 64]} />
          <meshStandardMaterial map={tex} metalness={0.55} roughness={0.32} />
        </mesh>
        <mesh position={[0, 0, -t / 2 - 0.002]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[radius * 0.94, 64]} />
          <meshStandardMaterial map={tex} metalness={0.55} roughness={0.32} />
        </mesh>
      </group>
    </group>
  );
}

function Shield({ theme }: { theme: Props["theme"] }) {
  const glass = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shieldShape(0.9), { depth: 0.2, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 10, curveSegments: 64 });
    g.center();
    return g;
  }, []);
  const rim = useMemo(() => {
    const outer = shieldShape(1);
    const hole = new THREE.Path(shieldShape(0.9).getPoints(96));
    outer.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(outer, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 6, curveSegments: 64 });
    g.center();
    return g;
  }, []);
  useEffect(
    () => () => {
      glass.dispose();
      rim.dispose();
    },
    [glass, rim],
  );
  const dark = theme === "dark";
  return (
    <group>
      <mesh geometry={rim}>
        <meshPhysicalMaterial color={dark ? "#aab8ff" : "#4a63f5"} metalness={1} roughness={0.2} clearcoat={1} clearcoatRoughness={0.1} envMapIntensity={1.4} />
      </mesh>
      <mesh geometry={glass} renderOrder={2}>
        <meshPhysicalMaterial
          color={dark ? "#7d93ff" : "#8aa0ff"}
          metalness={0.05}
          roughness={0.06}
          transparent
          opacity={dark ? 0.34 : 0.4}
          depthWrite={false}
          clearcoat={1}
          clearcoatRoughness={0.04}
          iridescence={1}
          iridescenceIOR={1.35}
          envMapIntensity={1.6}
        />
      </mesh>
    </group>
  );
}

function Particles({ theme }: { theme: Props["theme"] }) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 2.6 + Math.random() * 2.4;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.7;
      pos[i * 3 + 2] = r * Math.cos(ph) - 1.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.03;
  });
  const dark = theme === "dark";
  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial size={0.028} sizeAttenuation color={dark ? "#9fb0ff" : "#4f63e8"} transparent opacity={dark ? 0.75 : 0.5} depthWrite={false} blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending} />
    </points>
  );
}

function Orbit({ theme }: { theme: Props["theme"] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.35;
  });
  const ringColor = theme === "dark" ? "#7f95ff" : "#4a63f5";
  const coins = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  return (
    <group rotation={[1.2, 0.15, -0.25]}>
      <mesh>
        <torusGeometry args={[2.3, 0.006, 8, 240]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.55} />
      </mesh>
      <group ref={ref}>
        {coins.map((a, i) => (
          <group key={i} position={[Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3]} rotation={[-1.2, 0, 0]}>
            <Coin radius={0.24} glyph="$" edge="#2775ca" from="#4c9bff" to="#1d5fb8" spin={1.4 + i * 0.3} />
          </group>
        ))}
      </group>
    </group>
  );
}

function Rig({ children, still }: { children: ReactNode; still: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g || still) return;
    const t = state.clock.elapsedTime;
    const targetY = Math.sin(t * 0.35) * 0.35 + state.pointer.x * 0.35;
    const targetX = -state.pointer.y * 0.22 + Math.sin(t * 0.5) * 0.04;
    g.rotation.y += (targetY - g.rotation.y) * 0.05;
    g.rotation.x += (targetX - g.rotation.x) * 0.05;
    g.position.y = Math.sin(t * 0.9) * 0.08;
  });
  return <group ref={ref}>{children}</group>;
}

export default function HeroScene({ theme, active, still }: Props) {
  const dark = theme === "dark";
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 7.4], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      frameloop={active && !still ? "always" : "demand"}
      aria-hidden="true"
    >
      <Environment />
      <ambientLight intensity={dark ? 0.35 : 0.8} />
      <directionalLight position={[3, 4, 5]} intensity={dark ? 2.2 : 1.6} />
      <pointLight position={[-4, 1, -2]} intensity={dark ? 40 : 18} color="#8b5cf6" />
      <pointLight position={[0, -0.2, 1.2]} intensity={dark ? 3 : 2} color="#f7931a" distance={4} />
      <Rig still={still}>
        <Shield theme={theme} />
        <Coin radius={0.62} glyph="₿" edge="#e8850f" from="#ffb547" to="#e57a00" spin={still ? 0 : 0.7} position={[0, 0.05, -0.05]} />
        <Orbit theme={theme} />
      </Rig>
      <Particles theme={theme} />
    </Canvas>
  );
}
