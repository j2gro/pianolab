import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ingestSheetMusic, ingestUsage, parseIngestArgs } from "./ingestMxl";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export function runIngestCli(argv: string[]): number {
  let flags;
  try {
    flags = parseIngestArgs(argv, {
      lessonsDir: path.join(srcDir, "lessons"),
      catalogPath: path.join(srcDir, "catalog.generated.ts"),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  if (flags.help) {
    process.stderr.write(`${ingestUsage()}\n`);
    return 0;
  }

  let result;
  try {
    result = ingestSheetMusic(flags);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  for (const skip of result.skipped) {
    process.stderr.write(`skip ${skip.file} (${skip.reason})\n`);
  }
  for (const imported of result.imported) {
    process.stderr.write(`${flags.dryRun ? "would import" : "imported"} ${imported}\n`);
  }
  for (const fail of result.failed) {
    process.stderr.write(`fail ${fail.file}: ${fail.error}\n`);
  }
  process.stderr.write(
    `${flags.dryRun ? "dry-run " : ""}${result.imported.length} imported, ${result.skipped.length} skipped, ${result.failed.length} failed\n`,
  );
  return result.failed.length > 0 ? 1 : 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = runIngestCli(process.argv.slice(2));
}
