# Integrationsplan

## Pi -> RabbitMode

Pi muss RabbitMode nicht hart kennen.

Bevorzugt über Events/Capabilities:

```text
rabbit:capabilities:request
rabbit:status
rabbit:mode-changed
rabbit:activity
```

Die finalen Namen erst nach Prüfung bestehender Event-Konventionen festlegen.

## RabbitMode -> Pi

Rabbit benötigt:

- semantischen Command Hook
- Session Lifecycle
- Thinking-Steuerung
- Model Registry/Capabilities
- Workflow Capability Snapshot
- Permission-/Trust-Zustand nur lesend
- UI/Status Event Bus
- Verification Entry Point

Keine privaten Imports, wenn öffentliche Extension APIs existieren.

## RabbitMode -> pi-subagents

Aktueller v1-RPC kann bereits als Basis dienen:

- ping
- status
- spawn
- interrupt
- stop

Für Rabbit fehlen voraussichtlich öffentliche Fähigkeiten für:

- Capability Discovery
- Ephemeral Agent Definition
- deklarativen Graph / dynamische Chain
- ggf. strukturierte Parent-Orchestrierung

Empfehlung:

`subagents:rpc:v2`

V2 muss intern denselben Executor verwenden.

## Capability Handshake

RabbitMode startet nur voll, wenn:

```text
pi-subagents installed
AND compatible RPC
AND model supports max
AND workflow/permission provider available
```

Fehlt etwas:

```text
RABBIT DEGRADED / UNAVAILABLE
```

Nicht fail-open.

## Package Pinning

In `daydaylx/pi` RabbitMode auf exakten Commit pinnen:

```text
git:github.com/daydaylx/pi-rabbitmode@<sha>
```

RabbitMode und pi-subagents müssen reproduzierbar versioniert werden.

## Setup Doctor

Soll prüfen:

- Rabbit package vorhanden
- erwartete RPC-Version
- Shortcut registriert
- Theme verfügbar
- max-thinking capability
- aktueller pi-subagents Pin
- keine verbotene Parallel-/Permission-Konfiguration
