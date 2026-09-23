# pi-rabbitmode

RabbitMode ist eine opt-in Orchestrierungsschicht für [Pi](https://github.com/daydaylx/pi)
(`daydaylx/pi`), die für komplexe Aufgaben dynamische, ephemere Subagenten
über die bestehende [`pi-subagents`](https://github.com/daydaylx/pi-subagents)
Runtime orchestriert. RabbitMode ist **kein** neuer Permission-Level und
**kein** vierter Workflow-Modus — es ist eine separat aktivierbare Schicht
oberhalb von Pis bestehendem Permission-/Workflow-/Verification-System.

## Status: Phase 1–10 Grundgerüst

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
- einen Client für `pi-subagents`' bestehendes v1 EventBus-RPC
  (`subagents:rpc:v1:*`, `src/runtime/subagents-rpc.ts`): `/rabbit status`
  pingt die Runtime (kurzer Timeout) und zeigt an, ob sie erreichbar ist
- `/rabbit spawn <rolle> <Aufgabe>` startet eine bereits installierte Rolle
  über das v1-`spawn`-RPC — die drei projekteigenen Basisrollen
  (`investigator`, `debugger`, `verifier`) sowie drei von `pi-rabbitmode`
  selbst mitgelieferte, read-only Audit-Rollen
  (`permission-auditor`, `recovery-auditor`, `architecture-auditor`,
  unter `agents/`, automatisch von `pi-subagents` entdeckt über den
  `pi.subagents.agents`-Manifest-Schlüssel)
- `/rabbit define <json>` — echte Ephemeral-Agent-Erzeugung: der
  Hauptagent kann zur Laufzeit eine **neue** Rolle definieren
  (`id`/`purpose`/`instructions`/`tools`/`task`), RabbitMode schreibt sie
  als `.pi/agents/rabbit-dynamic/<id>.md`, spawnt sie sofort und löscht
  die Datei danach wieder (`src/orchestration/dynamic-role.ts`).
  **Tools sind hart auf read-only beschränkt** (`read`, `grep`, `find`,
  `ls` — nie `bash`/`write`/`edit`), maximal 8 dynamische Rollen pro
  Session, Frontmatter-Injection-Schutz für nutzergenerierten Text. Siehe
  „Bewusste Ausnahme" unten.
- `/rabbit workflow <json>` — deklarativer DAG (`src/orchestration/
  graph.ts`): mehrere Steps mit `dependsOn`, begrenzter Parallelität
  (Default 3, `docs/spec/01_ARCHITECTURE.md` §7), Zyklus-/Unknown-Dependency-
  Validierung, transitivem Skip bei fehlgeschlagener Abhängigkeit — genau
  das Beispiel-Fan-out aus `docs/spec/01_ARCHITECTURE.md` §5
  (`permission-auditor`/`recovery-auditor`/`architecture-auditor` →
  Synthese-Step). Steps referenzieren nur bereits installierte Rollen
  (Baseline oder mitgelieferte Bundled-Rollen) — inline `/rabbit
  define`-Definitionen innerhalb eines Workflow-Steps sind bewusst noch
  nicht eingebaut (siehe „Grenze in Phase 8" unten).
- `/rabbit replan <json>` — begrenztes Replanning (`docs/spec/
  02_CONTRACTS.md` §8): fügt dem aktuellen Workflow neue Steps als
  numerierte Revision hinzu, verlangt einen konkreten Grund
  (`"reason"`), maximal 3 Revisionen pro Workflow
  (`docs/spec/01_ARCHITECTURE.md` §7 — die *adaptive* Revisionsanzahl aus
  Issue #1 ist bewusst Post-MVP), überschreibt keine ältere Revision und
  kann Limits (Parallelität) nicht ausweiten. Bereits abgeschlossene
  Steps werden nie erneut gespawnt.
- Nested Delegation (`docs/spec/02_CONTRACTS.md` §6: „Nested Depth
  maximal 2"): keine eigene Tiefenzählung — `pi-subagents` hat dafür
  bereits einen Mechanismus (`PI_SUBAGENT_DEPTH`/`PI_SUBAGENT_MAX_DEPTH`,
  pro Rolle per `maxSubagentDepth`-Frontmatter). Jede von `pi-rabbitmode`
  geschriebene Rolle (die drei mitgelieferten Audit-Rollen und jede
  `/rabbit define`-Rolle) setzt `maxSubagentDepth: 2` explizit. In der
  Praxis rein vorsorglich: keine dieser Rollen bekommt ein
  delegationsfähiges Tool (`bash`/`subagent`), kann also aktuell ohnehin
  nicht weiter verschachteln.

**Es gibt noch keinen Writer.** `/rabbit on` schaltet
einen internen Zustand um, erzwingt `max`-Thinking und wechselt
Theme/Widget — es verändert nie Permission-Level oder Workflow-Mode, auch
nicht indirekt. `Super+R` (Resume) und `Shift+Tab` (Workflow-Menü) bleiben
unverändert; RabbitMode registriert ausschließlich die neue, bisher
unbelegte Bindung `Super+Alt+R`.

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

### Bewusste Grenze in Phase 6: nur v1-RPC, kein v2-Protokoll

`docs/spec/10_INTEGRATION_PLAN.md` empfiehlt für Capability Discovery,
Ephemeral-Agent-Definitionen und deklarative Graph-/Chain-Ausführung ein
neues `subagents:rpc:v2`. Das würde echten Code in `daydaylx/pi-subagents`
selbst ändern — einem dritten, aktiv weiterentwickelten Repository mit
eigener Historie (nicht nur einer Spezifikationsidee). Diese Runde bindet
bewusst nur das bereits vorhandene, stabile v1-Protokoll an
(`ping`/`status`/`spawn`/`interrupt`/`stop`, Event-Namen `subagents:rpc:v1:*`
— exakt aus `~/.pi/agent/git/github.com/daydaylx/pi-subagents/src/extension/
rpc.ts` übernommen, nicht importiert, da `pi-subagents` selbst kein
`exports`-Feld hat). `daydaylx/pi-subagents` selbst bleibt in dieser Runde
unverändert.

### Phase 7: echte Ephemeral-Agent-Erzeugung ohne v2 — bewusste Ausnahme vom V1-Nicht-Ziel

`docs/spec/08_RISKS_AND_NON_GOALS.md` nennt für V1 explizit als
Nicht-Ziel: „keine automatische persistente Agent-Dateien". `/rabbit
define` ist eine bewusste, vom Nutzer angeforderte Ausnahme davon: statt
auf das fehlende v2-Protokoll zu warten, nutzt es einen bereits
vorhandenen, öffentlichen Mechanismus — `pi-subagents` durchsucht beim
Rollen-Discovery auch projektlokale `.pi/agents/`-Verzeichnisse
(`~/.pi/agent/git/github.com/daydaylx/pi-subagents/src/agents/
agent-discovery.ts`). RabbitMode schreibt dorthin, spawnt, und löscht die
Datei wieder — der *Zweck* bleibt ephemeral/session-lokal, auch wenn die
Rolle technisch kurz auf der Platte liegt (pi-subagents kann eine Rolle
nur aus einer Datei entdecken, es gibt keinen In-Memory-Weg).

Weil das eine Rolle mit echtem Tool-Zugriff automatisch erzeugt, ist die
Sicherheitsgrenze im Code erzwungen, nicht nur empfohlen:

- Tools nur aus `["read", "grep", "find", "ls"]` — kein `bash`/`write`/`edit`
  kann je über `/rabbit define` vergeben werden.
- jedes Freitext-Feld, das ins Frontmatter wandert (`purpose`), wird gegen
  Frontmatter-Injection geprüft (keine Newlines, kein `---`) — ein
  bösartiger `purpose`-Text kann keine zusätzlichen Frontmatter-Felder wie
  `tools: bash` einschmuggeln.
- maximal 8 dynamische Rollen pro Session
  (`docs/spec/01_ARCHITECTURE.md` §7).
- Cleanup bei Erfolg, Fehlschlag und als Fallback bei `session_shutdown` —
  keine verwaiste Rollendatei überlebt die Session.

Verzichtet wird hier bewusst weiterhin auf: Schreib-/Ausführungs-Tools für
dynamische Rollen, Nested-Delegation dynamischer Rollen und ein
`v2`-Protokoll in `pi-subagents` selbst.

### Bewusste Grenze in Phase 8: Status-Polling ist best-effort, nicht live verifiziert

`spawn` startet immer detached/async (von `pi-subagents` selbst erzwungen);
um zu wissen, wann ein Step fertig ist, pollt `src/orchestration/
status-adapter.ts` die `status`-RPC-Methode. Die genaue Antwortstruktur für
einen noch laufenden vs. fertigen Run ist aus dem `Details`/`SingleResult`-
Typ in `~/.pi/agent/git/github.com/daydaylx/pi-subagents/src/shared/
types/results.ts` **statisch erschlossen, nicht gegen einen echten Lauf
verifiziert** — der einzige verfügbare Live-Klon hat bereits nicht
committete Arbeit einer anderen Session (siehe Phase-6-Commit). Die
Interpretation ist deshalb bewusst in einer einzigen Funktion
(`interpretStatusReply`) isoliert und mit einer auffälligen ⚠️-Markierung
versehen, damit sie an genau einer Stelle korrigiert werden kann, sobald
sie gegen einen echten Lauf geprüft wurde. Der DAG-Scheduler selbst
(Abhängigkeiten, Parallelitätsgrenze, Skip-Kaskaden) ist davon unabhängig
und vollständig getestet.

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
| `/rabbit status` | zeigt Mode, `pi-subagents`-Erreichbarkeit und, rein informativ, den zuletzt auf dem Aurora-Bus beobachteten Permission-Level/Workflow-Mode |
| `/rabbit spawn <rolle> <Aufgabe>` | startet `investigator`\|`debugger`\|`verifier`\|`permission-auditor`\|`recovery-auditor`\|`architecture-auditor` (nur bei aktivem RabbitMode) |
| `/rabbit define <json>` | definiert und startet eine neue, session-lokale Rolle (read-only, siehe oben; nur bei aktivem RabbitMode) |
| `/rabbit workflow <json>` | führt einen deklarativen DAG aus Steps mit Abhängigkeiten aus (siehe oben; nur bei aktivem RabbitMode) |
| `/rabbit replan <json>` | fügt dem laufenden Workflow eine begründete, numerierte Revision hinzu, max. 3 (siehe oben; nur bei aktivem RabbitMode) |
| `/rabbit stop` | meldet noch immer "kein aktiver Rabbit-Run" — Interrupt/Stop für einen laufenden Workflow ist noch nicht angebunden |

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
öffentlicher Aurora-Motion-Hook existiert) · Phase 6b `subagents:rpc:v2`
(eigene Entscheidung/Umsetzung in `daydaylx/pi-subagents`) · Phase 8b
Status-Polling live verifizieren · inline `/rabbit define` innerhalb
eines Workflow-Steps · Phase 11 Writer · Phase 12
Verification-Integration · Phase 13 Persistenz (explizit) · Phase 14
Benchmark.

Die vollständige Spezifikation liegt unter [`docs/spec/`](docs/spec/).

## Verbindliche Grenzen

Siehe [`AGENTS.md`](AGENTS.md). Kurzfassung: keine Permission-/
Verification-/Recovery-Logik duplizieren, keine zweite Subagenten-
Execution-Engine, kein automatischer Plan→Work-Wechsel, keine automatische
Permission-Erhöhung, Nested Delegation max. Depth 2, Root-only Dynamic
Agent Creation, Writer-Concurrency startet bei 1.

## Lizenz

MIT
