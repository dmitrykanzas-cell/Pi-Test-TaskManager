# Pi: конфигурация моделей

## Цель

Pi — самостоятельная среда для запуска и проверки Context-Evidence Pipeline. Предметное приложение не требуется.

```text
Pi    -> контекст, lifecycle, policy, artifacts
Jev   -> typed Context Manager, Router, Verifier
Luna  -> исполнитель pipeline-задачи
Opus  -> независимый reviewer
Tools -> локальные проверки и evidence
```

## Контракт ролей

```text
Pi candidate retrieval -> Jev Router -> manifest для Luna
Luna -> Tools/Evidence -> manifest для Opus
Opus -> Jev Verifier -> VERDICT.json
```

Router выбирает из найденных кандидатов и сообщает о конфликте или недостающем контексте. Verifier принимает решение только по evidence. Jev не владеет физическими файлами и не переписывает канонические документы молча.

## Контекстные артефакты

```text
CONTEXT-MANIFEST.json  manifest конкретного вызова
OBSERVATIONS.jsonl     результаты tools
ROUTING.jsonl          решения маршрутизации
PI-RUN.json            snapshot запуска
VERDICT.json           typed verdict с evidenceRefs
```

Слои: `CANONICAL`, `DECISIONS`, `TASK_STATE`, `OBSERVATIONS`, `HYPOTHESES`, `TRANSIENT`.

## Ограничения

- обязательные роли fail-closed;
- `APPROVE` требует verified evidence и текущий `runId`;
- fixture не доказывает live provider call;
- chain-of-thought не сохраняется;
- push, PR, merge и commit не выполняются автоматически;
- локальные tests не зависят от `dotnet` или domain fixture.

## Следующие проверки

1. Полный contract-compliant observations log.
2. Свежий live run всех пяти ролей.
3. Event log, status/history projection и typed questions.

Секреты и ключи в документ не записываются.
