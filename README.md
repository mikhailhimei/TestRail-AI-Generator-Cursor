# TestRail — локальный сервер Codex

Файлы из архива `testrail-codex-server.zip` для работы расширения TestRail AI Generator с Codex.

## Получение файлов

Встроенный Codex CLI хранится в Git LFS. Установите [Git LFS](https://git-lfs.com/), затем выполните:

```sh
git lfs install
git clone https://github.com/mikhailhimei/TestRail-AI-Generator-Cursor.git
cd TestRail-AI-Generator-Cursor
git lfs pull
```

## Запуск в Windows x64

1. Установите Node.js 22.12 или новее.
2. Запустите `Start Windows.cmd`.
3. При необходимости войдите в аккаунт Codex.
4. В настройках расширения нажмите «Подключить Codex» и подтвердите подключение в окне сервера.

Не закрывайте окно сервера во время работы. Подробная инструкция, в том числе для других систем, находится в [README.txt](README.txt).

Токен подключения создаётся локально при запуске. Данные авторизации и локальные токены исключены из Git.
