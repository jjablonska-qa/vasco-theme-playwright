import { test, expect } from '../helpers/free-shipping-test.js';
import { readShippingSummary, shippingPriceFromText } from '../helpers/shipping-methods.js';
test.setTimeout(120000);
const pl={base:'https://vasco-electronics.pl/',products:'/wszystkie/',checkout:'/zamowienie',q1:'38',glass:'40'};
for(const s of [{name:'niska wartość',product:pl.glass},{name:'wyższa wartość',product:pl.q1}])test(`PL: darmowa dostawa — ${s.name}`,async({page})=>{
 await page.goto(new URL(pl.products,pl.base).href,{waitUntil:'domcontentloaded'});await cookies(page);await addProduct(page,s.product);
 await page.goto(new URL(pl.checkout,pl.base).href,{waitUntil:'domcontentloaded'});await cookies(page);await page.locator('input[name="firstname"]').fill('Automat');await page.locator('input[name="lastname"]').fill('Test');await page.locator('input[name="email"]').fill(`testcases.web+free-shipping-pl-${Date.now().toString(36)}@gmail.com`);
 for(const n of [/Warunki korzystania z serwisu|Regulamin|warunki/i,/Politykę prywatności|Polityke prywatnosci|prywatności|prywatnosci/i]){const b=page.getByRole('checkbox',{name:n}).first();await expect(b).toBeVisible({timeout:15000});await b.check({force:true}).catch(async()=>b.evaluate(e=>e.click()));}
 const cont=page.getByRole('button',{name:/Kontynuuj/i});const ready=async()=>await page.getByPlaceholder(/ulica|adres/i).first().isVisible().catch(()=>false);const b=page.locator('button[name="continue"][data-link-action="register-new-customer"]').first();await b.click({force:true}).catch(async()=>cont.first().click({force:true}));await expect.poll(ready,{timeout:30000}).toBeTruthy();
 const fill=async(n,v)=>{for(const f of [page.getByPlaceholder(n).first(),page.getByRole('textbox',{name:n}).first()])if(await f.isVisible().catch(()=>false)){await f.fill(v);return;}throw Error(`PL ${n}`)};await fill(/imię|imie/i,'Automat');await fill(/nazwisko/i,'Test');await fill(/^wprowadź adres$/i,'Marszałkowska 12');await fill(/kod pocztowy/i,'00-001');await fill(/miasto/i,'Warszawa');await fill(/telefon/i,'888123456');await cont.last().click({force:true});await expect.poll(async()=>/metoda wysyłki|metoda wysylki|metodę dostawy|metode dostawy|dostawa/i.test(await page.locator('body').innerText()),{timeout:30000}).toBeTruthy();
 const shipping=await readShippingSummary(page,/^Wysyłka$/i);expect(shipping,'PL shipping summary').not.toBeNull();expect(shippingPriceFromText(shipping,{currency:/zł|PLN/,freePattern:/za darmo|darmowa|gratis|free/i})).toBe(0);
});
async function cookies(page){const d=page.locator('#CybotCookiebotDialog');await d.waitFor({state:'visible',timeout:5000}).catch(()=>{});const b=page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll,#CybotCookiebotDialogBodyLevelButtonAccept').first();if(await b.isVisible().catch(()=>false))await b.click({force:true})}
async function addProduct(page,id){
 const card=page.locator(`article.product-miniature[data-id-product="${id}"]`),modal=page.locator('#blockcart-modal,[role="dialog"][aria-labelledby="blockcart-modal-title"]').first();
 await expect(card).toBeVisible({timeout:15000});await card.scrollIntoViewIfNeeded();
 await card.locator('button.add-to-cart').click();
 await expect(page.getByRole('link',{name:/Koszyk\s*1/i}).first()).toBeVisible({timeout:15000});
 if(await modal.isVisible().catch(()=>false)){const close=modal.getByRole('button',{name:/Zamknij|Close/i}).first();if(await close.isVisible().catch(()=>false))await close.click({force:true});else await page.keyboard.press('Escape');}
}
