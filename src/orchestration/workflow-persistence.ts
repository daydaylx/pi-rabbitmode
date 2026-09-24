import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { WorkflowSession } from "./workflow-session.ts";

/**
 * Phase 13 (`docs/spec/05_IMPLEMENTATION_PHASES.md`: "/rabbit
 * save-workflow … Explizit. Nie automatisch."). The spec gives no format —
 * unlike `/rabbit save-agent` (dynamic-role.ts's `save()`), there is no
 * existing discovery mechanism a workflow snapshot could reuse, since
 * `pi-subagents` only discovers *agent* `.md` files, not workflow graphs.
 * This is therefore a plain, honestly-scoped JSON audit/reference dump of
 * `WorkflowSession.revisions()` — the full append-only revision history
 * (steps + the reason each replan gave), plus a condensed per-step outcome
 * (`status`/`message`, no other run metadata). It is NOT a template format:
 * `/rabbit workflow` only accepts inline JSON today, there is no
 * `/rabbit workflow <saved-name>` loader, and this deliberately does not
 * add one — that would be new, unrequested orchestration surface, not a
 * persistence format for what already runs.
 */
export const WORKFLOW_SNAPSHOT_DIR = "rabbit-workflows";
const NAME_PATTERN = /^[a-z][a-z0-9-]{1,60}$/;

export interface SavedWorkflowStepOutcome {
  id: string;
  status: string;
  message?: string;
}

export interface SavedWorkflowRevision {
  revision: number;
  reason?: string;
  steps: { id: string; role: string; task: string; dependsOn?: string[] }[];
  outcomes: SavedWorkflowStepOutcome[];
}

export interface SavedWorkflowSnapshot {
  name: string;
  savedAt: string;
  revisions: SavedWorkflowRevision[];
}

export function isValidWorkflowSnapshotName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

function toSnapshot(name: string, session: WorkflowSession, now: () => string): SavedWorkflowSnapshot {
  return {
    name,
    savedAt: now(),
    revisions: session.revisions().map((revision) => ({
      revision: revision.revision,
      ...(revision.reason !== undefined ? { reason: revision.reason } : {}),
      steps: revision.steps.map((step) => ({
        id: step.id,
        role: step.role,
        task: step.task,
        ...(step.dependsOn !== undefined ? { dependsOn: step.dependsOn } : {}),
      })),
      outcomes: revision.result.steps.map((result) => ({
        id: result.id,
        status: result.status,
        ...(result.message !== undefined ? { message: result.message } : {}),
      })),
    })),
  };
}

export async function saveWorkflowSnapshot(
  cwd: string,
  name: string,
  session: WorkflowSession,
  now: () => string = () => new Date().toISOString(),
): Promise<{ ok: true; filePath: string } | { ok: false; error: string }> {
  if (!isValidWorkflowSnapshotName(name)) {
    return {
      ok: false,
      error: `name muss klein geschrieben sein und zu ${NAME_PATTERN} passen (z.B. "auth-refactor-audit").`,
    };
  }
  if (session.currentRevision() === 0) {
    return { ok: false, error: "Workflow hat noch keine Revision — nichts zu speichern." };
  }

  const dir = path.join(cwd, ".pi", WORKFLOW_SNAPSHOT_DIR);
  const filePath = path.join(dir, `${name}.json`);
  await mkdir(dir, { recursive: true });
  const snapshot = toSnapshot(name, session, now);
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return { ok: true, filePath };
}
