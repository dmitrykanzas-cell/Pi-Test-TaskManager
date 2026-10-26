# Pi Context-Evidence Pipeline — план

## Цель

Построить и проверить самостоятельный Pi Context-Evidence Pipeline:

```text
User request
    -> Pi
    -> Jev Router
    -> Luna
    -> Tools / Evidence
    -> Opus
    -> Jev Verifier
    -> typed verdict
```

Репозиторий содержит pipeline harness, контракты контекста, extension и тесты. Предметное приложение или учебный C#-проект не являются частью системы.

## Scope

В репозитории остаются:

- `.pi/extensions/` — Pi extensions;
- `.pi/work/` — контракты и состояние pipeline;
- `scripts/` — Router, Context Manager, Verifier, orchestrator и regression tests;
- `docs/` — документация протокола.

Не входят:

- доменное приложение;
- C# solution и `dotnet`-проверки;
- календарь, Telegram и другие случайные fixtures;
- внешние сетевые вызовы в regression tests.

## Текущий срез

1. Core pipeline — typed roles, fail-closed, trace write.
2. Context Router — role-specific manifests и policy checks.
3. Context Manager — typed operations, provenance, history и fail-closed recovery.
4. Jev Verifier — evidence-first verdict.
5. Deterministic E2E harness — локальная проверка маршрутизации и verifier boundary.
6. Pi extension — `/pi-pipeline` как live entry point с обязательными provider roles.

## Проверки

```text
node --test scripts/*.test.mjs
node scripts/context-e2e.mjs
node scripts/pi-orchestrator.mjs
node scripts/validate-context-contract.mjs .pi/work
git diff --check
```

`APPROVE` считается доказанным только при свежем run с пятью завершёнными ролями и текущими evidence. Deterministic fixtures не заменяют live provider run.

## Следующие этапы

1. Устранить stale runtime artifacts и привести `OBSERVATIONS.jsonl` к полному контракту.
2. Выделить каталог `.pi/work/runs/<runId>/` и append-only `EVENTS.jsonl`.
3. Добавить status/history/answer commands после отдельной проверки Pi API.
4. Проверить live Router, Luna, Opus и Jev Verifier в свежем run.
5. После проверки пользователь вручную решает вопрос локального Git commit.

## Ограничения

- Не делать push, PR или merge автоматически.
- Не считать наличие extension доказательством live pipeline.
- Не сохранять chain-of-thought; хранить только structured progress и evidence.
- Не смешивать Router и Verifier.
- Не возвращать `APPROVE` при неполном или неподтверждённом evidence.
- Не возвращать в репозиторий удалённый domain fixture без отдельного решения.

Подробный target protocol описан в `docs/PI-PIPELINE.md`.
