# Agro Drifter

Gra jazdy/driftu z polskim, nocnym, groteskowym klimatem: driftujesz przez
wieś i blokowisko, unikając sarn, potłuczonych butelek i dziur w drodze, aż
dotrzesz do stacji paliw, gdzie gra się zapisuje.

**Gra na żywo: https://kasztan9w8w7w6.github.io/Agro-drifter/**

## W trakcie przepisywania na pełne 3D

Projekt jest w trakcie przechodzenia z prototypu 2D (Phaser/canvas) na pełne
3D w Three.js z estetyką PS1 (patrz techniczny brief w historii projektu).
To jest **Sesja 1** tego przepisu: fundament renderowania, kamery, fizyki i
sterowania - zanim dołączą realne assety, droga i świat.

### Zaimplementowane (Sesja 1)

- `WebGPURenderer` z automatycznym fallbackiem do WebGL2 (wbudowany w
  Three.js) + `RetroPassNode` jako pipeline post-processingu: vertex
  snapping, affine texture mapping, niska rozdzielczość wewnętrzna z
  nearest-neighbor filtering - klimat PS1 bez pisania własnego shadera.
- Kamera "chase cam" za autem z tłumieniem niezależnym od FPS
  (`1 - exp(-rate*dt)`), look-ahead, FOV pump przy prędkości i lekki roll
  proporcjonalny do kąta poślizgu podczas driftu.
- Fizyka driftu (bicycle model z nasycającą się siłą boczną opony,
  przeniesiony na płaszczyznę XZ świata 3D), z pakietem testów w `npm test`
  (Vitest): brak NaN/eksplozji prędkości w losowej jazdie, zachowanie
  niezależne od FPS (fizyka wewnętrznie dzieli krok na podkroki - patrz
  `MAX_SUBSTEP_DT`), auto realnie zwalnia i prostuje się po puszczeniu
  wejść, oraz regresyjny test kierunku skrętu zweryfikowany względem
  rzeczywistej macierzy `lookAt` z Three.js (nie "na oko").
- Drift osiągalny dwiema drogami: hamulcem ręcznym (mocny, szybki) i samym
  gazem + ostrym skrętem przy prędkości ("power oversteer", parametr
  `powerOversteerFactor` per auto - im wyższy, tym łatwiej auto się urywa
  z tyłu bez ręcznego).
- Jedna abstrakcja wejścia (`{throttle, brake, steer, handbrake}`) wspólna
  dla klawiatury i dotyku - fizyka nie wie, z jakiego źródła pochodzi input.
- Płaska płaszczyzna testowa z prostymi obiektami-znacznikami (bez drogi,
  przeszkód i realnych modeli - to kolejne kroki przepisu).
- Automatyczny deploy na GitHub Pages przy pushu do `main`.

Kod poprzedniego prototypu 2D (audio syntezowane na żywo, zapis do
`localStorage`, generowane proceduralnie sprite'y) częściowo pozostaje w
repo (`src/audio`, `src/save.ts`, `src/palette.ts`) do ponownego podłączenia
w kolejnych sesjach przepisu (radio, save-pointy) - obecnie jeszcze
niepodłączony do nowej pętli gry.

Świadomie odłożone na później: realne assety CC0 (Kenney/itch.io), droga i
świat, przeszkody, radio, save-pointy, wiele map, tuning/personalizacja aut,
multiplayer.

## Uruchomienie

```bash
npm install
npm run dev      # tryb deweloperski
npm run build    # build produkcyjny do dist/
npm test         # testy fizyki (Vitest)
```

## Sterowanie

- `W`/`↑` - gaz, `S`/`↓` - hamulec (przytrzymany na stojącym aucie = wsteczny)
- `A`/`←`, `D`/`→` - skręt
- `Spacja` - hamulec ręczny (drift)
- Na telefonie: wirtualne przyciski w rogach ekranu.
