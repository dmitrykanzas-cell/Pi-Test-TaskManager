# Pi Context-Evidence Pipeline

Репозиторий является самостоятельным harness для Pi Context-Evidence Pipeline. C#-, TaskManager-, Calendar- и Telegram-приложения сюда не входят.

## Исполнительная схема

```text
User request
     |
     v
Pi: session + state + event log
     |
     v
Jev Router ---- role-specific manifest ----> Luna
                                              |
                                              v
                                      Tools / evidence
                                              |
                                              v
                                           Opus
                                              |
                                              v
                                      Jev Verifier
                                              |
                                              v
                                  typed verdict + human boundary
```

- Pi владеет контекстом, lifecycle, event log и применением policy.
- Jev Router выбирает контекст из кандидатов.
- Luna выполняет pipeline-задачу.
- Tools создают проверяемые observations/evidence.
- Opus независимо проверяет результат.
- Jev Verifier принимает typed verdict по evidence.
- User отвечает на формальные вопросы и отдельно решает вопрос Git commit.

## Состав репозитория

```text
.pi/extensions/     Pi extensions
.pi/work/           manifests, observations, routing, verdicts
scripts/            core, router, context manager, verifier, harness, tests
docs/               protocol documentation
```

Domain fixtures, C# solution, `dotnet`, Calendar и Telegram намеренно отсутствуют.

## Запуск

```text
/pi-pipeline <request>
```

После установки extension текущую Pi-сессию нужно перезапустить. Для локального запуска из этого каталога:

```text
pi install C:\Users\ThinkPad\Downloads\Pi-Test-TaskManager\.pi\extensions\anymodel-classifier.ts
pi install C:\Users\ThinkPad\Downloads\Pi-Test-TaskManager\.pi\extensions\pi-pipeline.ts
```

`--print` не диспетчеризует slash-команды. Регистрацию можно проверять через RPC `get_commands`.

## Локальные проверки

```bash
node --test scripts/*.test.mjs
node scripts/context-e2e.mjs
node scripts/pi-orchestrator.mjs
node scripts/validate-context-contract.mjs .pi/work
git diff --check
```

Regression tests не делают сетевых вызовов и проверяют контракты локально. Deterministic E2E harness проверяет реальную файловую маршрутизацию и Verifier boundary, но не заменяет live-вызовы моделей.

## Наблюдаемость

Status line — только проекция текущего состояния:

```text
[Pi Pipeline] RUNNING · Luna · tools 3/6 · 01:42
```

Источником истории должен быть append-only event log:

```text
event log -> state projection -> status line / history view
     |-----> observations / routing / verdict
```

События: `RUN_STARTED`, `STAGE_STARTED`, `MODEL_PROGRESS`, `MODEL_RESPONDED`, `TOOL_STARTED`, `TOOL_COMPLETED`, `EVIDENCE_ADDED`, `QUESTION_RAISED`, `STAGE_PAUSED`, `STAGE_FAILED`, `STAGE_COMPLETED`, `RUN_FINISHED`.

События содержат `eventId`, `runId`, timestamp, stage, actor, type, status, summary и ссылки на artifacts/evidence. Chain-of-thought не сохраняется.

Целевая структура запуска:

```text
.pi/work/runs/<runId>/
  RUN.json
  EVENTS.jsonl
  CONTEXT-MANIFEST.json
  OBSERVATIONS.jsonl
  ROUTING.jsonl
  EVIDENCE.jsonl
  QUESTIONS.jsonl
  VERDICT.json
```

Текущие файлы в `.pi/work/` остаются совместимым MVP-срезом. Перенос в каталог запуска и projection из `EVENTS.jsonl` ещё не считается реализованным.

## Формальный вопрос пользователю

Модель не просит пользователя свободной строкой. Pi создаёт typed `Question` и переводит run в `WAITING_FOR_USER`:

```text
RUNNING -> WAITING_FOR_USER -> RESUMED -> RUNNING
```

Целевой интерфейс:

```text
/pi-pipeline-status
/pi-pipeline-history [runId]
/pi-pipeline-answer <questionId> <answerId>
```

Названия команд являются target protocol документации. До отдельной регистрационной и live-проверки их нельзя считать реализованными.

## Fail-closed и доказательство успеха

- Недоступность Router, Luna, Opus или Verifier даёт `BLOCKED`.
- Fixture-результат не маркируется как live provider.
- `APPROVE` требует текущие evidence и ссылки на текущий `runId`.
- Старый `VERDICT.json` не является результатом нового запуска.
- Неполное evidence даёт `INSUFFICIENT_EVIDENCE`, а не скрытый `APPROVE`.

Доказанным live pipeline считается только свежий trace с пятью завершёнными ролями:

```text
ROUTER -> LUNA -> TOOLS_EVIDENCE -> OPUS -> JEV_VERIFIER
```

Наличие extension, status line или локального fixture-теста само по себе этого не доказывает.

## Текущий MVP-артефакт

- `.pi/work/PI-RUN.json` — snapshot запуска;
- `.pi/work/CONTEXT-MANIFEST.json` — manifest контекста;
- `.pi/work/OBSERVATIONS.jsonl` — observations/evidence;
- `.pi/work/ROUTING.jsonl` — routing decisions;
- `.pi/work/VERDICT.json` — typed verdict;
- `.pi/extensions/pi-pipeline.ts` — live entry point;
- `scripts/` — локальные pipeline-модули и regression tests.
