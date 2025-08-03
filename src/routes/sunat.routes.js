const express = require('express');
const router = express.Router();
const sunatController = require('../controllers/sunat.controller');

// Define the endpoint to accept RUC, username, and password
router.post('/execute', sunatController.executeScript);

module.exports = router;