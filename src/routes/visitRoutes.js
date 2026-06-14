const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { createVisit, getVisits, getVisitById, approveVisit, rejectVisit, getVisitStats } = require('../controllers/visitController');

router.post('/', protect, requirePermission('visits.create'), createVisit);
router.get('/', protect, requirePermission('visits.read'), getVisits);
router.get('/stats', protect, requirePermission('visits.read'), getVisitStats);
router.get('/:id', protect, requirePermission('visits.read'), getVisitById);
router.put('/:id/approve', protect, requirePermission('visits.approve'), approveVisit);
router.put('/:id/reject', protect, requirePermission('visits.reject'), rejectVisit);

module.exports = router;
