# pi-rabbitmode

RabbitMode ist eine opt-in Orchestrierungsschicht für [Pi](https://github.com/daydaylx/pi)
(`daydaylx/pi`), die für komplexe Aufgaben dynamische, ephemere Subagenten
über die bestehende [`pi-subagents`](https://github.com/daydaylx/pi-subagents)
Runtime orchestriert. RabbitMode ist **kein** neuer Permission-Level und
**kein** vierter Workflow-Modus — es ist eine separat aktivierbare Schicht
oberhalb von Pis bestehendem Permission-/Workflow-/Verification-System.

## Status: Phase 1–5 Grundgerüst

Diese Version implementiert ausschließlich:

- ein installierbares, standardmäßig **wirkungsloses** Pi-Package
- session-lokalen Rabbit-State (`off` | `active`)
- `/rabbit on|off|status|stop` (plus `/rabbit`/`/rabbit toggle` als Toggle-Alias)
- `Super+Alt+R` als zusätzlichen Shortcut, der exakt denselben Toggle-Pfad
  wie `/rabbit toggle` aufruft (keine doppelte Logik im Shortcut-Handler)
- erzwungenes `max`-Thinking während RabbitMode aktiv ist: die vorherige
  Stufe wird gemerkt und beim Deaktivieren wiederhergestellt; ein Modell
  ohne `max`-Unterstützung lässt `/rabbit on` fehlschlagen
  (`RABBIT_MODEL_INCOMPATIBLE`) statt still auf eine niedrigere Stufe zu
  fallen
- ein eigenes `aurora-rabbit`-Theme (kalte Electric-Blue-Identität,
  `themes/aurora-rabbit.json`), das beim Aktivieren übernommen und beim
  Deaktivieren auf das vorherige Theme zurückgesetzt wird (nie dauerhaft
  in `settings.json` geschrieben)
- einen `◆ RABBIT · MAX`-Statuswidget (`ctx.ui.setWidget`, über dem Editor),
  sichtbar solange RabbitMode aktiv ist

**Es gibt noch keine Orchestrierung, keine Subagenten-Ansteuerung.**
`/rabbit on` schaltet einen internen Zustand um, erzwingt `max`-Thinking und
wechselt Theme/Widget — es verändert nie Permission-Level oder
Workflow-Mode, auch nicht indirekt. `Super+R` (Resume) und `Shift+Tab`
(Workflow-Menü) bleiben unverändert; RabbitMode registriert ausschließlich
die neue, bisher unbelegte Bindung `Super+Alt+R`.

### Bewusste Grenze in Phase 5: keine kontinuierliche Animation

`docs/spec/04_RABBIT_TUI.md` beschreibt eine absichtlich übertriebene,
durchgehend animierte Darstellung (Glow-/Pulse-/Sweep-Effekte, animierte
Branch-Linien). Diese Runde liefert davon bewusst nur den **statischen,
ereignisgetriebenen** Teil (Theme-Wechsel + einmaliges Setzen des
Statuswidgets bei `/rabbit on`/`/rabbit off`), aus zwei Gründen:

1. `daydaylx/pi`s geteilte Motion-/Ticker-Infrastruktur
   (`AnimationTicker`/`STATE_VISUALS` in `extensions/aurora-ui/index.ts`)
   hat aktuell keinen öffentlichen Hook, über den ein externes Package
   Frames abonnieren oder eigene visuelle Zustände registrieren kann. Eine
   eigene, unabhängige Zeitschleife zu bauen ist durch den Contract
   ausdrücklich verboten ("Keine zweite Ticker-/Animation-Engine",
   `docs/spec/02_CONTRACTS.md`).
2. Ein solcher Hook wäre eine Änderung an Auroras geteiltem, von jeder
   Session genutzten Rendering-Code in `daydaylx/pi` — dort kann diese
   Umsetzung das Ergebnis nicht visuell verifizieren (kein Zugriff auf ein
   echtes Terminal-Rendering). Eine ungeprüfte Änderung an diesem
   gemeinsam genutzten Code wird hier bewusst vermieden.

Damit sind Kriterien wie "Rabbit Status wird von Aurora dargestellt"
(Aurora rendert das Widget selbst) und "Blue-Shift auch auf kleinen
Terminals erkennbar" (Theme deckt das ab) bereits erfüllt; die volle
"spektakuläre", durchgehend bewegte Inszenierung bleibt offen für eine
spätere Runde, idealerweise zusammen mit einer bewussten Entscheidung, ob
und wie ein solcher Hook in `daydaylx/pi` aussehen soll.

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

Phase 5b Rabbit-TUI-Feinschliff (durchgehende Animation, sobald ein
öffentlicher Aurora-Motion-Hook existiert) · Phase 6 `pi-subagents`-
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
