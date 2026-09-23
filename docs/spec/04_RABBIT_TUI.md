# RabbitMode TUI – Blue Shift

## Ziel

RabbitMode muss unmittelbar visuell erkennbar sein, ohne die bestehende Aurora-TUI neu zu bauen.

Standard:

- warmes `aurora-forge`

Rabbit:

- kalte, tiefblaue visuelle Identität
- Electric-Blue Akzente
- Tiefen-/Branching-Darstellung
- semantische Fehlerfarben bleiben erhalten

## Palette – Richtung

Vorgeschlagene Leitwerte:

```text
Background      #07101C
Deep Surface    #0B1726
Surface         #102237
Highlight       #163755

Rabbit Blue     #3D9CFF
Electric Blue   #63B3FF
Ice Blue        #9DD7FF
Deep Blue       #235C91
```

Diese Werte sind Designrichtung, keine unveränderliche Implementierungsvorgabe. Kontrasttests sind verbindlich.

Success bleibt grün.
Warning bleibt amber/gelb.
Error bleibt rot.

Blau bedeutet:

- RabbitMode
- Orchestrierung
- Hierarchie
- Workflow-Struktur

## Theme-Verhalten

Empfehlung:

- `pi-rabbitmode` liefert `aurora-rabbit.json`
- Aurora/Pi bleibt Eigentümer des Renderings
- beim Rabbit-Enter vorheriges Theme merken
- Rabbit Theme session-lokal aktivieren
- beim Exit vorheriges Theme wiederherstellen
- keine dauerhafte Änderung von `settings.json`

## Aktivierungseffekt

Expressive Motion:

```text
          ◇
        ◇ ◆ ◇
      ◇ ◆ ◉ ◆ ◇

       RABBIT

      ◇ ◆ ◉ ◆ ◇
        ◇ ◆ ◇
          ◇
```

Nur kurz.

Reduced Motion:

```text
◆ RABBIT ON
```

Motion Off:

- nur Theme-/Statuswechsel
- keine Animation

## Footer

Normal:

```text
WORK │ Luna │ Denken hoch │ ~/pi
```

Rabbit:

```text
◆ RABBIT │ WORK │ Luna │ MAX │ ~/pi
```

Breit:

```text
[ ◆ RABBIT ]  WORK │ Luna │ MAX │ ~/pi
```

Laufender Workflow:

```text
[ ◆ RABBIT 3/8 ]  A3 │ Luna MAX │ ~/pi
```

Kompakt:

```text
◆R │ W │ MAX │ ~/pi
```

Rabbit-Status ist Orientation State und darf auf kleinen Terminals nicht vollständig verschwinden.

## Activity Surface

Beispiel:

```text
◆ RABBIT · BRANCHING

  ● permission-auditor
    checking execution boundaries

  ● recovery-investigator
    tracing state recovery

  ○ regression-hunter
    waiting for dependency

  ─────────────────────────
  Depth 1 · Agents 2/3 · Step 3/8
```

## Dynamischer Agent

Kurzzeitige Meldung:

```text
◇ SPAWN
  permission-boundary-auditor
  Luna · MAX · read-only
```

Anschließend normale Activity-Zeile.

## Replanning

```text
↻ RABBIT · DEEPER

New dependency discovered:
recovery -> permission state

Workflow revision 2/3

+ state-transition-auditor
+ recovery regression pass
```

Keine dauerhafte große Box.

## Nested Delegation

Darstellung:

```text
◆ RABBIT · DEPTH 2

├─✓ architecture
├─● permissions
│   ├─● shell-boundary
│   └─● file-boundary
└─● recovery
```

Farbe darf Tiefe unterstützen, aber Zustand darf nie ausschließlich über Farbe vermittelt werden.

## Motion

Vorhandene Aurora Motion Engine wiederverwenden.

Keine zweite Ticker-/Animation-Engine.

Mögliche zusätzliche Visual States:

- `orchestrating`
- `branching`
- `synthesizing`
- `replanning`

Intern sachliche Namen behalten.

## Verbindliche Effekt-Philosophie – absichtlich übertrieben

RabbitMode soll **nicht subtil** aussehen.

Die visuelle Abgrenzung vom normalen Pi ist Teil der Funktion. Sobald RabbitMode aktiv ist, darf und soll die TUI deutlich überzeichneter wirken als Aurora Forge.

Verbindliche Designrichtung:

- viele sichtbare Animationen
- Electric-Blue / Ice-Blue Leuchteffekte
- pulsierende Statusflächen
- animierte Branch-/Depth-Linien
- deutlich sichtbare Spawn-Effekte
- animierte Workflow-Transitions
- kurze Glitch-/Scan-/Sweep-Effekte
- wechselnde Aktivitätsglyphen
- sichtbares "Abtauchen" bei steigender Delegationstiefe
- auffällige Replanning-Animationen
- starke Aktivierungs- und Deaktivierungssequenz
- Agent-Spawn darf kurz den Fokus der Statusfläche übernehmen
- erfolgreiche Synthese/Verification darf mit klarer Abschlussanimation quittiert werden
- bei parallelen Agenten darf die Oberfläche bewusst lebendig und "beschäftigt" aussehen

**RabbitMode darf absichtlich zeitweise nervig wirken.**

Das ist kein normales Produktivitäts-Theme, sondern ein bewusst aktivierter Spezialmodus. Der Nutzer hat RabbitMode explizit eingeschaltet und soll jederzeit erkennen, dass Pi gerade in einer außergewöhnlichen, teuren und stark orchestrierenden Betriebsart läuft.

Die Gestaltung soll deshalb eher in Richtung:

```text
special mode / overdrive / deep dive / system unlocked
```

gehen und ausdrücklich **nicht** in Richtung:

```text
subtle enterprise status indicator
```

### Effektbudget

Im normalen Aurora gilt Zurückhaltung.

Im RabbitMode gilt das Gegenteil:

```text
Standard Aurora:
  Effekte dienen Information.

RabbitMode:
  Information + Inszenierung.
```

Es ist zulässig, dass mehrere Effekte gleichzeitig sichtbar sind, solange die eigentlichen Inhalte weiterhin lesbar bleiben.

Beispiele:

```text
      ◇      ◆
   ◇   ◆  ◇      ◇
        RABBIT
   ▸ DESCENDING ▸
  ◇   ◆   ◉   ◆   ◇
```

oder während Fan-out:

```text
◆ RABBIT · BRANCHING

          ╭─◉ permission
      ╭───┼─◉ recovery
◆━━━━━┥   ╰─◉ architecture
      ╰───────▷ SYNTHESIS
```

Die Darstellung darf animiert pulsieren, auffächern oder "tiefer" werden.

### Bewusste Ausnahme zur normalen UI-Zurückhaltung

Für RabbitMode ist **"zu viel Bewegung" nicht automatisch ein Designfehler**.

Ein Effekt soll nur entfernt oder reduziert werden, wenn er:

1. Text unlesbar macht,
2. Eingaben behindert,
3. Statusinformationen verdeckt,
4. Terminal-Rendering instabil macht,
5. erhebliche CPU-Last erzeugt,
6. bei kleinen Terminals das Layout zerstört.

"Das wirkt etwas nervig" ist ausdrücklich **kein** ausreichender Grund, den Effekt zu entfernen.

### Motion Modes

Trotz der absichtlich übertriebenen Standarddarstellung bleiben bestehende Accessibility-/Motion-Schalter autoritativ.

Empfohlene Interpretation:

```text
expressive:
  volle Rabbit-Inszenierung

contextual:
  viele Rabbit-Effekte, aber weniger permanente Bewegung

reduced:
  starke statische Blue-Shift-Identität,
  nur kurze Zustandswechsel

off:
  keine Animation,
  aber weiterhin deutliches Rabbit-Theme und ◆ RABBIT Status
```

RabbitMode darf `reduced` oder `off` niemals eigenmächtig überschreiben.

### Performance Guardrail

Effekte müssen über die vorhandene Aurora-Motion-/Render-Infrastruktur laufen.

Verboten:

- ungebremste eigene Timer
- mehrere konkurrierende Animation Loops
- Render-I/O
- Animationen, die Agent-/Workflow-Logik treiben
- Polling nur für visuelle Effekte

Die TUI darf spektakulär aussehen; die Runtime darunter muss trotzdem deterministisch bleiben.
