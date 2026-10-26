# Состояние Pi Pipeline

- Цель: самостоятельный Pi Context-Evidence Pipeline.
- Предметный fixture удалён из репозитория и больше не является частью verification path.
- Текущий scope: `.pi/extensions`, `.pi/work`, `scripts`, `docs`.
- Обязательная цепочка: `ROUTER -> LUNA -> TOOLS_EVIDENCE -> OPUS -> JEV_VERIFIER`.
- Локальные проверки используют Node.js и pipeline contracts.
- Deterministic fixtures проверяют границы Router/Verifier, но не заменяют live provider run.
- Runtime state должен быть связан с актуальным `runId`; stale verdict не считается результатом нового запуска.
- Последняя локальная проверка: `PI-RUN.json` и `VERDICT.json` имеют один актуальный `runId`; contract validator сообщил 4 fragments и 10 observations.
- Следующий технический срез: event log и history projection.
- Push, PR, merge и commit автоматически не выполняются.
