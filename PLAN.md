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

Репозиторий содержит pipeline harness, контракты контекста, Pi extensions и тесты. Предметное приложение не является частью системы.

## Scope

В репозитории остаются:

- `.pi/extensions/` — Pi extensions: `/pi-pipeline`, `/jev-verify`, `/jev-probe` и classifier;
- `.pi/work/` — контракты и состояние pipeline;
- `scripts/` — Router, Context Manager, Verifier, orchestrator и regression tests;
- `docs/` — документация протокола.

Не входят:

- доменное приложение и его fixture;
- внешние сетевые вызовы в regression tests.

## Текущий срез

1. Core pipeline — typed roles, fail-closed, run write и live-provider guard.
2. Context Router — role-specific manifests и policy checks.
3. Context Manager — typed operations, provenance, history и fail-closed recovery.
4. Jev Verifier — evidence-first verdict.
5. Deterministic E2E harness — локальная проверка маршрутизации и verifier boundary.
6. Pi extensions — `/pi-pipeline` как live entry point, `/jev-verify` как evidence verifier и `/jev-probe` как диагностический probe.

## Проверки

```text
node --test scripts/*.test.mjs
node scripts/context-e2e.mjs
node scripts/pi-orchestrator.mjs
node scripts/validate-context-contract.mjs .pi/work
git diff --check
```

`APPROVE` считается доказанным только при свежем run с пятью завершёнными ролями, текущими verified evidence и совпадением `runId`. Локальный E2E подтверждает контракты и границы, но не заменяет live provider run.

## Следующие этапы

1. Выделить каталог `.pi/work/runs/<runId>/` и append-only `EVENTS.jsonl` — реализовано в CLI harness и extension; корневые snapshots сохранены для совместимости.
2. Добавить status/history/answer commands после отдельной проверки Pi API — команды зарегистрированы; `answer` переводит `WAITING_FOR_USER` в `RESUMED` без скрытого продолжения.
3. Проверить live Router, Luna, Opus и Jev Verifier в свежем run.
4. Добавить отдельный contract-test для provider evidence и stale-run recovery — реализованы `assertLiveResult` и `recoverStaleRun`, покрыты core regression tests.

## Ограничения

- Не делать push, PR или merge автоматически.
- Не считать наличие extension доказательством live pipeline.
- Не сохранять chain-of-thought; хранить только structured progress и evidence.
- Не смешивать Router и Verifier.
- Не возвращать `APPROVE` при неполном или неподтверждённом evidence.
- Не возвращать в репозиторий удалённый domain fixture без отдельного решения.

Подробный target protocol описан в `docs/PI-PIPELINE.md`.
