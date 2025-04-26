/**
 * Predefined interests organized by categories and subcategories
 */
const interests = [
  {
    category: "Entertainment",
    subcategories: [
      "Movies",
      "Music",
      "Gaming",
      "Anime",
      "Theater & Acting",
      "Comics",
      "Magic Tricks",
      "Podcast Listening",
    ],
  },
  {
    category: "Travel & Adventure",
    subcategories: [
      "Travel",
      "Hiking",
      "Camping",
      "Biking",
      "Adventure",
      "Fishing",
    ],
  },
  {
    category: "Sports & Fitness",
    subcategories: [
      "Sports",
      "Fitness",
      "Swimming",
      "Skating",
    ],
  },
  {
    category: "Food & Cooking",
    subcategories: [
      "Cooking",
      "Foodie",
    ],
  },
  {
    category: "Arts & Creativity",
    subcategories: [
      "Photography",
      "Art",
      "DIY & Crafts",
      "Interior Design",
    ],
  },
  {
    category: "Knowledge & Learning",
    subcategories: [
      "Reading",
      "Science",
      "History",
      "Space & Astronomy",
      "Languages",
    ],
  },
  {
    category: "Lifestyle & Wellness",
    subcategories: [
      "Fashion",
      "Health & Wellness",
      "Meditation",
      "Spirituality",
      "Astrology",
      "Gardening",
    ],
  },
  {
    category: "Technology & Innovation",
    subcategories: [
      "Technology",
      "Coding",
      "Startups",
      "Business",
      "Investment & Finance",
    ],
  },
  {
    category: "Social & Community",
    subcategories: [
      "Politics",
      "Volunteering",
      "Public Speaking",
      "Relationship Advice",
    ],
  },
  {
    category: "Animals & Nature",
    subcategories: [
      "Nature",
      "Animals",
      "Pets & Pet Care",
    ],
  },
  {
    category: "Automobile",
    subcategories: [
      "Cars",
    ],
  },
];

/**
 * Get all available interest categories
 * @returns {Array} Array of category names
 */
const getCategories = () => {
  return interests.map(item => item.category);
};

/**
 * Get all subcategories for a specific category
 * @param {string} category - The category name
 * @returns {Array|null} Array of subcategories or null if category not found
 */
const getSubcategoriesByCategory = (category) => {
  const found = interests.find(item => item.category === category);
  return found ? found.subcategories : null;
};

/**
 * Get all available interests as a flat array of subcategories
 * @returns {Array} Flat array of all subcategories
 */
const getAllInterests = () => {
  return interests.reduce((acc, item) => {
    return [...acc, ...item.subcategories];
  }, []);
};

/**
 * Validate if the provided interests are valid
 * @param {Array} userInterests - Array of user interests
 * @returns {boolean} True if all interests are valid
 */
const validateInterests = (userInterests) => {
  const allValidInterests = getAllInterests();
  return userInterests.every(interest => allValidInterests.includes(interest));
};

module.exports = {
  interests,
  getCategories,
  getSubcategoriesByCategory,
  getAllInterests,
  validateInterests
}; 