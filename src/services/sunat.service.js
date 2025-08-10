const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

exports.runPuppeteerScript = async (ruc, username, password) => {
  let browser = null;

  try {
    const downloadDir = path.join(__dirname, `../../download_${ruc}`);

    // 0) Carpeta limpia siempre
    try { await fs.promises.rm(downloadDir, { recursive: true, force: true }); } catch {}
    await fs.promises.mkdir(downloadDir, { recursive: true });

    // ==== Helpers ============================================================
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const DOWNLOAD_GAP_MS = 1000; // enfriamiento entre descargas

    const slugify = (s) => (s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim().replace(/\s+/g, '_')
      .slice(0, 80);

    const listFinalFiles = async (dir) =>
      (await fs.promises.readdir(dir)).filter(f => !f.endsWith('.crdownload'));

    // Espera el siguiente archivo nuevo (no .crdownload) comparando contra "before"
    async function waitForNewFile(dir, beforeSet, { timeout = 60000, stableMs = 700 } = {}) {
      const start = Date.now();
      let lastName = null, lastSize = -1, lastChanged = Date.now();

      while (Date.now() - start < timeout) {
        const files = await listFinalFiles(dir);
        const news = files.filter(f => !beforeSet.has(f));
        if (news.length) {
          // pick más reciente y espera a que “se estabilice”
          const picks = await Promise.all(news.map(async f => {
            const p = path.join(dir, f);
            const st = await fs.promises.stat(p).catch(() => null);
            return st ? { f, p, st } : null;
          }));
          const cand = picks.filter(Boolean).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)[0];
          if (cand) {
            if (cand.f !== lastName || cand.st.size !== lastSize) {
              lastName = cand.f; lastSize = cand.st.size; lastChanged = Date.now();
            }
            if (Date.now() - lastChanged >= stableMs) return cand.f;
          }
        }
        await sleep(200);
      }
      return null;
    }

    // Reobtiene SIEMPRE un frame “fresco”, con reintentos (mitiga OOPIF refresh)
    async function getFreshFrame(page, selector = '#iframeApplication', tries = 6) {
      for (let i = 0; i < tries; i++) {
        await page.waitForSelector(selector, { timeout: 60000 });
        const h = await page.$(selector);
        const fr = h && await h.contentFrame();
        if (fr) return fr;
        await sleep(250);
      }
      throw new Error('No pude obtener el frame');
    }

    // Evalúa en un frame; si el contexto se destruye durante navegación, reintenta
    async function evalInFrame(page, frameGetter, fn, arg, tries = 3) {
      let fr = await frameGetter();
      for (let i = 0; i < tries; i++) {
        try {
          return await fr.evaluate(fn, arg);
        } catch (e) {
          const msg = String(e?.message || '');
          if (/Execution context was destroyed|Cannot find context|detached|Target closed/i.test(msg)) {
            await sleep(400);
            fr = await frameGetter();  // refrescar frame y reintentar
            continue;
          }
          throw e;
        }
      }
      throw new Error('Frame inestable tras reintentos');
    }
    // ========================================================================

    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        // Desactivar site isolation para evitar OOPIF y el assert del FrameManager
        '--disable-site-isolation-trials',
        '--disable-features=IsolateOrigins,site-per-process'
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
    console.log('🌐 Abriendo página principal...');
    await sleep(1000);
    await page.goto('https://www.sunat.gob.pe/', { waitUntil: 'load', timeout: 110000 });

    await page.waitForSelector('a[href*="cl-ti-itmenu"]', { visible: true, timeout: 50000 });

    console.log('🖱️ Scroll lento hacia el botón SOL...');
    await page.evaluate(() => {
      const el = document.querySelector('a[href*="cl-ti-itmenu"]');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    await sleep(6000);

    console.log('🖱️ Movimiento del mouse lento...');
    const botonSol = await page.$('a[href*="cl-ti-itmenu"]');
    const bb = await botonSol.boundingBox();
    await page.mouse.move(0, 0);
    await sleep(1000);
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 70 });
    await sleep(5000);
    await botonSol.click({ delay: 400 });

    // esperar la pestaña del menú
    console.log('🕒 Esperando nueva pestaña...');
    const [newTab] = await Promise.all([
      new Promise(resolve => {
        const iv = setInterval(async () => {
          const pages = await browser.pages();
          const target = pages.find(p => p.url().includes('e-menu.sunat.gob.pe'));
          if (target) { clearInterval(iv); resolve(target); }
        }, 3000);
      }),
    ]);
    if (!newTab) throw new Error('❌ No se abrió la pestaña del menú');

    const sunatPage = newTab;

    // Login
    console.log('⌨️ Llenando formulario de login...');
    await sunatPage.waitForSelector('#txtRuc', { timeout: 30000 });
    await sunatPage.type('#txtRuc', ruc, { delay: 400 });
    await sunatPage.type('#txtUsuario', username, { delay: 400 });
    await sunatPage.type('#txtContrasena', password, { delay: 400 });
    await sleep(3000);
    await (await sunatPage.$('#btnAceptar')).click({ delay: 600 });
    await sunatPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 70000 });

    // 2) Entrar al buzón
    console.log('🧭 Entrando al buzón...');
    let frame = await getFreshFrame(sunatPage);
    await evalInFrame(sunatPage, () => getFreshFrame(sunatPage), () => {
      const a = document.querySelector('#aListNoti');
      a && a.click();
    });

    // recargar frame con listado
    frame = await getFreshFrame(sunatPage);
    await frame.waitForSelector('#listaMensajes li a.linkMensaje.text-muted', { timeout: 40000 });

    // contar notificaciones visibles
    let total = await frame.$$eval('#listaMensajes li a.linkMensaje.text-muted', els => els.length);
    const MAX_A_PROCESAR = total;

    // ---- pick & download dentro de frame (sin esperas largas) ----------------
    async function pickAndDownloadFromFrame(f) {
      const target = await f.evaluate(() => {
        const norm = s => (s || '').replace(/\s+/g, ' ').trim();
        const anchors = Array.from(document.querySelectorAll('a'));
        const candidates = anchors.map(a => {
          const text = norm(a.textContent);
          const href = (a.getAttribute('href') || '');
          const m = href.match(/goArchivoDescarga\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/i);
          return { text, params: m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null };
        }).filter(x => x.params && !/^constancia[_\s]/i.test(x.text));

        if (!candidates.length) return null;
        candidates.sort((a, b) => {
          const score = (t) => { let s = 0; if (/resoluci[oó]n/i.test(t)) s += 2; if (/N[°ºo]/i.test(t)) s += 1; return -s; };
          return score(a.text) - score(b.text);
        });

        return { text: candidates[0].text, params: candidates[0].params };
      });

      if (!target) return false;

      await f.evaluate(([idAdjunto, idx, idNoti]) => {
        const fn =
          (typeof window.goArchivoDescarga === 'function' && window.goArchivoDescarga) ||
          (typeof parent?.goArchivoDescarga === 'function' && parent.goArchivoDescarga) ||
          (typeof top?.goArchivoDescarga === 'function' && top.goArchivoDescarga);
        if (!fn) throw new Error('goArchivoDescarga no disponible');
        fn(idAdjunto, idx, idNoti);
      }, target.params);

      return true;
    }
    // --------------------------------------------------------------------------

    async function procesarIndice(indice, secuencia) {
      // frame fresco con la lista
      let fr = await getFreshFrame(sunatPage);

      // info ANTES de abrir
      const infoLista = await fr.$$eval('#listaMensajes li', lis =>
        lis.map(li => ({
          asunto: li.querySelector('a.linkMensaje.text-muted')?.innerText.trim() || '',
          fecha: li.querySelector('small.fecPublica')?.innerText.trim() || '',
          tag:   (li.querySelector('span.label') || li.querySelector('[class*="tag"]'))?.textContent.trim() || ''
        }))
      );
      const { asunto, fecha, tag } = infoLista[indice] || { asunto: '', fecha: '', tag: '' };

      // abrir la notificación por índice
      const ok = await evalInFrame(
        sunatPage,
        () => getFreshFrame(sunatPage),
        (i) => {
          const links = Array.from(document.querySelectorAll('#listaMensajes li a.linkMensaje.text-muted'));
          if (!links[i]) return false; links[i].click(); return true;
        },
        indice
      );
      if (!ok) return { ok: false, asunto, fecha, tag, nombre: null };

      // frame del detalle (fresco)
      fr = await getFreshFrame(sunatPage);

      // snapshot "antes" (fuera del frame lo usaremos)
      const before = new Set(await listFinalFiles(downloadDir));

      // disparar descarga dentro del detalle (y subframes)
      let got = await pickAndDownloadFromFrame(fr);
      if (!got) {
        for (const child of fr.childFrames()) {
          got = await pickAndDownloadFromFrame(child);
          if (got) break;
        }
      }

      // volver rápido al listado (no nos quedamos en el frame)
      await evalInFrame(
        sunatPage,
        () => getFreshFrame(sunatPage),
        () => {
          const btn = document.querySelector('button[onclick*="volver"], #btnVolver, .btn-back, a[href*="buzon"]');
          btn && btn.click();
        }
      );

      // reobtener lista y esperar que cargue
      fr = await getFreshFrame(sunatPage);
      await fr.waitForSelector('#listaMensajes li a.linkMensaje.text-muted', { timeout: 40000 });

      // ahora, afuera del frame, esperamos el archivo nuevo y lo renombramos
      let real = await waitForNewFile(downloadDir, before);
      let finalName = null;
      if (real) {
        finalName = `noti_${secuencia}_${slugify(asunto || 'documento')}.pdf`;
        const src = path.join(downloadDir, real);
        const dest = path.join(downloadDir, finalName);
        try { await fs.promises.unlink(dest); } catch {}
        await fs.promises.rename(src, dest);
        await sleep(200);
      }

      return { ok: true, asunto, fecha, tag, nombre: finalName };
    }

    // ------- loop principal -------
    const results = [];
    let numero = 1; // numeración real

    for (let idx = 0; idx < MAX_A_PROCESAR; idx++) {
      console.log(`📬 Procesando notificación #${idx + 1}`);
      const { ok, asunto, fecha, tag, nombre } = await procesarIndice(idx, numero);
      if (!ok) { console.log('⛔ No se pudo abrir la notificación. Deteniendo.'); break; }

      results.push({
        numero: numero,
        asunto,
        fecha,
        tag,
        name_file: nombre ? [nombre] : []
      });

      if (nombre) {
        console.log('✅ Descarga renombrada como:', nombre);
        numero++;
        await sleep(DOWNLOAD_GAP_MS); // pequeño enfriamiento
      } else {
        console.log('⚠ Notificación sin adjunto válido.');
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
