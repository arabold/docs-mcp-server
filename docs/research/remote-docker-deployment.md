# Исследование: Docker-развёртывание и изоляция экземпляров

Дата проверки: 2026-08-08

## Краткий вывод

1. `docs-mcp-server` официально поддерживает запуск в Docker. Для обычной нагрузки достаточно одного контейнера в standalone-режиме: MCP, Web UI и обработчик документов работают в одном процессе.
2. Один экземпляр уже разделяет данные по именам библиотек и версиям. Поиск `search_docs` обязательно принимает имя библиотеки, поэтому результаты разных библиотек не объединяются в одном запросе.
3. Это логическое, а не строгое разделение. Один экземпляр использует общие базу SQLite, конфигурацию, модель эмбеддингов, учётные данные, правила доступа к сети и файлам. Авторизованный пользователь получает доступ ко всем MCP-инструментам без разграничения по библиотекам.
4. Если цель — гарантированно не смешивать книги, документацию отдельных проектов, права доступа и настройки, имеет смысл поднять отдельный standalone-контейнер на каждый контур. Для трёх небольших контуров это проще и безопаснее, чем три распределённых комплекта `worker + mcp + web`.

## 1. Возможность установки в Docker

Поддержка Docker является штатной:

- README содержит готовый запуск опубликованного образа `ghcr.io/arabold/docs-mcp-server:latest` с томами `/data` и `/config` и HTTP-портом 6280 ([README.md](../../README.md#alternative-run-with-docker)).
- Руководство по установке повторяет этот вариант и объясняет назначение постоянных томов и права пользователя контейнера ([docs/setup/installation.md](../setup/installation.md#option-2-docker)).
- Репозиторий содержит production [`Dockerfile`](../../Dockerfile): Node.js 22, Chromium для Playwright, непривилегированный пользователь `node` (uid 1000), постоянные каталоги `/data` и `/config`.
- В репозитории есть [`docker-compose.yml`](../../docker-compose.yml) для распределённой схемы `worker + mcp + web`.

Для первого удалённого развёртывания предпочтителен standalone-контейнер. Архитектура прямо относит его к простым production-развёртываниям; распределённый режим нужен прежде всего при большой нагрузке и независимом масштабировании интерфейсных процессов ([docs/infrastructure/deployment-modes.md](../infrastructure/deployment-modes.md#standalone-server-mode)).

Минимальная схема одного экземпляра:

```text
клиент MCP -> TLS/reverse proxy -> контейнер docs-mcp-server:6280
                                      |-- отдельный том /data
                                      |-- отдельный том /config
                                      `-- при необходимости /sources:ro
```

В контейнере следует явно запускать HTTP-режим с `--protocol http --host 0.0.0.0 --port 6280`. Для локальных файлов каталог хоста необходимо отдельно примонтировать в контейнер; одного тома `/data` для этого недостаточно ([docs/guides/basic-usage.md](../guides/basic-usage.md#local-files-with-docker)).

### Проверенное состояние удалённого сервера

Проверка выполнена по SSH только читающими командами. Идентификаторы сервера и
секреты в отчёт не выводились.

| Проверка | Результат |
|---|---|
| ОС и архитектура | Ubuntu 24.04, x86_64 |
| Процессор | 4 логических CPU |
| Оперативная память | 45 828 MiB |
| Свободно на корневом диске | 15,7 GiB |
| Docker | клиент и daemon 29.1.3 доступны текущему пользователю |
| Docker storage/cgroups | overlayfs, cgroup v2 |
| Docker Compose | 2.40.3 |
| Текущая нагрузка Docker | 8 работающих контейнеров; образы занимают около 4,5 GB |
| Доступ к GHCR | доступен с сервера |
| Порты 6280, 6281, 6282 | свободны |
| Порт 8080 | занят |
| Порты 80 и 443 | 80 занят, 443 свободен |
| Каталог `REMOTE_SERVER_PROJECT_DIR` | переменная пока не задана |

На порту 80 работает Apache 2.4.58. Модули `proxy`, `proxy_http`, `rewrite`,
`headers` и `ssl` сейчас не включены, поэтому Apache пока не готов выполнять
роль HTTPS reverse proxy для этих экземпляров. Статус UFW без повышения прав
прочитать не удалось, поэтому состояние внешнего firewall остаётся
неподтверждённым.

Сервер подходит для нескольких standalone-контейнеров по CPU и памяти. Главный
ресурсный риск — диск: общий Docker-образ переиспользуется между контейнерами,
но данные, SQLite-базы и конфигурация каждого экземпляра занимают место отдельно.
До загрузки больших книг следует определить ожидаемый объём и настроить контроль
свободного места. Стандартный распределённый Compose без изменений не запустится,
так как его host-порт worker `8080` уже занят.

## 2. Что уже разделено внутри одного экземпляра

Хранилище нормализовано по сущностям `libraries -> versions -> pages -> documents`; документы связаны с конкретной библиотекой и версией ([docs/concepts/data-storage.md](../concepts/data-storage.md#database-schema)).

Поиск также явно ограничивается библиотекой:

- CLI использует форму `search <library> <query>` ([docs/guides/basic-usage.md](../guides/basic-usage.md#search-the-index));
- MCP-схема `search_docs` требует поле `library` ([src/mcp/mcpServer.ts](../../src/mcp/mcpServer.ts));
- `SearchTool` сначала проверяет существование указанной библиотеки, разрешает её версию и только затем обращается к хранилищу ([src/tools/SearchTool.ts](../../src/tools/SearchTool.ts)).

Поэтому один экземпляр подходит, если под «не смешивалось» имеется в виду только следующее:

- книги и проекты имеют разные имена библиотек;
- агент всегда передаёт правильное имя библиотеки;
- одни и те же пользователи могут видеть и изменять весь индекс;
- для всех коллекций подходят одинаковые модель эмбеддингов, ключи, сетевые правила и политика локальных файлов;
- общий жизненный цикл базы, резервного копирования и обновления приемлем.

## 3. Где один экземпляр не даёт строгой изоляции

В одном экземпляре общими остаются:

- один каталог хранилища и одна SQLite-база (`app.storePath`; в образе это `/data`) ([docs/setup/configuration.md](../setup/configuration.md#app-app));
- один конфигурационный контур (`/config` в Docker);
- одна активная модель и размерность эмбеддингов, чья идентичность хранится на уровне всей базы, а не отдельной библиотеки ([docs/concepts/data-storage.md](../concepts/data-storage.md#metadata-table));
- общие лимиты и параллелизм скрапинга;
- общие правила исходящего доступа и чтения `file://`;
- общий набор MCP-инструментов управления индексом.

Встроенная OAuth-модель бинарная: авторизованный пользователь получает полный доступ ко всем MCP-инструментам, библиотечных ролей в ней нет ([docs/infrastructure/authentication.md](../infrastructure/authentication.md#binary-authentication-model)). Следовательно, библиотечные имена защищают от случайного смешивания результатов поиска, но не являются границей доступа или администрирования.

Кроме того, инструменты могут индексировать новые источники и получать разрешённые URL. Для настоящей изоляции недостаточно разделить только тома: каждому экземпляру нужны собственные сетевые allowlist-правила и отдельные разрешённые корни файлов. Руководство по безопасности рекомендует для удалённых развёртываний узкие `allowedRoots` либо полностью отключённый `file://`, а также ограничение исходящей сети ([docs/infrastructure/security.md](../infrastructure/security.md#deployment-hardening)).

## 4. Рекомендуемая схема для книг и проектов

Для заявленной цели рекомендуется три независимых standalone-экземпляра:

| Контур | MCP-адрес | Том данных | Том конфигурации | Доступные источники |
|---|---|---|---|---|
| Книги | отдельный hostname или путь reverse proxy | `docs-books-data` | `docs-books-config` | только каталог книг и/или разрешённые сайты книг |
| Проект A | отдельный hostname или путь | `docs-project-a-data` | `docs-project-a-config` | только репозитории и документация проекта A |
| Проект B | отдельный hostname или путь | `docs-project-b-data` | `docs-project-b-config` | только источники проекта B |

Практические правила изоляции:

1. У каждого контейнера должны быть уникальные тома `/data` и `/config`. Нельзя подключать один SQLite-том к независимым standalone-экземплярам.
2. Локальные исходники монтируются отдельно и только для чтения, например `/srv/docs/books:/sources:ro`; в конфигурации экземпляра разрешается только `/sources`.
3. Публично открывается только reverse proxy с TLS. Порты контейнеров лучше публиковать на loopback хоста или оставить только во внутренней Docker-сети.
4. Для каждого экземпляра задаются собственные `publicOrigin`, OAuth audience/доступ и, при необходимости, отдельные ключи провайдеров эмбеддингов.
5. Исходящая сеть ограничивается доменами конкретного контура. Если экземпляр индексирует только локальные файлы, сетевой доступ следует максимально сузить.
6. Телеметрию следует принять как отдельное явное решение; значение по умолчанию — `true` ([docs/setup/configuration.md](../setup/configuration.md#app-app)).
7. Резервное копирование и восстановление выполняются отдельно для каждого тома. Перед обновлением важных баз следует проверять миграции на согласованной копии ([docs/concepts/data-storage.md](../concepts/data-storage.md#backup-and-recovery)).

Концептуальный Compose-фрагмент, не предназначенный для запуска без настройки TLS, авторизации и правил доступа:

```yaml
services:
  books:
    image: ghcr.io/arabold/docs-mcp-server:latest
    command: ["--protocol", "http", "--host", "0.0.0.0", "--port", "6280"]
    restart: unless-stopped
    ports:
      - "127.0.0.1:6280:6280"
    volumes:
      - docs-books-data:/data
      - docs-books-config:/config
      - /srv/docs/books:/sources:ro

  project-a:
    image: ghcr.io/arabold/docs-mcp-server:latest
    command: ["--protocol", "http", "--host", "0.0.0.0", "--port", "6280"]
    restart: unless-stopped
    ports:
      - "127.0.0.1:6281:6280"
    volumes:
      - docs-project-a-data:/data
      - docs-project-a-config:/config
      - /srv/docs/project-a:/sources:ro

volumes:
  docs-books-data:
  docs-books-config:
  docs-project-a-data:
  docs-project-a-config:
```

В существующем репозиторном `docker-compose.yml` явно заданы одинаковые `container_name` и глобальные имена томов. Поэтому его нельзя просто запустить несколько раз под разными Compose project name для полной изоляции: имена контейнеров и томов столкнутся. Для нескольких контуров нужен отдельный production Compose без фиксированных общих имён либо с уникальными именами для каждого контура.

## 5. Разные Bearer-токены для разных экземпляров

### Что есть внутри `docs-mcp-server`

Текущая версия не содержит настройки вида `STATIC_BEARER_TOKEN`, `API_KEY` или списка заранее заданных входных токенов. Доступные параметры встроенной авторизации — только `enabled`, `issuerUrl` и `audience`; CLI также предлагает лишь `--auth-enabled`, `--auth-issuer-url` и `--auth-audience` ([docs/setup/configuration.md](../setup/configuration.md#authentication-auth), [src/cli/commands/default.ts](../../src/cli/commands/default.ts)).

Встроенный сервер действительно принимает заголовок `Authorization: Bearer ...`, но это не проверка на равенство фиксированному секрету:

- сервер является OAuth2 protected resource и зависит от внешнего OAuth2/OIDC-провайдера ([docs/infrastructure/authentication.md](../infrastructure/authentication.md#overview));
- JWT проверяется по JWKS, issuer и audience;
- opaque-токен может проверяться через `userinfo` внешнего провайдера;
- middleware возвращает `401`, если провайдер не подтвердил токен ([src/auth/ProxyAuthManager.ts](../../src/auth/ProxyAuthManager.ts), [src/auth/middleware.ts](../../src/auth/middleware.ts)).

Следовательно, есть два разных решения, которые нельзя смешивать:

1. **Встроенный OAuth2/OIDC.** Для каждого экземпляра задаётся отдельный `audience` и, при необходимости, отдельный клиент/политика у провайдера. Клиент присылает выданный провайдером Bearer access token. Это предпочтительно для нескольких пользователей, браузерного входа, сроков действия и отзыва токенов.
2. **Фиксированный Bearer-секрет.** Сам `docs-mcp-server` его не проверяет. Проверку выполняет внешний reverse proxy, а встроенная OAuth-авторизация приложения остаётся выключенной, чтобы один заголовок не проходил две несовместимые проверки.

### Безопасная схема фиксированных токенов

```text
MCP-клиент --TLS + Bearer BOOKS_TOKEN--> reverse proxy --> books:6280
MCP-клиент --TLS + Bearer PROJECT_TOKEN-> reverse proxy --> project:6280
                                                    контейнеры не доступны извне
```

Для каждого hostname или маршрута reverse proxy сравнивает `Authorization` с отдельным секретом и проксирует запрос только при совпадении. Концептуальный пример Caddy:

```caddyfile
books.example.com {
    @authorized header Authorization "Bearer {$BOOKS_BEARER_TOKEN}"

    handle @authorized {
        reverse_proxy 127.0.0.1:6280
    }

    handle {
        header WWW-Authenticate "Bearer realm=docs-books"
        respond "Unauthorized" 401
    }
}

project-a.example.com {
    @authorized header Authorization "Bearer {$PROJECT_A_BEARER_TOKEN}"

    handle @authorized {
        reverse_proxy 127.0.0.1:6281
    }

    handle {
        header WWW-Authenticate "Bearer realm=docs-project-a"
        respond "Unauthorized" 401
    }
}
```

Caddy документирует точное сопоставление значения request header, взаимоисключающие `handle`-блоки, подстановку `{$ENV}` до разбора Caddyfile и `reverse_proxy`: [header matcher](https://caddyserver.com/docs/caddyfile/matchers#header), [handle](https://caddyserver.com/docs/caddyfile/directives/handle), [environment variables](https://caddyserver.com/docs/caddyfile/concepts#environment-variables), [reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). Это первичная документация Caddy; пример выше является проектной схемой, а не встроенной возможностью `docs-mcp-server`.

Обязательные меры:

- токены должны быть разными для каждого экземпляра, длинными и случайными; для безопасной подстановки в конфигурацию удобно использовать URL-safe набор символов без пробелов и кавычек;
- хранить токены следует в закрытом secret storage или окружении reverse proxy, а не в отслеживаемом Compose/Caddyfile;
- контейнеры нельзя публиковать на внешнем интерфейсе: иначе proxy можно обойти прямым подключением;
- использовать только HTTPS; при HTTP Bearer-секрет передаётся открытым текстом;
- не включать запись `Authorization` в access-логи и не выводить окружение/конфигурацию с подставленными значениями;
- при ротации заменить только токен нужного контура и перезагрузить proxy, не переиспользуя старое значение в соседних контурах;
- клиент MCP должен уметь добавлять постоянный заголовок `Authorization` ко всем запросам. Для новых подключений предпочтителен `/mcp` (Streamable HTTP); поддержку пользовательских заголовков нужно проверить в конкретном клиенте;
- Web UI в обычном браузере неудобно защищать фиксированным Bearer-заголовком. Для Web UI и нескольких людей лучше использовать OAuth2/OIDC либо отдельный browser-oriented auth proxy.

Фиксированный Bearer-токен остаётся общим секретом: у него нет личности пользователя, автоматического срока действия и точечного отзыва. Если простого сравнения заголовка недостаточно, reverse proxy должен делегировать проверку отдельному auth-сервису (например, через [Caddy `forward_auth`](https://caddyserver.com/docs/caddyfile/directives/forward_auth)) либо следует использовать встроенную OAuth2/OIDC-схему.

Для поставленной задачи разные фиксированные токены на reverse proxy дадут практическое разделение трёх доверенных MCP-клиентов. Если доступ получат разные люди или Web UI будет открыт удалённо, предпочтительнее отдельный OAuth audience на каждый экземпляр.

## 6. Когда нужен распределённый режим

Распределённая схема оправдана, когда одному контуру требуется высокая скорость индексации или несколько MCP/Web-координаторов. В ней один worker владеет SQLite-хранилищем, а координаторы обращаются к нему через tRPC.

Важно:

- worker не поддерживает горизонтальное масштабирование с общей SQLite-базой; его масштабируют вертикально ([docs/infrastructure/deployment-modes.md](../infrastructure/deployment-modes.md#the-worker-does-not-scale-horizontally));
- внутренний `/api` не защищается встроенным OAuth и должен оставаться в закрытой сети ([docs/infrastructure/authentication.md](../infrastructure/authentication.md#security-scope));
- текущий репозиторный Compose публикует порт worker `8080` на хост. В production-схеме без внешней необходимости это отображение следует убрать, оставив доступ только внутри Compose-сети.

Для начальной установки книг и нескольких проектов распределённый режим добавит контейнеры и сетевые связи, но не улучшит разделение данных по сравнению с отдельными standalone-контейнерами.

## Итоговая рекомендация

- Если нужна только аккуратная организация поиска и все пользователи/настройки общие — начать с одного экземпляра и отдельных библиотек.
- Если «не смешивалось» означает отдельные данные, источники, доступ, ключи, настройки и возможность независимо обновлять/восстанавливать контуры — использовать отдельный standalone-контейнер на книги и на каждый проект.
- Для описанного сценария предпочтителен второй вариант. Сначала следует проверить ресурсы удалённого сервера и сетевую схему, затем подготовить production Compose; данное исследование само по себе ничего на сервере не изменяет.

## Первичные источники

- [`README.md`](../../README.md)
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md)
- [`Dockerfile`](../../Dockerfile)
- [`docker-compose.yml`](../../docker-compose.yml)
- [`docs/setup/installation.md`](../setup/installation.md)
- [`docs/setup/configuration.md`](../setup/configuration.md)
- [`docs/infrastructure/deployment-modes.md`](../infrastructure/deployment-modes.md)
- [`docs/infrastructure/authentication.md`](../infrastructure/authentication.md)
- [`docs/infrastructure/security.md`](../infrastructure/security.md)
- [`docs/concepts/data-storage.md`](../concepts/data-storage.md)
- [`src/mcp/mcpServer.ts`](../../src/mcp/mcpServer.ts)
- [`src/tools/SearchTool.ts`](../../src/tools/SearchTool.ts)
