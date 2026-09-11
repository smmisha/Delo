# Аудит требований Delo v1

Дата: 11 сентября 2026 года. Статусы относятся к текущим исходникам и локальной сборке 0.1.1.

`PASS` означает проверенное поведение. `PARTIAL` означает, что реализация существует, но обязательная часть требует другой среды или физического сценария. Непроверенная часть не засчитывается автоматически.

## Требования продукта

| ID | Статус | Доказательство / остаток |
| --- | --- | --- |
| S01 | PARTIAL | Локальный Windows 11 x64 installer запускается без SDK; публичная версия и чистая Windows ещё не проверены. |
| S02 | PASS | Desktop/topmost host, quick entry, сроки, таймер, репутация, архив, корзина, настройки, RU/UK/EN и обе темы реализованы и покрыты unit/live сценариями. |
| S03 | PASS | Не входящие в v1 серверные и расширенные функции отсутствуют; быстрый ввод не зависит от парсера дат. |
| S04 | PASS | Принятый портфель с галочкой встроен в UI, EXE, окно, трей и setup; рекламные элементы макета отсутствуют в app UI. |
| W01 | PARTIAL | Настоящий Win+D PASS, положение сохраняется и окно clamp-ится. Физическая смена/отключение монитора не проверена. |
| W02 | PASS | Desktop owner и topmost переключаются одним окном; материал и ввод подтверждены оконным стендом и production host. |
| W03 | PASS | Физический Win32 Ctrl+Alt+Space открыл список; конфликты startup/runtime проверены отдельным удерживающим процессом. |
| W04 | PASS | Физический Ctrl+Alt+N открыл quick-window. Live-сценарий 9 PASS: фокус, Enter, Escape, возврат фокуса, черновик и singleton окна. |
| W05 | PARTIAL | Tray-команды локализованы, singleton и installer mutex проверены, exit ждёт save acknowledgement. Реальный tray click и production autostart registry ещё не проверены. |
| T01 | PASS | Live input/editor 9 PASS: whitespace, IME, Enter race, Shift+Enter, multiline RU/UK, 4000/4001 и cancel. |
| T02 | PASS | Редактор и действия меню сохраняют независимые поля; cancel и write-error поведение покрыты live/unit тестами. |
| T03 | PASS | Deadline model покрывает day-end, exact time, DST/zone и смену срока; live invalid time не изменяет задачу. |
| T04 | PASS | Группировка и порядок реализованы чистой моделью; пустые группы скрыты. |
| T05 | PASS | Live context menu 14 PASS: границы, клавиатура, повтор, переключение, scroll, resize и outside click. |
| T06 | PASS | Выполнение останавливает таймер, показывает текст/цвет/галочку; награда идемпотентна и отменяется. |
| F01–F02 | PASS | Unit V05 и live workflow подтверждают одного runner, pause/resume/stop/complete, накопление и формат свыше 24 часов. Реальный сон проверен отдельно. |
| R01–R03 | PASS | Unit V06/V07 подтверждают награды, штрафы, позднее выполнение, undo и offline event ordering без повторного начисления. |
| A01–A04 | PASS | Unit V08 покрывает выполненные/незавершённые, scopes, будущий срок и повторный отсчёт после restore; live archive/trash доступны. |
| D01–D03 | PASS | Live undo/trash 12 PASS и unit retention boundary: независимые окна, hover/focus pause, LIFO undo, hidden pause, restore и 30 дней. |
| U01–U02 | PASS | Production D3D11/WGC/DComp захватывает реальный monitor backdrop с самоисключением; 9 GPU checks подтверждают Gaussian blur, inward refraction, tint и прозрачные углы. |
| U03 | PASS | 44 px controls, multiline wrapping, фиксированные header/input и dialog/menu bounds проверены live-сценариями. |
| U04 | PASS | Обе темы и material проверены на светлых, тёмных и детализированных контролируемых фонах; состояния имеют текст/иконки и видимый focus. |
| U05 | PASS | На неподвижном desktop за 10 секунд 0 новых presents. Live reduced motion 4 PASS: настройка применяется/сохраняется, transition и displacement animation отключены. |
| U06 | PASS | Live RU/UK/EN 13 PASS, исходный текст задач не меняется; menu/dialog focus и accessible names проверены. Installer имеет те же три языка. |
| U07 | PASS | Completion/overdue policy покрыта 4 unit тестами: только новые live ledger events, без звука startup/re-render/deadline edit. Настройки независимы. |
| N01–N02 | PASS | 20 native store/hotkey assertions, transactional settings tests и live backup recovery 4 PASS подтверждают CAS, atomic write, backup, corruption block и явное restore. |
| N03 | PARTIAL | Основной ноутбук 1920×1200: idle около 0,13% одного ядра, Working Set 54,69 МиБ; Win+D и sleep PASS. DPI 100/125/150/200, внешний monitor и интегрированная GPU физически не проверены. |
| N04 | PARTIAL | Inno Setup x64, per-user install/update/uninstall и сохранение данных PASS. Ветка отсутствующего WebView2 на чистой Windows остаётся UNVERIFIED. |
| N05 | PARTIAL | MIT, README, THIRD_PARTY, build/package scripts, secret/path audit и локальный Git подготовлены. Публичный GitHub repository/release ещё не создан; installer не подписан. |

## Приёмочные сценарии

| ID | Статус | Доказательство / остаток |
| --- | --- | --- |
| V01 | PASS | Физические global hotkeys плюс quick-window 9 PASS. |
| V02 | PARTIAL | Win+D и desktop/topmost PASS; Explorer restart и физический monitor change не проверены. |
| V03 | PASS | Input/editor 9 PASS и locales 13 PASS. |
| V04 | PASS | Context menu 14 PASS. |
| V05 | PASS | Domain timer scenario и live timer workflow. |
| V06 | PASS | Reputation unit scenarios, включая restart/idempotency. |
| V07 | PASS | Exact time, midnight, 7 days, offline, deadline/zone unit scenarios. |
| V08 | PASS | Archive scopes, future protection, restore cycle unit/live scenarios. |
| V09 | PASS | Undo/trash 12 live PASS плюс restart/retention unit boundaries. |
| V10 | PARTIAL | Themes, backgrounds, languages, keyboard, reduced motion, idle и rapid actions проверены; физические DPI/monitor scenarios остаются. |
| V11 | PASS | Write failures, restart, update and explicit backup recovery проверены. Первый sleep-run нашёл crash; fix прошёл реальный сон и relaunch. |
| V12 | PARTIAL | install 0.1.0 → update 0.1.1 → relaunch → uninstall и повторные final-package cycles PASS; clean Windows/missing runtime и GitHub publication остаются. |

## Внешние действия для закрытия

1. Проверить DPI 100%, 125%, 150%, 200% и подключение/отключение второго монитора.
2. Проверить installer в чистой Windows Sandbox/VM без SDK и без WebView2 Runtime.
3. Проверить production autostart и tray pointer interaction.
4. Опубликовать GitHub repository и release asset после review; при наличии сертификата подписать installer.
