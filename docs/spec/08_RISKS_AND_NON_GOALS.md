# Risiken und Nicht-Ziele

## P0-Risiken

### Permission Escape

Dynamische Agenten dürfen niemals durch eigene Definitionen mehr Rechte erhalten.

Gegenmaßnahme:

```text
effective = parent ∩ agent ∩ rabbit ∩ workflow
```

### Plan -> Work Bypass

Rabbit darf Plan Mode nicht automatisch verlassen.

### Unbounded Recursion

Nested Delegation technisch auf Depth 2 begrenzen.

### Agent Explosion

Harte Limits für Agenten, Parallelität, Fan-out und Revisionen.

### Verification Bypass

Rabbit darf FAIL oder INCOMPLETE nicht durch alternative Reviewer wegargumentieren.

## P1-Risiken

### Zweite Runtime

Keine eigene Spawn-/Chain-/Parallel-Engine bauen.

### Zu viel UI

Blue Shift darf Aurora nicht zu einer separaten Rabbit-TUI duplizieren.

### Repository-Kopplung

Nur versionierte öffentliche Contracts zwischen Pi, RabbitMode und pi-subagents.

### Thinking Capability Drift

Nicht aus Modellnamen ableiten. Capability gegen Runtime/Registry prüfen.

### Writer Collision

V1: mutation concurrency = 1.

## Nicht-Ziele V1

Nicht implementieren:

- unbegrenzte Agenten
- unbegrenzte Rekursion
- automatische YOLO-Aktivierung
- Permission-Eskalation
- automatisches Plan->Work
- parallele Writer im selben Workspace
- automatische persistente Agent-Dateien
- selbstmodifizierende Workflow-Scripts
- eigene Recovery-Engine
- eigene Verification-Engine
- eigene Subagent-Runtime
- Ersatz für Pi Editor
- Ersatz für Shift+Tab
- generische Workflow-Programmiersprache
- Rabbit standardmäßig aktiv

## Rabbit-spezifische UX-Ausnahme

RabbitMode ist bewusst kein zurückhaltender Produktivitätsmodus.

Folgendes ist **kein** Risiko an sich:

- sehr viele Animationen
- starke Blue-Glow-Effekte
- auffällige Übergänge
- visuelle Überzeichnung
- eine Oberfläche, die zeitweise bewusst "zu viel" wirkt

Erst wenn Lesbarkeit, Eingabe, semantische Statusfarben, Terminal-Stabilität oder Performance leiden, wird daraus ein tatsächlicher Befund.

Die Implementierung darf RabbitMode nicht aus allgemeinem "weniger ist mehr"-UX-Denken wieder auf das normale Aurora-Niveau herunterkürzen.
