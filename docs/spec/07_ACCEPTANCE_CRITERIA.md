# Acceptance Criteria

RabbitMode gilt erst als implementiert, wenn alle folgenden Punkte erfüllt sind:

1. eigenes Repository `daydaylx/pi-rabbitmode`
2. installierbar als Pi-Package/Extension
3. standardmäßig deaktiviert
4. `Super+Alt+R` toggelt RabbitMode
5. `/rabbit` bietet denselben kanonischen Zustandspfad
6. `Super+R` bleibt Resume
7. `Shift+Tab` bleibt unverändert
8. RabbitMode ist keine `WorkflowMode`-Erweiterung
9. RabbitMode verändert Permission-Level nicht
10. RabbitMode erzwingt `max`
11. normales Thinking wird nach Exit korrekt wiederhergestellt
12. Modelle ohne `max` werden nicht still auf `high` reduziert
13. ModelScope bleibt bindend
14. vorhandene feste Rollen werden vor dynamischer Erzeugung bevorzugt
15. dynamische Agenten sind session-lokal
16. Agenten-Persistenz passiert nur explizit
17. Nested Delegation ist auf Depth 2 begrenzt
18. dynamische Agentenerzeugung ist Root-only
19. Parallelität ist technisch begrenzt
20. Writer concurrency startet bei 1
21. Child Permission <= Parent Permission
22. Plan Mode wird nicht automatisch verlassen
23. Recovery-/Trust-/Secret-Grenzen bleiben autoritativ
24. `pi-subagents` bleibt Execution Runtime
25. keine zweite Child-Process-/Chain-Engine
26. Rabbit Workflow kann begrenzt revidiert werden
27. Revisionshistorie bleibt erhalten
28. `project_check` bleibt kanonischer Verifikationsweg
29. Hard-Verifier-Gates bleiben unverändert
30. FAIL/INCOMPLETE können nicht weggeorchestriert werden
31. Rabbit Status wird von Aurora dargestellt
32. Rabbit-Blue-Shift ist auch auf kleinen Terminals erkennbar
33. Fehlerzustände bleiben semantisch rot
34. Reduced Motion und Motion Off funktionieren
35. vorheriges Theme wird nach Rabbit Exit wiederhergestellt
36. Standardmodus verhält sich ohne RabbitMode exakt wie vor der Änderung
37. Setup/Doctor erkennt fehlende oder inkompatible Rabbit-Abhängigkeiten
38. Tests decken Shortcut, Thinking, Permissions, Graph, Nested, TUI und Failure Paths ab
39. Dokumentation nennt aktuellen echten pi-subagents-Pin
40. Benchmark zeigt Auswirkungen auf Qualität, Calls, Tokens und Laufzeit
41. RabbitMode wirkt visuell absichtlich deutlich übertriebener als Standard-Aurora
42. expressive mode nutzt reichlich Animationen und Effekte statt minimalistischer Zurückhaltung
43. "etwas nervig" gilt im RabbitMode nicht als UX-Fehler, solange Lesbarkeit und Bedienung erhalten bleiben
44. Activation, Spawn, Branching, Replanning, Depth und Completion besitzen klar unterscheidbare visuelle Effekte
45. vorhandene Reduced-Motion-/Motion-Off-Einstellungen bleiben autoritativ
46. Effekte erzeugen keine zweite Render-/Timer-Architektur
