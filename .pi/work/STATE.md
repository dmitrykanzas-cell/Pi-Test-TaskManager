# Состояние Pi Pipeline

- Цель: самостоятельный Pi Context-Evidence Pipeline.
- C# / TaskManager fixture удалён из репозитория и больше не является частью verification path.
- Текущий scope: `.pi/extensions`, `.pi/work`, `scripts`, `docs`.
- Обязательная цепочка: `ROUTER -> LUNA -> TOOLS_EVIDENCE -> OPUS -> JEV_VERIFIER`.
- Локальные проверки должны использовать Node.js и pipeline contracts, без `dotnet`.
- Deterministic fixtures проверяют границы Router/Verifier, но не заменяют live provider run.
- Runtime state должен быть связан с актуальным `runId`; stale verdict не считается результатом нового запуска.
- Следующий технический срез: полный contract-compliant `OBSERVATIONS.jsonl`, затем event log и history projection.
- Push, PR, merge и commit автоматически не выполняются.
