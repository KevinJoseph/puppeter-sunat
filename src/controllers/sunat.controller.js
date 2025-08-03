// src/controllers/sunat.controller.js
const sunatService = require('../services/sunat.service');

exports.executeScript = async (req, res) => {
    try {
        const { ruc, username, password } = req.body;
        const result = await sunatService.runPuppeteerScript(ruc, username, password);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};