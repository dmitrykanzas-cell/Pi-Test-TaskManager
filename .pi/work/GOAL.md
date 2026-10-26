# Цель

Создать и доказать самостоятельный Pi Context-Evidence Pipeline — наблюдаемую и fail-closed среду взаимодействия Pi, Jev Router, Luna, Tools, Opus и Jev Verifier.

Репозиторий содержит только pipeline harness, его контракты, Pi extensions, тесты и документацию. Предметное приложение не является частью цели.

Целевой поток:

```text
REQUEST -> Pi -> Jev Router -> Luna -> Tools/Evidence -> Opus -> Jev Verifier -> typed verdict
```

Успех должен подтверждаться реальными проверками, актуальными evidence и свежим `runId`, а не наличием файлов или старого fixture trace.
