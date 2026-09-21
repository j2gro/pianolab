import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { slugFromPath } from "./import-midi";
import { musicXmlFromBytes } from "./mxl";
import { creditComposer, creditTitle, musicXmlToLesson, type HandsMode } from "./musicXmlToLesson";
import type { Difficulty } from "./types";

export const DEFAULT_SHEET_MUSIC_DIR = "C:\\sheet_music";

export type IngestFlags = {
  help: boolean;
  dryRun: boolean;
  force: boolean;
  dir: string;
  lessonsDir: string;
  catalogPath: string;
  difficulty?: Difficulty;
  hands?: HandsMode;
};

export type LibraryLesson = {
  id: string;
  title: string;
  file: string;
};

export type IngestDecision =
  | { file: string; slug: string; action: "import" }
  | { file: string; slug: string; action: "skip"; reason: string };

export function ingestUsage(): string {
  return `Usage: npm run lesson:ingest-mxl -- [options]

  Scan a folder for .mxl scores that are not yet lesson JSON and add them
  to packages/lesson-schema/src/lessons/ plus the generated catalog.

  --dir PATH             Folder to scan (default: C:\\sheet_music)
  --lessons-dir PATH     Lesson JSON directory
  --catalog PATH         Generated catalog module path
  --difficulty beginner  beginner | intermediate | advanced
  --hands both           both | melody | left
  --force                Re-import even when the slug or title already exists
  --dry-run              Print actions without writing files
  --help`;
}

export function parseIngestArgs(argv: string[], defaults: { lessonsDir: string; catalogPath: string }): IngestFlags {
  const flags: IngestFlags = {
    help: false,
    dryRun: false,
    force: false,
    dir: DEFAULT_SHEET_MUSIC_DIR,
    lessonsDir: defaults.lessonsDir,
    catalogPath: defaults.catalogPath,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      flags.force = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    index += 1;
    if (key === "dir") {
      flags.dir = value;
    } else if (key === "lessons-dir") {
      flags.lessonsDir = value;
    } else if (key === "catalog") {
      flags.catalogPath = value;
    } else if (key === "difficulty") {
      if (value !== "beginner" && value !== "intermediate" && value !== "advanced") {
        throw new Error("--difficulty must be beginner, intermediate, or advanced");
      }
      flags.difficulty = value;
    } else if (key === "hands") {
      if (value !== "both" && value !== "melody" && value !== "left") {
        throw new Error("--hands must be both, melody, or left");
      }
      flags.hands = value;
    } else {
      throw new Error(`unknown flag --${key}`);
    }
  }

  return flags;
}

export function listMxlFiles(dir: string): string[] {
  const found: string[] = [];
  walk(dir, found);
  return found.sort((a, b) => a.localeCompare(b));
}

function walk(dir: string, found: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error(`cannot read folder ${dir}`);
  }
  for (const name of entries) {
    if (name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, found);
    } else if (stat.isFile() && path.extname(name).toLowerCase() === ".mxl") {
      found.push(full);
    }
  }
}

export function listLibraryLessons(lessonsDir: string): LibraryLesson[] {
  let names: string[] = [];
  try {
    names = readdirSync(lessonsDir);
  } catch {
    return [];
  }
  const lessons: LibraryLesson[] = [];
  for (const name of names.filter((file) => file.toLowerCase().endsWith(".json")).sort()) {
    const file = path.join(lessonsDir, name);
    const raw = JSON.parse(readFileSync(file, "utf8")) as { id?: unknown; title?: unknown };
    if (typeof raw.id !== "string" || typeof raw.title !== "string") {
      throw new Error(`invalid lesson JSON ${file}`);
    }
    lessons.push({ id: raw.id, title: raw.title, file: name });
  }
  return lessons;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function decideMxlAction(
  file: string,
  xml: string,
  library: LibraryLesson[],
  force: boolean,
): IngestDecision {
  const slug = slugFromPath(file);
  if (force) {
    return { file, slug, action: "import" };
  }
  const byId = library.find((item) => item.id === slug);
  if (byId) {
    return { file, slug, action: "skip", reason: `id ${byId.id}` };
  }
  const byFile = library.find((item) => path.basename(item.file, ".json") === slug);
  if (byFile) {
    return { file, slug, action: "skip", reason: `file ${byFile.file}` };
  }
  const title = creditTitle(xml);
  if (title) {
    const key = normalizeTitle(title);
    const byTitle = library.find((item) => normalizeTitle(item.title) === key);
    if (byTitle) {
      return { file, slug, action: "skip", reason: `title "${byTitle.title}"` };
    }
  }
  return { file, slug, action: "import" };
}

export function jsonImportIdent(fileName: string, used: Set<string>): string {
  const base = fileName.replace(/\.json$/i, "");
  let ident = base.replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase()).replace(
    /[^a-zA-Z0-9]/g,
    "",
  );
  if (!ident || !/^[A-Za-z_]/.test(ident)) {
    ident = `lesson${ident}`;
  }
  ident = `${ident}Json`;
  let candidate = ident;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${ident}${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

export function generateCatalogModule(jsonFiles: string[]): string {
  const used = new Set<string>();
  const entries = jsonFiles.map((file) => ({ file, ident: jsonImportIdent(file, used) }));
  const imports = entries
    .map((entry) => `import ${entry.ident} from "./lessons/${entry.file}" with { type: "json" };`)
    .join("\n");
  const array = entries.map((entry) => `  ${entry.ident},`).join("\n");
  return `// Generated by ingest-mxl.ts. Do not edit by hand.\n\n${imports}\n\nexport const catalogLessonJson = [\n${array}\n] as const;\n`;
}

export function writeLessonFile(lessonsDir: string, slug: string, xml: string, flags: IngestFlags): string {
  mkdirSync(lessonsDir, { recursive: true });
  const lesson = musicXmlToLesson(xml, {
    id: slug,
    title: creditTitle(xml) ?? slug,
    composer: creditComposer(xml) ?? "Unknown",
    hands: flags.hands,
    difficulty: flags.difficulty,
  });
  const out = path.join(lessonsDir, `${slug}.json`);
  writeFileSync(out, `${JSON.stringify(lesson, null, 2)}\n`);
  return out;
}

export function refreshCatalog(lessonsDir: string, catalogPath: string): string[] {
  const files = listLibraryLessons(lessonsDir).map((item) => item.file);
  writeFileSync(catalogPath, generateCatalogModule(files));
  return files;
}

export type IngestSkip = Extract<IngestDecision, { action: "skip" }>;

export type IngestResult = {
  imported: string[];
  skipped: IngestSkip[];
  failed: { file: string; error: string }[];
};

export function ingestSheetMusic(flags: IngestFlags): IngestResult {
  const library = listLibraryLessons(flags.lessonsDir);
  const files = listMxlFiles(flags.dir);
  const result: IngestResult = { imported: [], skipped: [], failed: [] };

  for (const file of files) {
    let xml: string;
    try {
      xml = musicXmlFromBytes(new Uint8Array(readFileSync(file)));
    } catch (error) {
      result.failed.push({ file, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const decision = decideMxlAction(file, xml, library, flags.force);
    if (decision.action === "skip") {
      result.skipped.push(decision);
      continue;
    }
    try {
      if (!flags.dryRun) {
        const out = writeLessonFile(flags.lessonsDir, decision.slug, xml, flags);
        library.push({
          id: decision.slug,
          title: creditTitle(xml) ?? decision.slug,
          file: path.basename(out),
        });
        result.imported.push(out);
      } else {
        result.imported.push(path.join(flags.lessonsDir, `${decision.slug}.json`));
      }
    } catch (error) {
      result.failed.push({ file, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!flags.dryRun) {
    refreshCatalog(flags.lessonsDir, flags.catalogPath);
  }

  return result;
}
