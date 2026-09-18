# Agro Drifter

Gra jazdy/driftu z polskim, nocnym, groteskowym klimatem: driftujesz przez
wieś i blokowisko, unikając sarn, potłuczonych butelek i dziur w drodze, aż
dotrzesz do stacji paliw, gdzie gra się zapisuje.

**Gra na żywo: https://kasztan9w8w7w6.github.io/Agro-drifter/**

## W trakcie przepisywania na pełne 3D

Projekt jest w trakcie przechodzenia z prototypu 2D (Phaser/canvas) na pełne
3D w Three.js z estetyką PS1 (patrz techniczny brief w historii projektu).
Pierwszy grywalny loop (droga, drzewa, sarna, rozbite szkło, jeden save
point, radio) już działa - na placeholderach wszędzie, gdzie brief wymaga
realnego, licencjonowanego modelu.

### Zaimplementowane

- `WebGPURenderer` z automatycznym fallbackiem do WebGL2 (wbudowany w
  Three.js) + `RetroPassNode` jako pipeline post-processingu: vertex
  snapping, affine texture mapping, niska rozdzielczość wewnętrzna z
  nearest-neighbor filtering - klimat PS1 bez pisania własnego shadera.
- Kamera "chase cam" za autem z tłumieniem niezależnym od FPS
  (`1 - exp(-rate*dt)`), look-ahead, FOV pump przy prędkości, lekki roll
  proporcjonalny do kąta poślizgu i **kompensacja prędkością** - bez niej
  tłumienie wykładnicze goniące ruchomy cel ma opóźnienie proporcjonalne do
  prędkości (przy ~170 km/h kamera była 2x dalej niż powinna - złapane w
  testach, nie w teorii, i pokryte regresyjnym testem).
- Fizyka driftu (bicycle model z nasycającą się siłą boczną opony,
  przeniesiony na płaszczyznę XZ świata 3D, wewnętrznie dzielony na
  podkroki dla powtarzalności niezależnie od FPS), drift osiągalny
  hamulcem ręcznym i samym gazem + ostrym skrętem przy prędkości ("power
  oversteer", parametr `powerOversteerFactor` per auto).
- Droga generowana proceduralnie (krzywizna/szerokość zwężają się z
  progresem, port matematyki ze starego prototypu 2D na płaszczyznę XZ),
  drzewa wzdłuż trasy przez `InstancedMesh` (jeden draw call na cały las,
  nie jeden na drzewo).
- System przeszkód: sarna patrolująca sinusoidą w poprzek drogi (zderzenie
  = utrata prędkości), rozbite szkło jako strefa obniżonej przyczepności
  (fizyka to czuje, nie tylko widać - decal generowany na canvasie, nie
  ściągany).
- Jeden save point: generyczny kiosk "24h" (bez realnego logo/marki -
  względy prawne, brief sekcja 2), neon dogenerowany w kodzie, zapis do
  `localStorage` z pulsem "focus mode" w retro pipeline jako feedback.
- Radio z dwoma stacjami (melancholijna i disco), crossfade przez
  `GainNode` (nie hard-cut) - `R` na klawiaturze albo przycisk na ekranie.
  Zmienia tylko muzykę, nie fizykę (zgodnie z MVP - to zostaje na fazę 2).
- Jedna abstrakcja wejścia (`{throttle, brake, steer, handbrake}`) wspólna
  dla klawiatury i dotyku.
- Pakiet testów w `npm test` (Vitest): konwencja skrętu zweryfikowana
  względem rzeczywistej macierzy `lookAt` z Three.js (nie "na oko"), brak
  NaN/eksplozji w długiej losowej jeździe, dt-independence fizyki i
  kamery, uspokojenie po puszczeniu wejść, obie ścieżki wejścia w drift.
- Automatyczny deploy na GitHub Pages przy pushu do `main`.

### Assety - placeholdery z jednym punktem podmiany

Sieć w środowisku, w którym to powstało, blokuje kenney.nl/itch.io, więc
auto/drzewo/sarna/kiosk są na razie proste prymitywy (boxy/cone/cylinder),
**nie finalna grafika**. Wrzuć realne pliki `.glb` do
`public/assets/models/` (dokładne nazwy i źródła w
[`public/assets/models/README.md`](public/assets/models/README.md)) -
gra automatycznie ich użyje, bez zmian w kodzie. Jeśli pliku nie ma, gra
dalej działa na placeholderze.

Kod poprzedniego prototypu 2D (audio syntezowane na żywo, generowane
proceduralnie sprite'y) częściowo pozostaje w repo (`src/audio/sfx.ts`) do
ewentualnego ponownego podłączenia (silnik/kolizje SFX) - obecnie
niepodłączony do nowej pętli gry; muzyka/radio już są podłączone.

Świadomie odłożone na później: więcej niż jeden save point/mapa,
tuning/personalizacja aut, ekonomia, multiplayer, cykl dnia/nocy.

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
- `R` - zmiana stacji radiowej
- Na telefonie: wirtualne przyciski w rogach ekranu + przycisk "RADIO".
