# Geplanter Dateiaufbau

## Neues Repository: pi-rabbitmode

```text
pi-rabbitmode/
├── README.md
├── AGENTS.md
├── package.json
├── tsconfig.json
│
├── src/
│   ├── extension/
│   │   └── index.ts
│   │
│   ├── rabbit/
│   │   ├── state.ts
│   │   ├── commands.ts
│   │   ├── activation.ts
│   │   ├── effort.ts
│   │   └── capabilities.ts
│   │
│   ├── orchestration/
│   │   ├── orchestrator.ts
│   │   ├── graph.ts
│   │   ├── workflow.ts
│   │   ├── replanner.ts
│   │   ├── scheduler.ts
│   │   └── limits.ts
│   │
│   ├── agents/
│   │   ├── contract.ts
│   │   ├── factory.ts
│   │   ├── ephemeral.ts
│   │   ├── validator.ts
│   │   └── registry.ts
│   │
│   ├── runtime/
│   │   ├── subagents-rpc.ts
│   │   ├── lifecycle.ts
│   │   ├── model-capabilities.ts
│   │   └── permission-intersection.ts
│   │
│   └── protocol/
│       ├── events.ts
│       ├── status.ts
│       └── version.ts
│
├── themes/
│   └── aurora-rabbit.json
│
└── test/
    ├── state.test.*
    ├── effort.test.*
    ├── agents.test.*
    ├── graph.test.*
    ├── replanning.test.*
    ├── nested.test.*
    ├── permissions.test.*
    └── integration.test.*
```

Namen dürfen nach Discovery angepasst werden. Verantwortlichkeiten nicht vermischen.

## Mögliche minimale Änderungen in daydaylx/pi

Nur wenn bestehende öffentliche Hooks nicht ausreichen:

- Shortcut-Katalog: `Super+Alt+R`
- Command-/Frontend-Mapping
- kleiner Rabbit Status Contract
- Aurora State Adapter
- Footer/Activity Rendering
- Theme registration/loading
- setup doctor compatibility check
- Tests

Rabbit-Orchestrierungslogik gehört **nicht** in `daydaylx/pi`.

## Mögliche Änderungen in pi-subagents

Nur wenn aktuelles RPC nicht reicht:

- versionierte Capability-Abfrage
- ephemeral agent definitions
- graph/chain execution über denselben Executor
- keine zweite Execution-Pipeline
- backward compatibility für RPC v1
