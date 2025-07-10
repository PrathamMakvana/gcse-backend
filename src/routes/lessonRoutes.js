const express = require('express');
const router = express.Router();
const { startLesson, getLessonHistory, saveLessonData } = require('../controllers/lessonController');

router.post('/start', startLesson);
router.get('/history', getLessonHistory);
router.post('/save-lesson-data',saveLessonData)



module.exports = router;
