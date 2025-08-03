const puppeteer = require('puppeteer');

exports.runPuppeteerScript = async (ruc, username, password) => {
  try {
    const browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox'],
      defaultViewport: null,
      executablePath: '/usr/bin/google-chrome'
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );

    console.log("🌐 Abriendo página principal...");
    await page.goto('https://www.sunat.gob.pe/', { waitUntil: 'load', timeout: 90000 });

    await page.waitForSelector('a[href*="cl-ti-itmenu"]', { visible: true, timeout: 60000 });

    console.log("🖱️ Preparando clic lento en acceso SOL...");
    const botonSol = await page.$('a[href*="cl-ti-itmenu"]');
    const boundingBox = await botonSol.boundingBox();
    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + boundingBox.height / 2, { steps: 30 });
    await new Promise(resolve => setTimeout(resolve, 5000));
    await botonSol.click({ delay: 300 });

    console.log("🕒 Esperando nueva pestaña...");
    const [newTab] = await Promise.all([
      new Promise(resolve => {
        const check = setInterval(async () => {
          const pages = await browser.pages();
          const target = pages.find(p => p.url().includes('e-menu.sunat.gob.pe'));
          if (target) {
            clearInterval(check);
            resolve(target);
          }
        }, 1000);
      }),
    ]);

    if (!newTab) throw new Error('❌ No se abrió la pestaña del menú');

    await newTab.bringToFront();
    const sunatPage = newTab;

    console.log("⌨️ Llenando formulario de login...");
    await sunatPage.waitForSelector('#txtRuc', { timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));
    await sunatPage.type('#txtRuc', ruc, { delay: 200 });
    await new Promise(r => setTimeout(r, 1500));
    await sunatPage.type('#txtUsuario', username, { delay: 200 });
    await new Promise(r => setTimeout(r, 1500));
    await sunatPage.type('#txtContrasena', password, { delay: 200 });
    await new Promise(r => setTimeout(r, 1500));
    await sunatPage.click('#btnAceptar');

    await sunatPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 90000 });
    console.log('✅ Login enviado');

    try {
      await sunatPage.waitForSelector('.dropdown-menu.show span', { timeout: 10000 });
      const opciones = await sunatPage.$$('.dropdown-menu.show span');
      for (const opcion of opciones) {
        const text = await sunatPage.evaluate(el => el.innerText.trim(), opcion);
        if (text === 'Español') {
          await opcion.click();
          console.log('🌐 Idioma "Español" seleccionado');
          break;
        }
      }
    } catch {
      console.log('✅ No apareció popup de idioma');
    }

    try {
      console.log("🧭 Esperando iframe...");
      await sunatPage.waitForSelector('#iframeApplication', { timeout: 60000 });
      const frameHandle = await sunatPage.$('#iframeApplication');
      const frame = await frameHandle.contentFrame();

      await new Promise(r => setTimeout(r, 3000));
      await frame.waitForSelector('#aListMen', { timeout: 60000 });
      await frame.click('#aListMen');
      console.log('📨 Clic en "Buzón Mensajes"');

      await frame.waitForSelector('#listaMensajes li', { timeout: 60000 });

      const mensajes = await frame.$$eval('#listaMensajes li', items =>
        items.map((li, index) => {
          const asunto = li.querySelector('a.linkMensaje.text-muted')?.innerText.trim() || 'Sin asunto';
          const fecha = li.querySelector('small.text-muted')?.innerText.trim() || 'Sin fecha';
          return {
            numero: index + 1,
            asunto,
            fecha
          };
        })
      );

      return {
        success: true,
        mensajes
      };

    } catch (err) {
      throw new Error(`⚠️ Error al procesar mensajes: ${err.message}`);
    } finally {
      await new Promise(resolve => setTimeout(resolve, 5000));
      await browser.close();
    }

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};
