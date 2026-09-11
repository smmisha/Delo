# Delo — первая проверка нативного источника фона

10 сентября 2026. **Материал пока не подтверждён.** Исследован конкретный Windows.UI.Composition-прототип через WinForms/.NET Framework; отрицательный результат не доказывает невозможность эффекта в WinUI или другом native-host.

## Измерения

Тест использует два собственных окна. За пробной поверхностью расположен контрастный узор, который меняет цвета. Изменение контрольного пикселя и изображения должно показать, что материал получает внешний фон. Это проверка источника; шейдер преломления на данном этапе не подключался.

| Проверка | Фактический результат |
| --- | --- |
| Windows transparency preference | Включена, настройка не менялась |
| Контрольная красная Composition-поверхность | Отрисовалась, COLORREF=255 |
| Включение DWMWA_USE_HOSTBACKDROPBRUSH, рамки и системного backdrop | HRESULT=0; этого недостаточно для визуального успеха |
| HostBackdrop как источник стандартного opacity-effect | Чёрный цвет до и после изменения узора: 0 / 0 |
| Обычный BackdropBrush, окно без redirection bitmap | Однородная серая поверхность: 13882323 / 13882323; внешний узор не обнаружен |
| Привязка HostWindow к Explorer | SetParent вернул Win32 error 5 (Access denied) |
| Уничтожение Composition-target, новое HWND, повторная привязка | Ошибка привязки сохранилась в этом процессе |
| Desktop-материал после Win+D | Не проверен: выполнение не дошло до этой стадии |

Финальный прогон завершился кодом **1**, его нельзя считать успешным. [Машинный журнал](evidence/native-backdrop-2026-09-10.json). Изображение серой поверхности просмотрено. Все временные процессы закрылись.

Ранее проверенный простой layered-виджет продолжает иметь отдельный результат **13/13**: [WINDOWS-LAYER.md](WINDOWS-LAYER.md). Его исходник в этом эксперименте не менялся. Успех простого окна не переносится автоматически на окно с другим compositor-target.

## Что построено

- [HostBackdropProbe.cs](../prototypes/windows-layer/HostBackdropProbe.cs): системный Windows.UI.Composition, контрольный цвет, два источника backdrop, измерение реакции на внешний узор.
- [BackdropEffect.cpp](../prototypes/windows-layer/BackdropEffect.cpp): собственная C++/WinRT-обвязка стандартного D2D opacity-effect с коэффициентом 1. Никакого собственного шейдера, патчинга DWM или перехватов функций.
- [build-host-backdrop.ps1](../prototypes/windows-layer/build-host-backdrop.ps1) и [build-effect.ps1](../prototypes/windows-layer/build-effect.ps1): сборка имеющимися локальными инструментами. Обнаружены Windows SDK 10.0.26100.0 и Visual Studio Build Tools 2026 с MSVC 14.50.35717; устанавливать их не понадобилось.
- Сборка C# и C++ проходит. Первоначальная попытка передать описание эффекта через управляемый COM-интерфейс дала E_POINTER; C++/WinRT-адаптер эту проблему устранил, но не решил источник фона.

Вспомогательные DLL, изображения и EXE остаются в исключённом из Git `bin`. Это диагностические артефакты, не установщик Delo.

## Уточнение по LiquidGlassWinUI

В [LiquidGlassBrush.cs](https://github.com/luckyelysia/LiquidGlassWinUI/blob/main/LiquidGlassWinUI/LiquidGlassBrush.cs) источник создаётся через `CreateBackdropBrush`. Сам по себе этот вызов не доказывает чтение других окон: область выборки зависит от host и композиции. Проверка библиотеки в нашем desktop-host ещё не выполнялась.

По [README библиотеки](https://github.com/luckyelysia/LiquidGlassWinUI), её custom-effect runtime зависит от внутренних символов конкретной Windows App SDK 2.2.0 и x64. Это кандидат для отдельного теста, не выбранная основа публичного приложения. Он не был установлен или запущен в текущем эксперименте.

## Вывод для Architecture

1. Не фиксировать стек приложения по успешному простому SetParent-прототипу: renderer способен изменить совместимость HWND с Explorer.
2. Не выдавать Acrylic, серую поверхность или успешно возвращённый HRESULT за преломление.
3. Следующий эксперимент должен убрать WinForms/.NET Framework из цепочки: минимальный native Win32/C++/WinRT host с контролируемым источником, затем тест конкретной refractive-библиотеки. Сначала доказать внешний фон и desktop-совместимость, потом настраивать визуальные параметры.
4. Реальные CPU/GPU/RAM-бюджеты оптики измерять только после работающего источника. В этом прогоне показатели ресурсов не измерялись.

## Документация

- [Microsoft HostBackdropBrush](https://learn.microsoft.com/en-us/uwp/api/windows.ui.composition.compositor.createhostbackdropbrush): выборка до отрисовки окна; приложение не может читать пиксели этой кисти обратно напрямую.
- [Microsoft CompositionBackdropBrush](https://learn.microsoft.com/en-us/uwp/api/windows.ui.composition.compositionbackdropbrush): использование источника в цепочке эффектов.
- [Microsoft DWMWINDOWATTRIBUTE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute): разрешение host-backdrop для Win32-окна.
- [Win32Acrylic](https://github.com/ALTaleX531/Win32Acrylic): изучен порядок создания compositor и DesktopWindowTarget; исходники в Delo не переносились.
