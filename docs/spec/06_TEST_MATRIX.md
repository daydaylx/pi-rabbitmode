# Testmatrix

## A. Shortcut / Commands

- `Super+Alt+R` toggelt RabbitMode
- `Super+R` bleibt Resume
- `Shift+Tab` bleibt unverändert
- Shortcut und `/rabbit` benutzen denselben Command-Pfad
- Draft-Verhalten entspricht bestehender Shortcut-Policy

## B. Session State

- Start = off
- on -> active
- off -> off
- Neustart = off
- kein ungefragtes Persistieren
- laufender Run verhindert stilles Off
- `/rabbit stop` beendet kontrolliert

## C. Thinking

- normal high -> Rabbit max -> exit high
- normal medium -> Rabbit max -> exit medium
- normal max -> Rabbit max -> exit max
- Modell ohne max wird nicht still mit high gestartet
- Child Agents laufen max
- Nested Agents laufen max
- persistente Standard-Settings bleiben unverändert

## D. Workflow

- Work erlaubt Rabbit Mutation
- Simple Plan erlaubt keinen mutierenden Rabbit-Run
- Detailed Plan erlaubt keinen mutierenden Rabbit-Run
- Rabbit wechselt Plan nicht automatisch zu Work
- Plan Approval-Vertrag bleibt unverändert

## E. Permissions

Für jedes Permission-Level:

- Rabbit erhöht es nicht
- Child kann Parent nicht überschreiten
- Tool-Allowlist schränkt zusätzlich ein
- Secret Guard bleibt aktiv
- Trust Guard bleibt aktiv
- Recovery Gate bleibt aktiv
- YOLO wird nicht automatisch eingeschaltet

## F. Dynamic Agents

- vorhandene Rolle wird bevorzugt
- dynamische Rolle nur bei echtem Bedarf
- ephemeral Definition verschwindet mit Run/Session
- invalid tool -> rejected
- invalid model -> rejected
- incompatible max -> rejected
- Child darf keine neue Agentenklasse definieren
- max dynamic agent limit wird erzwungen

## G. Parallelism

- read-only Agents bis concurrency limit
- über limit -> queued/rejected gemäß Vertrag
- Writer concurrency = 1
- kein überlappender Parallel-Write
- Stop propagiert sauber

## H. Nested Delegation

- depth 1 funktioniert
- depth 2 funktioniert
- depth 3 wird geblockt
- Child nur mit freigegebenen Rollen
- Root-only Agent Factory
- Child Limits können Root Limits nicht erhöhen

## I. Workflow Graph

- gültiger DAG startet
- Zyklus rejected
- unbekannte Dependency rejected
- failed dependency behandelt
- structured outputs übergeben
- Schrittstatus deterministisch
- History bleibt nachvollziehbar

## J. Replanning

- Revision mit neuem Befund erlaubt
- Revision ohne Grund rejected
- max revisions erzwungen
- alte Graph-Version bleibt sichtbar
- Revision kann Permission/Depth/Concurrency nicht erhöhen

## K. Verification

- targeted checks
- project_check canonical
- hard verifier weiterhin verpflichtend
- verifier FAIL bleibt FAIL
- verifier INCOMPLETE zählt nicht als PASS
- Repair max rounds
- erfolgreicher Repair braucht erneute Verification

## L. TUI

Breitenklassen testen:

- wide
- comfortable
- standard
- compact
- extrem narrow

Zusätzlich:

- Rabbit Status bleibt sichtbar
- MAX sichtbar, soweit Platz vorhanden
- Error bleibt rot
- Warning bleibt warning
- Blue Shift nur Rabbit-Semantik
- reduced motion
- motion off
- Theme restoration
- Unicode cell widths
- kein Render-I/O

## M. Failure Tests

- pi-subagents RPC fehlt
- falsche RPC-Version
- Provider timeout
- auth failure
- model max unsupported
- Agent crash
- parent stop
- malformed workflow
- stale session
- recovery block
- verification fail

## N. Rabbit Effect Intensity

- expressive mode zeigt mehrere unterschiedliche Rabbit-Animationstypen
- Activation, Spawn, Branching, Replanning und Completion sind visuell unterscheidbar
- Effekte dürfen bewusst auffällig und dauerhaft lebendig sein
- Effekte verdecken keine Eingabe
- Effekte verdecken keine Error-/Warning-/Verification-Zustände
- Animation bleibt bei kleinen Terminals stabil
- `reduced` reduziert Bewegung zuverlässig
- `off` entfernt zeitbasierte Animation vollständig
- keine zusätzlichen ungebremsten Timer/Render-Loops
- CPU-/Render-Verhalten bleibt innerhalb sinnvoller Grenzen
