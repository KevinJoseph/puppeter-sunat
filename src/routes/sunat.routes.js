const express = require('express');
const router = express.Router();
const sunatController = require('../controllers/sunat.controller');

router.post('/execute', sunatController.executeScript);
router.get('/download/:ruc', sunatController.listDownloads);
router.get('/download/:ruc/:filename', sunatController.downloadFile);

module.exports = router;
