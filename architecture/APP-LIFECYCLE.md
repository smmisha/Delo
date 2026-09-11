# Lifecycle производственного Delo

Дата проверки: 11 сентября 2026 года.

## Win+D

Проверена настоящая сборка `app/bin/Delo.exe` в отдельной сессии `--harness=lifecycle-20260911`, а не оконный прототип. В harness diagnostics добавлены прямые Win32-показатели `IsWindowVisible`, `IsIconic` и фактический owner HWND.

До Win+D:

```text
healthy=true, errors=0
windowVisible=true, iconic=false
owner=197936, window=1115098
copied=76, rendered=2
```

После физически отправленного Win+D и ожидания 2 секунд:

```text
healthy=true, errors=0
windowVisible=true, iconic=false
owner=197936, window=1115098
copied=128, rendered=2
```

Процесс оставался отвечающим. Окно не было свёрнуто или скрыто, owner рабочего стола не изменился, захват продолжал получать кадры, а renderer не сообщил ошибок. Повторное Win+D вернуло окна пользователя; Delo затем штатно завершился через `beforeExit`/save acknowledgement.

Это закрывает проверенный случай Win+D на текущем основном мониторе и текущем DPI. Смена Explorer, перенос между физическими мониторами и разные DPI остаются отдельными сценариями.

## Покой и ресурсы

Production renderer проверен в сессии `--harness=idle-20260911` после Win+D на неподвижном рабочем столе. За 10 секунд WGC передал 4 кадра, но счётчик отрисовок не изменился: `rendered=92` до и после. Renderer остался `healthy=true`, `errors=0`, окно — видимым и не свёрнутым.

Параллельное измерение за 12 секунд показало 15,62 мс CPU, то есть около 0,13% одного логического ядра. Working Set остался 54,69 МиБ, Private Memory — 65,86 МиБ. Контрольный прогон поверх меняющегося окна Codex дал новые presents, что является требуемой реакцией стекла на изменение захваченного фона, а не собственной декоративной анимацией.

## Сон и блокировка

Host принимает `PBT_APMSUSPEND`, `PBT_APMRESUMEAUTOMATIC`, `WTS_SESSION_LOCK` и `WTS_SESSION_UNLOCK`. Перед паузой он рассылает domain-команду `suspend` и сбрасывает WGC/D3D resources; после возобновления создаёт их заново. Таймер использует `QueryUnbiasedInterruptTimePrecise`, поэтому время сна не должно попадать в рабочий интервал.

Первый реальный прогон production app в сессии `sleep-production-20260911` воспроизвёл исчезновение виджета после пробуждения. Windows Event Log зафиксировал native crash `0xc0000005` в `Delo.exe`, RVA `0x21BCE`. Дизассемблирование сопоставило адрес с разыменованием GPU внутри `GlassRenderer::Tick`. WGC/DComp-вызов может вложенно обработать power/display message; прежний `Reset()` в этот момент освобождал GPU и capture прямо посреди текущего Tick. Данные не повредились: задача была сохранена как paused.

Исправление добавляет защиту от повторного Tick и откладывает `Rebuild`/`Suspend` reset до выхода из текущего Tick. После сборки повторный реальный сон выполнен в сессии `sleep-production-fix-20260911` с работающим таймером. До сна: `healthy=true`, `errors=0`, `recoveries=1`, elapsed 1492,75 мс. После пробуждения:

```text
powerSuspends=3, powerResumes=3
healthy=true, errors=0, recoveries=4
windowVisible=true, iconic=false
workState=paused, elapsedMs=24822.46
```

Несколько power-событий ожидаемы: Windows прислал session lock/unlock и системные suspend/resume уведомления. Таймер исключил период сна при сравнении с wall-clock. Все 6 post-resume проверок прошли; процесс продолжал отвечать, новых Application Error/WER событий для Delo после исправления нет. После штатного выхода и повторного запуска той же сессии прошли ещё 4 проверки: задача и elapsed сохранились, состояние осталось paused, renderer снова healthy/errors=0.
