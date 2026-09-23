# Arbeitsauftrag – RabbitMode implementieren

## Ziel

Implementiere RabbitMode als eigenständige Pi-Extension im neuen Repository:

`daydaylx/pi-rabbitmode`

RabbitMode ist eine opt-in Orchestrierungsschicht für komplexe Aufgaben. Er wird über `Super+Alt+R` aktiviert und erzwingt für alle Rabbit-Modellläufe `max` Thinking/Effort.

## Repositories

Autoritativ:

1. `https://github.com/daydaylx/pi`
2. `https://github.com/daydaylx/pi-subagents`
3. neues Repository `https://github.com/daydaylx/pi-rabbitmode`

Vor Änderungen aktuellen Remote-Stand und tatsächliche Pins prüfen. Keine Annahmen aus veralteter Dokumentation übernehmen.

## Harte Regeln

1. `Super+Alt+R` toggelt RabbitMode.
2. `Super+R` bleibt Resume.
3. `Shift+Tab` bleibt unverändert.
4. RabbitMode ist kein neuer `WorkflowMode`.
5. RabbitMode verändert Permissions nie automatisch.
6. RabbitMode darf Plan Mode nicht selbst zu Work wechseln.
7. RabbitMode erzwingt `max`.
8. Kein stiller `max -> high` Fallback.
9. Modelle ohne `max` sind für Rabbit-Ausführung unzulässig.
10. ModelScope bleibt autoritativ.
11. `pi-subagents` bleibt Execution Runtime.
12. Keine zweite Spawn-/Chain-/Parallel-Engine.
13. Dynamische Agenten sind standardmäßig ephemeral.
14. Persistenz nur explizit.
15. Nested Delegation maximal Depth 2.
16. Nur Root Rabbit Supervisor darf neue Agententypen definieren.
17. Analyseparallelität ist begrenzt.
18. mutierende Agenten concurrency = 1 in V1.
19. Child Permissions dürfen Parent Permissions nicht überschreiten.
20. bestehende Recovery-, Trust-, Secret- und Verification-Gates bleiben bindend.
21. `project_check` bleibt kanonische Verification.
22. Hard-Verifier-Regeln bleiben unverändert.
23. Rabbit Status wird von Aurora gerendert; RabbitMode baut keine eigene TUI-Engine.
24. Blue Shift darf Fehler-/Warning-Semantik nicht überschreiben.
25. Standardmodus muss ohne Rabbit exakt wie vorher funktionieren.

## Vorgehen

### 1. Discovery

Prüfe zuerst:

- aktuellen HEAD von `daydaylx/pi`
- aktuellen `pi-subagents` Pin in `settings.json`
- RPC/Capability API des tatsächlichen Pins
- Thinking API und Modell-Capability-Ermittlung
- Shortcut- und Command-Infrastruktur
- Workflow Capability Bridge
- Permission Hooks
- Aurora State/Footer/Theme/Motion
- Setup Doctor

Dokumentiere Abweichungen von diesem Paket.

### 2. Architektur bestätigen

Verwende:

```text
pi
  -> policy / workflow / permissions / verification / Aurora

pi-rabbitmode
  -> orchestration / dynamic workflow / ephemeral agents / replanning

pi-subagents
  -> execution / lifecycle / parallel / nested / artifacts
```

Keine zyklischen Abhängigkeiten.

### 3. Rabbit State

Implementiere einen session-lokalen Rabbit State und die Commands:

```text
/rabbit on
/rabbit off
/rabbit status
/rabbit stop
```

### 4. Shortcut

Registriere:

```text
Super+Alt+R -> kanonischer /rabbit toggle
```

Nicht als separaten Logikpfad.

### 5. MAX Thinking

Rabbit aktiviert einen session-lokalen Override:

```text
effectiveThinking = max
```

Vorherige Nutzerstufe merken und beim Exit wiederherstellen.

Keine persistente Änderung der Standardsettings.

### 6. TUI

Rabbit bekommt eine kalte Electric-Blue Identität:

- `aurora-rabbit`
- Footer `◆ RABBIT`
- MAX sichtbar
- aktive Agenten / Step / Depth
- vorhandene Aurora Motion Engine
- responsive
- reduced/off motion
- semantische Error/Warning/Success Farben beibehalten

**Wichtige Designvorgabe:** RabbitMode soll visuell absichtlich übertrieben sein. Nicht auf subtile oder minimalistische Darstellung optimieren.

Im normalen `expressive` Motion Mode ausdrücklich viele Effekte und Animationen einsetzen:

- starke Activation-/Exit-Sequenzen
- Blue Glow / Pulse / Sweep
- animierte Branch- und Depth-Linien
- auffällige Agent-Spawn-Effekte
- sichtbares Replanning / "DEEPER"
- lebendige parallele Agent-Aktivität
- Synthese-/Verification-/Completion-Animationen
- kurze Glitch-/Scan-Effekte, wenn terminaltechnisch stabil

Es ist ausdrücklich akzeptabel, wenn RabbitMode zeitweise etwas nervig wirkt. Das gehört zum Spezialmodus-Charakter.

Nicht wegen allgemeiner UX-Minimalismus-Regeln zurückbauen.

Grenzen sind nur:

- Lesbarkeit
- Bedienbarkeit
- semantische Error/Warning-Zustände
- kleine Terminalgrößen
- Performance / stabile Render-Architektur
- bestehende Reduced-Motion-/Motion-Off-Einstellungen

Keine zweite Animation Engine bauen; vorhandene Aurora-Motion-Infrastruktur maximal ausnutzen.

### 7. Runtime Bridge

Bevorzugt versionierte RPC-Erweiterung statt interner Imports.

Wenn v1 nicht reicht, definiere eine backward-compatible v2.

### 8. Ephemeral Agents

Dynamic Agent Factory:

- enges Purpose
- minimale Tools
- max Thinking
- ModelScope
- writeScope
- fresh/fork
- mayDelegate
- maxDepth

Vorhandene Rollen bevorzugen.

### 9. Workflow

Deklarativer DAG:

- dependencies
- structured outputs
- status
- bounded parallelism
- revisions
- history
- failure behavior

Keine generische Script-Sprache.

### 10. Nested Delegation

Maximal Depth 2.

Child darf nur bereits freigegebene Rollen aufrufen.

Child darf keine neue Agentenklasse erzeugen.

### 11. Writer

V1:

```text
mutationConcurrency = 1
```

Jeder dynamische Writer benötigt `writeScope`.

### 12. Verification

Nach Mutation:

```text
targeted checks
-> project_check verify
-> hard verifier wenn Policy fordert
-> synthesis
```

FAIL bleibt FAIL.
INCOMPLETE bleibt INCOMPLETE.

## Tests

Die vollständige Matrix in `06_TEST_MATRIX.md` ist verpflichtend.

Besonders kritisch:

- Shortcut-Parität
- Thinking restoration
- unsupported max
- Permission intersection
- Plan Mode
- depth limit
- writer serialization
- verifier authority
- responsive Rabbit UI
- failure paths

## Abschluss

Liefer am Ende:

1. geänderte Repositories und Commits
2. Architekturabweichungen
3. neue öffentliche Contracts
4. Testresultate
5. offene Risiken
6. Benchmark-Vorschlag Standard vs Rabbit
7. klare Aussage, ob RabbitMode produktionsreif ist oder experimentell bleiben sollte

Schwierigkeiten: 9/10 | Thinking: xhigh
