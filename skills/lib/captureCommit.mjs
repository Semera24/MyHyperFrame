import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Stage the image and provenance first; restore the old image if the ledger commit fails. */
export function commitCapture(out, ledgerPath, png, record, format = "object") {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const lock = `${ledgerPath}.capture-lock`;
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Another capture owns this ledger. Retry after it finishes. A crash leaves the lock for manual recovery.",
      );
    throw error;
  }
  try {
    replaceCapture(out, ledgerPath, png, record, format);
  } finally {
    rmSync(lock, { recursive: true });
  }
}

function replaceCapture(out, ledgerPath, png, record, format) {
  const next = nextLedger(readLedger(ledgerPath, format), record);
  mkdirSync(dirname(out), { recursive: true });
  const images = mkdtempSync(join(dirname(out), ".capture-"));
  let records;
  let preserveBackup = false;
  try {
    records = mkdtempSync(join(dirname(ledgerPath), ".capture-"));
    const image = join(images, "new.png"),
      backup = join(images, "before.png"),
      ledgerFile = join(records, "sources.json");
    const hadImage = existsSync(out);
    if (hadImage) copyFileSync(out, backup);
    writeFileSync(image, png);
    writeFileSync(ledgerFile, JSON.stringify(next, null, 1) + "\n");
    renameSync(image, out);
    try {
      renameSync(ledgerFile, ledgerPath);
    } catch (error) {
      try {
        if (hadImage) renameSync(backup, out);
        else rmSync(out);
      } catch (rollbackError) {
        preserveBackup = true;
        throw new AggregateError(
          [error, rollbackError],
          `Capture rollback failed; recovery files remain in ${images}`,
        );
      }
      throw error;
    }
  } finally {
    if (!preserveBackup) rmSync(images, { recursive: true, force: true });
    if (records) rmSync(records, { recursive: true, force: true });
  }
}

function readLedger(ledgerPath, format) {
  if (existsSync(ledgerPath)) return JSON.parse(readFileSync(ledgerPath, "utf8"));
  return format === "array" ? [] : { captures: [] };
}

function nextLedger(ledger, record) {
  const captures = Array.isArray(ledger) ? ledger : ledger.captures;
  if (!Array.isArray(captures)) throw new Error("The capture ledger needs a captures array.");
  const entries = [...captures.filter((item) => item?.file !== record.file), record];
  return Array.isArray(ledger) ? entries : { ...ledger, captures: entries };
}
