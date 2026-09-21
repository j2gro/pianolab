import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { LessonNote } from "@pianolab/lesson-schema";
import type { NoteVisualState, TransportSnapshot } from "@pianolab/engine";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  ExtrudeGeometry,
  LinearFilter,
  OrthographicCamera,
  SRGBColorSpace,
  Shape,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
} from "three";
import {
  HIGHEST_MIDI,
  LOWEST_MIDI,
  PITCH_NAMES,
  WHITE_WIDTH,
  isBlackKey,
  keyX,
  keyboardWidth,
  pitchClassName,
} from "./layout";
import {
  BLACK_KEY_DEPTH,
  EAT_Z,
  HIT_Z,
  KEY_BOTTOM_PAD,
  KEY_BOTTOM_Z,
  KEY_CENTER_Z,
  KEY_DEPTH,
  LOOK_Z,
  noteLength,
  noteStartZ,
} from "./roll";

export type KeyLight = "expected" | "correct" | "wrong";

const FLASH_SLOTS = 24;
const NOTE_THICK = 0.07;
const LABEL_ATLAS_REV = 2;
const noteGeomCache = new Map<string, ExtrudeGeometry>();

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function noteNameTextures(): Record<string, CanvasTexture> {
  const textures: Record<string, CanvasTexture> = {};
  const size = 256;
  for (const name of PITCH_NAMES) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(17, 24, 39, 0.92)";
    roundRect(ctx, 20, 64, 216, 128, 64);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = name.length > 1 ? "800 84px Arial, sans-serif" : "800 112px Arial, sans-serif";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(17, 24, 39, 0.95)";
    ctx.strokeText(name, size / 2, size / 2 + 6);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(name, size / 2, size / 2 + 6);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.needsUpdate = true;
    textures[name] = texture;
  }
  return textures;
}

function impactTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const cx = 64;
  const cy = 64;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 64);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.18, "rgba(255,255,255,0.85)");
  glow.addColorStop(0.42, "rgba(255,255,255,0.28)");
  glow.addColorStop(0.62, "rgba(255,255,255,0.08)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, 28, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function quantizeSize(value: number): number {
  return Math.max(0.02, Math.floor(value * 80) / 80);
}

function roundedBarGeometry(width: number, length: number, flatBottom = false): ExtrudeGeometry {
  const w = quantizeSize(width);
  const l = quantizeSize(length);
  const key = `${w}:${l}:${flatBottom ? "f" : "r"}`;
  const cached = noteGeomCache.get(key);
  if (cached) {
    return cached;
  }
  const radius = Math.min(w * 0.48, l * 0.48);
  const x = -w / 2;
  const y = -l / 2;
  const shape = new Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + w - radius, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + radius);
  if (flatBottom) {
    shape.lineTo(x + w, y + l);
    shape.lineTo(x, y + l);
  } else {
    shape.lineTo(x + w, y + l - radius);
    shape.quadraticCurveTo(x + w, y + l, x + w - radius, y + l);
    shape.lineTo(x + radius, y + l);
    shape.quadraticCurveTo(x, y + l, x, y + l - radius);
  }
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new ExtrudeGeometry(shape, {
    depth: NOTE_THICK,
    bevelEnabled: false,
    curveSegments: 12,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, NOTE_THICK / 2, 0);
  noteGeomCache.set(key, geometry);
  return geometry;
}

const PITCH_COLORS = [
  "#ff4d6d",
  "#ff8a3d",
  "#ffc02e",
  "#d4e04a",
  "#5dff4a",
  "#2ee6b0",
  "#2ad4e8",
  "#3d9bff",
  "#7a5cff",
  "#c44dff",
  "#ff5ac8",
  "#ff6b8a",
];

function pitchColor(midi: number): string {
  return PITCH_COLORS[((midi % 12) + 12) % 12]!;
}

function noteColor(midi: number, state: NoteVisualState, flashed: boolean): string {
  if (flashed || state === "wrong") {
    return "#ff4a4a";
  }
  if (state === "missed") {
    return "#8b919c";
  }
  const color = pitchColor(midi);
  if (state === "waiting" || state === "due") {
    return color;
  }
  return color;
}

function keyTint(midi: number, light: KeyLight | undefined, pressed: boolean): string {
  if (light === "wrong") {
    return isBlackKey(midi) ? "#dc2626" : "#f87171";
  }
  if (light || pressed) {
    return pitchColor(midi);
  }
  return isBlackKey(midi) ? "#0b0f16" : "#f4f6fa";
}

function glowHex(midi: number, light: KeyLight | undefined, pressed: boolean): string {
  if (light === "wrong") {
    return "#ff5c5c";
  }
  if (light || pressed) {
    return pitchColor(midi);
  }
  return "#ffffff";
}

function CameraRig() {
  useFrame(({ camera, size }) => {
    const cam = camera as OrthographicCamera;
    const aspect = size.width / Math.max(1, size.height);
    cam.position.set(0, 18, LOOK_Z);
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, LOOK_Z);
    const halfW = keyboardWidth() * 0.52;
    const height = (halfW * 2) / Math.min(aspect, 1.22);
    const keyboardScreenY = KEY_BOTTOM_Z - LOOK_Z;
    cam.left = -halfW;
    cam.right = halfW;
    cam.bottom = keyboardScreenY - KEY_BOTTOM_PAD;
    cam.top = cam.bottom + height;
    cam.near = 0.1;
    cam.far = 40;
    cam.updateProjectionMatrix();
  });
  return null;
}

function FallingNote({
  note,
  beat,
  state,
  flashed,
  texture,
}: {
  note: LessonNote;
  beat: number;
  state: NoteVisualState;
  flashed: boolean;
  texture: CanvasTexture | undefined;
}) {
  const startZ = noteStartZ(note, beat);
  const fullLength = noteLength(note);
  const endZ = startZ + fullLength;
  if (endZ < EAT_Z || startZ > 24) {
    return null;
  }
  const visibleStart = Math.max(startZ, EAT_Z);
  const length = quantizeSize(endZ - visibleStart);
  if (visibleStart + length < EAT_Z + 0.02) {
    return null;
  }
  const x = keyX(note.midi);
  const color = noteColor(note.midi, state, flashed);
  const black = isBlackKey(note.midi);
  const width = black ? WHITE_WIDTH * 0.5 : WHITE_WIDTH * 0.78;
  const labelW = black ? 0.125 : 0.155;
  const eaten = startZ < EAT_Z;
  const atHit = startZ <= 0.18 && endZ >= EAT_Z;
  const body = roundedBarGeometry(width, length, eaten);
  const halo = roundedBarGeometry(width * 1.12, length + (eaten ? 0 : width * 0.12), eaten);
  const labelZ = -length / 2 + Math.min(Math.max(width * 0.55, 0.07), length * 0.45);
  const showLabel = Boolean(texture) && labelZ > -length / 2 + 0.04;
  return (
    <group position={[x, 0.2, visibleStart + length / 2]}>
      <mesh geometry={halo} renderOrder={0}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={atHit ? 0.28 : 0.12}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={body} renderOrder={1}>
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {showLabel ? (
        <mesh
          position={[0, NOTE_THICK + 0.05, labelZ]}
          rotation={[-Math.PI / 2, 0, Math.PI]}
          renderOrder={4}
        >
          <planeGeometry args={[labelW, labelW]} />
          <meshBasicMaterial
            map={texture}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function PianoKey({
  midi,
  light,
  pressed,
  onPlay,
  onRelease,
}: {
  midi: number;
  light: KeyLight | undefined;
  pressed: boolean;
  onPlay?: (midi: number) => void;
  onRelease?: (midi: number) => void;
}) {
  const group = useRef<Group>(null);
  const amount = useRef(0);
  const black = isBlackKey(midi);
  const depth = black ? BLACK_KEY_DEPTH : KEY_DEPTH;
  const height = black ? 0.125 : 0.09;
  const width = black ? WHITE_WIDTH * 0.55 : WHITE_WIDTH * 0.94;
  const color = keyTint(midi, light, pressed);
  const glow = glowHex(midi, light, pressed);
  const lit = Boolean(light) || pressed;

  useFrame((_, dt) => {
    const target = pressed ? 1 : 0;
    amount.current += (target - amount.current) * Math.min(1, dt * (pressed ? 22 : 14));
    if (group.current) {
      group.current.scale.y = 1 - amount.current * 0.22;
    }
  });

  return (
    <group ref={group} position={[keyX(midi), 0, HIT_Z]}>
      <mesh
        position={[0, height / 2, -depth / 2]}
        onPointerDown={(event) => {
          event.stopPropagation();
          onPlay?.(midi);
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          onRelease?.(midi);
        }}
        onPointerLeave={(event) => {
          if (event.buttons) {
            onRelease?.(midi);
          }
        }}
      >
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={color}
          roughness={black ? 0.38 : 0.48}
          metalness={0}
          emissive={lit ? glow : "#000000"}
          emissiveIntensity={pressed ? 0.7 : light ? 0.42 : 0}
        />
      </mesh>
      {lit ? (
        <mesh position={[0, height + 0.012, -depth / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[width * 0.98, depth * 0.92]} />
          <meshBasicMaterial
            color={glow}
            transparent
            opacity={pressed ? 0.55 : 0.32}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function Keyboard({
  keyLights,
  pressedMidis,
  onPlayKey,
  onReleaseKey,
}: {
  keyLights: Record<number, KeyLight>;
  pressedMidis: number[];
  onPlayKey?: (midi: number) => void;
  onReleaseKey?: (midi: number) => void;
}) {
  const keys = useMemo(() => {
    const list: number[] = [];
    for (let midi = LOWEST_MIDI; midi <= HIGHEST_MIDI; midi++) {
      list.push(midi);
    }
    return list;
  }, []);
  const pressed = useMemo(() => new Set(pressedMidis), [pressedMidis]);

  return (
    <group>
      <mesh position={[0, -0.045, KEY_CENTER_Z]}>
        <boxGeometry args={[keyboardWidth() + 0.1, 0.08, KEY_DEPTH + 0.16]} />
        <meshStandardMaterial color="#07090f" roughness={0.7} metalness={0.12} />
      </mesh>
      {keys
        .filter((midi) => !isBlackKey(midi))
        .map((midi) => (
          <PianoKey
            key={midi}
            midi={midi}
            light={keyLights[midi]}
            pressed={pressed.has(midi)}
            onPlay={onPlayKey}
            onRelease={onReleaseKey}
          />
        ))}
      {keys
        .filter((midi) => isBlackKey(midi))
        .map((midi) => (
          <PianoKey
            key={midi}
            midi={midi}
            light={keyLights[midi]}
            pressed={pressed.has(midi)}
            onPlay={onPlayKey}
            onRelease={onReleaseKey}
          />
        ))}
      <mesh position={[0, 0.11, HIT_Z]}>
        <boxGeometry args={[keyboardWidth(), 0.02, 0.045]} />
        <meshBasicMaterial color="#f5c542" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.16, HIT_Z]}>
        <boxGeometry args={[keyboardWidth(), 0.1, 0.14]} />
        <meshBasicMaterial
          color="#f5c542"
          transparent
          opacity={0.16}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function ContactOverlay({ midis }: { midis: number[] }) {
  const texture = useMemo(() => impactTexture(), []);
  const flashRefs = useRef<(Mesh | null)[]>([]);
  const seen = useRef(new Set<number>());
  const slots = useRef({
    midi: new Int16Array(FLASH_SLOTS).fill(-1),
    born: new Float32Array(FLASH_SLOTS),
    cursor: 0,
  });

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const active = new Set(midis);
    for (const midi of active) {
      if (seen.current.has(midi)) {
        continue;
      }
      seen.current.add(midi);
      const i = slots.current.cursor;
      slots.current.cursor = (i + 1) % FLASH_SLOTS;
      slots.current.midi[i] = midi;
      slots.current.born[i] = now;
    }
    for (const midi of [...seen.current]) {
      if (!active.has(midi)) {
        seen.current.delete(midi);
      }
    }
    for (let i = 0; i < FLASH_SLOTS; i++) {
      const mesh = flashRefs.current[i];
      if (!mesh) {
        continue;
      }
      const midi = slots.current.midi[i];
      const age = now - slots.current.born[i];
      const mat = mesh.material as MeshBasicMaterial;
      if (midi < 0 || age > 0.42) {
        mesh.visible = false;
        continue;
      }
      const u = age / 0.42;
      mesh.visible = true;
      mesh.position.set(keyX(midi), 0.2, HIT_Z + 0.01);
      const size = WHITE_WIDTH * (1.2 + u * 1.9);
      mesh.scale.set(size, size, 1);
      mat.color.set(pitchColor(midi));
      mat.opacity = (1 - u) * (1 - u) * 0.95;
    }
  });

  return (
    <group>
      {midis.map((midi) => (
        <mesh
          key={midi}
          position={[keyX(midi), 0.19, HIT_Z + 0.01]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={5}
        >
          <planeGeometry args={[WHITE_WIDTH * 1.4, WHITE_WIDTH * 1.15]} />
          <meshBasicMaterial
            map={texture}
            color={pitchColor(midi)}
            transparent
            opacity={0.58}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {Array.from({ length: FLASH_SLOTS }, (_, i) => (
        <mesh
          key={`flash-${i}`}
          ref={(node) => {
            flashRefs.current[i] = node;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
          renderOrder={7}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={0}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function SceneContents({
  notes,
  snapshot,
  keyLights,
  pressedMidis,
  onPlayKey,
  onReleaseKey,
}: {
  notes: LessonNote[];
  snapshot: TransportSnapshot;
  keyLights: Record<number, KeyLight>;
  pressedMidis: number[];
  onPlayKey?: (midi: number) => void;
  onReleaseKey?: (midi: number) => void;
}) {
  const textures = useMemo(() => noteNameTextures(), [LABEL_ATLAS_REV]);
  return (
    <>
      <color attach="background" args={["#12141c"]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[0, 16, 4]} intensity={1.1} />
      <CameraRig />
      {notes.map((note) => (
        <FallingNote
          key={note.id}
          note={note}
          beat={snapshot.beat}
          state={snapshot.states[note.id] ?? "upcoming"}
          flashed={snapshot.wrongFlashIds.includes(note.id)}
          texture={textures[pitchClassName(note.midi)]}
        />
      ))}
      <Keyboard
        keyLights={keyLights}
        pressedMidis={pressedMidis}
        onPlayKey={onPlayKey}
        onReleaseKey={onReleaseKey}
      />
      <ContactOverlay midis={pressedMidis} />
    </>
  );
}

export function PianoScene({
  notes,
  snapshot,
  keyLights,
  pressedMidis,
  onPlayKey,
  onReleaseKey,
}: {
  notes: LessonNote[];
  snapshot: TransportSnapshot;
  keyLights: Record<number, KeyLight>;
  pressedMidis: number[];
  onPlayKey?: (midi: number) => void;
  onReleaseKey?: (midi: number) => void;
}) {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 18, LOOK_Z], near: 0.1, far: 40, zoom: 1 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ scene, gl }) => {
        gl.setClearColor("#12141c", 1);
        scene.background = new Color("#12141c");
      }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <SceneContents
        notes={notes}
        snapshot={snapshot}
        keyLights={keyLights}
        pressedMidis={pressedMidis}
        onPlayKey={onPlayKey}
        onReleaseKey={onReleaseKey}
      />
    </Canvas>
  );
}
