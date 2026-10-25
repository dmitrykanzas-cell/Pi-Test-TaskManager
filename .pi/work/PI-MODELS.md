# Pi: конфигурация моделей

Дата фиксации: 2026-10-25

## Основная цель Pi

Pi — самостоятельная среда разработки на базе ИИ-агентов. TaskManager — только полигон для проверки реального цикла Pi на C#-проекте.

```text
Luna  -> основной исполнитель
Opus  -> ревьюер через .pi/work/*.md
Jev   -> типизированный контроль решений
```

## Текущая конфигурация

Локальный файл: `%USERPROFILE%\.pi\agent\models.json`.

Секреты в документ не записываются. Ключ AnyModel используется через `HERMES_CUSTOM_ANYMODEL_ORG_API_KEY`.

| Роль | Provider | Pi model ID | Тип | Статус |
|---|---|---|---|---|
| Luna | `anymodel` | `cx/gpt-6-luna` | chat | проверена через Pi: `PI_LUNA_OK` |
| Opus | `anymodel` | `cc/claude-opus-5-5` | chat | проверена через Pi: `PI_OPUS_OK` |
| Jev | `anymodel` | `jev/jev-latest` | classifier | настроен; отдельный System One probe успешен |

## Jev

Источник данных: карточка Jev у провайдера, предоставленная пользователем:

- карточка: `pg/jev-latest`;
- назначение: decision engine, typed verdicts, не чат;
- context: 32K;
- цена: `$0.05` за 1M токенов;
- коэффициент: `×1`, то есть `5¢ × 1 = $0.05`;
- списание: токены запроса ×1.

В Pi Jev описан как classifier:

- `type`: `classifier`;
- `api`: `typesafe-system-one`;
- endpoint base: `https://anymodel.org/v1`;
- Pi вызывает `/systemone`;
- wire-level model ID, подтверждённый прямым запросом: `jev/jev-latest`.

Важно: `pg/jev-latest` — ID из карточки/маршрутизации провайдера, но прямой запрос AnyModel с ним ответил `selected model unavailable`. Тот же System One запрос с `jev/jev-latest` вернул корректное typed-решение:

```text
answers.approved.type = noul
answers.approved.noul = 0.97
usage.total_tokens = 298
```

Следовательно, в `models.json` используется `jev/jev-latest`, а исходный ID карточки сохранён здесь для трассировки.

Classifier-модели не выбираются обычным `/model`. Они вызываются из `codemode` через `models.getModelOfType("classifier", "anymodel", "jev/jev-latest")` и `models.classify(...)`.

## Старая конфигурация

До настройки был provider `colibri`:

- endpoint: `http://127.0.0.1:18081/v1`;
- локальная Qwen2.5 7B Instruct Q4_K_M;
- фактический запрос завершался ошибкой соединения;
- backup: `%USERPROFILE%\.pi\agent\backups\models.json.2026-10-25-colibri.json`.

`colibri` оставлен как резервный provider, но не является рабочей основной моделью.

## Проверки

Проверено:

```text
pi --model cx/gpt-6-luna --no-tools --no-session -p ...
  PI_LUNA_OK

pi --model cc/claude-opus-5-5 --no-tools --no-session -p ...
  PI_OPUS_OK

POST https://anymodel.org/v1/systemone
  model: jev/jev-latest
  typed answer: noul = 0.97
  total_tokens: 298
```

## Следующий Pi-flow

1. Luna читает рабочие файлы и реализует задачу.
2. Результат и состояние фиксируются в `.pi/work/*.md`.
3. Opus получает те же файлы и выполняет ревью.
4. Jev проверяет типизированные решения через classifier API.
5. Каждый законченный срез фиксируется Git-коммитом.

## Журнал

- 2026-10-25: сохранён backup старой конфигурации `colibri`.
- 2026-10-25: добавлен `anymodel` с Luna и Opus; обе модели проверены через Pi.
- 2026-10-25: подтверждён Jev; исправлено различие ID карточки `pg/jev-latest` и рабочего AnyModel API ID `jev/jev-latest`.
- 2026-10-25: добавлен classifier `typesafe-system-one` с ценой `$0.05/1M`, коэффициентом `×1` и context `32K`.

Источник формата конфигурации: локальная документация Pi 1.0.4, `docs/models.md` и `docs/custom-provider.md`.

Серверную конфигурацию Hermes этот файл не меняет.

## Git

Pi-Test-TaskManager уже содержит первый коммит:

```text
05ae6e5 feat: establish Pi TaskManager pilot
```

После изменения конфигурации Jev нужно сделать отдельный коммит.

## References

- Pi config: `%USERPROFILE%\.pi\agent\models.json`
- Pi docs: `%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\docs\models.md`
- AnyModel endpoint: `https://anymodel.org/v1`
- Provider-facing Jev ID: `pg/jev-latest`
- Working AnyModel System One ID: `jev/jev-latest`
