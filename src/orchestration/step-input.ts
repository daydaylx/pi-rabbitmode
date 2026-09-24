import type { WorkflowStepStatus } from "./graph.ts";

/** Maximum UTF-8 size of a complete task sent to a child agent. */
export const MAX_WORKFLOW_STEP_INPUT_BYTES = 32 * 1024;

export interface DependencyResultInput {
  stepId: string;
  status: WorkflowStepStatus;
  output?: string;
}

export type StepInputResult =
  | { ok: true; task: string }
  | { ok: false; error: string };

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Return the longest prefix that fits the given UTF-8 byte budget. */
function fitUtf8Prefix(value: string, maxBytes: number): string {
  let result = "";
  let size = 0;
  for (const character of value) {
    const nextSize = utf8Length(character);
    if (size + nextSize > maxBytes) break;
    result += character;
    size += nextSize;
  }
  return result;
}

function truncateWithMarker(value: string, maxBytes: number, label: string): string {
  if (utf8Length(value) <= maxBytes) return value;
  const markerFor = (omittedBytes: number) =>
    `\n[${label}: ${omittedBytes} UTF-8 bytes omitted; input limit ${MAX_WORKFLOW_STEP_INPUT_BYTES} bytes.]`;
  let omittedBytes = utf8Length(value);
  let prefix = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const marker = markerFor(omittedBytes);
    prefix = fitUtf8Prefix(value, Math.max(0, maxBytes - utf8Length(marker)));
    omittedBytes = utf8Length(value.slice(prefix.length));
  }
  const marker = markerFor(omittedBytes);
  prefix = fitUtf8Prefix(value, Math.max(0, maxBytes - utf8Length(marker)));
  omittedBytes = utf8Length(value.slice(prefix.length));
  return `${prefix}${markerFor(omittedBytes)}`;
}

/**
 * Build a child prompt from its declared task and only its direct,
 * successfully completed dependencies. Independent steps retain their
 * exact task unchanged. Oversized input is explicitly annotated rather
 * than silently clipped.
 */
export function buildStepInput(
  task: string,
  dependencyResults: readonly DependencyResultInput[],
  maxBytes = MAX_WORKFLOW_STEP_INPUT_BYTES,
): StepInputResult {
  if (dependencyResults.length === 0) {
    return utf8Length(task) <= maxBytes
      ? { ok: true, task }
      : { ok: true, task: truncateWithMarker(task, maxBytes, "Task truncated") };
  }

  const invalid = dependencyResults.find((result) => result.status !== "completed");
  if (invalid) {
    return {
      ok: false,
      error: `Dependency "${invalid.stepId}" has status "${invalid.status}" and cannot be used as a successful input.`,
    };
  }

  const sections = dependencyResults.map((result) =>
    `[Dependency result: ${result.stepId}]\n${result.output?.trim() || "(No textual output returned.)"}`,
  );
  const fullInput = `${task.trim()}\n\nDependency results:\n${sections.join("\n\n")}`;
  if (utf8Length(fullInput) <= maxBytes) return { ok: true, task: fullInput };

  const dependencyHeader = `${task.trim()}\n\nDependency results:\n`;
  if (utf8Length(dependencyHeader) >= maxBytes) {
    return {
      ok: true,
      task: truncateWithMarker(dependencyHeader, maxBytes, "Workflow input truncated"),
    };
  }

  const remaining = maxBytes - utf8Length(dependencyHeader);
  const dependencyText = sections.join("\n\n");
  const fitted = truncateWithMarker(dependencyText, remaining, "Dependency output truncated");
  return { ok: true, task: `${dependencyHeader}${fitted}` };
}
