# Pi RabbitMode – Implementierungspaket

## Zweck

Dieses Paket beschreibt die Implementierung von **RabbitMode** als eigenständige Pi-Extension.

**Ziel-Repository:** `daydaylx/pi-rabbitmode`

RabbitMode ist kein neuer Permission-Level und kein vierter Plan-/Work-Modus. Es ist eine separat aktivierbare Orchestrierungsschicht für komplexe Aufgaben.

## Verbindliche Kernentscheidungen

- Name: **RabbitMode**
- Repository: `daydaylx/pi-rabbitmode`
- Aktivierung: **`Super+Alt+R`**
- Command: `/rabbit`
- Effort/Thinking im RabbitMode: **immer `max`**
- Modelle ohne `max`-Unterstützung sind für Rabbit-Ausführung nicht zulässig
- bestehendes `Super+R -> Resume` bleibt unverändert
- bestehendes `Shift+Tab`-Workflow-Menü bleibt unverändert
- RabbitMode ist standardmäßig aus und session-lokal
- RabbitMode benötigt für mutierende Ausführung `work`
- RabbitMode verändert Permission-Level niemals automatisch
- dynamische Agenten sind standardmäßig ephemeral
- Nested Delegation ist erlaubt, aber begrenzt
- Analyse darf begrenzt parallel laufen
- Writer-Concurrency startet mit `1`
- `pi-subagents` bleibt die Execution Runtime
- Pi bleibt Autorität für Permissions, Verification, Recovery und Workflow
- Aurora bleibt Eigentümerin der TUI-Darstellung
- visuelle Rabbit-Identität: kalte/electric-blue Effekte und Tiefenwirkung

## Baseline

Planung basiert auf dem zuletzt geprüften Stand:

- `daydaylx/pi` main: `d6a87553d23d7f54d87a2fc3c04e0b985b98a22b`
- dort gepinnte `pi-subagents` Runtime:
  `75e6a8685ccfc7968816a059a10173854f0d3c8a`

Vor Implementierungsbeginn muss der Agent den aktuellen Remote-Stand erneut prüfen und Abweichungen dokumentieren.

## Paketinhalt

- `01_ARCHITECTURE.md` – Zielarchitektur
- `02_CONTRACTS.md` – technische Verträge und Invarianten
- `03_REPOSITORY_BOUNDARIES.md` – Verantwortlichkeiten der Repositories
- `04_RABBIT_TUI.md` – blaue visuelle Identität und TUI-Verhalten
- `05_IMPLEMENTATION_PHASES.md` – Reihenfolge der Umsetzung
- `06_TEST_MATRIX.md` – verpflichtende Tests
- `07_ACCEPTANCE_CRITERIA.md` – Definition of Done
- `08_RISKS_AND_NON_GOALS.md` – Risiken und bewusste Nicht-Ziele
- `09_FILE_PLAN.md` – geplante Dateistruktur
- `10_INTEGRATION_PLAN.md` – Änderungen in Pi und pi-subagents
- `11_AGENT_WORK_ORDER.md` – direkt nutzbarer Arbeitsauftrag
- `AGENTS.md` – Ausführungsregeln für Coding Agents
- `MANIFEST.json` – maschinenlesbare Eckdaten

## Wichtig

Dieses Paket ist eine **Implementierungsspezifikation**. Es enthält bewusst noch keine vollständige TypeScript-Implementierung.
