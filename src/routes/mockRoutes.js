const express = require('express');
const router = express.Router();
const { startMockTest } = require('../controllers/mockController');

router.post('/start-mock', startMockTest);


module.exports = router;
