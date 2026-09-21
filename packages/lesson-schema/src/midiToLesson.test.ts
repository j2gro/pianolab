import assert from "node:assert/strict";
import { test } from "node:test";
import { Midi } from "./midiLib";
import { parseImportArgs, slugFromPath } from "./import-midi";
import { listMidiTracks, midiToLesson } from "./midiToLesson";

function fixtureMidi(): Midi {
  const midi = new Midi();
  midi.header.setTempo(80);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  midi.header.update();
  const ppq = midi.header.ppq;
  const melody = midi.addTrack();
  melody.name = "Melody";
  melody.addNote({ midi: 60, ticks: 0, durationTicks: ppq });
  melody.addNote({ midi: 64, ticks: ppq, durationTicks: ppq });
  melody.addNote({ midi: 67, ticks: ppq * 2, durationTicks: ppq * 2 });
  const extra = midi.addTrack();
  extra.name = "Unused";
  extra.addNote({ midi: 48, ticks: 0, durationTicks: ppq });
  return midi;
}

test("maps ticks to beats, tempo, and time signature", () => {
  const lesson = midiToLesson(fixtureMidi(), {
    id: "fixture",
    title: "Fixture",
    composer: "Test",
    track: 0,
  });
  assert.equal(lesson.defaultTempo, 80);
  assert.deepEqual(lesson.timeSignature, [4, 4]);
  assert.deepEqual(
    lesson.notes.map((note) => ({ midi: note.midi, beat: note.beat, durationBeats: note.durationBeats })),
    [
      { midi: 60, beat: 0, durationBeats: 1 },
      { midi: 64, beat: 1, durationBeats: 1 },
      { midi: 67, beat: 2, durationBeats: 2 },
    ],
  );
  assert.equal(lesson.notes[0]?.finger, 1);
  assert.equal(lesson.notes[2]?.finger, 5);
});

test("collapses overlapping notes to the highest pitch by default", () => {
  const midi = new Midi();
  midi.header.setTempo(100);
  const track = midi.addTrack();
  const ppq = midi.header.ppq;
  track.addNote({ midi: 60, ticks: 0, durationTicks: ppq });
  track.addNote({ midi: 67, ticks: 0, durationTicks: ppq });
  const lesson = midiToLesson(midi, {
    id: "chord",
    title: "Chord",
    composer: "Test",
  });
  assert.equal(lesson.notes.length, 1);
  assert.equal(lesson.notes[0]?.midi, 67);
});

test("overlap first keeps file order", () => {
  const midi = new Midi();
  const track = midi.addTrack();
  const ppq = midi.header.ppq;
  track.addNote({ midi: 60, ticks: 0, durationTicks: ppq });
  track.addNote({ midi: 67, ticks: 0, durationTicks: ppq });
  const lesson = midiToLesson(midi, {
    id: "first",
    title: "First",
    composer: "Test",
    overlap: "first",
  });
  assert.equal(lesson.notes[0]?.midi, 60);
});

test("phrases split on long rests and cover every note", () => {
  const midi = new Midi();
  const track = midi.addTrack();
  const ppq = midi.header.ppq;
  track.addNote({ midi: 60, ticks: 0, durationTicks: ppq });
  track.addNote({ midi: 62, ticks: ppq * 8, durationTicks: ppq });
  const lesson = midiToLesson(midi, {
    id: "rests",
    title: "Rests",
    composer: "Test",
    phraseBars: 8,
  });
  assert.equal(lesson.phrases.length, 2);
  const covered = lesson.phrases.flatMap((phrase) => phrase.noteIds);
  assert.deepEqual(covered, lesson.notes.map((note) => note.id));
});

test("phrases split every N bars when the melody is continuous", () => {
  const midi = new Midi();
  const track = midi.addTrack();
  const ppq = midi.header.ppq;
  for (let beat = 0; beat < 8; beat++) {
    track.addNote({ midi: 60, ticks: beat * ppq, durationTicks: ppq });
  }
  const lesson = midiToLesson(midi, {
    id: "bars",
    title: "Bars",
    composer: "Test",
    phraseBars: 1,
  });
  assert.equal(lesson.notes.length, 8);
  assert.equal(lesson.phrases.length, 2);
  assert.equal(lesson.phrases[0]?.noteIds.length, 4);
  assert.equal(lesson.phrases[1]?.noteIds.length, 4);
});

test("listMidiTracks reports note counts", () => {
  const tracks = listMidiTracks(fixtureMidi());
  assert.equal(tracks[0]?.noteCount, 3);
  assert.equal(tracks[0]?.name, "Melody");
  assert.equal(tracks[1]?.noteCount, 1);
});

test("CLI args parse list-tracks and import flags", () => {
  const listed = parseImportArgs(["song.mid", "--list-tracks"]);
  assert.equal(listed.file, "song.mid");
  assert.equal(listed.flags.listTracks, true);

  const imported = parseImportArgs([
    "C:\\tmp\\Ode To Joy.mid",
    "--track",
    "0",
    "--grid",
    "16",
    "--phrase-bars",
    "4",
    "--overlap",
    "lowest",
    "--out",
    "out.json",
  ]);
  assert.equal(imported.flags.track, 0);
  assert.equal(imported.flags.overlap, "lowest");
  assert.equal(imported.flags.out, "out.json");
  assert.equal(slugFromPath("C:\\tmp\\Ode To Joy.mid"), "ode-to-joy");

  const xml = parseImportArgs(["song.mxl", "--hands", "melody", "--difficulty", "intermediate"]);
  assert.equal(xml.flags.hands, "melody");
  assert.equal(xml.flags.difficulty, "intermediate");
});
