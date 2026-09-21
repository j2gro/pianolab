import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIFFICULTY_RANK,
  FULL_SONG_ID,
  goldenLesson,
  goldenSimplifiedLesson,
  lessons,
  maryHadALittleLambLesson,
  maryHadALittleLambTwoHandsLesson,
  notesForPhrase,
  notesForScope,
  twinkleLesson,
} from "./index";

test("Twinkle validates and phrases cover the full melody", () => {
  assert.equal(twinkleLesson.id, "twinkle-c-major");
  assert.equal(twinkleLesson.difficulty, "beginner");
  assert.equal(twinkleLesson.notes.length, 42);
  assert.equal(twinkleLesson.phrases.length, 6);

  const covered = twinkleLesson.phrases.flatMap((phrase) => phrase.noteIds);
  assert.equal(covered.length, twinkleLesson.notes.length);
  assert.deepEqual([...new Set(covered)].sort(), twinkleLesson.notes.map((n) => n.id).sort());

  const phrase1 = notesForPhrase(twinkleLesson, "p1");
  assert.deepEqual(
    phrase1.map((n) => n.midi),
    [60, 60, 67, 67, 69, 69, 67],
  );

  const whole = notesForScope(twinkleLesson, FULL_SONG_ID);
  assert.equal(whole.length, twinkleLesson.notes.length);
  assert.equal(whole[0]?.id, "n01");
  assert.equal(whole.at(-1)?.id, "n42");
});

test("Mary Had a Little Lamb validates and is in the catalog", () => {
  assert.equal(maryHadALittleLambLesson.id, "mary-had-a-little-lamb-c-major");
  assert.equal(maryHadALittleLambLesson.notes.length, 25);
  assert.equal(maryHadALittleLambLesson.phrases.length, 5);
  assert.deepEqual(
    notesForPhrase(maryHadALittleLambLesson, "p1").map((n) => n.midi),
    [64, 62, 60, 62, 64, 64, 64],
  );
  const covered = maryHadALittleLambLesson.phrases.flatMap((phrase) => phrase.noteIds);
  assert.equal(covered.length, maryHadALittleLambLesson.notes.length);
  assert.ok(lessons.length >= 5);
  assert.ok(lessons.some((item) => item.id === maryHadALittleLambLesson.id));
});

test("Mary two-hands arrangement is in the catalog", () => {
  assert.equal(maryHadALittleLambTwoHandsLesson.id, "mary-had-a-little-lamb-two-hands");
  assert.ok(maryHadALittleLambTwoHandsLesson.notes.some((note) => note.hand === "left"));
  assert.ok(maryHadALittleLambTwoHandsLesson.notes.some((note) => note.hand === "right"));
  assert.equal(maryHadALittleLambTwoHandsLesson.difficulty, "beginner");
  assert.ok(lessons.some((item) => item.id === maryHadALittleLambTwoHandsLesson.id));
});

test("Golden is an intermediate catalog song", () => {
  assert.equal(goldenLesson.id, "golden-k-pop-demon-hunters");
  assert.equal(goldenLesson.difficulty, "intermediate");
  assert.ok(goldenLesson.notes.length > 0);
  assert.ok(lessons.some((item) => item.id === goldenLesson.id));
  const ranks = lessons.map((item) => DIFFICULTY_RANK[item.difficulty]);
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b),
  );
});

test("Golden simplified is a beginner catalog song", () => {
  assert.equal(goldenSimplifiedLesson.id, "golden-kpop-demon-hunters-simplified");
  assert.equal(goldenSimplifiedLesson.difficulty, "beginner");
  assert.ok(goldenSimplifiedLesson.notes.length > 0);
  assert.ok(goldenSimplifiedLesson.notes.length < goldenLesson.notes.length);
  assert.ok(lessons.some((item) => item.id === goldenSimplifiedLesson.id));
});
