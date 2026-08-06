# Testy darmowej dostawy

Ten katalog zawiera testy end-to-end Playwright dla darmowej dostawy na rynkach Vasco Electronics.

Każdy test wykonuje pełny przebieg: dodaje produkt do koszyka, przechodzi przez checkout, uzupełnia dane wymagane dla rynku i sprawdza cenę dostawy.

## Scenariusze

- Rynki z progiem darmowej dostawy mają dwa scenariusze: produkt poniżej progu oraz produkt powyżej progu.
- Rynki z dostawą zawsze darmową mają dwa scenariusze z produktami o niskiej i wysokiej wartości.
- Testy są uruchamiane na Chromium, Firefox i WebKit.

Produkty używane w scenariuszach:

- szkło ochronne (`data-id-product="40"`) — niska wartość;
- Vasco Translator Q1 (`data-id-product="38"`) — wysoka wartość.

## Uruchamianie

Cały zestaw:

```bash
npx playwright test tests/free-shipping
```

Jeden rynek:

```bash
npx playwright test tests/free-shipping/free-shipping-ro.spec.js
```

Jeden rynek w jednej przeglądarce:

```bash
npx playwright test tests/free-shipping/free-shipping-ro.spec.js --project=chromium
```

## Zasady utrzymania

- Cena dostawy jest sprawdzana dopiero po przejściu do kroku dostawy.
- Gdy checkout nie renderuje listy metod dostawy, test odczytuje dokładny wiersz dostawy z podsumowania — nie ogólny tekst strony.
- Dane adresowe są lokalne dla rynku, ponieważ część checkoutów wymaga dodatkowych pól, np. prowincji lub województwa.
- Nie używamy kodów rabatowych. Scenariusze opierają się na pełnych cenach produktów.
- Po zmianie testów należy uruchomić najpierw zmieniony rynek, a następnie cały katalog `tests/free-shipping`.

## Backup

Punkt powrotu przed rozpoczęciem porządkowania jest zapisany w:

```text
.codex-backups/free-shipping-before-unification-2026-07-22.tar.gz
```
# Testy darmowej dostawy

Po każdym uruchomieniu testów powstają dwa raporty:

- `audit-report.html` — pojedynczy raport podsumowujący rynki, wyniki i wykryte problemy. Przy błędzie zawiera także klikalny URL strony, na której test się zatrzymał.
- `playwright-report/` — szczegółowy, standardowy raport Playwrighta.

Uruchomienie całego pakietu i utworzenie raportów:

```bash
npm run test:free-shipping
```

Otwarcie prostego raportu audytowego:

```bash
npm run report:free-shipping
```

Szczegółowy raport Playwrighta można otworzyć przez `npx playwright show-report`.
