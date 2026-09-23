# Agent Instructions – Pi RabbitMode

## Aktueller Stand

Dieses Repository befindet sich in **Phase 1–10** (Grundgerüst,
session-lokaler Rabbit-State, `/rabbit`-Command, `Super+Alt+R`-Shortcut,
erzwungenes `max`-Thinking mit Restore und Modell-Capability-Check,
`aurora-rabbit`-Theme + Statuswidget — statisch, noch ohne kontinuierliche
Animation —, v1-RPC-Client zu `pi-subagents`, `/rabbit spawn` für
Basisrollen und drei mitgelieferte Audit-Rollen, `/rabbit define` für
echte session-lokale Ephemeral-Agent-Erzeugung mit hart read-only
begrenztem Tool-Zugriff, `/rabbit workflow` für einen deklarativen DAG mit
Abhängigkeiten und begrenzter Parallelität, `/rabbit replan` für
begrenztes, begründungspflichtiges Replanning (max. 3 Revisionen),
`maxSubagentDepth: 2` auf jeder von `pi-rabbitmode` geschriebenen Rolle
(reutilisiert `pi-subagents`' eigenen Tiefen-Mechanismus statt einer
zweiten Engine) — siehe README.md für Sicherheitsgrenzen und die noch
unverifizierte Status-Polling-Annahme). Es gibt noch keinen Writer und
kein `subagents:rpc:v2` in `pi-subagents` selbst. Die vollständige
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
- Dynamische Agenten bleiben standardmäßig ephemeral: Rollendateien aus
  `/rabbit define` werden nach Gebrauch wieder gelöscht (Cleanup bei
  Erfolg, Fehlschlag und als Fallback bei `session_shutdown`).
- Tools dynamisch erzeugter Rollen sind hart auf `read, grep, find, ls`
  begrenzt — kein `bash`/`write`/`edit`, keine Ausnahme.
- Nested Depth maximal 2: jede von `pi-rabbitmode` geschriebene Rolle
  setzt `maxSubagentDepth: 2` in ihrer Frontmatter (`pi-subagents`' eigener
  Mechanismus, siehe `src/orchestration/dynamic-role.ts`).
- Root-only dynamic agent creation: nur `/rabbit define` (vom Hauptagenten
  ausgelöst) erzeugt Rollen; es gibt keinen Pfad, über den ein gespawnter
  Child selbst neue Rollen anlegt.
- Writer concurrency initial 1. (ab Phase 11)
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
