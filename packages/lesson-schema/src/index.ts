import twinkleJson from "./lessons/twinkle.json" with { type: "json" };
import { parseLesson } from "./parse";

export const twinkleLesson = parseLesson(twinkleJson);

export {
  LESSON_SCHEMA_VERSION,
  type Finger,
  type Hand,
  type Lesson,
  type LessonId,
  type LessonNote,
  type LessonPhrase,
  type LessonProgress,
} from "./types";

export {
  FULL_SONG_ID,
  LessonParseError,
  notesForPhrase,
  notesForScope,
  parseLesson,
  remapPhraseToZero,
} from "./parse";
