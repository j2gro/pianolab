import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  decideMxlAction,
  generateCatalogModule,
  ingestSheetMusic,
  jsonImportIdent,
  parseIngestArgs,
} from "./ingestMxl";

const SCORE = `<?xml version="1.0"?>
<score-partwise>
  <credit page="1"><credit-words>New Tune</credit-words></credit>
  <identification><creator type="composer">Test</creator></identification>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>
  </part>
</score-partwise>`;

function packMxl(xml: string): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>`,
    ),
    "score.xml": strToU8(xml),
  });
}

test("parseIngestArgs reads dir, dry-run, and difficulty", () => {
  const parsed = parseIngestArgs(["--dir", "D:\\drops", "--dry-run", "--difficulty", "advanced"], {
    lessonsDir: "lessons",
    catalogPath: "catalog.ts",
  });
  assert.equal(parsed.dir, "D:\\drops");
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.difficulty, "advanced");
});

test("skips MXL files already in the library by slug or title", () => {
  const library = [{ id: "canon-in-d-easy", title: "Canon in D", file: "canon-in-d-easy.json" }];
  const bySlug = decideMxlAction("C:\\sheet_music\\canon-in-d-easy.mxl", SCORE, library, false);
  assert.equal(bySlug.action, "skip");

  const byTitle = decideMxlAction(
    "C:\\sheet_music\\ez-piano-02-new-tune.mxl",
    SCORE.replace("New Tune", "Canon in D"),
    library,
    false,
  );
  assert.equal(byTitle.action, "skip");

  const fresh = decideMxlAction("C:\\sheet_music\\fur-elise-easy-ver.mxl", SCORE, library, false);
  assert.equal(fresh.action, "import");
  assert.equal(fresh.slug, "fur-elise-easy-ver");
});

test("generateCatalogModule uses stable import names", () => {
  const used = new Set<string>();
  assert.equal(jsonImportIdent("golden-k-pop-demon-hunters.json", used), "goldenKPopDemonHuntersJson");
  const source = generateCatalogModule(["twinkle.json", "mary-had-a-little-lamb.json"]);
  assert.match(source, /import twinkleJson from "\.\/lessons\/twinkle\.json"/);
  assert.match(source, /maryHadALittleLambJson/);
});

test("ingestSheetMusic writes new lesson JSON and catalog", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pianolab-ingest-"));
  const drops = path.join(root, "drops");
  const lessonsDir = path.join(root, "lessons");
  const catalogPath = path.join(root, "catalog.generated.ts");
  mkdirSync(drops);
  mkdirSync(lessonsDir);
  writeFileSync(
    path.join(lessonsDir, "existing.json"),
    `${JSON.stringify({ id: "existing", title: "Existing", composer: "X" }, null, 2)}\n`,
  );
  writeFileSync(path.join(drops, "new-tune.mxl"), packMxl(SCORE));
  writeFileSync(path.join(drops, "existing.mxl"), packMxl(SCORE.replace("New Tune", "Existing")));

  const result = ingestSheetMusic({
    help: false,
    dryRun: false,
    force: false,
    dir: drops,
    lessonsDir,
    catalogPath,
  });

  assert.equal(result.imported.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.failed.length, 0);
  const written = JSON.parse(readFileSync(path.join(lessonsDir, "new-tune.json"), "utf8")) as {
    id: string;
    title: string;
    composer: string;
  };
  assert.equal(written.id, "new-tune");
  assert.equal(written.title, "New Tune");
  assert.equal(written.composer, "Test");
  const catalog = readFileSync(catalogPath, "utf8");
  assert.match(catalog, /newTuneJson/);
  assert.match(catalog, /existingJson/);
});
