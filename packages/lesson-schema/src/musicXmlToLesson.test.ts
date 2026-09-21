import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { musicXmlFromBytes } from "./mxl";
import { creditComposer, musicXmlToLesson } from "./musicXmlToLesson";
import { parseXml, textOf } from "./xmlLite";

const FIXTURE = `<?xml version="1.0"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise>
  <credit page="1"><credit-words>Fixture Tune</credit-words></credit>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <direction>
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome></direction-type>
        <sound tempo="80"/>
      </direction>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration>
        <staff>1</staff>
        <lyric><text>Ma</text></lyric>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration>
        <staff>1</staff>
      </note>
      <backup><duration>2</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>2</duration>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

test("xmlLite reads nested text", () => {
  const doc = parseXml("<root><a>hi</a></root>");
  assert.equal(textOf(doc, "a"), "hi");
});

test("musicXmlToLesson keeps both staves and maps midi/tempo", () => {
  const lesson = musicXmlToLesson(FIXTURE, {
    id: "fixture-hands",
    title: "Fixture",
    composer: "Test",
    phraseBars: 4,
  });
  assert.equal(lesson.defaultTempo, 80);
  assert.equal(lesson.difficulty, "beginner");
  assert.deepEqual(lesson.timeSignature, [4, 4]);
  assert.equal(lesson.notes.length, 3);
  assert.deepEqual(
    lesson.notes.map((note) => ({ midi: note.midi, beat: note.beat, durationBeats: note.durationBeats, hand: note.hand })),
    [
      { midi: 64, beat: 0, durationBeats: 1, hand: "right" },
      { midi: 48, beat: 0, durationBeats: 2, hand: "left" },
      { midi: 62, beat: 1, durationBeats: 1, hand: "right" },
    ],
  );
  assert.equal(lesson.notes[0]?.lyric, "Ma");
  assert.equal(lesson.notes[0]?.finger, 3);
  assert.equal(lesson.notes[1]?.finger, 5);
});

test("hands melody drops the bass staff", () => {
  const lesson = musicXmlToLesson(FIXTURE, {
    id: "melody-only",
    title: "Melody",
    composer: "Test",
    hands: "melody",
  });
  assert.equal(lesson.notes.length, 2);
  assert.ok(lesson.notes.every((note) => note.hand === "right"));
});

test("creditComposer prefers identification creator", () => {
  const xml = `<?xml version="1.0"?><score-partwise>
    <identification><creator type="composer">Beethoven</creator></identification>
    <part id="P1"><measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part>
  </score-partwise>`;
  assert.equal(creditComposer(xml), "Beethoven");
});

test("musicXmlFromBytes reads an MXL zip", () => {
  const packed = zipSync({
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>`,
    ),
    "score.xml": strToU8(FIXTURE),
  });
  const xml = musicXmlFromBytes(packed);
  assert.match(xml, /<score-partwise>/);
});
