import { useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { LessonNote } from "@pianolab/lesson-schema";
import type { NoteVisualState, TransportSnapshot } from "@pianolab/engine";
import { CanvasTexture, OrthographicCamera } from "three";
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
  HIT_Z,
  KEY_BOTTOM_Z,
  KEY_CENTER_Z,
  KEY_DEPTH,
  LOOK_Z,
  noteLength,
  noteStartZ,
} from "./roll";

export type KeyLight = "expected" | "correct" | "wrong";

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
  for (const name of PITCH_NAMES) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = "#e4f57a";
    roundRect(ctx, 6, 28, 116, 72, 36);
    ctx.fill();
    ctx.fillStyle = "#14532d";
    ctx.font = name.length > 1 ? "700 42px system-ui, sans-serif" : "700 56px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 64, 66);
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    textures[name] = texture;
  }
  return textures;
}

function noteColor(state: NoteVisualState, flashed: boolean): string {
  if (flashed) {
    return "#f05353";
  }
  switch (state) {
    case "hit":
      return "#3dd68c";
    case "wrong":
      return "#f05353";
    case "missed":
      return "#6b7280";
    case "waiting":
    case "due":
      return "#f5c542";
    default:
      return "#3ecf6a";
  }
}

function CameraRig() {
  useFrame(({ camera, size }) => {
    const cam = camera as OrthographicCamera;
    const aspect = size.width / Math.max(1, size.height);
    cam.position.set(0, 18, LOOK_Z);
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, LOOK_Z);
    const halfW = keyboardWidth() * 0.52;
    const height = (halfW * 2) / aspect;
    const keyboardScreenY = KEY_BOTTOM_Z - LOOK_Z;
    cam.left = -halfW;
    cam.right = halfW;
    cam.bottom = keyboardScreenY - 0.55;
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
  const length = noteLength(note);
  const endZ = startZ + length;
  if (endZ < KEY_BOTTOM_Z || startZ > 24) {
    return null;
  }
  const visibleStart = startZ;
  const visibleLength = length;
  const x = keyX(note.midi);
  const color = noteColor(state, flashed);
  const black = isBlackKey(note.midi);
  const width = black ? WHITE_WIDTH * 0.55 : WHITE_WIDTH * 0.86;
  const labelW = black ? 0.13 : 0.155;
  return (
    <group position={[x, 0.28, visibleStart + visibleLength / 2]}>
      <mesh>
        <boxGeometry args={[width, 0.1, visibleLength]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
      </mesh>
      {texture ? (
        <mesh
          position={[0, 0.07, -visibleLength / 2 + Math.min(0.09, visibleLength * 0.4)]}
          rotation={[-Math.PI / 2, 0, Math.PI]}
        >
          <planeGeometry args={[labelW, labelW]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function keyTint(midi: number, light: KeyLight | undefined): string {
  if (light === "correct") {
    return isBlackKey(midi) ? "#16a34a" : "#4ade80";
  }
  if (light === "wrong") {
    return isBlackKey(midi) ? "#dc2626" : "#f87171";
  }
  if (light === "expected") {
    return isBlackKey(midi) ? "#ca8a04" : "#fde047";
  }
  return isBlackKey(midi) ? "#111827" : "#e8eaed";
}

function Keyboard({
  keyLights,
  onPlayKey,
}: {
  keyLights: Record<number, KeyLight>;
  onPlayKey?: (midi: number) => void;
}) {
  const keys = useMemo(() => {
    const list: number[] = [];
    for (let midi = LOWEST_MIDI; midi <= HIGHEST_MIDI; midi++) {
      list.push(midi);
    }
    return list;
  }, []);

  const play = (midi: number) => {
    onPlayKey?.(midi);
  };

  return (
    <group>
      {keys
        .filter((midi) => !isBlackKey(midi))
        .map((midi) => (
          <mesh
            key={midi}
            position={[keyX(midi), 0, KEY_CENTER_Z]}
            onPointerDown={(event) => {
              event.stopPropagation();
              play(midi);
            }}
          >
            <boxGeometry args={[WHITE_WIDTH * 0.94, 0.14, KEY_DEPTH]} />
            <meshStandardMaterial
              color={keyTint(midi, keyLights[midi])}
              roughness={0.45}
              emissive={keyLights[midi] ? keyTint(midi, keyLights[midi]) : "#000000"}
              emissiveIntensity={keyLights[midi] ? 0.35 : 0}
            />
          </mesh>
        ))}
      {keys
        .filter((midi) => isBlackKey(midi))
        .map((midi) => (
          <mesh
            key={midi}
            position={[keyX(midi), 0.08, HIT_Z - 0.38]}
            onPointerDown={(event) => {
              event.stopPropagation();
              play(midi);
            }}
          >
            <boxGeometry args={[WHITE_WIDTH * 0.55, 0.16, 0.68]} />
            <meshStandardMaterial
              color={keyTint(midi, keyLights[midi])}
              roughness={0.3}
              emissive={keyLights[midi] ? keyTint(midi, keyLights[midi]) : "#000000"}
              emissiveIntensity={keyLights[midi] ? 0.45 : 0}
            />
          </mesh>
        ))}
      <mesh position={[0, 0.09, HIT_Z]}>
        <boxGeometry args={[keyboardWidth(), 0.02, 0.045]} />
        <meshBasicMaterial color="#f5c542" />
      </mesh>
    </group>
  );
}

function SceneContents({
  notes,
  snapshot,
  keyLights,
  onPlayKey,
}: {
  notes: LessonNote[];
  snapshot: TransportSnapshot;
  keyLights: Record<number, KeyLight>;
  onPlayKey?: (midi: number) => void;
}) {
  const textures = useMemo(() => noteNameTextures(), []);
  return (
    <>
      <color attach="background" args={["#12141c"]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[0, 16, 4]} intensity={1.15} />
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
      <Keyboard keyLights={keyLights} onPlayKey={onPlayKey} />
    </>
  );
}

export function PianoScene({
  notes,
  snapshot,
  keyLights,
  onPlayKey,
}: {
  notes: LessonNote[];
  snapshot: TransportSnapshot;
  keyLights: Record<number, KeyLight>;
  onPlayKey?: (midi: number) => void;
}) {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 18, LOOK_Z], near: 0.1, far: 40, zoom: 1 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <SceneContents notes={notes} snapshot={snapshot} keyLights={keyLights} onPlayKey={onPlayKey} />
    </Canvas>
  );
}
