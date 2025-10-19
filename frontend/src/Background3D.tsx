// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
import React, { Suspense, useMemo, useRef, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Float, Environment, Stars, Sparkles, MeshDistortMaterial, Text, Line, Grid, CameraShake } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing'
import * as THREE from 'three'

function SpinningKnot(props: JSX.IntrinsicElements['mesh'] & { color?: string }) {
  const ref = useRef<THREE.Mesh>(null!)
  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (ref.current) {
      ref.current.rotation.x = t * 0.25
      ref.current.rotation.y = t * 0.35
    }
  })
  return (
    <mesh ref={ref} {...props} castShadow>
      <torusKnotGeometry args={[1.1, 0.33, 128, 16]} />
      <meshStandardMaterial color={props.color || '#63b3ed'} metalness={0.6} roughness={0.2} />
    </mesh>
  )
}

function FloatingSpheres() {
  const positions = useMemo(() => {
    // Seeded randomness for stable positions
    // @ts-expect-error - seed is a mutable util in three
    THREE.MathUtils.seed = 42
    const arr: [number, number, number][] = []
    for (let i = 0; i < 16; i++) {
      arr.push([
        (THREE.MathUtils.seededRandom() - 0.5) * 10,
        (THREE.MathUtils.seededRandom() - 0.5) * 6,
        (THREE.MathUtils.seededRandom() - 0.5) * 8,
      ])
    }
    return arr
  }, [])

  return (
    <group>
      {positions.map((p, i) => (
        <Float key={i} speed={1 + (i % 3) * 0.4} rotationIntensity={0.4} floatIntensity={0.8}>
          <mesh position={p} castShadow>
            <sphereGeometry args={[0.25 + (i % 5) * 0.06, 32, 32]} />
            <meshStandardMaterial color={i % 2 ? '#c084fc' : '#60a5fa'} metalness={0.7} roughness={0.25} />
          </mesh>
        </Float>
      ))}
    </group>
  )
}

function ConstellationLines() {
  // Reproduce the same deterministic positions as FloatingSpheres to connect nearby points
  const points = useMemo(() => {
    // @ts-expect-error - seed is a mutable util in three
    THREE.MathUtils.seed = 42
    const arr: THREE.Vector3[] = []
    for (let i = 0; i < 16; i++) {
      arr.push(new THREE.Vector3(
        (THREE.MathUtils.seededRandom() - 0.5) * 10,
        (THREE.MathUtils.seededRandom() - 0.5) * 6,
        (THREE.MathUtils.seededRandom() - 0.5) * 8,
      ))
    }
    return arr
  }, [])

  const lines = useMemo(() => {
    const conns: Array<{ start: THREE.Vector3; end: THREE.Vector3; opacity: number }> = []
    const maxDist = 3.5
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = points[i].distanceTo(points[j])
        if (d < maxDist) {
          // Opacity fades with distance
          const opacity = THREE.MathUtils.mapLinear(d, 0, maxDist, 0.9, 0.15)
          conns.push({ start: points[i], end: points[j], opacity })
        }
      }
    }
    // Limit to avoid too many lines
    return conns.slice(0, 48)
  }, [points])

  return (
    <group>
      {lines.map((l, idx) => (
        <Line
          key={idx}
          points={[l.start, l.end]}
          color="#7dd3fc"
          lineWidth={1}
          transparent
          opacity={l.opacity}
          dashed={false}
        />
      ))}
    </group>
  )
}

function FloatingRings() {
  const positions = useMemo(() => {
    // deterministic placement
    // @ts-expect-error seed is a mutable util in three
    THREE.MathUtils.seed = 7
    const arr: Array<{ pos: [number, number, number]; rot: [number, number, number]; scale: number; color: string }> = []
    const palette = ['#6ee7b7', '#60a5fa', '#c084fc']
    for (let i = 0; i < 8; i++) {
      arr.push({
        pos: [
          (THREE.MathUtils.seededRandom() - 0.5) * 8,
          (THREE.MathUtils.seededRandom() - 0.2) * 4,
          (THREE.MathUtils.seededRandom() - 0.5) * 6,
        ],
        rot: [
          THREE.MathUtils.seededRandom() * Math.PI,
          THREE.MathUtils.seededRandom() * Math.PI,
          THREE.MathUtils.seededRandom() * Math.PI,
        ],
        scale: 0.4 + THREE.MathUtils.seededRandom() * 0.8,
        color: palette[i % palette.length],
      })
    }
    return arr
  }, [])

  return (
    <group>
      {positions.map((item, i) => (
        <Float key={i} speed={1 + (i % 4) * 0.25} rotationIntensity={0.3} floatIntensity={0.6}>
          <mesh position={item.pos} rotation={item.rot} scale={item.scale} castShadow>
            <torusGeometry args={[0.8, 0.03, 32, 96]} />
            <meshStandardMaterial color={item.color} metalness={0.4} roughness={0.3} emissive={item.color} emissiveIntensity={0.08} />
          </mesh>
        </Float>
      ))}
    </group>
  )
}

function EnergyOrb() {
  const meshRef = useRef<THREE.Mesh>(null!)
  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (meshRef.current) {
      meshRef.current.rotation.y = t * 0.2
    }
  })
  return (
    <mesh ref={meshRef} position={[0, -0.6, -1.2]} scale={2.2} castShadow>
      <sphereGeometry args={[0.8, 64, 64]} />
      {/* Distorted emissive orb */}
      <MeshDistortMaterial
        color="#1e293b"
        emissive="#60a5fa"
        emissiveIntensity={0.4}
        roughness={0.25}
        metalness={0.1}
        distort={0.35}
        speed={1.2}
      />
    </mesh>
  )
}

function EchoText() {
  // Floating 3D brand text
  return (
    <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.6}>
      <Text
        position={[0, 1.6, -0.6]}
        fontSize={0.6}
        letterSpacing={0.02}
        color="#e2e8f0"
        outlineWidth={0.007}
        outlineColor="#60a5fa"
        anchorX="center"
        anchorY="middle"
      >
        Echo
      </Text>
    </Float>
  )
}

function GroundGrid() {
  // Subtle floor grid for depth perception
  return (
    <group position={[0, -2.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <Grid
        args={[30, 30]}
        cellSize={0.6}
        cellThickness={0.6}
        sectionSize={3}
        sectionThickness={1.2}
        sectionColor="#1f3b64"
        cellColor="#172554"
        fadeDistance={30}
        fadeStrength={1}
        infiniteGrid
      />
    </group>
  )
}

function AuroraBackdrop() {
  // Two translucent distorted planes to simulate aurora/nebula glow
  return (
    <group>
      <mesh position={[0, 1.5, -6]} rotation={[0, 0, 0]} scale={[12, 6, 1]}>
        <planeGeometry args={[2, 1, 64, 64]} />
        <MeshDistortMaterial
          color="#0ea5e9"
          transparent
          opacity={0.25}
          emissive="#38bdf8"
          emissiveIntensity={0.2}
          roughness={0.8}
          metalness={0}
          distort={0.6}
          speed={0.6}
        />
      </mesh>
      <mesh position={[0.6, 1.0, -5.5]} rotation={[0, 0.3, 0]} scale={[10, 4.5, 1]}>
        <planeGeometry args={[2, 1, 64, 64]} />
        <MeshDistortMaterial
          color="#22c55e"
          transparent
          opacity={0.18}
          emissive="#34d399"
          emissiveIntensity={0.18}
          roughness={0.85}
          metalness={0}
          distort={0.45}
          speed={0.5}
        />
      </mesh>
    </group>
  )
}

function ParticleField() {
  // Lightweight GPU-friendly star dust using Points
  const points = useRef<THREE.Points>(null!)
  const { positions, colors } = useMemo(() => {
    const num = 800
    const pos = new Float32Array(num * 3)
    const cols = new Float32Array(num * 3)
    // @ts-expect-error - seed is mutable in three
    THREE.MathUtils.seed = 21
    for (let i = 0; i < num; i++) {
      const ix = i * 3
      pos[ix] = (THREE.MathUtils.seededRandom() - 0.5) * 24
      pos[ix + 1] = (THREE.MathUtils.seededRandom() - 0.5) * 14
      pos[ix + 2] = -4 - Math.random() * 8

      // blue-cyan-lilac gradient
      const t = Math.random()
      const c = new THREE.Color().setHSL(0.58 + 0.1 * t, 0.9, 0.6 + 0.2 * t)
      cols[ix] = c.r; cols[ix + 1] = c.g; cols[ix + 2] = c.b
    }
    return { positions: pos, colors: cols }
  }, [])

  useFrame((state) => {
    // slow rotation + subtle drift
    if (points.current) {
      const t = state.clock.getElapsedTime()
      points.current.rotation.y = t * 0.02
      points.current.rotation.x = Math.sin(t * 0.1) * 0.02
    }
  })

  return (
    <points ref={points} frustumCulled>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={colors.length / 3} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.035} vertexColors depthWrite={false} transparent opacity={0.7} />
    </points>
  )
}

type BgProps = {
  lowPower?: boolean
  onAutoLowPower?: (v: boolean) => void
}

function Background({ lowPower = false, onAutoLowPower }: BgProps) {
  const sceneRef = useRef<THREE.Group>(null!)
  // FPS monitor: when average FPS dips below threshold for a bit, trigger low power
  const fpsAvg = useRef<number>(60)
  const secAccum = useRef<number>(0)
  const framesAccum = useRef<number>(0)
  const lowCounter = useRef<number>(0)
  // Subtle parallax for the whole scene
  useFrame((state) => {
    if (!sceneRef.current) return
    const { mouse } = state
    const targetRotX = THREE.MathUtils.lerp(sceneRef.current.rotation.x, mouse.y * -0.08, 0.05)
    const targetRotY = THREE.MathUtils.lerp(sceneRef.current.rotation.y, mouse.x * 0.12, 0.05)
    sceneRef.current.rotation.x = targetRotX
    sceneRef.current.rotation.y = targetRotY

    // fps monitoring
    const dt = state.clock.getDelta()
    secAccum.current += dt
    framesAccum.current += 1
    if (secAccum.current >= 1) {
      const fps = framesAccum.current / secAccum.current
      fpsAvg.current = fpsAvg.current * 0.8 + fps * 0.2
      secAccum.current = 0
      framesAccum.current = 0

      if (!lowPower) {
        if (fpsAvg.current < 30) lowCounter.current++
        else lowCounter.current = Math.max(0, lowCounter.current - 1)
        if (lowCounter.current >= 3) {
          onAutoLowPower?.(true)
          lowCounter.current = 0
        }
      }
    }
  })
  return (
    <group ref={sceneRef}>
      {/* subtle gradient-like background via fog and background color */}
      <color attach="background" args={["#0b1020"]} />
      <fog attach="fog" args={["#0b1020", 10, 28]} />

      {/* subtle camera motion */}
      {!lowPower && (
        <CameraShake
          maxYaw={0.02}
          maxPitch={0.01}
          maxRoll={0.01}
          yawFrequency={0.25}
          pitchFrequency={0.2}
          rollFrequency={0.15}
        />
      )}

      {/* lights */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} castShadow />
      <hemisphereLight intensity={0.4} color={"#86c5ff"} groundColor={"#0b1020"} />

      {/* aurora/nebula backdrop behind everything */}
      <AuroraBackdrop />

      {/* main objects */}
      <group position={[0, 0.2, 0]}>
        <SpinningKnot position={[0, 0, 0]} color="#6ee7b7" />
        <EchoText />
        <FloatingSpheres />
        <ConstellationLines />
        <FloatingRings />
        <EnergyOrb />
      </group>

      {/* ground grid */}
      {!lowPower && <GroundGrid />}

      {/* parallax particle field for depth */}
      {!lowPower && <ParticleField />}

      {/* background star field and subtle sparkles */}
      <Stars radius={60} depth={40} count={lowPower ? 500 : 1200} factor={3} saturation={0} fade speed={0.4} />
      {!lowPower && (
        <Sparkles count={40} speed={0.6} opacity={0.6} scale={[12, 6, 8]} size={2} color="#93c5fd" />
      )}

      {/* nice soft environment lighting */}
      <Environment preset="city" />

      {/* allow camera orbit but keep it subtle; disabled pointer-events at wrapper */}
      <OrbitControls enablePan={false} enableZoom={false} maxPolarAngle={Math.PI * 0.9} />
    </group>
  )
}

export default function Background3D({ lowPower = false, onAutoLowPower }: { lowPower?: boolean; onAutoLowPower?: (v: boolean) => void }) {
  return (
    <div className="bg3d">
      <Canvas
        shadows
        dpr={lowPower ? [1, 1] : [1, 2]}
        camera={{ position: [0, 0.8, 6], fov: 50 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <Background lowPower={lowPower} onAutoLowPower={onAutoLowPower} />
          {/* postprocessing: subtle bloom, vignette and film noise */}
          {!lowPower && (
            <EffectComposer>
              <Bloom intensity={0.5} luminanceThreshold={0.2} luminanceSmoothing={0.85} mipmapBlur radius={0.6} />
              <Vignette eskil offset={0.25} darkness={0.28} />
              <Noise premultiply opacity={0.02} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
    </div>
  )
}
