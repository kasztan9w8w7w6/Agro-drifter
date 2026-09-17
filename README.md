# Agro Drifter

Pixelartowa gra jazdy/driftu z polskim, nocnym, groteskowym klimatem: driftujesz
przez wieś i blokowisko, unikając sarn, potłuczonych butelek i dziur w drodze,
aż dotrzesz do stacji paliw, gdzie gra się zapisuje.

**Gra na żywo: https://kasztan9w8w7w6.github.io/Agro-drifter/**

## Zaimplementowane

- Arcade'owa fizyka driftu ze ślizgiem opartym o kąt poślizgu: hamulec ręczny
  daje natychmiastowy "kick" zawiasu (jak prawdziwy handbrake turn), zjazd na
  pobocze drastycznie ogranicza przyczepność, uszkodzenia auta pogarszają
  prowadzenie.
- Trudność rośnie wzdłuż trasy: droga zwęża się i mocniej się kręci, a
  przeszkody gęstnieją im bliżej stacji.
- Jedna testowa mapa: kręta droga przez wieś/blokowisko, noc, latarnie z
  poświatą, reflektory auta, delikatny vignette + scanline (klimat retro-CRT).
- Przeszkody: sarna, rozbita butelka (osłabia przyczepność), dziura (spowalnia) -
  każda z iskrami i shakiem kamery przy zderzeniu.
- Dym spod opon i ślady driftu zostające na asfalcie, popup "DRYF! +metry".
- Wskaźnik paliwa (spada wraz z dystansem - sygnalizuje zbliżający się koniec
  poziomu) i pasek uszkodzeń auta.
- Stacja paliw jako save point: dokowanie auta, pixelowa animacja tankowania
  (obracająca się "beczka" jako uproszczone 3D), zapis do `localStorage`.
- Dynamiczna muzyka generowana na żywo: melancholijny pad w tonacji molowej +
  mocno przesterowany sub-bas, reagujące na prędkość/drift/zagrożenie (niskie
  paliwo, uszkodzenia).
- Dźwięki silnika i kolizji syntezowane na żywo (Web Audio API) - bez plików audio.
- Sterowanie dotykowe (wirtualne przyciski) na telefonie, zablokowany
  scroll/zoom strony podczas gry.
- Wszystkie sprite'y generowane proceduralnie (canvas) jako placeholdery -
  auta mają fikcyjne, nielicencjonowane wyglądy.
- Automatyczny deploy na GitHub Pages przy pushu do `main`.

Świadomie odłożone na później: wiele map, tuning/personalizacja aut, ekonomia
i odblokowywanie, prawdziwe nagrania audio, cykl dnia/nocy, multiplayer.

## Uruchomienie

```bash
npm install
npm run dev      # tryb deweloperski
npm run build    # build produkcyjny do dist/
```

## Sterowanie

- `W`/`↑` - gaz, `S`/`↓` - hamulec/wsteczny
- `A`/`←`, `D`/`→` - skręt
- `Spacja` - hamulec ręczny (drift, tapnięcie w trakcie skrętu = kick)
- `R` - restart po dojechaniu do stacji i zapisaniu gry
- Na telefonie: wirtualne przyciski w rogach ekranu.
