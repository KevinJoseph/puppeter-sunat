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

    // Descargas
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );

    // 1) Ir a SUNAT e ingresar
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

    
    // esperar la pestaña del menú
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

    //Login
    console.log("⌨️ Llenando formulario de login...");
    await sunatPage.waitForSelector('#txtRuc', { timeout: 30000 });
    await sunatPage.type('#txtRuc', ruc, { delay: 400 });
    await sunatPage.type('#txtUsuario', username, { delay: 400 });
    await sunatPage.type('#txtContrasena', password, { delay: 400 });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await (await sunatPage.$('#btnAceptar')).click({ delay: 600 });
    await sunatPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 70000 });

    // 2) Entrar al buzón
    console.log("🧭 Entrando al buzón...");
    await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
    let frameHandle = await sunatPage.$('#iframeApplication');
    let frame = await frameHandle.contentFrame();

    await frame.waitForSelector('#aListNoti', { timeout: 40000 });
    await (await frame.$('#aListNoti')).click({ delay: 400 });


    // recargar frame
    await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
    frameHandle = await sunatPage.$('#iframeApplication');
    frame = await frameHandle.contentFrame();

    await frame.waitForSelector('#listaMensajes li a.linkMensaje.text-muted', { timeout: 40000 });

    // contar notificaciones visibles
    let total = await frame.$$eval('#listaMensajes li a.linkMensaje.text-muted', els => els.length);
    const MAX_A_PROCESAR = total; // ajusta si quieres limitar

    // ------- helpers -------
    async function pickAndDownloadFromFrame(f) {
      // Buscar anchors con goArchivoDescarga(...) que NO sean "constancia"
      const target = await f.evaluate(() => {
        const norm = s => (s || '').replace(/\s+/g, ' ').trim();
        const anchors = Array.from(document.querySelectorAll('a'));

        const candidates = anchors.map(a => {
          const text = norm(a.textContent);
          const href = (a.getAttribute('href') || '');
          const m = href.match(/goArchivoDescarga\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/i);
          return {
            text,
            href,
            params: m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
          };
        })
        .filter(x => x.params && !/^constancia[_\s]/i.test(x.text)); // excluir constancia

        if (candidates.length === 0) return null;

        // Priorizar por contenido del texto
        candidates.sort((a, b) => {
          const score = (t) => {
            let s = 0;
            if (/resoluci[oó]n/i.test(t)) s += 2;   // “Resolución…”
            if (/N[°ºo]/i.test(t)) s += 1;         // contiene “N°/No”
            return -s; // menor primero (más score = mayor prioridad)
          };
          return score(a.text) - score(b.text);
        });

        return { text: candidates[0].text, params: candidates[0].params };
      });

      if (!target) return null;

      // Invocar la función con los parámetros
      await f.evaluate(([idAdjunto, idx, idNoti]) => {
        const fn =
          (typeof window.goArchivoDescarga === 'function' && window.goArchivoDescarga) ||
          (typeof parent?.goArchivoDescarga === 'function' && parent.goArchivoDescarga) ||
          (typeof top?.goArchivoDescarga === 'function' && top.goArchivoDescarga);
        if (!fn) throw new Error('goArchivoDescarga no disponible');
        fn(idAdjunto, idx, idNoti);
      }, target.params);

      return target.text;
    }

    async function procesarIndice(indice) {
      // reobtener frame
      await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
      let fh = await sunatPage.$('#iframeApplication');
      let fr = await fh.contentFrame();

      // Obtener asunto, fecha y tag ANTES de abrir
      const infoLista = await fr.$$eval('#listaMensajes li', lis =>
        lis.map(li => ({
          asunto: li.querySelector('a.linkMensaje.text-muted')?.innerText.trim() || '',
          fecha: li.querySelector('small.fecPublica')?.innerText.trim() || '',
          tag: (li.querySelector('span.label') || li.querySelector('[class*="tag"]'))?.textContent.trim() || ''
        }))
      );
      const { asunto, fecha, tag } = infoLista[indice] || { asunto: '', fecha: '', tag: '' };

      // abrir notificación por índice
      const ok = await fr.evaluate((i) => {
        const links = Array.from(document.querySelectorAll('#listaMensajes li a.linkMensaje.text-muted'));
        if (!links[i]) return false;
        links[i].click();
        return true;
      }, indice);

      if (!ok) return { ok: false, asunto, fecha, tag, nombre: null };

      // reobtener frame del detalle
      await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
      fh = await sunatPage.$('#iframeApplication');
      fr = await fh.contentFrame();

      // descargar solo el link correcto (en frame y subframes)
      let nombre = await pickAndDownloadFromFrame(fr);
      if (!nombre) {
        for (const child of fr.childFrames()) {
          nombre = await pickAndDownloadFromFrame(child);
          if (nombre) break;
        }
      }

      // pequeña espera para iniciar descarga
      await new Promise(r => setTimeout(r, 1500));

      // volver al listado
      await fr.evaluate(() => {
        const btn = document.querySelector('button[onclick*="volver"], #btnVolver, .btn-back, a[href*="buzon"]');
        btn?.click();
      });

      // esperar lista nuevamente
      await sunatPage.waitForSelector('#iframeApplication', { timeout: 50000 });
      fh = await sunatPage.$('#iframeApplication');
      fr = await fh.contentFrame();
      await fr.waitForSelector('#listaMensajes li a.linkMensaje.text-muted', { timeout: 40000 });

      return { ok: true, asunto, fecha, tag, nombre };
    }
    // ------- fin helpers -------

    const results = [];
    let numero = 1; // contador incremental

    for (let idx = 0; idx < MAX_A_PROCESAR; idx++) {
      console.log(`📬 Procesando notificación #${idx + 1}`);
      const { ok, asunto, fecha, tag, nombre } = await procesarIndice(idx);
      if (!ok) {
        console.log('⛔ No se pudo abrir la notificación. Deteniendo.');
        break;
      }
      results.push({
        numero: numero++,
        asunto,
        fecha,
        tag,
        name_file: nombre ? [nombre] : []
      });
      if (nombre) {
        console.log('✅ Descarga disparada para:', nombre);
      } else {
        console.log('⚠ No se encontró link válido (goArchivoDescarga) en esta notificación');
      }
    }

    console.log('🎯 Listo.');
    return { success: true, data: results };

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
};
