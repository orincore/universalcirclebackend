const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/admin');
const supabase = require('../config/database');
const { error } = require('../utils/logger');
const { 
  approveVerification, 
  rejectVerification 
} = require('../controllers/verificationController');

// Middleware chain - both auth and admin required
const adminAuth = [authenticate, isAdmin];

// Admin verification routes
router.put('/:verification_id/approve', adminAuth, approveVerification);
router.put('/:verification_id/reject', adminAuth, rejectVerification);

// Get pending verifications route will be added here
router.get('/pending', adminAuth, async (req, res) => {
  try {
    const { data, error: fetchError } = await supabase
      .from('verification_requests')
      .select(`
        id, 
        status, 
        verification_type,
        requested_at,
        submitted_at,
        users (
          id, 
          username, 
          first_name, 
          last_name, 
          email
        )
      `)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true });

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    return res.status(200).json({
      success: true,
      data: data
    });
  } catch (err) {
    error(`Error fetching pending verifications: ${err.message}`);
    return res.status(500).json({
      success: false,
      message: 'Error fetching pending verifications'
    });
  }
});

module.exports = router; 