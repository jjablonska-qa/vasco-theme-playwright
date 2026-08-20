// This configuration intentionally belongs to variant tests only. It can grow
// market-specific product or selector exceptions without affecting cart tests.
export const variantMarkets = [
  { code: 'PL', baseUrl: 'https://vasco-electronics.pl/', allProductsPath: '/wszystkie/', cartPath: '/koszyk?action=show' },
  { code: 'BG', baseUrl: 'https://vasco-electronics.bg/', allProductsPath: '/vsicki-produkti/', cartPath: '/kolicka?action=show' },
  { code: 'DK', baseUrl: 'https://vasco-translator.dk/', allProductsPath: '/alle-produkter/', cartPath: '/kurv?action=show' },
  { code: 'UK', baseUrl: 'https://vasco-electronics.co.uk/', allProductsPath: '/all-products/', cartPath: '/cart?action=show' },
  { code: 'COM', baseUrl: 'https://vasco-translator.com/', allProductsPath: '/all-products/', cartPath: '/cart?action=show' },
  { code: 'ES', baseUrl: 'https://traductor-de-voz.es/', allProductsPath: '/productos/', cartPath: '/carrito?action=show' },
  { code: 'BE', baseUrl: 'https://vasco-translator.be/fr/', allProductsPath: '/fr/tous-les-produits/', cartPath: '/fr/panier?action=show' },
  { code: 'HR', baseUrl: 'https://vasco-translator.hr/', allProductsPath: '/proizvodi/', cartPath: '/kosarica?action=show' },
  { code: 'IT', baseUrl: 'https://vasco-electronics.it/', allProductsPath: '/tutti-i-prodotti/', cartPath: '/carrello?action=show' },
  { code: 'LT', baseUrl: 'https://vasco-translator.lt/', allProductsPath: '/visi-produktai/', cartPath: '/krepselis?action=show' },
  { code: 'RO', baseUrl: 'https://vasco-electronics.ro/', allProductsPath: '/toate-produsele/', cartPath: '/cos?action=show' },
  { code: 'SE', baseUrl: 'https://vasco-translator.se/', allProductsPath: '/alla-produkter/', cartPath: '/varukorg?action=show' },
  { code: 'CZ', baseUrl: 'https://vasco-electronics.cz/', allProductsPath: '/vsechny-vyrobky/', cartPath: '/kosik?action=show' },
  { code: 'DE', baseUrl: 'https://vasco-electronics.de/', allProductsPath: '/alle-produkte/', cartPath: '/warenkorb?action=show' },
  { code: 'FI', baseUrl: 'https://vasco-translator.fi/', allProductsPath: '/kaikki-tuotteet/', cartPath: '/ostoskori?action=show' },
  { code: 'FR', baseUrl: 'https://vasco-electronics.fr/', allProductsPath: '/traducteur-electronique/', cartPath: '/panier?action=show' },
  { code: 'HU', baseUrl: 'https://vasco-electronics.hu/', allProductsPath: '/minden-termek/', cartPath: '/cart?action=show' },
  { code: 'NL', baseUrl: 'https://vasco-electronics.nl/', allProductsPath: '/alle-producten/', cartPath: '/winkelmandje?action=show' },
  { code: 'SK', baseUrl: 'https://vasco-electronics.sk/', allProductsPath: '/vsetky-produkty/', cartPath: '/nakupny-kosik?action=show' },
  { code: 'PT', baseUrl: 'https://vasco-translator.pt/', allProductsPath: '/todos-produtos/', cartPath: '/carrinho?action=show' },
  { code: 'CA EN', baseUrl: 'https://vasco-translator.ca/en/', allProductsPath: '/en/all-products/', cartPath: '/en/cart?action=show' },
];

export const variantMarketsByCode = Object.fromEntries(variantMarkets.map(market => [market.code, market]));
