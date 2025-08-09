const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

exports.runPuppeteerScript = async (ruc, username, password) => {
  let browser = null;

  try {
    const downloadDir = path.join(__dirname, `../../download_${ruc}`);
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ],
      defaultViewport: null,
      executablePath: '/usr/bin/google-chrome'
    });

    const page = await browser.newPage();

    // Configurar carpeta de descargas
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );

    console.log("🌐 Abriendo página principal...");
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.goto('https://www.sunat.gob.pe/', { waitUntil: 'load', timeout: 110000 });

    await page.waitForSelector('a[href*="cl-ti-itmenu"]', { visible: true, timeout: 50000 });

    console.log("🖱️ Scroll lento hacia el botón SOL...");
    await page.evaluate(() => {
      const el = document.querySelector('a[href*="cl-ti-itmenu"]');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    await new Promise(resolve => setTimeout(resolve, 6000));

    console.log("🖱️ Movimiento del mouse lento...");
    const botonSol = await page.$('a[href*="cl-ti-itmenu"]');
    const boundingBox = await botonSol.boundingBox();
    await page.mouse.move(0, 0);
    await new Promise(r => setTimeout(r, 1000));
    await page.mouse.move(
      boundingBox.x + boundingBox.width / 2,
      boundingBox.y + boundingBox.height / 2,
      { steps: 70 }
    );
    await new Promise(resolve => setTimeout(resolve, 5000));
    await botonSol.click({ delay: 400 });

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
        }, 3000);
      }),
    ]);

    if (!newTab) throw new Error('❌ No se abrió la pestaña del menú');

    const sunatPage = newTab;

    console.log("⌨️ Llenando formulario de login...");
    await sunatPage.waitForSelector('#txtRuc', { timeout: 30000 });
    await sunatPage.type('#txtRuc', ruc, { delay: 400 });
    await sunatPage.type('#txtUsuario', username, { delay: 400 });
    await sunatPage.type('#txtContrasena', password, { delay: 400 });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await (await sunatPage.$('#btnAceptar')).click({ delay: 600 });
    await sunatPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 70000 });

    console.log("🧭 Entrando al buzón...");
    await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
    let frameHandle = await sunatPage.$('#iframeApplication');
    let frame = await frameHandle.contentFrame();

    await frame.waitForSelector('#aListNoti', { timeout: 40000 });
    await (await frame.$('#aListNoti')).click({ delay: 400 });

    // Recargar frame después de entrar al listado
    await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
    frameHandle = await sunatPage.$('#iframeApplication');
    frame = await frameHandle.contentFrame();

    await frame.waitForSelector('#listaMensajes li', { timeout: 40000 });

    // Scroll infinito
    let prevCount = 0;
    while (true) {
      const count = await frame.$$eval('#listaMensajes li', items => items.length);
      if (count === prevCount) break;
      prevCount = count;

      await frame.evaluate(() => {
        const last = document.querySelector('#listaMensajes li:last-child');
        last?.scrollIntoView();
      });

      await new Promise(res => setTimeout(res, 1200));
    }

    // Procesar notificaciones
    let i = 0;
    const results = []; // <--- NUEVO
  while (true) {
      // Reobtener iframe en cada iteración
      await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
      frameHandle = await sunatPage.$('#iframeApplication');
      frame = await frameHandle.contentFrame();

      const notifs = await frame.$$eval('#listaMensajes li a.linkMensaje.text-muted', links =>
        links.map(a => a.innerText.trim())
      );

      const fechas = await frame.$$eval('#listaMensajes li', lis =>
        lis.map(li => li.querySelector('small.fecPublica')?.innerText.trim() || '')
      );

      const labels = await frame.$$eval('#listaMensajes li', lis =>
        lis.map(li => (li.querySelector('span.label') || li.querySelector('[class*="tag"]'))?.textContent.trim() || '')
      );

      if (i >= notifs.length) break;

      const asunto = notifs[i];
      const fecha  = fechas[i] || '';
      const tag    = labels[i] || '';

      console.log(`📩 Notificación ${i + 1}: ${asunto} | Fecha: ${fecha} | Label: ${tag}`);

      // Abrir detalle
      await frame.evaluate(idx => {
        document.querySelectorAll('#listaMensajes li a.linkMensaje.text-muted')[idx]?.click();
      }, i);

      await new Promise(res => setTimeout(res, 2000));

      // Reobtener iframe tras abrir la notificación
      await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
      frameHandle = await sunatPage.$('#iframeApplication');
      frame = await frameHandle.contentFrame();

      // Obtener archivos (nombres y urls)
      const archivos = await frame.$$eval('#listArchivosAdjuntos a, a[href*="bajarArchivo"]', links =>
        links.map(a => ({
          nombre: (a.innerText || a.textContent || '').trim() || 'archivo_sin_nombre',
          url: a.href
        }))
      );

      // Descargar
      for (const archivo of archivos) {
        console.log(`⬇ Descargando: ${archivo.nombre}`);
        await frame.evaluate(url => window.open(url, '_blank'), archivo.url);
      }

      // Guardar en resultados
      results.push({
        asunto,
        fecha,
        tag,
        name_file: archivos.map(a => a.nombre) // <- si quieres solo el primero: archivos[0]?.nombre || ''
      });

      console.log("✅ Procesada");

      // Volver al listado
      try {
        await frame.evaluate(() => {
          const btn = document.querySelector('button[onclick*="volver"], #btnVolver, .btn-back, a[href*="buzon"]');
          btn?.click();
        });
        await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
        frameHandle = await sunatPage.$('#iframeApplication');
        frame = await frameHandle.contentFrame();
        await frame.waitForSelector('#listaMensajes li', { timeout: 40000 });
      } catch {
        console.warn("⚠ No se pudo volver a la lista");
        break;
      }

      i++;
    }


    console.log(`🎯 Proceso finalizado ✅`);
    return { success: true, data: results };

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
};
