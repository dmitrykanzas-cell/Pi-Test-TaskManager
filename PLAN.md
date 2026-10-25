# План MVP Pi и тестового проекта

## Цель

Проверить рабочий процесс Pi на небольшом, но не игрушечном C#-проекте: интервью → требования → план → реализация этапами → build/test → состояние проекта.

## Тестовый проект

**TaskManager** — консольный менеджер локальных задач.

Первая версия должна уметь:

- создавать задачу;
- изменять статус: `New`, `InProgress`, `Done`;
- назначать приоритет;
- сохранять задачи в JSON;
- загружать их после перезапуска;
- искать и фильтровать задачи;
- проверять правила автоматическими тестами.

Не входит в первую версию:

- GUI;
- база данных;
- синхронизация;
- авторизация;
- удалённое API;
- интеграция с внешними сервисами.

## Этапы

### 0. Скелет и рабочие файлы

Создать solution, production-проект, test-проект и файлы `.pi/work/`.

Проверка:

```text
dotnet build
dotnet test
```

### 1. Доменная модель — завершён

Добавить задачу, статус, приоритет и правила допустимых изменений.

Проверка:

- тесты создания задачи;
- тесты переходов статуса;
- тесты недопустимых значений.

Результат: `TaskItem`, `TaskItemStatus`, `TaskPriority` и пять тестов реализованы.

### 2. JSON-хранилище — завершён минимальный вариант

Добавить сохранение и загрузку через отдельный интерфейс хранилища.

Проверка:

- сохранение и повторная загрузка;
- пустой файл;
- отсутствующий файл;
- повреждённый JSON;
- отсутствие записи за пределами назначенной папки.

Результат: `JsonTaskRepository`, round-trip-тест и обработка отсутствующего файла реализованы.

### 3. Поиск и фильтрация — завершён минимальный вариант

Добавить поиск по заголовку и фильтрацию по статусу/приоритету.

Проверка:

- регистр символов;
- пустой запрос;
- сочетание фильтров;
- отсутствие результатов.

Результат: `TaskQuery.Filter` реализует поиск без учёта регистра и сочетание фильтров; CLI-команда `search` проверена smoke-сценарием.

### 4. Консольный интерфейс — завершён минимальный smoke-вариант

Добавить минимальные команды для работы с задачами.

Проверка:

- справка;
- создание;
- изменение статуса;
- список и поиск;
- понятные ошибки ввода.

Результат: команды `add`, `list`, `done`, `quit` работают; сохранение проверено после перезапуска.

### 5. Прогон Pi — выполнен для этапа поиска/фильтрации

Проверить ручной workflow с Luna, Opus и Jev:

- Luna ведёт этап и обновляет рабочие файлы;
- Opus проверяет план и diff через файлы;
- Jev проверяет актуальность `STATE.md` и наличие решений;
- после каждого этапа есть build/test и краткий отчёт.

Результат ручного прогона:

```text
Luna → добавила тест Query_CombinesTitleSearchWithPriorityFilter
Opus → проверил diff/spec, APPROVE
Jev → classifier через codemode, typed VERDICT.json, stopReason=stop
```

Проверка этапа: `dotnet build` — 0 ошибок/0 предупреждений; `dotnet test` — 10/10.

### 6. Контракт контекста, операций Jev и evidence — завершён

До автоматизации маршрутизации описать минимальный, проверяемый контракт.
Jev не хранит память сам и не получает право молча переписывать канонические
Файлы. Pi хранит физическое представление контекста, собирает кандидатов и применяет
разрешённые операции Jev. Jev управляет логическим жизненным циклом контекста.

Минимальные typed-операции Jev:

```text
ADD / UPDATE / REMOVE / RETAIN / ROUTE / CONFLICT
```

Операция `REMOVE` разрешена для transient-фрагментов. Канонический фрагмент не
удаляется молча: он переводится в `obsolete`, а операция сохраняется в журнале.
Изменение логического контекста не редактирует уже отправленный prompt — Pi собирает
новый manifest и новый вызов модели.

Разделить данные на слои:

- `CANONICAL` — подтверждённые правила и факты;
- `DECISIONS` — решения пользователя/проекта;
- `TASK_STATE` — состояние текущей задачи;
- `OBSERVATIONS` — результаты build/test/diff и другие факты инструментов;
- `HYPOTHESES` — неподтверждённые предположения;
- `TRANSIENT` — данные одного запуска.

Для каждого фрагмента определить минимум:

```text
id, kind, text, source, sourceVersion, authority,
status, freshness, sensitivity, targetModels, relatedFragments
```

Добавить контракты:

- `CONTEXT-MANIFEST.json` — версия и состав контекста конкретного запуска;
- `OBSERVATIONS.jsonl` — машинные результаты инструментов;
- `ROUTING.jsonl` — решения маршрутизации и причины include/exclude;
- расширенный `VERDICT.json` — решение, confidence, evidenceRefs и stopReason.

Проверка:

- каждый фрагмент имеет источник и статус;
- observation не может автоматически стать canonical decision;
- секретный или чувствительный фрагмент не маршрутизируется внешней модели;
- verdict ссылается на существующие evidence;
- `git diff --check` и JSON-проверка проходят.

Результат текущего среза:

- добавлены `CONTEXT-MANIFEST.json`, `OBSERVATIONS.jsonl` и `ROUTING.jsonl`;
- добавлен независимый локальный валидатор `scripts/validate-context-contract.mjs`;
- проверены provenance/status у фрагментов, запрет observation → canonical,
  чувствительные фрагменты для external-модели и ссылки verdict на существующие
  observations;
- валидатор подтвердил 4 фрагмента и 7 observations;
- добавлены позитивные и негативные проверки: битая связь фрагментов и неполный
  `APPROVE` отклоняются;
- выполнен отдельный read-only review Opus через Pi, результат сохранён в
  `.pi/work/REVIEW.md`;
- добавлен и реально запущен `.pi/extensions/jev-verifier.ts`: он читает только
  verified observations, вызывает Jev и сохраняет typed `VERDICT.json`;
- финальный Jev-прогон увидел полный набор evidence, но дважды вернул
  `jevApproved=false`, поэтому verdict честно остался `INSUFFICIENT_EVIDENCE`;
- завершение этапа не означает автоматический `APPROVE`.

### 7. Jev Context Manager — typed-управление контекстом

Завершено: реализован dependency-free Context Manager, принимающий typed-операции
из JSON и выполняющий их через Pi policy check:

```text
typed operation → policy check → physical manifest → ROUTING.jsonl → new manifest
```

Реализованные операции: `ADD`, `UPDATE`, `OBSOLETE`, `REMOVE`, `CONFLICT`.
`RETAIN` остаётся journal-level операцией без изменения фрагмента.

Pi сохраняет `previousManifestId`, `manifestHistory` и `fragmentHistory`; запись
manifest и routing выполняется через transaction marker, временные файлы и
последующий rename. Это не делает два разных файла одной FS-транзакцией: при
сбое между заменами незавершённая транзакция обнаруживается при следующем запуске
и обрабатывается fail-closed.

Проверены сценарии: добавить observation, обновить hypothesis, устареть canonical,
удалить transient, отклонить изменение canonical, зарегистрировать conflict и
отклонить неизвестный fragment. Для rejected operations сохраняется routing-запись
с `result=REJECTED`, физический контекст не изменяется. Дополнительно проверены
полный ADD-контракт, неизменяемость provenance/security-полей при UPDATE,
обязательные `operationId`/`baseManifestId`, stale manifest, симметричная запись
conflict и восстановление после незавершённой транзакции.

Артефакты: `scripts/context-manager.mjs` и `scripts/context-manager.test.mjs`.

Первоначальное требование:

Проверить, что Jev может вернуть операции над контекстом, а Pi умеет:

- проверить операцию по policy;
- применить её к физическому представлению;
- сохранить provenance и версию;
- записать результат в `ROUTING.jsonl`;
- сформировать новый `CONTEXT-MANIFEST.json`.

Минимальные сценарии: добавить observation, обновить hypothesis, пометить фрагмент
устаревшим, удалить transient, отклонить попытку изменить canonical и зарегистрировать
конфликт.

### 8. Jev Router — typed-маршрутизация контекста

Завершено: реализован отдельный typed-вызов Jev до запуска исполнителя. Это не
финальный verdict, а policy-решение по кандидатам контекста.

Поток:

```text
файлы/индекс → Pi собирает кандидатов → Jev Router
                                      ↓
                         CONTEXT-MANIFEST для Luna/Opus
```

Обязанности разделены:

- Pi детерминированно ищет кандидатов по путям, тегам, ссылкам и изменённым
  файлам;
- Jev выбирает релевантные фрагменты, обнаруживает конфликт и указывает
  недостающие обязательные фрагменты;
- Pi применяет policy безопасности, лимиты токенов и обязательные ограничения;
- renderer формирует фактический контекст для модели;
- routing log сохраняет кандидатов, решение, причину и версию контекста.

Jev не отвечает за полноту поиска: отсутствие фрагмента в кандидатах — ошибка
сборщика, а не доказательство решения Jev.

Typed-состояния маршрутизатора:

```text
READY
CONFLICT
MISSING_REQUIRED_CONTEXT
INSUFFICIENT_EVIDENCE
BLOCKED
```

Проверка:

- сценарий `READY` с обязательным fragment для Luna;
- отдельный manifest для Opus;
- `CONFLICT` и `MISSING_REQUIRED_CONTEXT`;
- блокировка sensitive fragment без явной policy;
- блокировка по лимиту фрагментов;
- отклонение неизвестного кандидата и невалидного typed-решения;
- routing log восстанавливает кандидатов, решение, включённые и исключённые
  фрагменты.

Артефакты: `scripts/context-router.mjs` и `scripts/context-router.test.mjs`.
Router сохраняет role-specific manifest как `CONTEXT-MANIFEST.<role>.json` и
не изменяет базовый `CONTEXT-MANIFEST.json`. Его journal-записи имеют `type=ROUTER`
и проверяются общим context validator.

### 9. Jev Verifier — typed-финальное решение

Не смешивать маршрутизацию и финальный verdict в одном контракте. После работы
Luna/Opus Pi собирает evidence, а Jev оценивает только переданные проверяемые
факты.

Минимальные решения:

```text
APPROVE
REQUEST_CHANGES
BLOCKED
INSUFFICIENT_EVIDENCE
```

`APPROVE` нельзя получать только из текста модели. Обязательны ссылки на:

- результат `dotnet build`;
- результат `dotnet test`;
- diff и список изменённых файлов;
- `REVIEW.md` или иной результат Opus;
- фактический smoke-тест, если затронут CLI.

Проверка:

- Jev получает evidenceRefs, а не только строку `Opus: APPROVE`;
- отсутствующий build/test даёт `INSUFFICIENT_EVIDENCE`;
- конфликт требований даёт `BLOCKED`, а не молчаливый выбор;
- поддерживаются `APPROVE`, `REQUEST_CHANGES`, `BLOCKED`, `INSUFFICIENT_EVIDENCE`;
- ошибка или незавершённый ответ Jev даёт `BLOCKED`;
- неизвестное решение и дублирующиеся/пустые evidenceRefs отклоняются;
- probability не трактуется как доказательство и сохраняется отдельно от решения.

Реализация: `scripts/jev-verifier.mjs`, тесты: `scripts/jev-verifier.test.mjs`.
Policy verifier принимает только typed Jev decision и evidenceRefs, проверяет существование,
`status=verified`, обязательные виды evidence и конфликт; затем сохраняет typed verdict.
Фактический текущий `.pi/work/VERDICT.json` остаётся `INSUFFICIENT_EVIDENCE`, если внешний Jev
не подтвердил approval. Тестовый `APPROVE` доказывает только локальный policy contract, не внешний вызов.

### 10. Сквозной контекстный прогон

Проверить полный сценарий:

```text
REQUEST → Pi candidate retrieval → Jev Router
        → Luna → tools/evidence → Opus
        → Jev Verifier → человек → ручной commit
```

Для каждого участника зафиксировать фактический вход и выход:

- Luna получает только контекст из `CONTEXT-MANIFEST.json`;
- Opus получает отдельный manifest с diff, критериями и ограничениями;
- Jev Router и Jev Verifier используют разные typed-контракты;
- Pi сохраняет routing log, observations и verdict;
- пользователь сохраняет право финального решения и Git-коммита.

Проверка: два этапа — обычный `APPROVE` и преднамеренный `INSUFFICIENT_EVIDENCE`.

Фактически выполнено локальным воспроизводимым harness `scripts/context-e2e.mjs`:

- REQUEST зафиксирован как typed input;
- Pi собрал 3 кандидата;
- Router сформировал отдельные manifests для Luna и Opus;
- Luna-path выполнил реальные `dotnet build`, `dotnet test` и `git diff --check`;
- evidence записано в изолированный `.pi/work`;
- Opus получил отдельный manifest с diff/criteria;
- Verifier прошёл обе ветки: `APPROVE` и `INSUFFICIENT_EVIDENCE`;
- сохранена трасса `.pi/work/E2E-TRACE.json`.

Граница доказательства: локальный harness использует typed boundary fixtures для Luna/Opus/Jev; он не выдаёт их за внешний вызов провайдера. Реальными являются filesystem routing, manifests, evidence, build/test и Verifier policy.

### 11. Автоматизация модулей Pi

Реализовано в `scripts/pi-orchestrator.mjs`:

- управление изолированной копией `.pi/work`;
- детерминированный сбор кандидатов из `GOAL.md`, `DECISIONS.md` и manifest;
- вызов Jev Router и применение policy;
- сборка role-specific manifest для Luna;
- запуск bounded build/test/smoke;
- сбор evidence с typed IDs;
- вызов Jev Verifier;
- запись `.pi/work/PI-RUN.json`;
- fail-closed обработка: ошибка инструмента даёт `BLOCKED`, `STATE.md` не объявляет этап завершённым;
- обновление `STATE.md` выполняется только после `APPROVE`.

Проверены две ветки:

- успешный запуск: `APPROVE`;
- `--simulate-failure`: `BLOCKED`, ненулевой exit code, статус этапа не продвигается.

Ограничение: локальный orchestrator использует typed boundary для внешних Luna/Opus/Jev provider-вызовов; Router, filesystem, build/test/smoke, evidence и Verifier выполняются реально.

Regression-проверка `scripts/pi-orchestrator.test.mjs` подтверждает последовательность `APPROVE → BLOCKED (fail-closed) → APPROVE (recovery)`.

Этап 11 закрыт: все 12 этапов MVP выполнены локально; отдельный provider-run и push остаются вне этого локального automation contract.

## Критерий MVP

MVP Pi считается проверенным, если свежая сессия может по `.pi/work/` понять
текущую задачу, детерминированно собрать кандидатов контекста, получить от Jev
typed routing decision, сформировать отдельный контекст для Luna и Opus,
выполнить один этап, собрать evidence, получить typed verdict Jev с ссылками на
evidence, а ревьюер может найти отклонение от требований по diff.

Полноценная память и маршрутизация не считаются доказанными по одному успешному
вердикту. Нужны отдельные проверки полноты кандидатов, конфликтов, утечки
чувствительных данных, устаревания и недостатка evidence.

## Ограничения

- Не делать push, PR или merge.
- Не добавлять поля, индексы и модули «на будущее».
- Не делать Jev единственным поисковиком контекста: полнота retrieval остаётся
  детерминированной ответственностью Pi.
- Не считать свободный текст модели канонической памятью без provenance и policy.
- Не смешивать Router и Verifier в один неразличимый verdict-контракт.
- Не считать зелёные unit-тесты доказательством работы консольного входа: его нужно проверить отдельным smoke-тестом.
- Каждый этап должен иметь команду проверки.

## Текущая точка

Проект достиг состояния для ручной проверки базового workflow Pi:
есть рабочие файлы `.pi/work`, доменная модель, JSON-хранилище, консольный
сценарий, зелёные build/test и проверенный базовый вызов Jev classifier через
Pi codemode. Контракт manifest/evidence, evidence-based Verifier, Context Manager
policy и Jev Router уже реализованы и проверены. Context Manager применяет
typed-операции, а Router собирает role-specific manifest из переданных кандидатов
и сохраняет typed-решение в routing journal.

Этапы 7–8 завершены. Полный MVP Pi ещё не завершён: отдельное усиление Verifier,
полный сквозной прогон и автоматизация остаются этапами 9–11.
