# Agent Instructions – Pi RabbitMode

## Arbeitsweise

Dieses Repository ist eine Orchestrierungs-Extension. Änderungen müssen die Grenzen zu `daydaylx/pi` und `daydaylx/pi-subagents` respektieren.

## Unverhandelbare Regeln

- Keine Permission-Logik duplizieren.
- Keine Verification-Logik duplizieren.
- Keine Recovery-Logik duplizieren.
- Keine zweite Subagent-Execution-Engine.
- Keine versteckten Plan->Work-Wechsel.
- Keine automatischen YOLO-/Permission-Erhöhungen.
- Rabbit läuft mit `max`; kein stiller Downgrade.
- Dynamische Agenten bleiben standardmäßig ephemeral.
- Nested Depth maximal 2.
- Root-only dynamic agent creation.
- Writer concurrency initial 1.
- Bestehende Pi-Shortcuts nicht verändern; einzige neue Bindung ist `Super+Alt+R`.
- `Super+R` und `Shift+Tab` müssen unverändert bleiben.
- TUI rendert Zustand; TUI entscheidet keine Orchestrierungs-/Permission-Regeln.

## Vor jedem Change

1. aktuellen Upstream/Pin prüfen
2. öffentliche API vor internem Import bevorzugen
3. fail-closed bei fehlender Capability
4. Test für Regression hinzufügen
5. keine unnötige Abstraktion ohne zweiten realen Consumer

## Komplexitätsregel

RabbitMode ist absichtlich mächtig, darf aber nicht zu einem allgemeinen Workflow-Framework werden.

Jede neue Abstraktion muss mindestens eine konkrete Rabbit-Anforderung erfüllen.

## Rabbit Visual Directive

RabbitMode ist die bewusste Ausnahme von normaler visueller Zurückhaltung.

Im `expressive` Modus:

- Effekte nicht aus Minimalismusgründen entfernen
- Animationen aktiv ausbauen
- Electric-Blue Spezialmodus deutlich inszenieren
- mehrere gleichzeitige, sinnvolle Bewegungsebenen sind erlaubt
- "nervig, aber lesbar" ist akzeptabel

Nur reduzieren, wenn ein konkreter technischer oder ergonomischer Schaden nachweisbar ist.

`reduced` und `off` müssen selbstverständlich respektiert werden.
