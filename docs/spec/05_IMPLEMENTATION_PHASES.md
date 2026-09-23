# Implementierungsphasen

## Phase 0 – Discovery / Baseline

Vor jeder Änderung:

- aktuellen `daydaylx/pi` main prüfen
- aktuellen `settings.json` Package-Pin lesen
- tatsächlichen `pi-subagents`-Pin prüfen
- aktuelle öffentliche Subagent-RPC prüfen
- Shortcut-Katalog prüfen
- Thinking API / Modell-Capabilities prüfen
- Aurora Theme-/Motion-Hooks prüfen
- Dokumentationsdrift identifizieren

Kein Code auf Basis veralteter Doku entwerfen.

## Phase 1 – Neues Repository

`daydaylx/pi-rabbitmode`

Grundstruktur:

- package manifest
- Extension entrypoint
- tests
- README
- AGENTS
- keine Orchestrierungslogik über Dummy hinaus

Ziel: installierbare, deaktivierte Extension.

## Phase 2 – Rabbit State + Command

Implementieren:

- `standard | rabbit`
- `/rabbit on`
- `/rabbit off`
- `/rabbit status`
- `/rabbit stop`
- session-lokaler State
- Events/Status

Noch keine dynamischen Agenten.

## Phase 3 – Shortcut

`Super+Alt+R` auf kanonischen `/rabbit`-Toggle routen.

Pflicht:

- `Super+R -> Resume` unverändert
- `Shift+Tab` unverändert
- keine doppelte Business-Logik im Shortcut

## Phase 4 – MAX Thinking Contract

Implementieren:

- vorherige Thinking-Stufe merken
- Rabbit -> effective max
- Exit -> vorherige Stufe wiederherstellen
- Modell-Capability prüfen
- Modell ohne max: Rabbit-Ausführung ablehnen/alternatives zulässiges Modell wählen
- kein stiller High-Fallback
- settings.json nicht persistent überschreiben

## Phase 5 – Rabbit TUI

Implementieren:

- Rabbit Status im Aurora State
- Footer
- `aurora-rabbit`
- Blue Shift
- Aktivierung/Exit
- responsive Darstellung
- reduced/off motion
- keine UI-eigene Orchestrierungslogik
- RabbitMode visuell absichtlich übertreiben: viele Animationen, Blue-Glow, Branch-/Depth-Effekte, Spawn-/Replan-/Verification-Transitions
- "etwas nervig" ist im RabbitMode ausdrücklich akzeptabel und kein Grund zur Reduktion
- expressive mode soll die volle Spezialmodus-Inszenierung zeigen

## Phase 6 – pi-subagents Capability Bridge

Versionierte Schnittstelle nutzen/erweitern.

Zuerst:

- ping/capabilities
- status
- spawn
- stop
- interrupt

Kein Import interner Package-Module.

## Phase 7 – Ephemeral Agent Factory

Implementieren:

- Dynamic Agent Definition
- Validierung
- Tool-Allowlist
- max effort
- ModelScope
- fresh/fork
- root-only dynamic role creation
- session-lokal

Noch keine Persistenz.

## Phase 8 – Workflow Graph

Implementieren:

- deklarativer DAG
- Dependencies
- Step status
- structured outputs
- sequential execution
- begrenzte read-only Parallelität
- Run history

## Phase 9 – Replanning

Implementieren:

- begrenzte Revisionen
- revisionsbegründender Befund
- unveränderbare History
- keine Permission-/Limit-Aufweitung

## Phase 10 – Nested Delegation

Implementieren:

- max depth 2
- Child Agents dürfen nur erlaubte Rollen verwenden
- Child Agents dürfen keine neuen Agententypen definieren
- Limits werden transitiv erzwungen

## Phase 11 – Writer

Implementieren:

- `writeScope`
- mutation concurrency = 1
- Permission Intersection
- keine Parallel-Writer im gleichen Workspace
- Dirty-state Verhalten definieren

## Phase 12 – Verification Integration

Implementieren:

- targeted checks
- project_check
- Hard-Verifier-Regeln
- FAIL/INCOMPLETE-Verhalten
- begrenzte Repair-Runden
- Abschluss nur bei erfülltem Vertrag

## Phase 13 – Persistenz optional

Erst nach stabiler Runtime:

- `/rabbit save-agent`
- `/rabbit save-workflow`

Explizit.
Nie automatisch.

## Phase 14 – Benchmark / Rollout

Vergleichen:

- Standard vs Rabbit
- Qualität
- Tokenverbrauch
- Modellaufrufe
- Laufzeit
- unnötige Delegationen
- gefundene Fehler
- Verifier-Abdeckung
- Fehlerraten
- Recovery-Verhalten

RabbitMode bleibt opt-in.
