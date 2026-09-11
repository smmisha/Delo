# Поставка Delo

Дата проверки: 11 сентября 2026 года.

## Состав

`app/package.ps1` сначала собирает release x64, затем вызывает Inno Setup и создаёт SHA-256 рядом с установщиком. `app/installer/Delo.iss` использует явный allowlist: приложение, HLSL, UI/core modules, лицензия Delo, LICENSE/NOTICE WebView2 SDK и подписанный автономный WebView2 Runtime x64. Тесты, исходники, `vendor`, `test-output` и пользовательские данные в пакет не входят.

Установка выполняется с `PrivilegesRequired=lowest` для текущего пользователя в `%LOCALAPPDATA%\Programs\Delo`. Поддерживается Windows 11 x64, минимальная версия — 10.0.22000. Доступны русский, украинский и английский интерфейсы установщика. Стабильный AppId позволяет обновлять существующую установку.

Перед копированием файлов установщик проверяет Evergreen WebView2 Runtime в зарегистрированных Microsoft client keys. Если подходящей версии нет, он извлекает и тихо запускает включённый standalone installer. Неудача останавливает установку с локализованным сообщением. Деинсталлятор не удаляет общий runtime.

Пользователь должен штатно закрыть работающий Delo перед обновлением или удалением. Установщик не завершает процесс принудительно, потому что приложение сначала подтверждает финальное сохранение состояния.

## Воспроизводимые команды

```powershell
cd app
./setup.ps1
./setup-distribution.ps1
./package.ps1 -Version 0.1.1
```

`setup-distribution.ps1` проверяет Authenticode автономного WebView2 и требует издателя Microsoft Corporation. `package.ps1` снова проверяет подпись перед упаковкой. Локально использован Inno Setup 6.7.3 с действительной подписью Pyrsys B.V.

Результат проверки:

- `dist/Delo-0.1.1-windows-x64-setup.exe` собран Inno Setup без предупреждений;
- SHA-256 актуального установщика с исправлением sleep/resume и VERSIONINFO: `2D4CDCDEDE24AC6142190174E2A7BEF08FBC39102A1BD61A228C7A3D3B6BDC8A`;
- принятый знак портфеля с галочкой встроен как multi-size icon в EXE и setup; Windows извлекает 32 × 32 с прозрачными углами;
- в установленной копии отсутствовали тесты, исходники, `vendor` и чужие данные;
- установка 0.1.0 и обновление поверх неё до 0.1.1 завершились без перезагрузки и без административных прав;
- установленный `Delo.exe` после обновления совпал по SHA-256 с release-сборкой;
- обновлённая копия загрузила сохранённую задачу в настоящем host/WebView2 без UI error;
- после удаления исчезли EXE, uninstaller, ярлык Start Menu и uninstall registry key;
- WebView2 Runtime остался зарегистрирован;
- изолированный `tasks.json` сохранился, SHA-256 до обновления и после удаления: `8F4DF9EC8263968944C2C6DED33D5831CB1A51BE415F71A9ED38A0C5C3763540`.
- отдельный процесс занял `Local\Delo.Widget`: silent setup завершился кодом 1, показал локализованное сообщение о запущенном Delo и не создал файлы приложения.

После functional исправлений пакет был повторно установлен в каталог `installed-final-20260911`. В установленной копии было 18 файлов, запрещённых исходников/тестов/vendor — 0. Настоящий host загрузился с `healthy=true`, `errors=0`, создал задачу без UI error и показал её после штатного перезапуска. Повторное удаление завершилось кодом 0: EXE, uninstaller, ярлык и uninstall key исчезли, WebView2 остался зарегистрирован, а изолированный `tasks.json` сохранил SHA-256 `CAC3A77829EB5397A800FEEEBE642D205DD084C9FFE19354C4574A761AC97490`.

После найденного и исправленного native crash при sleep/resume пакет собран ещё раз. Затем в EXE добавлен согласованный с installer ресурс VERSIONINFO: FileVersion `0.1.1.0`, ProductVersion `0.1.1`. Финальный release `Delo.exe` имеет SHA-256 `4914E354E0443C9507CE9A728528DBAA36A2D700B37C79E1C9D8078A27A58BB9`. Окончательный пакет установлен в новый каталог `installed-versioned-20260911`; установленный EXE совпал с release, host отвечал, renderer сообщил `healthy=true`, `errors=0`, `recoveries=1`. Деинсталляция завершилась кодом 0 и снова удалила EXE, uninstaller, ярлык и uninstall key.

Журналы локальной проверки находятся в игнорируемом `app/test-output`. Они не предназначены для публикации, поскольку могут содержать абсолютные пути пользователя.

## Что ещё не доказано

Проверка выполнена на машине разработчика, где WebView2 Runtime уже был установлен. Поэтому ветка его автоматической установки и запуск на чистой Windows без Visual Studio/SDK остаются `UNVERIFIED`. Для этого нужен отдельный Windows Sandbox или чистая виртуальная машина; удалять общий runtime с основной машины ради теста нельзя.

Установщик Delo пока не подписан сертификатом издателя. SHA-256 подтверждает целостность опубликованного файла, но Windows SmartScreen может показать предупреждение для нового неподписанного приложения.

Перед публичным релизом остаются полный аудит лицензий и ресурсов, создание Git-репозитория, проверка отсутствия секретов и личных артефактов, публикация исходников и установщика, а также сопоставление V12 с чистой системой.

## Первичные источники

- Microsoft WebView2 distribution: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- Inno Setup privileges: https://jrsoftware.org/ishelp/topic_setup_privilegesrequired.htm
- Inno Setup architecture directives: https://jrsoftware.org/ishelp/topic_setup_architecturesallowed.htm
- Inno Setup downloads: https://jrsoftware.org/isdl.php
