# pi-rabbitmode

RabbitMode ist eine opt-in Orchestrierungsschicht für [Pi](https://github.com/daydaylx/pi)
(`daydaylx/pi`), die für komplexe Aufgaben dynamische, ephemere Subagenten
über die bestehende [`pi-subagents`](https://github.com/daydaylx/pi-subagents)
Runtime orchestriert. RabbitMode ist **kein** neuer Permission-Level und
**kein** vierter Workflow-Modus — es ist eine separat aktivierbare Schicht
oberhalb von Pis bestehendem Permission-/Workflow-/Verification-System.

## Status: Orchestrator-MVP-Implementierung · Multi-Step-Live-E2E noch offen · Phase 11 bewusst nicht gebaut · Phase 14 zurückgestellt

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
  (`id`/`purpose`/`instructions`/`tools`/optional `task`), RabbitMode
  schreibt sie als `.pi/agents/rabbit-dynamic/<id>.md` und kann sie direkt
  oder in einem Workflow spawnen (`src/orchestration/dynamic-role.ts`).
  Die Datei bleibt bis `/rabbit off` oder Session-Ende auffindbar; aktiven
  Child-Runs wird Cleanup nicht vorzeitig entzogen.
  **Tools sind hart auf read-only beschränkt** (`read`, `grep`, `find`,
  `ls` — nie `bash`/`write`/`edit`), maximal 8 dynamische Rollen pro
  Session, Frontmatter-Injection-Schutz für nutzergenerierten Text. Siehe
  „Bewusste Ausnahme" unten.
- `/rabbit workflow <json>` — deklarativer DAG (`src/orchestration/
  graph.ts`): mehrere Steps mit `dependsOn`, begrenzter Parallelität
  (Default 3), Zyklus-/Unknown-Dependency-Validierung und transitivem Skip.
  Abhängige Steps erhalten ausschließlich die explizit deklarierten,
  erfolgreichen Vorgänger-Ergebnisse, mit UTF-8-Limit und sichtbarer
  Truncation-Markierung. Ephemere Rollen aus `/rabbit define` können in
  Workflow-Steps verwendet werden; das Bereinigen einer Rolle wartet, bis
  alle zugehörigen Child-Runs sie freigegeben haben.
- Der Main Agent bleibt Supervisor und erhält in aktivem RabbitMode drei
  Tools: `rabbit_define_role` (session-lokale read-only Spezialistenrolle),
  `rabbit_workflow` (validierter DAG mit genau einem terminalen
  Synthese-Step) und `rabbit_replan` (neue Befunde, neue Synthese,
  append-only, maximal drei Revisionen). Die Systemanweisung empfiehlt
  einfache Aufgaben selbst zu lösen, vorhandene Rollen vorzuziehen und
  Child-Ergebnisse samt Unsicherheit ehrlich zusammenzuführen.
- Für jeden Rabbit-Child wird `provider/model:max` explizit im v1-Spawn
  angefordert; wenn das Root-Modell `max` nicht unterstützt, wird fail-closed
  abgebrochen. Ob die installierte `pi-subagents`-Version den Override so
  interpretiert und tatsächlich `max` verwendet, muss ein echter Runtime-
  End-to-End-Test belegen (siehe Verifikation unten).
- `/rabbit replan <json>` — begrenztes Replanning (`docs/spec/
  02_CONTRACTS.md` §8): fügt dem aktuellen Workflow neue Steps als
  numerierte Revision hinzu, verlangt einen konkreten Grund
  (`"reason"`), maximal 3 Revisionen pro Workflow
  (`docs/spec/01_ARCHITECTURE.md` §7 — die *adaptive* Revisionsanzahl aus
  Issue #1 ist bewusst Post-MVP), überschreibt keine ältere Revision und
  kann Limits (Parallelität) nicht ausweiten. Bereits abgeschlossene
  Steps werden nie erneut gespawnt.
- `/rabbit verify [profil]` — abgespeckte Form von Phase 12 (siehe
  „Bewusst abgespeckt: Phase 12" unten): übergibt per `pi.sendUserMessage`
  eine Aufforderung an den aktiven Agenten, `project_check` mit dem
  angegebenen Profil (Default `verify`) selbst auszuführen. Nicht an
  aktives RabbitMode gebunden (berührt keinen Rabbit-eigenen State).
- `/rabbit save-agent <id>` (Phase 13) — verschiebt eine noch nicht
  aufgeräumte `/rabbit define`-Rolle von `.pi/agents/rabbit-dynamic/`
  (ephemeral, auto-cleanup) nach `.pi/agents/rabbit-saved/` und nimmt sie
  aus der Cleanup-Verfolgung — sie überlebt `/rabbit off` und Session-Ende.
  Kein neues Dateiformat, keine umgeschriebene Frontmatter: derselbe
  Inhalt, nur nicht mehr zum Löschen vorgemerkt. Explizit, nie automatisch.
- `/rabbit save-workflow <name>` (Phase 13) — schreibt die vollständige,
  append-only Revisionshistorie des laufenden Workflows (Steps + Replan-
  Gründe + kondensierte Step-Ergebnisse) als JSON nach
  `.pi/rabbit-workflows/<name>.json`. Reiner Audit-/Referenz-Snapshot: es
  gibt bewusst **keinen** Lademechanismus (`/rabbit workflow` akzeptiert
  weiterhin nur Inline-JSON) — das wäre neue, nicht angeforderte
  Orchestrierungs-Oberfläche, keine Persistenz von etwas, das bereits läuft.
- Nested Delegation (`docs/spec/02_CONTRACTS.md` §6: „Nested Depth
  maximal 2"): keine eigene Tiefenzählung — `pi-subagents` hat dafür
  bereits einen Mechanismus (`PI_SUBAGENT_DEPTH`/`PI_SUBAGENT_MAX_DEPTH`,
  pro Rolle per `maxSubagentDepth`-Frontmatter). Jede von `pi-rabbitmode`
  geschriebene Rolle (die drei mitgelieferten Audit-Rollen und jede
  `/rabbit define`-Rolle) setzt `maxSubagentDepth: 2` explizit. In der
  Praxis rein vorsorglich: keine dieser Rollen bekommt ein
  delegationsfähiges Tool (`bash`/`subagent`), kann also aktuell ohnehin
  nicht weiter verschachteln.

Ein gemeinsamer Run-Controller (eine Instanz pro Extension-Session) ist die
Autorität für Run-ID, Revision, Laufphase, aktive Steps und Child-Run-IDs.
Er publiziert `rabbit:runtime-state`, versorgt Widget und `/rabbit status`,
und `/rabbit stop` ruft den bestehenden `pi-subagents`-Stop-Kanal auf;
`/rabbit off` bleibt gesperrt, bis der Run beendet ist. Während eines
laufenden Spawns bleibt Stop als ausstehend sichtbar und der Child wird nach
Rückkehr gestoppt.

`/rabbit on` schaltet einen internen Zustand um, erzwingt `max`-Thinking
für den Root Agent und wechselt Theme/Widget — es verändert nie
Permission-Level oder Workflow-Mode, auch nicht indirekt. `Super+R` (Resume) und `Shift+Tab`
(Workflow-Menü) bleiben unverändert; RabbitMode registriert ausschließlich
die neue, bisher unbelegte Bindung `Super+Alt+R`. Jede dynamische Rolle
(egal ob erfolgreich, fehlgeschlagen oder noch aktiv) wird spätestens beim
Ausschalten von RabbitMode entfernt — nicht erst bei Session-Ende: ein
Listener auf das interne `rabbit:mode-changed`-Event deckt `/rabbit off`,
`/rabbit toggle` und den `Super+Alt+R`-Shortcut an einer Stelle ab, ein
zweiter Pfad in `session_shutdown` fängt den Fall auf, dass die Session
endet während RabbitMode noch aktiv ist.

### Bewusst nicht gebaut: Phase 11 (Writer)

`docs/spec/02_CONTRACTS.md` §7 verlangt mutierende dynamische Agenten mit
`writeScope`. Das wurde geprüft und **bewusst nicht umgesetzt**:

1. `pi-subagents` hat keinen bestehenden `writeScope`-Mechanismus (0
   Treffer im Quellcode) — eine echte, technisch durchgesetzte
   Pfad-Sandbox hätte entweder eine `pi-subagents`-Änderung gebraucht
   (außerhalb dieser Runde) oder eine eigene Permission-artige Prüfung in
   `pi-rabbitmode`, was gegen "keine Permission-Logik duplizieren"
   verstößt. `pi-rabbitmode` hat zudem keine Sicht auf einzelne Tool-Calls
   eines bereits gespawnten Kindprozesses — `writeScope` wäre technisch
   nur eine im Prompt eingebettete, nicht durchgesetzte Deklaration
   gewesen.
2. Ein schreibfähiger, automatisch erzeugter und sofort gestarteter
   Agent widerspricht direkt `docs/decisions/
   011-investigator-debugger-verifier.md` in `daydaylx/pi` ("Hauptagent
   bleibt alleiniger regulärer Patch-Eigentümer... ohne einen zweiten
   schreibenden Agenten") — eine bewusste, dokumentierte
   Architekturentscheidung dieses Projekts.
3. Beim Versuch, `edit`/`write` für dynamische Rollen freizuschalten, hat
   der Sicherheits-Klassifizierer der ausführenden Umgebung selbst die
   Aktion mit der Begründung „Create Unsafe Agents" blockiert. Das wird
   als harte Plattformgrenze behandelt, nicht als Hindernis zum Umgehen.

Dynamische Rollen bleiben deshalb read-only-only (`read`, `grep`, `find`,
`ls`) — siehe `docs/spec/01_ARCHITECTURE.md` §7 zu `writeScope`-Beispielen
für eine spätere, sorgfältiger geprüfte Runde, falls gewünscht.

### Bewusst abgespeckt: Phase 12 (Verification-Integration)

`docs/spec/02_CONTRACTS.md` §9 und `docs/spec/11_AGENT_WORK_ORDER.md` §12
definieren den Verification Contract als Kette **nach einer Mutation**:
`targeted checks -> project_check(profile=verify) -> hard verifier wenn
Policy fordert -> synthesis`. Da Phase 11 (Writer) dauerhaft nicht gebaut
wurde (siehe oben), gibt es in RabbitMode aktuell keinen Mutationspfad —
weder dynamische Rollen noch Workflow-Steps können etwas ändern. Phase 12
wie spezifiziert hätte deshalb keinen realen Trigger-Punkt und würde gegen
die eigene Komplexitätsregel verstoßen ("keine Abstraktion ohne
konkreten Consumer").

Stattdessen liefert diese Runde eine bewusst abgespeckte Version:
`/rabbit verify [profil]` ist ein reiner Komfort-Trigger für das echte
`project_check`-Tool, gedacht für den Fall, dass die Nutzerin nach einem
RabbitMode-Befund selbst etwas geändert hat — nicht mutationsgekoppelt,
weil RabbitMode selbst nicht mutiert.

`project_check` ist ein per `pi.registerTool` registriertes,
LLM-seitiges Tool (`extensions/setup-core/index.ts` in `daydaylx/pi`) —
eine Extension kann es nicht direkt aufrufen, ohne in ein fremdes Repo
hineinzugreifen (verboten durch `03_REPOSITORY_BOUNDARIES.md` und "keine
Verification-Logik duplizieren"). `/rabbit verify` nutzt deshalb den
bereits etablierten Mechanismus `pi.sendUserMessage(...)` (siehe
`extensions/plan-mode/commands.ts` in `daydaylx/pi` für das reale
Vorbild): es übergibt eine Aufforderung an den aktiven Agenten, der
`project_check` dann selbst über seinen eigenen Tool-Call-Turn ausführt
— RabbitMode implementiert Verification nicht neu, es delegiert an die
echte. `FAIL bleibt FAIL`, `INCOMPLETE gilt nicht als PASS` steht
deshalb explizit im übergebenen Prompt.

Bewusst nicht gebaut in dieser abgespeckten Form: ein automatischer
`targeted checks`-Schritt davor, ein automatischer Hard-Verifier-Trigger
danach und eine eigene Synthese — das bleibt, wie im Contract
beschrieben, dem aktiven Agenten und Pis bestehender Policy überlassen,
nicht RabbitMode.

**Live gefundene Einschränkung:** ein echter `pi -e /home/g/Projekte/
pi-rabbitmode --model <erlaubt> -p "/rabbit verify"`-Smoketest zeigte,
dass `sendUserMessage`s erzwungener zweiter Turn — von einem
Command-Handler außerhalb der normalen interaktiven Turn-Loop ausgelöst
— den Single-Shot-Kontrollfluss von `--print`/`--mode json` korrumpiert
(`"turn_end could not resolve the persisted assistant entry ID"`, dazu
kaskadierende `"stale ctx"`-Fehler aus fremden Extensions wie
`plan-mode`/`setup-core`). `/rabbit verify` prüft deshalb jetzt zuerst
`ctx.hasUI` (laut `ExtensionContext`-Typdefinition `true` nur in
TUI/RPC, `false` in print/json) und bricht dort sauber mit einer
Warnung ab, statt den Turn-Zustand zu korrumpieren. In der
interaktiven TUI (der eigentlichen Zielumgebung) bleibt `/rabbit
verify` unverändert nutzbar.

### Phase 13: Persistenz — save-agent bewusst als Move, save-workflow bewusst ohne Lademechanismus

`docs/spec/05_IMPLEMENTATION_PHASES.md` gibt für Phase 13 nur die beiden
Command-Namen vor, explizit nutzergetriggert, nie automatisch — die
Formatentscheidungen unten sind diese Runde selbst getroffen und hier
dokumentiert, nicht aus der Spec übernommen.

- `/rabbit save-agent <id>` erfindet kein neues Dateiformat: `pi-subagents`
  entdeckt `.pi/agents/` bereits rekursiv (siehe Phase 7 oben), also
  verschiebt `save()` (`src/orchestration/dynamic-role.ts`) die
  bestehende `.md`-Datei nur von `rabbit-dynamic/` (auto-cleanup) nach
  `rabbit-saved/` (kein Cleanup mehr) und behält die
  `package: rabbit-dynamic`-Frontmatter bewusst bei — ehrliche Herkunft
  ("diese Rolle wurde ursprünglich von RabbitMode automatisch erzeugt"),
  kein Grund, das zu verschleiern.
- `/rabbit save-workflow <name>` (`src/orchestration/
  workflow-persistence.ts`) ist ein reiner JSON-Audit-Snapshot der
  vollständigen `WorkflowSession.revisions()`-Historie. Es gibt bewusst
  **keinen** `/rabbit workflow <gespeicherter-name>`-Lademechanismus:
  `/rabbit workflow` akzeptiert weiterhin ausschließlich Inline-JSON. Ein
  Loader wäre neue, von der Spec nicht verlangte Orchestrierungs-Oberfläche
  (verstößt gegen die Komplexitätsregel) — diese Runde persistiert, was
  bereits gelaufen ist, sie baut keine Wiederverwendungs-Funktion.
- Beide Commands sind, wie `/rabbit define`/`/rabbit workflow`, an
  aktives RabbitMode gebunden (anders als `/rabbit verify`): sie
  operieren direkt auf Rabbit-eigenem State (der Dynamic-Role-Registry
  bzw. der laufenden `WorkflowSession`), nicht auf einem
  repository-fremden Tool.

### Bewusst zurückgestellt: Phase 14 (Benchmark/Rollout)

`docs/spec/05_IMPLEMENTATION_PHASES.md` verlangt für Phase 14 einen
empirischen Vergleich Standard-Pi vs. RabbitMode: Qualität,
Tokenverbrauch, Modellaufrufe, Laufzeit, unnötige Delegationen,
gefundene Fehler, Verifier-Abdeckung, Fehlerraten, Recovery-Verhalten.

Das ist grundsätzlich anders als Phase 0–13: keine Code-/Test-Aufgabe,
sondern eine Messaufgabe, die echte, laufende Pi-Sessions mit echten
Vergleichsaufgaben und echtem Token-/Zeit-Tracking braucht. Eine
Umsetzungssitzung ohne Zugriff auf eine laufende Pi-TUI-Instanz kann
sie nicht durchführen — weder ein Scaffolding vorab noch erfundene
Zahlen wären eine ehrliche Erfüllung dieser Phase. Phase 14 bleibt
deshalb bewusst offen, bis jemand mit einer echten Pi-Session die
Vergleichsläufe tatsächlich durchführt. Alle anderen Phasen (0–13,
mit Phase 11 bewusst nicht und Phase 12 bewusst abgespeckt) sind
umgesetzt.

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

### Phase 8: Status-Polling — live verifiziert, ein echter Bug gefunden und behoben

`spawn` startet immer detached/async (von `pi-subagents` selbst erzwungen);
um zu wissen, wann ein Step fertig ist, pollt `src/orchestration/
status-adapter.ts` die `status`-RPC-Methode. Die Interpretation dieser
Antwort war ursprünglich nur statisch aus dem `Details`/`SingleResult`-Typ
in `~/.pi/agent/git/github.com/daydaylx/pi-subagents/src/shared/
types/results.ts` erschlossen, nicht gegen einen echten Lauf verifiziert.

Ein echter `pi -e /home/g/Projekte/pi-rabbitmode -p "/rabbit on" "/rabbit
workflow {...}"`-Smoketest hat das jetzt nachgeholt — und einen echten Bug
gefunden: ein `status`-Poll unmittelbar nach `spawn` (bevor `pi-subagents`
die Statusdatei des neuen Async-Runs überhaupt geschrieben hat) kam als
`success: false, error: {code: "execution_failed", message: "Status file
not found."}` zurück. Die ursprüngliche Logik behandelte **jeden**
`!reply.success`-Fall als sofortigen, endgültigen Fehlschlag — dadurch
schlug praktisch jeder Workflow-Step innerhalb von ~1 Sekunde fehl, bevor
der gespawnte Agent überhaupt zu arbeiten begonnen hatte. Das ist ein reiner
Race, kein echter Fehlschlag — derselbe „noch nicht fertig"-Zustand wie ein
leeres `results`-Array, nur über den Fehlerkanal statt über eine
Erfolgs-Hülle gemeldet. `interpretStatusReply` behandelt diesen exakten
Text jetzt identisch zu einem leeren `results`-Array (weiterpollen), der
allgemeine Poll-Timeout (10 Minuten) bleibt als Obergrenze unverändert
bestehen. Nach dem Fix hat derselbe Smoketest einen echten, vollständigen
Workflow-Step (Ergebnis korrekt bis zum fertigen Text durchgereicht)
erfolgreich abgeschlossen. Der DAG-Scheduler selbst (Abhängigkeiten,
Parallelitätsgrenze, Skip-Kaskaden) war davon unabhängig und bereits
vollständig getestet.

## Architektur (MVP-Stand)

```text
daydaylx/pi              Host / Policy / Permissions / Verification / Aurora
        |
        v
daydaylx/pi-rabbitmode    Run-State / Supervisor-Tools / DAG / Dynamic Roles (dieses Repo)
        |
        v
daydaylx/pi-subagents     Child execution / chains / parallel / nested
```

`daydaylx/pi` bleibt für alle drei Repositories die alleinige Autorität für
Permissions, Trust, Recovery und Verification. `pi-rabbitmode` besitzt
Rabbit-Session-State, einen Run-Controller und die deklarative Orchestrierung
über vorhandene `pi-subagents`-RPCs — niemals ein eigenes Permission-,
Recovery- oder Verification-System und niemals eine zweite
Subagenten-Execution-Engine.
Details: [`docs/spec/03_REPOSITORY_BOUNDARIES.md`](docs/spec/03_REPOSITORY_BOUNDARIES.md).

## Commands

| Command | Wirkung |
| --- | --- |
| `/rabbit` / `/rabbit toggle` | schaltet zwischen `off` und `active` |
| `/rabbit on` | aktiviert RabbitMode (No-Op, falls bereits aktiv) |
| `/rabbit off` | deaktiviert RabbitMode (No-Op, falls bereits aus) |
| `/rabbit status` | zeigt Mode, `pi-subagents`-Erreichbarkeit, Rabbit-Run-Phase/aktive Steps und rein informativ beobachtete Aurora-Werte |
| `/rabbit spawn <rolle> <Aufgabe>` | startet `investigator`\|`debugger`\|`verifier`\|`permission-auditor`\|`recovery-auditor`\|`architecture-auditor` (nur bei aktivem RabbitMode) |
| `/rabbit define <json>` | definiert und startet eine neue, session-lokale Rolle (read-only, siehe oben; nur bei aktivem RabbitMode) |
| `/rabbit workflow <json>` | führt einen deklarativen DAG aus Steps mit Abhängigkeiten aus (siehe oben; nur bei aktivem RabbitMode) |
| `/rabbit replan <json>` | fügt dem laufenden Workflow eine begründete, numerierte Revision hinzu, max. 3 (siehe oben; nur bei aktivem RabbitMode) |
| `/rabbit verify [profil]` | fordert `project_check` mit dem angegebenen Profil (Default `verify`) beim aktiven Agenten an (siehe „Bewusst abgespeckt: Phase 12" unten; **nicht** an aktives RabbitMode gebunden) |
| `/rabbit save-agent <id>` | macht eine noch ephemerale `/rabbit define`-Rolle dauerhaft (siehe oben; nur bei aktivem RabbitMode) |
| `/rabbit save-workflow <name>` | schreibt einen JSON-Audit-Snapshot des laufenden Workflows (siehe oben; nur bei aktivem RabbitMode) |
| `/rabbit stop` | stoppt laufende Child-Runs kontrolliert; fehlgeschlagene Stop-Aufrufe werden gemeldet, ein Spawn-Race bleibt als ausstehend markiert |

Der State ist rein session-lokal (In-Memory), wird nirgends persistiert und
ist nach einem Neustart immer `off`.

## Verifikationsstand

`npm run typecheck` und `npm run test` prüfen die Implementierung lokal.
`status-adapter.ts` wurde zuvor bereits mit einem echten `pi-subagents`-
Workflow-Step live verifiziert. Die neue Supervisor-Kette (mehrstufiger
Fan-out/Fan-in, tatsächlicher Child-MAX-Override und Stop über die aktive
Runtime) braucht noch einen interaktiven Pi-Test mit bestätigtem
`rabbit_workflow`-Tool; `--mode json` kann die dafür nötige Extension-Tool-
Freigabe nicht anzeigen. Bis dahin ist dieser Live-Abnahmepunkt offen.

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

## Grenzen / spätere Arbeit

Der MVP bleibt read-only: keine Writer-Agenten, keine Permission-Erhöhung,
kein `subagents:rpc:v2`, keine automatische Persistenz außer den expliziten
Save-Commands und kein gespeicherter Workflow-Lademechanismus. Phase 14
Benchmark/Rollout bleibt eine empirische Messaufgabe mit echten, laufenden
Pi-Sessions (siehe „Bewusst zurückgestellt: Phase 14" unten).

Die vollständige Spezifikation liegt unter [`docs/spec/`](docs/spec/).

## Verbindliche Grenzen

Siehe [`AGENTS.md`](AGENTS.md). Kurzfassung: keine Permission-/
Verification-/Recovery-Logik duplizieren, keine zweite Subagenten-
Execution-Engine, kein automatischer Plan→Work-Wechsel, keine automatische
Permission-Erhöhung, Nested Delegation max. Depth 2, Root-only Dynamic
Agent Creation, Writer-Concurrency startet bei 1.

## Lizenz

MIT
