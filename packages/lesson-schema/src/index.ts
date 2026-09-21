import { catalogLessonJson } from "./catalog.generated";
import { parseLesson } from "./parse";
import { DIFFICULTY_RANK, type Lesson } from "./types";

export const lessons: Lesson[] = catalogLessonJson
  .map((json) => parseLesson(json))
  .sort(
    (a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] || a.title.localeCompare(b.title),
  );

function lessonById(id: string): Lesson {
  const lesson = lessons.find((item) => item.id === id);
  if (!lesson) {
    throw new Error(`missing catalog lesson ${id}`);
  }
  return lesson;
}

export const twinkleLesson = lessonById("twinkle-c-major");
export const maryHadALittleLambLesson = lessonById("mary-had-a-little-lamb-c-major");
export const maryHadALittleLambTwoHandsLesson = lessonById("mary-had-a-little-lamb-two-hands");
export const goldenLesson = lessonById("golden-k-pop-demon-hunters");
export const goldenSimplifiedLesson = lessonById("golden-kpop-demon-hunters-simplified");

export {
  DIFFICULTY_LABEL,
  DIFFICULTY_RANK,
  LESSON_SCHEMA_VERSION,
  type Difficulty,
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

export {
  formatTrackList,
  listMidiTracks,
  midiToLesson,
  type MidiImportOptions,
  type MidiLike,
  type MidiTrackInfo,
  type OverlapMode,
} from "./midiToLesson";

export {
  creditComposer,
  creditTitle,
  musicXmlToLesson,
  type HandsMode,
  type MusicXmlImportOptions,
} from "./musicXmlToLesson";
