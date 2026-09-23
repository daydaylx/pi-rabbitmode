# pi-rabbitmode

RabbitMode ist eine opt-in Orchestrierungsschicht für [Pi](https://github.com/daydaylx/pi)
(`daydaylx/pi`), die für komplexe Aufgaben dynamische, ephemere Subagenten
über die bestehende [`pi-subagents`](https://github.com/daydaylx/pi-subagents)
Runtime orchestriert. RabbitMode ist **kein** neuer Permission-Level und
**kein** vierter Workflow-Modus — es ist eine separat aktivierbare Schicht
oberhalb von Pis bestehendem Permission-/Workflow-/Verification-System.

## Status: Phase 1–2 Grundgerüst

Diese Version implementiert ausschließlich:

- ein installierbares, standardmäßig **wirkungsloses** Pi-Package
- session-lokalen Rabbit-State (`off` | `active`)
- `/rabbit on|off|status|stop` (plus `/rabbit`/`/rabbit toggle` als Toggle-Alias)

**Es gibt noch keine Orchestrierung, keinen Shortcut, kein eigenes Theme,
keine Subagenten-Ansteuerung.** `/rabbit on` schaltet nur einen internen
Zustand um und zeigt ihn an — es verändert nie Permission-Level oder
Workflow-Mode, auch nicht indirekt.

## Architektur (Zielbild, nicht vollständig umgesetzt)

```text
daydaylx/pi              Host / Policy / Permissions / Verification / Aurora
        |
        v
daydaylx/pi-rabbitmode    Orchestration / Workflow / Dynamic Agents  (dieses Repo)
        |
        v
daydaylx/pi-subagents     Child execution / chains / parallel / nested
```

`daydaylx/pi` bleibt für alle drei Repositories die alleinige Autorität für
Permissions, Trust, Recovery und Verification. `pi-rabbitmode` besitzt
ausschließlich Rabbit-Session-State, den `/rabbit`-Command und (später)
die Orchestrierungslogik — niemals ein eigenes Permission-, Recovery- oder
Verification-System und niemals eine zweite Subagenten-Execution-Engine.
Details: [`docs/spec/03_REPOSITORY_BOUNDARIES.md`](docs/spec/03_REPOSITORY_BOUNDARIES.md).

## Commands

| Command | Wirkung |
| --- | --- |
| `/rabbit` / `/rabbit toggle` | schaltet zwischen `off` und `active` |
| `/rabbit on` | aktiviert RabbitMode (No-Op, falls bereits aktiv) |
| `/rabbit off` | deaktiviert RabbitMode (No-Op, falls bereits aus) |
| `/rabbit status` | zeigt aktuellen Mode; zusätzlich, rein informativ, den zuletzt auf dem Aurora-Bus beobachteten Permission-Level/Workflow-Mode |
| `/rabbit stop` | Phase 1-2: meldet immer "kein aktiver Rabbit-Run" (kein echter Run existiert noch) |

Der State ist rein session-lokal (In-Memory), wird nirgends persistiert und
ist nach einem Neustart immer `off`.

## Lokal entwickeln/testen

```bash
npm install
npm run verify   # typecheck && test
```

Um die Extension gegen eine echte Pi-Session zu testen, ohne `settings.json`
zu verändern:

```bash
pi -e /home/g/Projekte/pi-rabbitmode
```

(in einem beliebigen Scratch-Projektverzeichnis, nicht im `daydaylx/pi`-
Arbeitsbaum selbst).

## Roadmap (spätere Phasen, siehe `docs/spec/05_IMPLEMENTATION_PHASES.md`)

Phase 3 Shortcut (`Super+Alt+R`) · Phase 4 MAX-Thinking-Override ·
Phase 5 Rabbit-TUI (`aurora-rabbit`, Blue Shift) · Phase 6 `pi-subagents`-
RPC-Bridge · Phase 7 Ephemeral Agent Factory · Phase 8 Workflow-Graph ·
Phase 9 Replanning · Phase 10 Nested Delegation · Phase 11 Writer ·
Phase 12 Verification-Integration · Phase 13 Persistenz (explizit) ·
Phase 14 Benchmark.

Die vollständige Spezifikation liegt unter [`docs/spec/`](docs/spec/).

## Verbindliche Grenzen

Siehe [`AGENTS.md`](AGENTS.md). Kurzfassung: keine Permission-/
Verification-/Recovery-Logik duplizieren, keine zweite Subagenten-
Execution-Engine, kein automatischer Plan→Work-Wechsel, keine automatische
Permission-Erhöhung, Nested Delegation max. Depth 2, Root-only Dynamic
Agent Creation, Writer-Concurrency startet bei 1.

## Lizenz

MIT
