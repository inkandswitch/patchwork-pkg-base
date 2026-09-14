import type { RecordsDiff, TLRecord } from "@tldraw/tldraw";
import type { TLDrawDoc } from "../datatype.ts";
import { isObject, mapValues } from "lodash";

/** Prepares a value for storing in Automerge (deep recursively)
 *  For now, all it does is convert strings to RawStrings.
 *  This is critical for performance because TLDraw can generate large
 *  strings for inline assets, which create huge documents.
 *  There's also no support for string merging anyway in TLDraw,
 *  so raw strings work fine.
 */
export function tldrawValueToAutomergeValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(tldrawValueToAutomergeValue);
  }
  if (isObject(value)) {
    return mapValues(value, tldrawValueToAutomergeValue);
  }
  return value;
}

export function applyTLStoreChangesToAutomerge(
  doc: TLDrawDoc,
  changes: RecordsDiff<TLRecord>
) {
  Object.values(changes.added).forEach((record) => {
    doc.store[record.id] = tldrawValueToAutomergeValue(record);
  });

  Object.values(changes.updated).forEach(([_, record]) => {
    doc.store[record.id] = deepCompareAndUpdate(doc.store[record.id], record);
  });

  Object.values(changes.removed).forEach((record) => {
    delete doc.store[record.id];
  });
}

function deepCompareAndUpdate(current: any, next: any): any {
  if (Array.isArray(next)) {
    const out = Array.isArray(current) ? current : [];
    for (let i = 0; i < next.length; i++) {
      out[i] = deepCompareAndUpdate(out[i], next[i]);
    }
    if (out.length > next.length) out.splice(next.length);
    return out;
  }

  if (isPlainObject(next)) {
    const out = isPlainObject(current) ? current : {};
    for (const [key, value] of Object.entries(next)) {
      out[key] = deepCompareAndUpdate(out[key], value);
    }
    for (const key of Object.keys(out)) {
      if (!(key in next)) delete out[key];
    }
    return out;
  }

  return current === next ? current : tldrawValueToAutomergeValue(next);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return isObject(value) && !Array.isArray(value);
}
