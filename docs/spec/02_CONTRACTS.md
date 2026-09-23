# RabbitMode Contracts

## 1. Aktivierungsvertrag

Kanonische Wege:

```text
Super+Alt+R   -> /rabbit toggle
/rabbit on
/rabbit off
/rabbit status
/rabbit stop
```

`Super+R` bleibt `/resume`.

`Shift+Tab` bleibt vollständig unverändert.

## 2. Session-Vertrag

RabbitMode:

- startet `off`
- ist nur für die aktuelle Session aktiv
- wird nicht ungefragt persistiert
- wird nicht automatisch anhand einer Aufgabe aktiviert
- stellt bei Deaktivierung die vorherige normale Thinking-Stufe wieder her

## 3. Effort-Vertrag

RabbitMode erzwingt:

```text
effectiveThinking = max
```

für:

- Root Supervisor
- dynamische Rabbit-Agenten
- im Rabbit-Workflow verwendete bestehende Agenten
- Nested Rabbit-Agenten

Ein Modell ist im RabbitMode nur verwendbar, wenn:

1. es durch die bestehende ModelScope-Policy erlaubt ist
2. es `max` unterstützt

Es gibt **keinen stillen Fallback von `max` auf `high`**.

Bei inkompatiblem Modell:

```text
RABBIT_MODEL_INCOMPATIBLE
requiredThinking: max
```

Dann muss ein anderes zulässiges Modell gewählt oder der Step abgebrochen werden.

## 4. Workflow-Vertrag

RabbitMode ersetzt weder Work noch Plan.

Für Version 1:

- mutierende Rabbit-Ausführung nur in `work`
- in Plan Mode darf RabbitMode nicht automatisch zu Work wechseln
- Plan -> Work bleibt explizite Nutzeraktion
- RabbitMode darf im Plan Mode höchstens diagnostischen Status anzeigen, aber keinen mutierenden Rabbit-Run starten

## 5. Permission-Vertrag

Effektive Child-Fähigkeit:

```text
parent permission
INTERSECT agent tool allowlist
INTERSECT rabbit policy
INTERSECT workflow restrictions
```

RabbitMode darf niemals:

- YOLO einschalten
- Permission-Level erhöhen
- Plan-Schutz umgehen
- Secret-/Credential-Grenzen umgehen
- Trust-Gates umgehen
- Recovery-Gates umgehen

## 6. Dynamic Agent Contract

Eine ephemeral Definition enthält mindestens:

```text
id
purpose
instructions
tools
context
model?
thinking = max
writeScope?
mayDelegate
maxDepth
```

Regeln:

- standardmäßig session-lokal
- Root Supervisor darf neue Agententypen definieren
- Child Agents dürfen keine neuen Agententypen erfinden
- Child Agents dürfen nur freigegebene Rollen delegieren
- Persistenz nur nach explizitem User-Command

## 7. Write Contract

Jeder mutierende dynamische Agent benötigt einen `writeScope`.

Beispiel:

```text
extensions/permissions/**
tests/workflow-mode/**
```

Initial:

```text
mutationConcurrency = 1
```

Keine zwei mutierenden Agenten gleichzeitig im selben Workspace.

Worktree-basierte parallele Writer sind ausdrücklich spätere Erweiterung.

## 8. Replanning Contract

Workflow-Revisionen:

- sind begrenzt
- werden nummeriert
- überschreiben die Historie nicht
- benötigen einen konkreten neuen Befund
- dürfen Limits/Permissions nicht ausweiten

Beispiel:

```text
revision 1 -> initial graph
revision 2 -> recovery dependency discovered
```

## 9. Verification Contract

RabbitMode ersetzt Verification nicht.

Reihenfolge nach Mutation:

```text
targeted checks
-> project_check(profile=verify)
-> hard verifier wenn bestehende Policy dies fordert
-> final synthesis
```

`FAIL` darf nicht durch einen beliebigen Reviewer "überstimmt" werden.

`INCOMPLETE` ist kein PASS.

## 10. Stop Contract

`/rabbit stop`:

- stoppt laufende Rabbit-Execution kontrolliert
- nutzt vorhandene Runtime-Stop-Kanäle
- markiert offene Steps als stopped/incomplete
- entfernt keine Historie

`/rabbit off` während laufender Agenten darf den Run nicht still abbrechen.
