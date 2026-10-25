# Pi: конфигурация моделей

Дата фиксации: 2026-10-25

## Основная цель Pi

Pi — самостоятельная среда разработки на базе ИИ-агентов. TaskManager — только
полигон для проверки цикла Pi на C#-проекте.

```text
Luna  -> основной исполнитель
Opus  -> независимый ревьюер через .pi/work/*.md
Jev   -> typed Context Manager + Router контекста + Verifier решений
Pi    -> хранение, retrieval, manifest и execution protocol
```

## Текущая конфигурация

Локальный файл: `%USERPROFILE%\.pi\agent\models.json`.

Секреты в документ не записываются. Ключ AnyModel используется через переменную
окружения.

| Роль | Provider | Pi model ID | Тип | Статус |
|---|---|---|---|---|
| Luna | `anymodel` | `cx/gpt-6-luna` | chat | проверена через Pi |
| Opus | `anymodel` | `cc/claude-opus-5-5` | chat | проверена через Pi |
| Jev | `anymodel` | `jev/jev-latest` | classifier | typed-вызов через codemode проверен |

## Роли

### Luna

Исполняет задачу: читает manifest и файлы проекта, пишет код/тесты, запускает
проверки, обновляет рабочее состояние и сообщает о результате.

### Opus

Независимо проверяет SPEC, PLAN, CONVENTIONS, diff, результаты инструментов и
архитектурные последствия. Не пишет код и не ведёт прямой диалог с пользователем.

### Jev

Jev не является обычной chat-моделью и не владеет физическими файлами памяти. Pi
передаёт ему структурированное состояние и typed-вопросы, а Jev возвращает typed
операции над логическим контекстом.

```text
Pi candidate retrieval → Jev Context Manager → Jev Router → manifest для Luna/Opus
Luna/Opus → tools/evidence → Jev Verifier → VERDICT.json
```

`Router` и `Verifier` — разные контракты:

- Router выбирает релевантные фрагменты из найденных кандидатов, выявляет конфликт и
  недостающий обязательный контекст;
- Verifier принимает решение по evidence после работы моделей;
- Jev не отвечает за полноту retrieval;
- Jev не переписывает `SPEC.md`, `DECISIONS.md` или другие канонические файлы молча.

## Context protocol

Pi хранит:

```text
CONTEXT-MANIFEST.json  состав контекста конкретной модели
OBSERVATIONS.jsonl     факты инструментов
ROUTING.jsonl          решения Router и причины include/exclude
VERDICT.json           typed verdict с evidenceRefs
```

Слои:

```text
CANONICAL / DECISIONS / TASK_STATE / OBSERVATIONS / HYPOTHESES / TRANSIENT
```

Каждый фрагмент должен иметь `source`, `sourceVersion`, `authority`, `status`,
`freshness`, `sensitivity`, `targetModels` и `relatedFragments`.

## Jev Context Manager

Jev может предложить операции `ADD`, `UPDATE`, `REMOVE`, `RETAIN`, `ROUTE` и
`CONFLICT` над логическими фрагментами контекста. Pi проверяет их policy и применяет
к хранилищу. Уже отправленный модели prompt не меняется; Pi формирует новый manifest.

`CANONICAL` и `DECISIONS` нельзя изменить или удалить молча. `TRANSIENT` можно удалить
после запуска, а устаревший фрагмент получает статус `obsolete`; операция сохраняется
в `ROUTING.jsonl`.

## Jev Router

Router вызывается до Luna или Opus. Pi сначала детерминированно собирает кандидатов
по путям, тегам, ссылкам и изменённым файлам. Router работает только с этим набором.

Состояния:

```text
READY
CONFLICT
MISSING_REQUIRED_CONTEXT
INSUFFICIENT_EVIDENCE
BLOCKED
```

Результат сохраняется в manifest и routing log. Pi дополнительно применяет policy
безопасности и лимиты токенов.

## Jev Verifier

Verifier вызывается после build/test/diff/smoke и Opus review. Решения:

```text
APPROVE
REQUEST_CHANGES
BLOCKED
INSUFFICIENT_EVIDENCE
```

`APPROVE` требует подходящих evidenceRefs. Probability — сигнал classifier, не
доказательство корректности кода.

## Проверенный вызов

```text
provider: anymodel
model: jev/jev-latest
api: typesafe-system-one
stopReason: stop
answers.approved.type: bool
answers.approved.probability: 0.74
```

Это доказывает вызов базового Verifier через Pi codemode. Качество Router,
полнота retrieval и калибровка probability ещё не проверены.

## Следующий Pi-flow

1. Пользователь и Luna формируют GOAL/SPEC/PLAN.
2. Pi собирает кандидатов контекста.
3. Jev Router создаёт typed routing decision.
4. Pi формирует отдельный manifest для Luna.
5. Luna реализует этап и запускает tools.
6. Pi формирует manifest для Opus.
7. Opus выполняет независимое ревью.
8. Pi сохраняет observations, diff и review.
9. Jev Verifier создаёт typed `VERDICT.json` с evidenceRefs.
10. Пользователь просматривает diff и делает локальный commit.

## Ограничения

- Не делать push, PR или merge.
- Не считать provider в конфигурации доказательством работоспособности.
- Не считать свободный текст модели канонической памятью.
- Не применять операции Jev над `CANONICAL`/`DECISIONS` без policy и provenance.
- Не смешивать Router и Verifier.
- Не передавать чувствительные фрагменты внешней модели без policy.

## References

- Pi config: `%USERPROFILE%\.pi\agent\models.json`
- Архитектура: `C:\Users\ThinkPad\Downloads\Pi-Dev-Construct.md`
- План: `C:\Users\ThinkPad\Downloads\Pi-Test-TaskManager\PLAN.md`
- Jev пояснение: `C:\Users\ThinkPad\Downloads\JevArchitecture.txt`
- AnyModel endpoint: `https://anymodel.org/v1`
- Provider-facing Jev ID: `pg/jev-latest`
- Working AnyModel System One ID: `jev/jev-latest`

Секреты и ключи в этот документ не записываются.