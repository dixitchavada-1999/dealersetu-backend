const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requireSuperAdmin } = require('../middlewares/permissionMiddleware');
const {
  getEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  previewEmailTemplate,
  resetEmailTemplate,
  getVariables,
  upsertVariable,
  deleteVariable,
} = require('../controllers/emailTemplateController');

// All email-template management is super-admin only.
router.use(protect, requireSuperAdmin);

// Static paths first (so 'preview' / 'variables' / 'reset' aren't treated as :key)
router.post('/preview', previewEmailTemplate);
router.get('/variables', getVariables);
router.post('/variables', upsertVariable);
router.delete('/variables/:key', deleteVariable);
router.post('/reset/:key', resetEmailTemplate);

router.get('/', getEmailTemplates);
router.post('/', createEmailTemplate);
router.get('/:key', getEmailTemplate);
router.put('/:key', updateEmailTemplate);
router.delete('/:key', deleteEmailTemplate);

module.exports = router;
