import { useEffect, useMemo, useState } from "react";
import {
  FULL_SONG_ID,
  lessons,
  type LessonProgress,
} from "@pianolab/lesson-schema";
import type { PracticeMode } from "@pianolab/engine";
import { getProgress, getToken, me, putProgress, setToken } from "./api";
import { AuthView } from "./views/AuthView";
import { PracticeView } from "./views/PracticeView";

type Screen = "auth" | "practice";

function lessonById(id: string) {
  return lessons.find((item) => item.id === id) ?? lessons[0]!;
}

function App() {
  const [lessonId, setLessonId] = useState(lessons[0]!.id);
  const lesson = lessonById(lessonId);
  const [screen, setScreen] = useState<Screen>(getToken() ? "practice" : "auth");
  const [email, setEmail] = useState<string>("");
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [phraseId, setPhraseId] = useState(FULL_SONG_ID);
  const [mode, setMode] = useState<PracticeMode>("wait");
  const [tempo, setTempo] = useState(lesson.defaultTempo);
  const [bootError, setBootError] = useState<string | null>(null);

  const applyProgress = (nextLessonId: string, next: LessonProgress | null) => {
    setProgress(next);
    const catalog = lessonById(nextLessonId);
    setTempo(next?.tempo ?? catalog.defaultTempo);
    const last = next?.lastPhraseId;
    if (last && (last === FULL_SONG_ID || catalog.phrases.some((phrase) => phrase.id === last))) {
      setPhraseId(last);
    } else {
      setPhraseId(FULL_SONG_ID);
    }
  };

  useEffect(() => {
    if (!getToken()) {
      return;
    }
    void (async () => {
      try {
        const profile = await me();
        setEmail(profile.email);
        const result = await getProgress(lessonId);
        applyProgress(lessonId, result.progress);
        setScreen("practice");
      } catch {
        setToken(null);
        setScreen("auth");
        setBootError("Session expired. Sign in again.");
      }
    })();
  }, []);

  const persist = (next: LessonProgress) => {
    setProgress(next);
    void putProgress(next);
  };

  const completed = useMemo(() => progress?.completedPhraseIds ?? [], [progress]);

  const saveSession = (nextPhraseId: string, nextTempo: number) => {
    persist({
      lessonId: lesson.id,
      hits: progress?.hits ?? 0,
      wrongs: progress?.wrongs ?? 0,
      waitsMs: progress?.waitsMs ?? [],
      completedPhraseIds: progress?.completedPhraseIds ?? [],
      tempo: nextTempo,
      lastPhraseId: nextPhraseId,
    });
  };

  return (
    <>
      {screen === "auth" ? (
        <AuthView
          onAuthed={(nextEmail) => {
            setEmail(nextEmail);
            setBootError(null);
            void getProgress(lesson.id).then((result) => {
              applyProgress(lesson.id, result.progress);
              setMode("wait");
              setScreen("practice");
            });
          }}
        />
      ) : null}
      {screen === "practice" ? (
        <PracticeView
          key={`${lesson.id}:${phraseId}`}
          lesson={lesson}
          lessons={lessons}
          progressCompleted={completed}
          email={email}
          phraseId={phraseId}
          mode={mode}
          tempo={tempo}
          onLesson={(id) => {
            setLessonId(id);
            setProgress(null);
            void getProgress(id).then((result) => {
              applyProgress(id, result.progress);
            });
          }}
          onPhrase={(id) => {
            setPhraseId(id);
            saveSession(id, tempo);
          }}
          onMode={setMode}
          onTempo={(next) => {
            setTempo(next);
            saveSession(phraseId, next);
          }}
          onSignOut={() => {
            setToken(null);
            setProgress(null);
            setPhraseId(FULL_SONG_ID);
            setMode("wait");
            setScreen("auth");
          }}
          onComplete={(stats) => {
            const completedIds = new Set(progress?.completedPhraseIds ?? []);
            if (mode === "wait") {
              if (phraseId === FULL_SONG_ID) {
                for (const phrase of lesson.phrases) {
                  completedIds.add(phrase.id);
                }
              } else {
                completedIds.add(phraseId);
              }
            }
            persist({
              lessonId: lesson.id,
              hits: (progress?.hits ?? 0) + stats.hits,
              wrongs: (progress?.wrongs ?? 0) + stats.wrongs,
              waitsMs: [...(progress?.waitsMs ?? []), ...stats.waitsMs],
              completedPhraseIds: [...completedIds],
              tempo,
              lastPhraseId: phraseId,
            });
          }}
        />
      ) : null}
      {bootError && screen === "auth" ? <p className="error banner">{bootError}</p> : null}
    </>
  );
}

export default App;
