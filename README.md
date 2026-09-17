# Agro Drifter

Pixelartowa gra jazdy/driftu z polskim, nocnym, groteskowym klimatem: driftujesz
przez wieś i blokowisko, unikając sarn, potłuczonych butelek i dziur w drodze,
aż dotrzesz do stacji paliw, gdzie gra się zapisuje.

## Status: prototyp sesji 1 (MVP)

Zaimplementowane:
- Arcade'owa fizyka jazdy z driftem (poślizg tylnej osi, hamulec ręczny).
- Jedna testowa mapa: kręta droga przez wieś/blokowisko, noc.
- Przeszkody: sarna, rozbita butelka (osłabia przyczepność), dziura (spowalnia).
- Wskaźnik paliwa (spada wraz z dystansem - sygnalizuje zbliżający się koniec
  poziomu) i pasek uszkodzeń auta.
- Stacja paliw jako save point: dokowanie auta, pixelowa animacja tankowania
  (obracająca się "beczka" jako uproszczone 3D), zapis do `localStorage`.
- Dźwięk silnika i kolizji syntezowany na żywo (Web Audio API) - bez plików audio.
- Wszystkie sprite'y generowane proceduralnie (canvas) jako placeholdery -
  auta mają fikcyjne, nielicencjonowane wyglądy.

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
- `Spacja` - hamulec ręczny (drift)
- `R` - restart po dojechaniu do stacji i zapisaniu gry
