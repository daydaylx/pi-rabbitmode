import { createWorkflowSession, type WorkflowSession } from "./workflow-session.ts";

/**
 * `/rabbit workflow` always starts a fresh session (new graph from
 * scratch); `/rabbit replan` extends whichever session is current. This
 * holder is the mutable slot commands.ts needs for that — a plain
 * `WorkflowSession` has no notion of "replace me with a new one", and
 * giving it one would blur "start a new graph" with "revise the current
 * graph", which the Replanning Contract keeps deliberately distinct.
 */
export interface WorkflowSessionHolder {
  current(): WorkflowSession | undefined;
  startNew(): WorkflowSession;
  /** Bind to `session_start`. */
  reset(): void;
}

export function createWorkflowSessionHolder(): WorkflowSessionHolder {
  let session: WorkflowSession | undefined;
  return {
    current: () => session,
    startNew: () => {
      session = createWorkflowSession();
      return session;
    },
    reset: () => {
      session = undefined;
    },
  };
}
