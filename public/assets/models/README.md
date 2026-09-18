# Miejsce na realne modele 3D

Wrzuć tu pliki `.glb` o **dokładnie tych nazwach** - gra automatycznie
zacznie ich używać przy następnym odświeżeniu, bez zmian w kodzie. Jeśli
pliku nie ma (albo się nie wczyta), gra pokazuje placeholder i działa dalej
- nic się nie wywala.

| Plik | Co to jest | Źródło z briefu | Uwaga |
|---|---|---|---|
| `car.glb` | Auto gracza | `ggbot.itch.io/psx-style-cars` (CC0) | Wybierz najmniejszy, najbardziej "126p-jak" model z paczki. |
| `tree.glb` | Jedno drzewo | `kenney.nl/assets/nature-kit` (CC0) | Musi być **jeden mesh** (jedna geometria) - używane przez `InstancedMesh`, nie przez pełny węzeł sceny. Origin modelu powinien być u podstawy pnia (na ziemi), nie w środku. |
| `deer.glb` | Sarna | Sketchfab, filtr licencji CC0/CC-BY (brief flaguje to jako "do weryfikacji") | Prosty, niski poly wystarczy - w grze i tak widziana z dystansu. |
| `kiosk.glb` | Budynek "kiosku 24h" (**obecnie nieużywany** - patrz niżej) | Bazowo `kenney.nl/assets/city-kit-suburban` (CC0) | **Bez realnego logo/nazwy marki** (patrz sekcja 2 briefu - względy prawne). Neon "24h/OTWARTE" jest generowany w kodzie i doklejany osobno, nie musi być częścią modelu. |
| `grass.glb` | Kępki trawy przy drodze (dekoracja) | dostarczone przez użytkownika | Opcjonalne - bez tego pliku gra po prostu nie rysuje kępek, teren nadal jest zielony (kolor materiału). |

Wszystko z Kenney.nl jest CC0 z automatu. Wszystko inne (itch.io, Sketchfab)
- sprawdź zakładkę licencji na stronie przed ściągnięciem.

`car`, `tree` i `grass` zostały wgrane i zoptymalizowane (`gltf-transform
join` + `optimize --texture-size 1024 --texture-compress webp`, meshopt) -
rozmiary spadły 10-40x względem oryginałów (np. auto 27MB→2.5MB).

**`kiosk.glb` nie jest już używany.** Plik pierwotnie oznaczony jako "kiosk"
(`polish_g-class_main_road_modular_building_kit.glb`) po sprawdzeniu węzeł
po węźle okazał się być kitem **modułowych płyt drogowych** (asfalt +
namalowane linie pasów, ok. 6x7m, kilka cm grube - nie budynek). Jego
tekstura asfaltu jest teraz wykorzystana jako `assets/textures/
road-asphalt.png` przez `RoadMesh.ts`. Stacja/kiosk wróciła do prostego
placeholdera (box + neonowy szyld) - żaden prawdziwy model budynku nie
został jeszcze dostarczony.
