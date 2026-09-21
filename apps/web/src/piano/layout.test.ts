import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HIGHEST_MIDI,
  LOWEST_MIDI,
  WHITE_WIDTH,
  isBlackKey,
  keyScreenX,
  keyX,
} from "./layout";

test("screen order is bass left, treble right (not mirrored)", () => {
  assert.ok(keyScreenX(LOWEST_MIDI) < keyScreenX(HIGHEST_MIDI));
  assert.ok(keyX(LOWEST_MIDI) > keyX(HIGHEST_MIDI));
  for (let midi = LOWEST_MIDI; midi < HIGHEST_MIDI; midi++) {
    assert.ok(
      keyScreenX(midi) < keyScreenX(midi + 1),
      `midi ${midi} should sit left of ${midi + 1} on screen`,
    );
  }
});

test("black keys sit in the gap, not on the previous white", () => {
  const pairs = [
    [60, 61, 62],
    [62, 63, 64],
    [65, 66, 67],
    [67, 68, 69],
    [69, 70, 71],
  ];
  for (const [left, black, right] of pairs) {
    assert.equal(isBlackKey(black), true);
    const mid = (keyScreenX(left) + keyScreenX(right)) / 2;
    assert.ok(Math.abs(keyScreenX(black) - mid) < WHITE_WIDTH * 0.02);
  }
});
