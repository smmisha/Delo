# Аудит требований Delo v1

Дата: 11 сентября 2026 года. Статусы относятся к текущим исходникам и локальной сборке 0.1.2.

После завершения аудита пользователь разрешил немедленное обновление: обычная копия `app/bin` теперь содержит проверенную сборку и перезапущена. Задачи и автозапуск сохранены. Статусы непроверенных требований и старого installer этим не меняются; подробности в начале [UI-AUDIT-20260911](UI-AUDIT-20260911.md).

Уточнение после повторного UI-аудита: [UI-AUDIT-20260911](UI-AUDIT-20260911.md) имеет приоритет над прежними утверждениями о физических клавишах, изменении размеров и моргании. Исправления перенесены в обычную копию `app/bin`; исторический installer 0.1.2 их не содержит. Строки о сне, Win+D и поставке ниже описывают прежние проверки, а не повторную сертификацию этой сборки.

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
| U01–U02 | PARTIAL | Production host использует живой Windows Composition Backdrop без screen capture, системной рамки и самозахвата; системный Gaussian Blur, многослойный tint, направленные блики и округление проверены. Видимое пространственное преломление внешнего фона у кромки U01 временно отсутствует. |
| U03 | PARTIAL | Проверены multiline, dialog/menu bounds и минимальные окна; в узком режиме часть контролов имеет 38 CSS px. Изменение размеров мышью исправлено; отдельный zoom интерфейса не реализован. |
| U04 | PARTIAL | Обе темы и фактические снимки проверены; состояния имеют текст/иконки и видимый focus. Полный набор контрастных измерений с разными внешними фонами для текущего renderer не выполнен. |
| U05 | PASS | На неподвижном desktop за 10 секунд 0 новых presents. Live reduced motion 4 PASS: настройка применяется/сохраняется, transition и displacement animation отключены. |
| U06 | PASS | Live RU/UK/EN 13 PASS, исходный текст задач не меняется; menu/dialog focus и accessible names проверены. Installer имеет те же три языка. |
| U07 | PASS | Completion/overdue policy покрыта 4 unit тестами: только новые live ledger events, без звука startup/re-render/deadline edit. Настройки независимы. |
| N01–N02 | PASS | 20 native store/hotkey assertions, transactional settings tests и live backup recovery 4 PASS подтверждают CAS, atomic write, backup, corruption block и явное restore. |
| N03 | PARTIAL | Основной ноутбук 1920×1200: idle около 0,13% одного ядра, Working Set 54,69 МиБ; Win+D и sleep PASS. DPI 100/125/150/200, внешний monitor и интегрированная GPU физически не проверены. |
| N04 | PARTIAL | Inno Setup x64 0.1.4, per-user install, полный UI harness, uninstall и сохранение данных PASS. В пакет включены локальный Whisper и модель. Ветка отсутствующего WebView2 на чистой Windows остаётся UNVERIFIED. |
| N05 | PARTIAL | MIT, README, THIRD_PARTY, build/package scripts, secret/path audit, публичный GitHub repository и release подготовлены. Installer не подписан. |

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
| V10 | PARTIAL | Themes, Liquid Glass settings, dropdown contrast, icon alignment, custom tooltip/confirmation, hotkey recording, 2 × 2 settings grid, stable send arrow, languages, keyboard, reduced motion, idle, rapid actions и responsive размеры 320 × 360 / 296 × 71 проверены; физические DPI/monitor scenarios остаются. |
| V11 | PASS | Write failures, restart, update and explicit backup recovery проверены. Первый sleep-run нашёл crash; fix прошёл реальный сон и relaunch. |
| V12 | PARTIAL | Пакет 0.1.4 SHA-256 `56BC4EBABA87359B7269781CEB7878EC9401B67083376E1578E7F6663483825B`: отдельная установка, 43 совпавших allowlist-файла, полный UI harness и uninstall PASS; тестовые данные сохранены. Windows Sandbox не дошла до LogonCommand, поэтому clean Windows/missing-runtime остаётся UNVERIFIED. |

## Внешние действия для закрытия

1. Проверить DPI 100%, 125%, 150%, 200% и подключение/отключение второго монитора.
2. Проверить installer в чистой Windows Sandbox/VM без SDK и без WebView2 Runtime.
3. Проверить production autostart и tray pointer interaction.
4. Опубликовать GitHub repository и release asset после review; при наличии сертификата подписать installer.
