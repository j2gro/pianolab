---
id: "mic-reports-note-an-octave-low-2026-09-22"
status: "review"
priority: "critical"
assignee: null
dueDate: null
created: "2026-09-22T01:50:00.000Z"
modified: "2026-09-22T02:05:00.000Z"
completedAt: null
labels: ["bug"]
order: "a16"
---

# Mic reports a note an octave low

Playing E4 is reported as E3, and notes go missing because a reading an octave low is a wrong note under strict matching.

Cause: the octave correction in `fundamentalOf` searched sub-multiples of the detected frequency and accepted one on periodicity plus energy at a single non-shared partial. Periodicity cannot reject a sub-octave, because a signal that repeats at T repeats at 2T as well, so the only guard was that single energy probe at -30dB. A sympathetic string or room noise near E3 clears that easily.

The blind search is the wrong shape for this problem: a sub-octave's harmonic series always contains the real note's series, so nothing in the signal can rule it out on its own. The app knows which note it is waiting for, so resolve the octave against that hypothesis instead of searching.

Acceptance:

- A played E4 reports E4, with no sub-octave search in the detector.
- With C4 expected and YIN locked onto C5, C4 is still reported, but only when several of C4's own partials are in the signal.
- An isolated C5 or G5 is still not reported as an expected C4.
- Without an expected note, a weak-fundamental note may read an octave high. That is a display nit and is preferred over inventing notes an octave low; practice modes always supply the expected note.
