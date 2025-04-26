const express = require('express');
const router = express.Router();
const { 
  interests,
  getCategories,
  getSubcategoriesByCategory,
  getAllInterests
} = require('../utils/interests');
const { authenticate } = require('../middlewares/auth');

// Get all interest categories
router.get('/categories', (req, res) => {
  try {
    const categories = getCategories();
    return res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Error fetching interest categories:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch interest categories'
    });
  }
});

// Get all subcategories for a specific category
router.get('/categories/:category', (req, res) => {
  try {
    const { category } = req.params;
    const subcategories = getSubcategoriesByCategory(category);
    
    if (!subcategories) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: subcategories
    });
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subcategories'
    });
  }
});

// Get all interests (full structure)
router.get('/', (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: interests
    });
  } catch (error) {
    console.error('Error fetching interests:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch interests'
    });
  }
});

// Get all interests as a flat list
router.get('/flat', (req, res) => {
  try {
    const allInterests = getAllInterests();
    return res.status(200).json({
      success: true,
      data: allInterests
    });
  } catch (error) {
    console.error('Error fetching flat interests list:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch interests list'
    });
  }
});

module.exports = router; 