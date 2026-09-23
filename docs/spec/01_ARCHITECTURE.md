# Zielarchitektur

## 1. Architekturprinzip

RabbitMode wird als eigenständige Orchestrierungsschicht umgesetzt:

```text
daydaylx/pi
  Host / Policy / Verification / Aurora
              |
              v
daydaylx/pi-rabbitmode
  Orchestration / Workflow / Dynamic Agents
              |
              v
daydaylx/pi-subagents
  Child execution / chains / parallel / nested
```

Es darf keine zweite Subagent-Execution-Engine entstehen.

## 2. Zustandsdimensionen

Die bestehenden Dimensionen bleiben getrennt:

```text
Workflow:
  work | simple_plan | detailed_plan

Permission:
  bestehende Pi-Permission-Level

Thinking:
  normale Auswahl im Standardmodus

Orchestration:
  standard | rabbit
```

RabbitMode ist **keine** Erweiterung von `WorkflowMode`.

## 3. RabbitMode State Machine

```text
OFF
 |
 v
ENTERING
 |
 v
ACTIVE
 |
 +-- ORCHESTRATING
 +-- BRANCHING
 +-- SYNTHESIZING
 +-- IMPLEMENTING
 +-- VERIFYING
 +-- REPLANNING
 |
 v
EXITING
 |
 v
OFF
```

Zustände müssen nach außen über einen kleinen Statusvertrag publiziert werden.

## 4. Supervisor-Rolle

Im RabbitMode ist der Main Agent primär Supervisor:

- Aufgabe klassifizieren
- benötigte Rollen bestimmen
- vorhandene Rollen bevorzugen
- nur bei Bedarf dynamische Spezialisten definieren
- Workflow als Graph planen
- parallele Analyse koordinieren
- Ergebnisse synthetisieren
- Workflow bei neuen Befunden revidieren
- Implementation koordinieren
- bestehende Verification-Gates auslösen
- Abschlusszustand begründet feststellen

Der Main Agent darf weiterhin selbst arbeiten. RabbitMode zwingt keine Delegation, wenn sie keinen Mehrwert bringt.

## 5. Execution Graph

Rabbit-Workflows sind deklarative DAGs.

Beispiel:

```text
                    +-> permission-auditor --+
DISCOVERY ----------+-> recovery-auditor ----+-> SYNTHESIS
                    +-> architecture-auditor +       |
                                                     v
                                              IMPLEMENTATION
                                                     |
                                                     v
                                                   TESTS
                                                     |
                                                     v
                                                 VERIFIER
                                               /          \
                                            PASS          FAIL
                                             |             |
                                            DONE         REPAIR
                                                            |
                                                            +-> VERIFIER
```

Keine beliebige Script-Sprache für Workflowsteuerung.

## 6. Dynamische Agenten

Priorität:

```text
investigator passend?
  -> ja: verwenden
debugger passend?
  -> ja: verwenden
verifier passend?
  -> ja: verwenden
sonst:
  -> dynamischen ephemeral Spezialisten definieren
```

Dynamische Rollen sollen eng geschnitten sein und nur die Tools erhalten, die für ihre Aufgabe notwendig sind.

## 7. Limits

Empfohlene Startwerte:

- dynamische Agenten pro Rabbit-Run: `8`
- gleichzeitig aktive Agenten: `3`
- Delegationstiefe: `2`
- Workflow-Steps: `12`
- Workflow-Revisionen: `3`
- Repair-Runden: `2`
- dynamischer Fan-out: `6`
- mutierende Agenten gleichzeitig: `1`

Limits müssen technisch erzwungen und im Status sichtbar sein.
