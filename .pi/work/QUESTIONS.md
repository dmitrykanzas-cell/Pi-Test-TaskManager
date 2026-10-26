# Открытые вопросы Pi Pipeline

Все вопросы относятся к pipeline, а не к предметному приложению.

- Q-01 [blocking] Какой полный контракт должен иметь каждое событие `EVENTS.jsonl`, чтобы восстановить run после перезапуска?
- Q-02 [blocking] Где хранить незакрытый typed `Question`: только в `.pi/work/runs/<runId>/` или также в общем индексе?
- Q-03 [blocking] Как зарегистрировать и live-проверить `/pi-pipeline-status`, `/pi-pipeline-history` и `/pi-pipeline-answer` через Pi API?
- Q-04 [non-blocking] Какие policy-checks между Luna и Tools разрешаются автоматически, а какие требуют подтверждения пользователя?
- Q-05 [blocking] Какой минимальный набор verified evidence достаточен для `APPROVE` у pipeline-only задачи?
- Q-06 [non-blocking] Как версионировать manifest и invalidation при изменении источника после маршрутизации?
- Q-07 [non-blocking] Какой typed-контракт операций Jev `ADD`, `UPDATE`, `OBSOLETE`, `REMOVE`, `CONFLICT` нужно закрепить как стабильный API?

Эти вопросы закрываются исследованием Pi API и малыми воспроизводимыми экспериментами, а не предположениями.

Формат:

```text
Q-NN [blocking | non-blocking]
Что:
Почему:
Варианты:
По умолчанию:
Ответ:
```
