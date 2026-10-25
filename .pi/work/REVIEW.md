# Stage 6 independent review

Дата: 2026-10-25
Ревьюер: Opus через Pi, read-only invocation
Область: контракт контекста/evidence, валидатор и Jev Verifier

## Решение

`APPROVE`

## Follow-up independent review

Дополнительное read-only ревью по исходному состоянию этапа выявило `REQUEST_CHANGES`.
Главный дефект: старый валидатор принимал forged `APPROVE` по одним только `kind`,
даже если evidence имело `status=observed` и описывало незавершённый review.
Также `ROUTING.jsonl` фактически не валидировался, а typed-поля проверялись только
на наличие ключа.

После этого findings валидатор усилен:

- `APPROVE` требует `missingEvidence=[]` и только `verified` evidence;
- fragment/observation metadata проверяется по типам и непустым значениям;
- `ROUTING.jsonl` читается и проверяет manifestId, операции, ссылки и причины;
- добавлены regression-тесты для observed APPROVE, sensitivity, typed fields,
  malformed routing и broken routing references.

Главный regression-case реально проверен: forged APPROVE отклонён с ошибками
`APPROVE requires review evidence` и `APPROVE evidence must be verified`.

Второе независимое ревью выявило дополнительный MEDIUM-дефект: записи операций
в `ROUTING.jsonl` принимались без обязательного `role` из-за значения по умолчанию
`luna`. Исправлено: `role` теперь обязателен, добавлен negative test для missing role,
а все штатные routing operation entries дополнены `role=luna`. После исправления
повторно прошли validator, negative tests, build и test.

## Проверенные требования

- `CONTEXT-MANIFEST.json` содержит 4 фрагмента с `id`, `kind`, `text`, `source`, `sourceVersion`, `authority`, `status`, `freshness`, `sensitivity`, `targetModels`, `relatedFragments`.
- В manifest представлены слои `CANONICAL`, `DECISIONS`, `OBSERVATIONS`, `HYPOTHESES`.
- Валидатор запрещает observation-фрагментам становиться canonical.
- Валидатор запрещает sensitive-фрагменты для external-моделей.
- `ROUTING.jsonl` содержит принятые `RETAIN`, `ADD`, `UPDATE` и отклонённую попытку удалить decision-фрагмент.
- `VERDICT.json` имеет typed-поля `decision`, `confidence`, `evidenceRefs`, `missingEvidence`, `stopReason`.
- `APPROVE` требует verified build, test, diff и review evidence.
- `.pi/extensions/jev-verifier.ts` читает observations, вызывает Jev classifier, применяет policy и сохраняет typed verdict.

## Замечания

1. `diff-001` и прежний `review-001` до финального прогона имели статус `observed`, а не `verified`. Это исправляется текущим evidence-прогоном.
2. Проверка `REMOVE` показана для decision-фрагмента и отклонена; проверка удаления transient относится к следующему этапу Context Manager.
3. Router и conflict resolution относятся к этапам 7–8, а не являются незавершёнными требованиями этапа 6.

## Evidence ревью

- Invocation: Pi в read-only режиме.
- Model: `anymodel/cc/claude-opus-5-5`.
- Инструменты: только `read`, `grep`, `find`.
- Файлы не изменялись ревьюером.

## Итог

Этап 6 может быть закрыт после обновления текущих evidence и успешного финального Jev Verifier-прогона. Probability Jev не заменяет build/test/review evidence.
