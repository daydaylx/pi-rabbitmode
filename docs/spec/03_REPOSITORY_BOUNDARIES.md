# Repository-Grenzen

## daydaylx/pi

Bleibt autoritativ für:

- Workflow Mode
- Plan Mode
- Permission-System
- Trust Boundary
- Recovery / Resilience
- Verification / project_check
- Verifier-Gates
- Aurora TUI
- Shortcut-Katalog / semantische Commands
- Frontend-/Status-Bridge

Erhält nur kleine Rabbit-Integrationspunkte.

Nicht hier implementieren:

- Rabbit-Orchestrator
- Dynamic Agent Factory
- Rabbit Workflow Engine
- Rabbit Replanning

## daydaylx/pi-rabbitmode

Besitzt:

- Rabbit Session State
- `/rabbit` Command
- `Super+Alt+R`-Integration über semantischen Command
- `max`-Thinking Override
- Capability-Prüfung für Modelle
- Dynamic Workflow Graph
- Dynamic Agent Factory
- Replanning
- Limits / Circuit Breaker
- Runtime Bridge zu `pi-subagents`
- Rabbit Status Events
- Rabbit-spezifische Tests
- optional ausgeliefertes `aurora-rabbit` Theme

Besitzt **nicht**:

- eigenes Permission-System
- eigene Recovery-Engine
- eigene Verification-Engine
- eigene TUI-Layout-Engine
- eigene Child-Process-Execution

## daydaylx/pi-subagents

Bleibt zuständig für:

- Agent discovery / validation
- Child spawning
- Chains
- Parallel execution
- Nested execution
- Lifecycle
- Status
- Interrupt / Stop
- Artifacts
- Worktrees
- Structured outputs
- Child safety

RabbitMode soll diese Fähigkeiten über eine versionierte öffentliche Schnittstelle nutzen.

## Dependency Rule

Keine zyklische Paketabhängigkeit.

```text
pi-rabbitmode -> öffentliche Pi Extension APIs
pi-rabbitmode -> versionierte pi-subagents RPC/Capability API
pi -> kennt Rabbit nur über kleine Events/Statusverträge
```

Pi muss auch ohne installierten RabbitMode vollständig funktionieren.
