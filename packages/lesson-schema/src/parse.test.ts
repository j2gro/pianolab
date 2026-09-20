import assert from "node:assert/strict";
import { test } from "node:test";
import { FULL_SONG_ID, notesForPhrase, notesForScope, twinkleLesson } from "./index";

test("Twinkle validates and phrases cover the full melody", () => {
  assert.equal(twinkleLesson.id, "twinkle-c-major");
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
