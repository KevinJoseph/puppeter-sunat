const puppeteer = require('puppeteer');

exports.runPuppeteerScript = async (ruc, username, password) => {
  try {
    const browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox'],
      defaultViewport: null,
      executablePath: '/usr/bin/google-chrome' // asegúrate que esté instalado en el VPS
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );

    await page.goto('https://www.sunat.gob.pe/', { waitUntil: 'networkidle2' });

    // Asegurarse de que el botón esté visible y hacer clic
    await page.waitForSelector('a[href*="cl-ti-itmenu"]', { visible: true });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.click('a[href*="cl-ti-itmenu"]');

    // Esperar la nueva pestaña
    let newTab;
    for (let i = 0; i < 10; i++) {
      const pages = await browser.pages();
      newTab = pages.find(p => p.url().includes('e-menu.sunat.gob.pe'));
      if (newTab) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!newTab) throw new Error('No se encontró la pestaña del menú');

    await newTab.bringToFront();
    const sunatPage = newTab;

    // Login
    await sunatPage.waitForSelector('#txtRuc', { timeout: 10000 });
    await sunatPage.type('#txtRuc', ruc, { delay: 100 });
    await sunatPage.type('#txtUsuario', username, { delay: 100 });
    await sunatPage.type('#txtContrasena', password, { delay: 100 });
    await sunatPage.click('#btnAceptar');

    // Esperar que cargue la siguiente vista
    await sunatPage.waitForNavigation({ waitUntil: 'networkidle2' });

    console.log('✅ Login enviado');

    // Seleccionar idioma si aparece
    try {
      await sunatPage.waitForSelector('.dropdown-menu.show span', { timeout: 5000 });
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

    // Acceder al iframe y hacer clic en Buzón Mensajes
    try {
      await sunatPage.waitForSelector('#iframeApplication', { timeout: 10000 });
      const frameHandle = await sunatPage.$('#iframeApplication');
      const frame = await frameHandle.contentFrame();

      await frame.waitForSelector('#aListMen', { timeout: 10000 });
      await frame.click('#aListMen');
      console.log('✅ Clic en "Buzón Mensajes" dentro del iframe realizado');

      await frame.waitForSelector('#listaMensajes li', { timeout: 10000 });

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
      throw new Error(`Error al procesar mensajes: ${err.message}`);
    } finally {
      await browser.close();
    }

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};
