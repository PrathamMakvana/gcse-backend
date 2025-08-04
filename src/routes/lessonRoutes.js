const express = require('express');
const router = express.Router();
const { startLesson, getLessonHistory, saveLessonData, generateDiagram } = require('../controllers/lessonController');

router.post('/start', startLesson);
router.get('/history', getLessonHistory);
router.post('/save-lesson-data',saveLessonData)
router.post('/generate-diagram', generateDiagram);




module.exports = router;
