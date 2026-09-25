# Agent Instructions – Pi RabbitMode

## Aktueller Stand

Dieses Repository befindet sich in **Phase 1–10 + Phase 12 (abgespeckt) +
Phase 13; Phase 11 bewusst nicht gebaut, Phase 14 bewusst zurückgestellt**
(Grundgerüst,
session-lokaler Rabbit-State, `/rabbit`-Command, `Super+Alt+R`-Shortcut,
erzwungenes `max`-Thinking mit Restore und Modell-Capability-Check,
`aurora-rabbit`-Theme + Statuswidget — statisch, noch ohne kontinuierliche
Animation —, v1-RPC-Client zu `pi-subagents`, `/rabbit spawn` für
das `verifier`-Profil und temporäre Spec-Agenten (die frühere Rollenbibliothek
mit `/rabbit define` und Audit-Rollen ist entfernt), `/rabbit workflow` für einen deklarativen DAG mit
Abhängigkeiten und begrenzter Parallelität, `/rabbit replan` für
begrenztes, begründungspflichtiges Replanning (max. 3 Revisionen),
`maxSubagentDepth: 2` auf jeder von `pi-rabbitmode` geschriebenen Rolle
(reutilisiert `pi-subagents`' eigenen Tiefen-Mechanismus statt einer
zweiten Engine), echter Dependency-Ergebnisfluss mit UTF-8-Limit, ein
session-weiter Run-Controller samt Stop/Race-Tracking und Main-Agent-
Supervisor-Tools für DAG, Dynamic Roles und begründetes Replanning — siehe
README.md für Sicherheitsgrenzen. Child-Spawns fordern `provider/model:max`
explizit an; die tatsächliche MAX-Interpretation der installierten Runtime
und die neue mehrstufige Supervisor-Kette müssen weiterhin interaktiv live
verifiziert werden. Status-Polling
(`src/orchestration/status-adapter.ts`) ist live gegen einen echten
`pi-subagents`-Lauf verifiziert; ein dabei gefundener Race (`status`-Poll
unmittelbar nach `spawn` liefert `"Status file not found."`, wurde
fälschlich als sofortiger Fehlschlag statt als "noch nicht fertig"
behandelt) ist behoben — siehe README.md unter "Phase 8: Status-Polling".
Dynamische Rollendateien sind
strikt an ein aktives RabbitMode-Fenster gebunden: der `rabbit:mode-
changed`-Listener in `src/extension/index.ts` räumt bei jeder
Deaktivierung (`/rabbit off`, Toggle, Shortcut) auf, `session_shutdown`
bleibt als awaited Fallback, falls die Session bei noch aktivem
RabbitMode endet — siehe `test/extension.test.ts`. Phase 11 (Writer)
wurde geprüft und bewusst **nicht** gebaut (drei Gründe, vollständig in
README.md unter "Bewusst nicht gebaut: Phase 11"): kein
wiederverwendbarer `writeScope`-Mechanismus in `pi-subagents`, Konflikt
mit ADR 011, und zuletzt ein Block durch die Sicherheitsschicht der
Ausführungsumgebung selbst beim Versuch, dynamischen Rollen
Schreibzugriff zu geben ("Create Unsafe Agents") — das gilt als harte
Plattformgrenze, nicht als Präferenz, die man umgehen könnte. Dynamische
Rollen bleiben deshalb dauerhaft read-only-only. `/rabbit verify [profil]`
deckt die dadurch entstandene, abgespeckte Form von Phase 12 ab: ein
reiner Komfort-Trigger für das echte `project_check`-Tool über
`pi.sendUserMessage` (nicht mutationsgekoppelt, da RabbitMode selbst nie
mutiert — vollständige Begründung in README.md unter "Bewusst
abgespeckt: Phase 12"). `/rabbit save-workflow
<name>` schreibt einen reinen JSON-Audit-Snapshot der Workflow-
Revisionshistorie nach `.pi/rabbit-workflows/` — bewusst ohne
Lademechanismus (vollständige Begründung in README.md unter "Phase 13:
Persistenz"). Phase 14 (Benchmark/Rollout, empirischer Standard-vs-
Rabbit-Vergleich) ist keine Code-/Test-Aufgabe, sondern eine Messaufgabe
mit echten, laufenden Pi-Sessions — aus einer Umsetzungssitzung ohne
Zugriff auf eine laufende Pi-TUI-Instanz nicht ehrlich durchführbar
(weder als Scaffolding noch mit erfundenen Zahlen) und bleibt deshalb
bewusst offen (vollständige Begründung in README.md unter "Bewusst
zurückgestellt: Phase 14"). Es gibt noch keinen Writer und kein
`subagents:rpc:v2` in `pi-subagents` selbst. Die vollständige
Original-Spezifikation liegt unter
[`docs/spec/`](docs/spec/) (11 Dateien + `MANIFEST.json`) und bleibt über
alle Phasen hinweg die kanonische Referenz für Architektur, Contracts,
Testmatrix und Acceptance Criteria. Diese Datei fasst nur die Regeln
zusammen, die für Coding-Agenten in **jeder** Phase gelten.

## Arbeitsweise

Dieses Repository ist eine Orchestrierungs-Extension. Änderungen müssen
die Grenzen zu `daydaylx/pi` und `daydaylx/pi-subagents` respektieren
(siehe [`docs/spec/03_REPOSITORY_BOUNDARIES.md`](docs/spec/03_REPOSITORY_BOUNDARIES.md)).

## Unverhandelbare Regeln

- Keine Permission-Logik duplizieren.
- Keine Verification-Logik duplizieren.
- Keine Recovery-Logik duplizieren.
- Keine zweite Subagent-Execution-Engine.
- Keine versteckten Plan->Work-Wechsel.
- Keine automatischen YOLO-/Permission-Erhöhungen.
- Rabbit läuft mit `max`; kein stiller Downgrade.
- Temporäre Agenten laufen über den Spec-Pfad (`daydaylx/pi` ADR 031): keine
  Rollendateien, keine dauerhafte Identität, nur `read`/`search`. Die
  frühere Rollenbibliothek (`/rabbit define`, `rabbit_define_role`,
  Audit-Rollen, `dynamic-role.ts`) wurde entfernt.
- Nested Depth maximal 2 über `pi-subagents`' eigenen Mechanismus
  (`PI_SUBAGENT_MAX_DEPTH`); temporäre Agenten erhalten kein Delegations-Tool.
- Kein Writer: temporäre Agenten erhalten dauerhaft keinen
  `write`-/`edit`-/`bash`-Zugriff — Phase 11 wurde geprüft und bewusst
  nicht umgesetzt (siehe "Aktueller Stand" oben und README.md).
- `project_check` niemals selbst ausführen oder nachbauen: `/rabbit
  verify` delegiert ausschließlich per `pi.sendUserMessage` an den
  aktiven Agenten, der das echte, per `pi.registerTool` registrierte Tool
  selbst aufruft (`src/rabbit/commands.ts`). Konkretisiert "keine
  Verification-Logik duplizieren" für diesen Command.
- `/rabbit verify` läuft nur mit `ctx.hasUI === true` (TUI/RPC) —
  `sendUserMessage`s erzwungener zweiter Turn korrumpiert nachweislich
  (echter `pi -p`-Smoketest) den Single-Shot-Kontrollfluss von
  `--print`/`--mode json`. Diese Gate nicht entfernen, ohne den
  zugrundeliegenden Pi-Core-Konflikt anderweitig gelöst zu haben.
- Persistenz nur explizit: `/rabbit save-workflow` ist der einzige Pfad,
  über den etwas RabbitMode-Erzeugtes eine Session überlebt. Kein anderer Code-Pfad darf automatisch persistieren.
  `/rabbit save-workflow` bleibt ein reiner Audit-Snapshot ohne Lade-
  mechanismus — kein `/rabbit workflow <name>` für gespeicherte Workflows.
- Bestehende Pi-Shortcuts nicht verändern; einzige neue Bindung ist
  `Super+Alt+R`.
- `Super+R` und `Shift+Tab` müssen unverändert bleiben.
- TUI rendert Zustand; TUI entscheidet keine Orchestrierungs-/
  Permission-Regeln. (ab Phase 5)

## Vor jedem Change

1. aktuellen Upstream/Pin prüfen
2. öffentliche API vor internem Import bevorzugen
3. fail-closed bei fehlender Capability
4. Test für Regression hinzufügen
5. keine unnötige Abstraktion ohne zweiten realen Consumer

## Komplexitätsregel

RabbitMode ist absichtlich mächtig, darf aber nicht zu einem allgemeinen
Workflow-Framework werden.

Jede neue Abstraktion muss mindestens eine konkrete Rabbit-Anforderung
erfüllen.

## Später (Phase 5) — Rabbit Visual Directive

Nicht Teil der aktuellen Phase, hier nur als verbindliche Designrichtung
für die spätere TUI-Umsetzung festgehalten (vollständig in
[`docs/spec/04_RABBIT_TUI.md`](docs/spec/04_RABBIT_TUI.md)):

RabbitMode ist die bewusste Ausnahme von normaler visueller Zurückhaltung.

Im `expressive` Modus:

- Effekte nicht aus Minimalismusgründen entfernen
- Animationen aktiv ausbauen
- Electric-Blue Spezialmodus deutlich inszenieren
- mehrere gleichzeitige, sinnvolle Bewegungsebenen sind erlaubt
- "nervig, aber lesbar" ist akzeptabel

Nur reduzieren, wenn ein konkreter technischer oder ergonomischer Schaden
nachweisbar ist. `reduced` und `off` müssen selbstverständlich respektiert
werden.
