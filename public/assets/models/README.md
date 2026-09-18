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
| `kiosk.glb` | Budynek "kiosku 24h" | Bazowo `kenney.nl/assets/city-kit-suburban` (CC0) | **Bez realnego logo/nazwy marki** (patrz sekcja 2 briefu - względy prawne). Neon "24h/OTWARTE" jest generowany w kodzie i doklejany osobno, nie musi być częścią modelu. |
| `grass.glb` | Kępki trawy przy drodze (dekoracja) | dostarczone przez użytkownika | Opcjonalne - bez tego pliku gra po prostu nie rysuje kępek, teren nadal jest zielony (kolor materiału). |

Wszystko z Kenney.nl jest CC0 z automatu. Wszystko inne (itch.io, Sketchfab)
- sprawdź zakładkę licencji na stronie przed ściągnięciem.

Wszystkie 4 pliki powyżej (`car`, `tree`, `kiosk`, `grass`) zostały już
wgrane i zoptymalizowane (`gltf-transform join` + `optimize --texture-size
1024 --texture-compress webp`, meshopt) - rozmiary spadły 10-40x względem
oryginałów (np. auto 27MB→2.5MB, kiosk 20.8MB→495KB).
