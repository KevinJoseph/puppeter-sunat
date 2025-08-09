// src/controllers/sunat.controller.js
const path = require('path');
const fs = require('fs');
const sunatService = require('../services/sunat.service');

// Sanitizador para evitar path traversal
function safeJoin(base, target) {
  const cleaned = path.posix.normalize('/' + target).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(base, cleaned);
}


exports.executeScript = async (req, res) => {
  try {
    const { ruc, username, password } = req.body;
    const out = await sunatService.runPuppeteerScript(ruc, username, password);

    if (!out?.success) {
      return res.status(500).json({ success: false, error: out?.error || 'Error', data: [] });
    }

    const base = `${req.protocol}://${req.get('host')}`; // ej: http://localhost:3000

    const data = (out.data || []).map(item => {
      const names = Array.isArray(item.name_file) ? item.name_file : (item.name_file ? [item.name_file] : []);
      const file_urls = names.map(n => `${base}/api/sunat/download/${encodeURIComponent(ruc)}/${encodeURIComponent(n)}.pdf`);
      //const file_url  = file_urls[0] || ''; // <- la primera (como pediste)

      return {
        asunto: item.asunto || '',
        fecha:  item.fecha  || '',
        tag:    item.tag    || '',
        name_file: names,
        //file_url,           // <- URL directa al primer archivo
        file_urls           // <- (opcional) todas las URLs
      };
    });

    return res.json({ success: true, notificaciones: data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message, notificaciones: [] });
  }
};


// GET /api/sunat/download/:ruc
exports.listDownloads = (req, res) => {
  const { ruc } = req.params;
  const baseDir = path.resolve(`../../download_${ruc}`);
  if (!fs.existsSync(baseDir)) return res.json([]);

  const base = `${req.protocol}://${req.get('host')}`;
  const files = fs.readdirSync(baseDir)
    .filter(f => !f.endsWith('.crdownload'))
    .map(f => ({
      name: f,
      url: `${base}/api/sunat/download/${encodeURIComponent(ruc)}/${encodeURIComponent(f)}`
    }));

  return res.json(files);
};

// GET /api/sunat/download/:ruc/:filename
exports.downloadFile = (req, res) => {
  const { ruc, filename } = req.params;
  const baseDir = path.resolve(`./download_${ruc}`);
  const filePath = safeJoin(baseDir, filename);

  if (!filePath.startsWith(baseDir)) return res.status(400).json({ error: 'Ruta inválida' });
  if (!fs.existsSync(filePath))     return res.status(404).json({ error: 'Archivo no encontrado' });

  return res.download(filePath, filename);
};
