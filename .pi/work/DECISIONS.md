# Решения

## Pipeline вместо предметного приложения

Pi-Test-TaskManager был временным полигоном. Основная цель — Pi Context-Evidence Pipeline, поэтому C# solution, TaskManager domain, Calendar и Telegram fixture удалены из репозитория.

Причина: предметное приложение больше не добавляет доказательств корректности pipeline и загрязняет prompts, verification path и evidence историей случайного домена.

## Минимальный репозиторий

Оставлены только:

```text
.pi/extensions/
.pi/work/
scripts/
docs/
```

Локальные проверки выполняются Node.js-скриптами и не зависят от `dotnet`.

## Исполнительная цепочка

```text
Pi -> Jev Router -> Luna -> Tools/Evidence -> Opus -> Jev Verifier
```

Router и Verifier имеют разные typed-контракты. Pi применяет policy и хранит физический контекст.

## Evidence-first verdict

`APPROVE` допустим только при текущих verified evidence, завершённых обязательных ролях и совпадении `runId`. Fixture-результаты не маркируются как live provider.

## Observability

Status line является проекцией состояния. Источником истории должен стать append-only event log, связанный с `runId`. Structured progress не содержит chain-of-thought.

## Взаимодействие с пользователем

Запрос модели оформляется typed `Question`; pipeline переходит в `WAITING_FOR_USER` и после ответа возобновляет тот же `runId`. Целевые команды status/history/answer требуют отдельной live-проверки Pi API.

## Git-граница

Push, PR, merge и commit автоматически не выполняются. После проверок пользователь отдельно просматривает diff и решает вопрос коммита.

## Следующие проверки

- привести все observations к полному contract;
- проверить свежий pipeline run;
- добавить event log и history projection;
- подтвердить live-вызовы Router, Luna, Opus и Verifier.

Секреты в документы не записываются.
