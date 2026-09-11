# Delo — знак и надпись

Набросок 4, 9 сентября 2026. Предложение для согласования.

## В интерфейсе — векторный знак `#i-mark`

Знак живёт в спрайте `index.html` как `<symbol id="i-mark">`, 540 байт, `currentColor`. Портфель с вырезанной галочкой: «дело сделано» — то, что делает продукт. Одна форма, поэтому читается и на 96 px, и на 16 px в трее, и в обеих темах без отдельных версий.

Локап — знак плюс надпись Delo шрифтом интерфейса (`.lockup` в `task-controls.css`). Знак на 14 % выше кегельной высоты и на 8 % ниже базовой линии; зазор между знаком и словом — 0,32 кегельной высоты. В шапке виджета знак 32 px и слово 25 px, в шапке страницы 26 / 20. Доступное имя — Delo, задано текстом внутри `h2`, а не `aria-label`.

Геометрия: стенки корпуса 10 единиц сетки 96 × 96, радиусы из одного ряда 4 / 8 / 12, галочка обводкой 9 единиц с полукруглыми торцами.

## Почему не Д

Исходная задумка — монограмма из кириллической Д и портфеля. В букве Д опознавательное — плинт, выходящий за корпус, и две лапки под ним. Три попытки собрать это с портфелем дали автомобиль (плинт с лапками под корпусом с просветом) и кровать (тонкие высокие лапки). Схема «широкая опора плюс две ноги» слишком занята в иконографии, чтобы прочитаться как буква на 24 px, поэтому от каламбура отказались: язык бренда несёт надпись, знак несёт смысл действия.

## Растровый мастер

`delo-logo.png` — прежний горизонтальный локап «Д-портфель», созданный встроенным imagegen. PNG 2172 × 724 с альфа-каналом, исходник сохранён без изменения пикселей. В интерфейсе больше не используется: маска из растра весила 424 КБ на элемент 132 × 36, не давала иконки для трея и не имела запасного варианта, если `mask` не поддержана. Файл оставлен как архив попытки.

Принципы адаптации: различимый силуэт, оптическое выравнивание знака и надписи, свободное пространство, монохромная версия. Референсы подхода: [IBM, правила 8-bar](https://www.ibm.com/design/language/ibm-logos/8-bar/) и [Microsoft, дизайн иконок приложений](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design). Их логотипы и графика не используются.

## Prompt

Use case: logo-brand.
Asset type: production transparent logo lockup for Delo, a polished minimalist Windows productivity widget.
Create one original, exclusive horizontal logo: on the left a clever single geometric monogram that merges Cyrillic capital Д and a business briefcase; on the right the exact word "Delo" (D uppercase, elo lowercase).
The mark must read as a broad briefcase with integrated top handle and two understated projecting feet of the Cyrillic Д at the bottom. Simplify to bold filled geometry, a distinctive open counter, precise softly rounded corners, no tiny details. The Д structure must be recognizable, not a generic suitcase pictogram. Wordmark: custom drawn businesslike neo-grotesk sans serif, confident medium-bold weight, refined optical kerning, slightly squared rounded curves that match the mark. Strict professional elegance; inspired by the restraint and scalability of major corporate identities without copying any existing logo.
Single flat monochrome very dark navy #182b3a. Genuinely transparent alpha background with no backdrop or baked checkerboard. Logo only, no labels, no extra text, no mockup, no border, no gradient, no lighting/shadow or 3D. Wide horizontal composition, tightly framed with modest clear space, wordmark and icon optically balanced at 32px display height. Crisp vector-like contours.
