const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../../utils/logger');
const { info, error, warn } = logger;
const supabase = require('../../config/database');

// Initialize Google Generative AI client
const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

// Create model with fallback to ensure we don't crash
let model;
try {
  if (!API_KEY) {
    console.error('GEMINI_API_KEY is not set in environment variables');
  } else {
    model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    console.log('Successfully initialized Gemini AI model');
  }
} catch (err) {
  console.error('Failed to initialize Gemini AI model:', err);
}

// Lists of common Indian first names
const indianMaleFirstNames = [
  'Aarav', 'Vihaan', 'Vivaan', 'Ansh', 'Dhruv', 'Arjun', 'Reyansh', 'Mohammed', 
  'Sai', 'Arnav', 'Aayan', 'Krishna', 'Ishaan', 'Shaurya', 'Atharva', 'Advik', 
  'Pranav', 'Advaith', 'Aaryan', 'Dhruv', 'Kabir', 'Ritvik', 'Aadit', 'Karthik', 
  'Rohan', 'Siddharth', 'Yash', 'Sai', 'Pranav', 'Virat'
];

//List of common Indian female first names
const indianFemaleFirstNames = [
  'Saanvi', 'Aanya', 'Aadhya', 'Aaradhya', 'Ananya', 'Pari', 'Anika', 'Navya', 
  'Angel', 'Diya', 'Myra', 'Sara', 'Iraa', 'Ahana', 'Anvi', 'Prisha', 'Riya', 
  'Isha', 'Ishita', 'Shreya', 'Tanvi', 'Meera', 'Tanya', 'Avni', 'Trisha', 
  'Mahika', 'Kiara', 'Avantika', 'Nitya', 'Anaya'
];

const indianNonBinaryFirstNames = [
  'Kiran', 'Akash', 'Roshan', 'Jyoti', 'Amar', 'Anand', 'Shanti', 'Jai', 'Ajay',
  'Vijay', 'Arun', 'Tarun', 'Chaman', 'Suman', 'Prem', 'Noor', 'Tara', 'Ravi',
  'Shashi', 'Indra', 'Mani', 'Shubh', 'Khushi', 'Rajni', 'Pal', 'Anant', 'Satya',
  'Prakash', 'Karan', 'Santosh'
];

// Lists of common Indian last names
const indianLastNames = [
  'Sharma', 'Verma', 'Patel', 'Gupta', 'Singh', 'Kumar', 'Jain', 'Shah', 'Mehra',
  'Malhotra', 'Agarwal', 'Banerjee', 'Chatterjee', 'Mukherjee', 'Rao', 'Reddy',
  'Nair', 'Menon', 'Iyer', 'Iyengar', 'Ahluwalia', 'Chowdhury', 'Das', 'Dutta',
  'Bose', 'Basu', 'Gandhi', 'Nehru', 'Kapoor', 'Khanna', 'Chopra', 'Chauhan',
  'Desai', 'Joshi', 'Mehta', 'Saxena', 'Trivedi', 'Chaudhary', 'Kohli', 'Mishra'
];

// Major Indian cities
const indianCities = [
  'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 
  'Ahmedabad', 'Jaipur', 'Lucknow', 'Kochi', 'Chandigarh', 'Indore', 'Bhopal', 
  'Surat', 'Noida', 'Gurgaon', 'Coimbatore', 'Nagpur', 'Vadodara', 'Vishakhapatnam',
  'Thiruvananthapuram', 'Bhubaneswar', 'Patna', 'Guwahati', 'Dehradun', 'Mysore',
  'Mangalore', 'Varanasi', 'Agra'
];

// Common interests for bots
const commonInterests = [
  'Reading', 'Writing', 'Photography', 'Travel', 'Cooking', 'Baking', 'Music',
  'Singing', 'Dancing', 'Hiking', 'Cycling', 'Swimming', 'Yoga', 'Meditation',
  'Painting', 'Drawing', 'Sketching', 'Movies', 'Theatre', 'Stand-up Comedy',
  'Cricket', 'Football', 'Basketball', 'Badminton', 'Tennis', 'Table Tennis',
  'Chess', 'Carrom', 'Gaming', 'Coding', 'Blogging', 'Podcasting', 'Fashion',
  'Fitness', 'Gardening', 'DIY Crafts', 'Volunteering', 'Teaching', 'Philosophy',
  'History', 'Technology', 'Food Exploration', 'Astronomy', 'Bird Watching'
];

// Common educational institutions in India
const indianEducationalInstitutions = [
  'Indian Institute of Technology (IIT)', 'Indian Institute of Management (IIM)', 
  'All India Institute of Medical Sciences (AIIMS)', 'Delhi University', 
  'Jawaharlal Nehru University', 'Banaras Hindu University', 'University of Mumbai',
  'University of Calcutta', 'University of Madras', 'Anna University', 
  'Jadavpur University', 'Jamia Millia Islamia', 'Amity University', 
  'Manipal University', 'Symbiosis International University', 'BITS Pilani',
  'National Institute of Technology', 'National Law School of India University',
  'Christ University', 'Loyola College', 'St. Stephen\'s College', 'Lady Shri Ram College',
  'Xavier Labour Relations Institute (XLRI)', 'NIFT', 'National Institute of Design'
];

// Common occupations
const commonOccupations = [
  'Software Engineer', 'Data Scientist', 'Product Manager', 'UI/UX Designer', 
  'Digital Marketing Specialist', 'Content Writer', 'Doctor', 'Nurse', 'Teacher',
  'Professor', 'Researcher', 'Lawyer', 'Chartered Accountant', 'Financial Analyst',
  'Investment Banker', 'Entrepreneur', 'Startup Founder', 'Architect', 'Civil Engineer',
  'Mechanical Engineer', 'Electrical Engineer', 'Chef', 'Fashion Designer', 'Photographer',
  'Journalist', 'News Anchor', 'Social Media Manager', 'HR Manager', 'Business Analyst',
  'Management Consultant', 'Sales Executive', 'Artist', 'Musician', 'Dancer',
  'Fitness Trainer', 'Yoga Instructor', 'Nutritionist', 'Psychologist', 'Counselor'
];

// Add more constants for enhanced bot profiles
const indianLanguages = [
  'Hindi', 'English', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 
  'Urdu', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi'
];

const relationshipStatuses = [
  'Single', 'Single and looking', 'Divorced', 'Widowed', 
  'It\'s complicated', 'Just exploring', 'Open to possibilities'
];

const personalityTraits = [
  'Friendly', 'Outgoing', 'Introverted', 'Creative', 'Ambitious', 'Laid-back',
  'Intellectual', 'Adventurous', 'Empathetic', 'Reliable', 'Spontaneous', 'Thoughtful',
  'Funny', 'Optimistic', 'Pragmatic', 'Compassionate', 'Analytical', 'Artistic',
  'Confident', 'Curious', 'Determined', 'Easy-going', 'Honest', 'Loyal',
  'Patient', 'Reflective', 'Resilient', 'Sensitive', 'Witty', 'Passionate'
];

const favoriteMovieGenres = [
  'Bollywood Drama', 'Hollywood Action', 'Sci-Fi', 'Comedy', 'Horror',
  'Thriller', 'Romance', 'Documentary', 'Indie Films', 'Classical Cinema'
];

const favoriteBookGenres = [
  'Fiction', 'Non-fiction', 'Self-help', 'Biography', 'Fantasy',
  'Science Fiction', 'Mystery', 'Poetry', 'History', 'Philosophy'
];

const favoriteMusicGenres = [
  'Bollywood', 'Classical Indian', 'Pop', 'Rock', 'Hip Hop',
  'EDM', 'Folk', 'Indie', 'Jazz', 'R&B', 'Instrumental'
];

const lifeGoals = [
  'Starting my own business', 'Traveling the world', 'Mastering my craft',
  'Making a difference in my community', 'Finding work-life balance',
  'Continuous learning and personal growth', 'Building meaningful relationships',
  'Contributing to environmental sustainability', 'Financial independence',
  'Creating art that inspires others', 'Teaching and mentoring others'
];

const travelExperiences = [
  'Backpacked across Europe', 'Explored the beaches of Goa', 'Hiked in the Himalayas',
  'Visited historical sites in Rajasthan', 'Experienced the bustling streets of Mumbai',
  'Spiritual retreat in Rishikesh', 'Safari in Ranthambore', 'Cultural tour of South India',
  'Food exploration in Delhi', 'Temple hopping in Tamil Nadu', 'Adventure sports in Manali',
  'Visited the Taj Mahal', 'Boat ride in the backwaters of Kerala'
];

// List of zodiac signs with date ranges
const zodiacSigns = [
  { sign: 'Aries', startMonth: 3, startDay: 21, endMonth: 4, endDay: 19 },
  { sign: 'Taurus', startMonth: 4, startDay: 20, endMonth: 5, endDay: 20 },
  { sign: 'Gemini', startMonth: 5, startDay: 21, endMonth: 6, endDay: 20 },
  { sign: 'Cancer', startMonth: 6, startDay: 21, endMonth: 7, endDay: 22 },
  { sign: 'Leo', startMonth: 7, startDay: 23, endMonth: 8, endDay: 22 },
  { sign: 'Virgo', startMonth: 8, startDay: 23, endMonth: 9, endDay: 22 },
  { sign: 'Libra', startMonth: 9, startDay: 23, endMonth: 10, endDay: 22 },
  { sign: 'Scorpio', startMonth: 10, startDay: 23, endMonth: 11, endDay: 21 },
  { sign: 'Sagittarius', startMonth: 11, startDay: 22, endMonth: 12, endDay: 21 },
  { sign: 'Capricorn', startMonth: 12, startDay: 22, endMonth: 1, endDay: 19 },
  { sign: 'Aquarius', startMonth: 1, startDay: 20, endMonth: 2, endDay: 18 },
  { sign: 'Pisces', startMonth: 2, startDay: 19, endMonth: 3, endDay: 20 }
];

// Indian states and union territories
const indianStates = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Chandigarh', 'Puducherry', 'Jammu and Kashmir', 'Ladakh'
];

/**
 * Format date to YYYY-MM-DD format
 * @param {Date} date - The date to format
 * @returns {string} Formatted date
 */
const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Get date of birth from age
 * @param {number} age - Age in years
 * @returns {string} Date of birth in YYYY-MM-DD format
 */
const getDateOfBirthFromAge = (age) => {
  const today = new Date();
  const birthYear = today.getFullYear() - age;
  const birthMonth = today.getMonth();
  const birthDay = today.getDate();
  return formatDate(new Date(birthYear, birthMonth, birthDay));
};

/**
 * Get date from days ago
 * @param {number} daysAgo - Number of days ago
 * @returns {string} Date in ISO format
 */
const getDateFromDaysAgo = (daysAgo) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
};

/**
 * Generate random age between 21 and 35
 * @returns {number} Age
 */
const generateRandomAge = () => {
  return Math.floor(Math.random() * (35 - 21 + 1)) + 21;
};

/**
 * Generate random location (city, state)
 * @returns {string} Location
 */
const generateRandomLocation = () => {
  return indianCities[Math.floor(Math.random() * indianCities.length)];
};

/**
 * Generate random interests
 * @param {Array} userInterests - User's interests to potentially match with
 * @returns {Array} Interests
 */
const generateRandomInterests = (userInterests = []) => {
  const interestCount = Math.floor(Math.random() * 5) + 3; // 3-7 interests
  const interests = [];
  
  // Include 1-2 of user's interests if available
  if (userInterests.length > 0) {
    const userInterestsToInclude = Math.min(2, userInterests.length);
    const shuffledUserInterests = [...userInterests].sort(() => 0.5 - Math.random());
    
    for (let i = 0; i < userInterestsToInclude; i++) {
      interests.push(shuffledUserInterests[i]);
    }
  }
  
  // Fill remaining with random interests
  while (interests.length < interestCount) {
    const randomInterest = commonInterests[Math.floor(Math.random() * commonInterests.length)];
    if (!interests.includes(randomInterest)) {
      interests.push(randomInterest);
    }
  }
  
  return interests;
};

/**
 * Generate random education
 * @returns {string} Education
 */
const generateRandomEducation = () => {
  const degrees = ['Bachelor\'s', 'Master\'s', 'PhD'];
  const fields = [
    'Computer Science', 'Information Technology', 'Electronics', 'Mechanical Engineering',
    'Civil Engineering', 'Business Administration', 'Finance', 'Marketing', 'Economics',
    'Psychology', 'Sociology', 'Literature', 'Political Science', 'History', 'Mathematics',
    'Physics', 'Chemistry', 'Biology', 'Medicine', 'Law', 'Architecture', 'Design',
    'Fine Arts', 'Film Studies', 'Journalism', 'Communication', 'Education', 'Pharmacy'
  ];
  
  const institution = indianEducationalInstitutions[Math.floor(Math.random() * indianEducationalInstitutions.length)];
  const degree = degrees[Math.floor(Math.random() * degrees.length)];
  const field = fields[Math.floor(Math.random() * fields.length)];
  
  return `${degree} in ${field} from ${institution}`;
};

/**
 * Generate random occupation
 * @returns {string} Occupation
 */
const generateRandomOccupation = () => {
  return commonOccupations[Math.floor(Math.random() * commonOccupations.length)];
};

/**
 * Generate random height in cm (appropriate for Indian demographics)
 * @param {string} gender - Gender of the person
 * @returns {number} Height in cm
 */
const generateRandomHeight = (gender) => {
  if (gender === 'male') {
    // Average male height in India is around 165cm with variation
    return Math.floor(Math.random() * 20) + 160; // 160-180cm
  } else if (gender === 'female') {
    // Average female height in India is around 152cm with variation
    return Math.floor(Math.random() * 20) + 150; // 150-170cm
  } else {
    // For non-binary, use a wider range
    return Math.floor(Math.random() * 30) + 155; // 155-185cm
  }
};

/**
 * Generate relationship status appropriate for the preference context
 * @param {string} preference - Dating or Friendship
 * @returns {string} Relationship status
 */
const generateRelationshipStatus = (preference) => {
  if (preference === 'Dating') {
    const datingStatuses = relationshipStatuses.filter(s => 
      s === 'Single' || s === 'Single and looking' || s === 'Divorced' || 
      s === 'Widowed' || s === 'Open to possibilities');
    return datingStatuses[Math.floor(Math.random() * datingStatuses.length)];
  } else {
    return relationshipStatuses[Math.floor(Math.random() * relationshipStatuses.length)];
  }
};

/**
 * Generate random languages spoken (always include English, maybe Hindi, and possibly others)
 * @returns {Array} Languages spoken
 */
const generateLanguages = () => {
  const languages = [];
  
  // Always include English
  languages.push('English');
  
  // 90% chance to include Hindi
  if (Math.random() < 0.9) {
    languages.push('Hindi');
  }
  
  // Add 0-3 more languages
  const additionalLanguages = Math.floor(Math.random() * 4);
  const otherLanguages = indianLanguages.filter(lang => !languages.includes(lang));
  const shuffled = [...otherLanguages].sort(() => 0.5 - Math.random());
  
  for (let i = 0; i < additionalLanguages && i < shuffled.length; i++) {
    languages.push(shuffled[i]);
  }
  
  return languages;
};

/**
 * Generate random personality traits
 * @returns {Array} Personality traits
 */
const generatePersonalityTraits = () => {
  const traitCount = Math.floor(Math.random() * 3) + 3; // 3-5 traits
  const traits = [];
  
  const shuffled = [...personalityTraits].sort(() => 0.5 - Math.random());
  
  for (let i = 0; i < traitCount; i++) {
    traits.push(shuffled[i]);
  }
  
  return traits;
};

/**
 * Generate random favorite movies, books, or music
 * @param {Array} genres - Array of genres to choose from
 * @returns {Array} Favorites
 */
const generateFavorites = (genres) => {
  const count = Math.floor(Math.random() * 3) + 1; // 1-3 favorites
  const favorites = [];
  
  const shuffled = [...genres].sort(() => 0.5 - Math.random());
  
  for (let i = 0; i < count; i++) {
    favorites.push(shuffled[i]);
  }
  
  return favorites;
};

/**
 * Generate zodiac sign based on date of birth
 * @param {string} dateOfBirth - Date of birth in YYYY-MM-DD format
 * @returns {string} Zodiac sign
 */
const generateZodiacSign = (dateOfBirth) => {
  const date = new Date(dateOfBirth);
  const month = date.getMonth() + 1; // JavaScript months are 0-indexed
  const day = date.getDate();
  
  for (const zodiac of zodiacSigns) {
    // Handle the case where the zodiac sign spans December to January
    if (zodiac.startMonth === 12 && zodiac.endMonth === 1) {
      if ((month === 12 && day >= zodiac.startDay) || (month === 1 && day <= zodiac.endDay)) {
        return zodiac.sign;
      }
    } else if ((month === zodiac.startMonth && day >= zodiac.startDay) || 
               (month === zodiac.endMonth && day <= zodiac.endDay)) {
      return zodiac.sign;
    }
  }
  
  // Default fallback (should never reach here if dates are valid)
  return 'Unknown';
};

/**
 * Generate more detailed location with city and state
 * @returns {Object} Location object with city and state
 */
const generateDetailedLocation = () => {
  const city = indianCities[Math.floor(Math.random() * indianCities.length)];
  const state = indianStates[Math.floor(Math.random() * indianStates.length)];
  
  return {
    city,
    state,
    display: `${city}, ${state}`
  };
};

/**
 * Generate fictitious social media handles
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @returns {Object} Social media handles
 */
const generateSocialMediaHandles = (firstName, lastName) => {
  const lowerFirstName = firstName.toLowerCase();
  const lowerLastName = lastName.toLowerCase();
  
  // Create variations for handles
  const variations = [
    `${lowerFirstName}${lowerLastName}`,
    `${lowerFirstName}_${lowerLastName}`,
    `${lowerFirstName}.${lowerLastName}`,
    `${lowerFirstName}${Math.floor(Math.random() * 1000)}`,
    `real_${lowerFirstName}`,
    `the_${lowerFirstName}`,
    `${lowerFirstName}${Math.floor(Math.random() * 100)}${lowerLastName.charAt(0)}`
  ];
  
  const randomVariation = () => variations[Math.floor(Math.random() * variations.length)];
  
  return {
    instagram: randomVariation(),
    twitter: randomVariation(),
    linkedin: `${lowerFirstName}-${lowerLastName}-${Math.floor(Math.random() * 900 + 100)}`
  };
};

/**
 * Generate professional experience
 * @param {number} age - Age of the person
 * @param {string} occupation - Current occupation
 * @param {string} education - Education details
 * @returns {Array} Professional experience
 */
const generateProfessionalExperience = (age, occupation, education) => {
  // Only generate work experience for people 22 or older
  if (age < 22) {
    return [];
  }
  
  const currentYear = new Date().getFullYear();
  const experiences = [];
  
  // Add current job
  experiences.push({
    title: occupation,
    company: generateCompanyName(),
    startYear: currentYear - Math.floor(Math.random() * 5) - 1, // 1-6 years
    endYear: null, // Current job
    isCurrent: true
  });
  
  // Potentially add 0-2 past jobs for older individuals
  const pastJobCount = age > 26 ? Math.floor(Math.random() * 3) : Math.floor(Math.random() * 2);
  
  let lastEndYear = experiences[0].startYear;
  
  for (let i = 0; i < pastJobCount; i++) {
    const jobDuration = Math.floor(Math.random() * 4) + 1; // 1-4 years
    const startYear = lastEndYear - jobDuration;
    const endYear = lastEndYear - 1;
    
    // Don't add jobs that would start before the person was 20
    if (currentYear - startYear > age - 20) {
      break;
    }
    
    experiences.push({
      title: generateRelatedJobTitle(occupation),
      company: generateCompanyName(),
      startYear,
      endYear,
      isCurrent: false
    });
    
    lastEndYear = startYear;
  }
  
  // Sort experiences in chronological order (oldest first)
  return experiences.sort((a, b) => a.startYear - b.startYear);
};

/**
 * Generate a company name
 * @returns {string} Company name
 */
const generateCompanyName = () => {
  const prefixes = ['Tech', 'Global', 'Indian', 'Future', 'Smart', 'Creative', 'Digital', 'Prime', 'Elite', 'Innovative'];
  const middles = ['Soft', 'System', 'Data', 'Info', 'Net', 'Web', 'Cloud', 'Media', 'Vision', 'Logic'];
  const suffixes = ['Solutions', 'Technologies', 'Systems', 'Innovations', 'Services', 'Enterprises', 'Corp', 'Group', 'Ventures', 'Labs'];
  
  const useMiddle = Math.random() > 0.5;
  
  if (useMiddle) {
    return `${prefixes[Math.floor(Math.random() * prefixes.length)]}${middles[Math.floor(Math.random() * middles.length)]} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
  } else {
    return `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${suffixes[Math.floor(Math.random() * suffixes.length)]}`;
  }
};

/**
 * Generate a related job title based on current occupation
 * @param {string} currentOccupation - Current occupation
 * @returns {string} Related job title
 */
const generateRelatedJobTitle = (currentOccupation) => {
  const techTitles = ['Junior Developer', 'Software Engineer', 'Systems Analyst', 'QA Engineer', 'Technical Support', 'IT Associate'];
  const marketingTitles = ['Marketing Assistant', 'Social Media Coordinator', 'Marketing Associate', 'Brand Ambassador', 'Content Creator'];
  const financeTitles = ['Financial Analyst', 'Accountant', 'Banking Associate', 'Investment Analyst', 'Financial Advisor'];
  const generalTitles = ['Assistant', 'Coordinator', 'Associate', 'Manager', 'Specialist', 'Consultant'];
  
  // Choose relevant job titles based on current occupation
  if (currentOccupation.includes('Engineer') || currentOccupation.includes('Developer') || 
      currentOccupation.includes('Tech') || currentOccupation.includes('Data')) {
    return techTitles[Math.floor(Math.random() * techTitles.length)];
  } else if (currentOccupation.includes('Market') || currentOccupation.includes('Content') || 
             currentOccupation.includes('Social') || currentOccupation.includes('Brand')) {
    return marketingTitles[Math.floor(Math.random() * marketingTitles.length)];
  } else if (currentOccupation.includes('Finance') || currentOccupation.includes('Account') || 
             currentOccupation.includes('Analyst') || currentOccupation.includes('Banking')) {
    return financeTitles[Math.floor(Math.random() * financeTitles.length)];
  } else {
    return generalTitles[Math.floor(Math.random() * generalTitles.length)];
  }
};

/**
 * Generate detailed educational history
 * @param {number} age - Age of the person
 * @param {string} highestEducation - Highest education attained
 * @returns {Array} Educational history
 */
const generateEducationalHistory = (age, highestEducation) => {
  const currentYear = new Date().getFullYear();
  const education = [];
  
  // Parse the highest education
  const degreeMatch = highestEducation.match(/(Bachelor's|Master's|PhD)/);
  const degree = degreeMatch ? degreeMatch[0] : "Bachelor's"; // Default to Bachelor's if not found
  
  const fieldMatch = highestEducation.match(/in (.+?) from/);
  const field = fieldMatch ? fieldMatch[1] : "General Studies"; // Default if not found
  
  const institutionMatch = highestEducation.match(/from (.+)$/);
  const institution = institutionMatch ? institutionMatch[1] : "University"; // Default if not found
  
  // Add highest degree
  let graduationYear;
  let startYear;
  
  if (degree === "PhD") {
    graduationYear = currentYear - Math.floor(Math.random() * 5); // 0-4 years ago
    startYear = graduationYear - 4; // 4 years for PhD
    
    education.push({
      degree: "PhD",
      field,
      institution,
      startYear,
      graduationYear,
      isHighest: true
    });
    
    // Add Master's
    const mastersGradYear = startYear - 1;
    const mastersStartYear = mastersGradYear - 2; // 2 years for Master's
    
    education.push({
      degree: "Master's",
      field,
      institution: indianEducationalInstitutions[Math.floor(Math.random() * indianEducationalInstitutions.length)],
      startYear: mastersStartYear,
      graduationYear: mastersGradYear,
      isHighest: false
    });
    
    // Add Bachelor's
    const bachelorGradYear = mastersStartYear - 1;
    const bachelorStartYear = bachelorGradYear - 4; // 4 years for Bachelor's
    
    education.push({
      degree: "Bachelor's",
      field,
      institution: indianEducationalInstitutions[Math.floor(Math.random() * indianEducationalInstitutions.length)],
      startYear: bachelorStartYear,
      graduationYear: bachelorGradYear,
      isHighest: false
    });
  } 
  else if (degree === "Master's") {
    graduationYear = currentYear - Math.floor(Math.random() * 5); // 0-4 years ago
    startYear = graduationYear - 2; // 2 years for Master's
    
    education.push({
      degree: "Master's",
      field,
      institution,
      startYear,
      graduationYear,
      isHighest: true
    });
    
    // Add Bachelor's
    const bachelorGradYear = startYear - 1;
    const bachelorStartYear = bachelorGradYear - 4; // 4 years for Bachelor's
    
    education.push({
      degree: "Bachelor's",
      field,
      institution: indianEducationalInstitutions[Math.floor(Math.random() * indianEducationalInstitutions.length)],
      startYear: bachelorStartYear,
      graduationYear: bachelorGradYear,
      isHighest: false
    });
  } 
  else {
    // Bachelor's degree
    graduationYear = currentYear - Math.floor(Math.random() * 7); // 0-6 years ago
    startYear = graduationYear - 4; // 4 years for Bachelor's
    
    education.push({
      degree: "Bachelor's",
      field,
      institution,
      startYear,
      graduationYear,
      isHighest: true
    });
  }
  
  // Sort education in chronological order (oldest first)
  return education.sort((a, b) => a.startYear - b.startYear);
};

/**
 * Generate random life goals
 * @returns {Array} Life goals
 */
const generateLifeGoals = () => {
  const goalCount = Math.floor(Math.random() * 2) + 1; // 1-2 goals
  const goals = [];
  
  const shuffled = [...lifeGoals].sort(() => 0.5 - Math.random());
  
  for (let i = 0; i < goalCount; i++) {
    goals.push(shuffled[i]);
  }
  
  return goals;
};

/**
 * Generate random travel experiences
 * @returns {Array} Travel experiences
 */
const generateTravelExperiences = () => {
  const experienceCount = Math.floor(Math.random() * 3) + 1; // 1-3 experiences
  const experiences = [];
  
  const shuffled = [...travelExperiences].sort(() => 0.5 - Math.random());
  
  for (let i = 0; i < experienceCount; i++) {
    experiences.push(shuffled[i]);
  }
  
  return experiences;
};

/**
 * Create a bot user record in the database - with robust error handling and verification
 * @param {object} botProfile - Bot profile data
 * @returns {Promise<object>} Created user data
 */
const createBotUserRecord = async (botProfile) => {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      // First check if bot user already exists
      const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('*')  // Get all user data, not just ID
        .eq('id', botProfile.id)
        .single();
      
      if (!checkError && existingUser) {
        info(`Bot user ${botProfile.id} already exists in database`);
        return existingUser;
      }
      
      if (checkError && checkError.code !== 'PGRST116') {
        // Real error, not just "no rows returned"
        throw new Error(`Error checking for existing bot user: ${checkError.message}`);
      }
      
      // Format data for database - ensure snake_case for all field names
      // Include ONLY fields that are known to exist in the database
      const userData = {
        id: botProfile.id,
        username: botProfile.username || `bot_${botProfile.firstName.toLowerCase()}${Math.floor(Math.random() * 1000)}`,
        email: `bot-${botProfile.id}@circleapp.io`, // Use a consistent domain
        password: `${uuidv4()}-${uuidv4()}`, // Secure random password that can't be guessed
        first_name: botProfile.firstName || botProfile.first_name,
        last_name: botProfile.lastName || botProfile.last_name,
        gender: botProfile.gender || 'other',
        bio: botProfile.bio || `Hi! I'm ${botProfile.firstName || botProfile.first_name}. Let's chat!`,
        date_of_birth: botProfile.date_of_birth,
        location: botProfile.location ? 
          (typeof botProfile.location === 'string' ? 
            JSON.stringify({city: botProfile.location}) : 
            JSON.stringify(botProfile.location)) : 
          JSON.stringify({city: 'Mumbai'}),
        profile_picture_url: botProfile.profile_picture_url,
        interests: Array.isArray(botProfile.interests) ? botProfile.interests : [],
        is_verified: true,
        is_bot: true,
        preference: botProfile.preference || 'Friendship',
        is_active: true,
        is_online: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
        
        // Add only fields we know exist in the database
        phone: null,
        private_profile: false,
        
        // Social media handles (only if they exist in the database)
        instagram_handle: null,
        twitter_handle: null,
        spotify_handle: null,
        linkedin_handle: null
      };
      
      // Log the exact data being inserted
      info(`Creating bot user with data: ${JSON.stringify(userData)}`);
      
      // Start a transaction for the bot user creation
      const { data, error } = await supabase
        .from('users')
        .insert(userData)
        .select('*')  // Return all fields, not just id
        .single();
      
      if (error) {
        throw new Error(`Error creating bot user: ${error.message} (${error.code})`);
      }
      
      if (!data || !data.id) {
        throw new Error('Bot user created but no data returned');
      }
      
      // Double-verify the user was created with a separate query
      const { data: verifyUser, error: verifyError } = await supabase
        .from('users')
        .select('id, username, first_name, last_name, is_bot')
        .eq('id', botProfile.id)
        .single();
      
      if (verifyError || !verifyUser) {
        throw new Error(`Bot user creation verification failed: ${verifyError?.message || 'User not found after creation'}`);
      }
      
      if (!verifyUser.is_bot) {
        // Ensure the is_bot flag is set
        await supabase
          .from('users')
          .update({ is_bot: true })
          .eq('id', botProfile.id);
      }
      
      info(`✅ Successfully created bot user ${botProfile.id} in database: ${verifyUser.username} (${verifyUser.first_name} ${verifyUser.last_name})`);
      
      return data;
    } catch (err) {
      retryCount++;
      error(`Failed to create bot user record (attempt ${retryCount}/${maxRetries}): ${err.message}`);
      
      if (retryCount >= maxRetries) {
        error(`Maximum retries reached for creating bot user ${botProfile.id || 'unknown'}`);
        throw err;
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, retryCount)));
    }
  }
};

/**
 * Verify bot user exists and recover if needed - use this before attempting any operations with a bot
 * @param {object} botProfile - Bot profile data 
 * @returns {Promise<object>} Verified bot user data
 */
const verifyAndRecoverBotUser = async (botProfile) => {
  if (!botProfile || !botProfile.id) {
    throw new Error('Invalid bot profile provided for verification');
  }
  
  try {
    // Check if bot exists
    const { data: botUser, error: botCheckError } = await supabase
      .from('users')
      .select('id, is_bot, first_name, last_name')
      .eq('id', botProfile.id)
      .single();
    
    // If bot exists and has all required fields, return it
    if (!botCheckError && botUser && botUser.is_bot) {
      return botUser;
    }
    
    // If bot exists but is missing the is_bot flag, fix it
    if (!botCheckError && botUser && !botUser.is_bot) {
      info(`Bot user ${botProfile.id} exists but is missing is_bot flag. Fixing...`);
      await supabase
        .from('users')
        .update({ is_bot: true })
        .eq('id', botProfile.id);
      
      return { ...botUser, is_bot: true };
    }
    
    // Otherwise create the bot user
    info(`Bot user ${botProfile.id} does not exist. Creating...`);
    
    // Ensure minimal required fields are present
    const minimalBotProfile = {
      id: botProfile.id,
      firstName: botProfile.firstName || botProfile.first_name || 'Bot',
      lastName: botProfile.lastName || botProfile.last_name || 'User',
      username: botProfile.username || `bot_${Math.floor(Math.random() * 10000)}`,
      gender: botProfile.gender || 'other',
      date_of_birth: botProfile.date_of_birth || '2000-01-01',
      interests: botProfile.interests || [],
      preference: botProfile.preference || 'Friendship',
      bio: botProfile.bio || `Hi! I'm a bot user. Let's chat!`,
      location: botProfile.location || { city: 'Mumbai' }
    };
    
    try {
      const newBotUser = await createBotUserRecord(minimalBotProfile);
      return newBotUser;
    } catch (createError) {
      // If we failed to create the bot user, try a simplified creation with absolute minimum fields
      error(`Error creating bot user during recovery: ${createError.message}. Trying simplified creation...`);
      
      try {
        // Create directly with supabase with minimum fields
        const { data, error: directCreateError } = await supabase
          .from('users')
          .insert({
            id: botProfile.id,
            username: `bot_${Math.floor(Math.random() * 10000)}`,
            email: `bot-${botProfile.id}@circleapp.io`,
            password: `bot-${uuidv4()}`,
            first_name: 'Bot',
            last_name: 'User',
            is_bot: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select('id')
          .single();
          
        if (directCreateError) {
          throw new Error(`Failed simplified bot creation: ${directCreateError.message}`);
        }
        
        return data;
      } catch (simpleCreateError) {
        error(`Failed simplified bot creation: ${simpleCreateError.message}`);
        throw new Error(`Cannot create bot user: ${simpleCreateError.message}`);
      }
    }
  } catch (err) {
    error(`Error verifying/recovering bot user: ${err.message}`);
    throw err;
  }
};

/**
 * Store a message between a bot and user with robust error handling and verification
 * @param {string} senderId - Sender user ID
 * @param {string} receiverId - Receiver user ID
 * @param {string} content - Message content
 * @returns {Promise<Object>} Created message data
 */
const storeBotMessage = async (senderId, receiverId, content) => {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      // First verify both users exist to avoid foreign key constraint errors
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, is_bot, first_name, last_name')
        .or(`id.eq.${senderId},id.eq.${receiverId}`);
      
      if (userError) {
        throw new Error(`Error verifying users: ${userError.message}`);
      }
      
      // Check if both users exist
      const userIds = users.map(u => u.id);
      
      // If sender is missing, we need to create it
      if (!userIds.includes(senderId)) {
        error(`Sender ${senderId} does not exist in users table. This is a critical error.`);
        
        // If this is a bot, try to recover
        const senderIsBot = users.some(u => u.id === senderId && u.is_bot);
        if (senderIsBot) {
          const botProfile = {
            id: senderId,
            // Add minimal required fields to create a valid bot user
            firstName: 'Bot',
            lastName: 'User',
            gender: 'other',
            date_of_birth: new Date(2000, 0, 1).toISOString().split('T')[0],
            interests: []
          };
          
          info(`Attempting to recreate missing bot user ${senderId}`);
          await createBotUserRecord(botProfile);
        } else {
          throw new Error(`Sender ${senderId} does not exist and is not a bot. Cannot create message.`);
        }
      }
      
      // If receiver is missing, we need to create it
      if (!userIds.includes(receiverId)) {
        error(`Receiver ${receiverId} does not exist in users table. This is a critical error.`);
        
        // If this is a bot, try to recover
        const receiverIsBot = users.some(u => u.id === receiverId && u.is_bot);
        if (receiverIsBot) {
          const botProfile = {
            id: receiverId,
            // Add minimal required fields to create a valid bot user
            firstName: 'Bot',
            lastName: 'User',
            gender: 'other',
            date_of_birth: new Date(2000, 0, 1).toISOString().split('T')[0],
            interests: []
          };
          
          info(`Attempting to recreate missing bot user ${receiverId}`);
          await createBotUserRecord(botProfile);
        } else {
          throw new Error(`Receiver ${receiverId} does not exist and is not a bot. Cannot create message.`);
        }
      }
      
      // Now create the message
      const messageId = uuidv4();
      const now = new Date().toISOString();
      
      const { data, error: msgError } = await supabase
        .from('messages')
        .insert({
          id: messageId,
          sender_id: senderId,
          receiver_id: receiverId,
          content,
          is_read: false,
          created_at: now,
          updated_at: now,
          is_bot_message: true
        })
        .select();
      
      if (msgError) {
        throw new Error(`Error creating bot message in database: ${msgError.message} (${msgError.code})`);
      }
      
      info(`Successfully stored message from ${senderId} to ${receiverId}`);
      return data;
    } catch (err) {
      retryCount++;
      error(`Error storing bot message (attempt ${retryCount}/${maxRetries}): ${err.message}`);
      
      if (retryCount >= maxRetries) {
        error(`Maximum retries reached for storing message from ${senderId} to ${receiverId}`);
        throw err;
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, retryCount)));
    }
  }
};

/**
 * Generate a bot profile
 * @param {string} gender - Gender of the bot
 * @param {string} preference - Preference (Dating or Friendship)
 * @param {Array} userInterests - User interests to match
 * @returns {Promise<object>} Bot profile
 */
const generateBotProfile = async (gender = 'male', preference = 'Friendship', userInterests = []) => {
  try {
    // Normalize gender
    const normalizedGender = gender.toLowerCase();
    
    // Create AI-generated detailed bot profile if AI available
    if (model) {
      try {
        // ... existing AI profile generation code ...
        
        // Existing code for generating bot profile with AI
        
        // After generating the profile and before returning:
        
        // Create bot user in database and ensure it exists before returning
        try {
          await createBotUserRecord(botProfile);
          info(`Successfully created AI-generated bot user ${botProfile.id}`);
        } catch (dbError) {
          // If creation fails, throw the error to use fallback bot
          error(`Failed to create AI-generated bot user: ${dbError.message}`);
          throw dbError;
        }
        
        return botProfile;
      } catch (err) {
        // Log the AI error and fall through to the fallback
        error(`Error generating AI bot profile: ${err.message}`);
        // Fall through to fallback approach
      }
    }
    
    // Use the fallback approach for generating bot profile
    return await generateFallbackBotProfile(normalizedGender, preference, userInterests);
  } catch (fallbackError) {
    error(`Error in generateBotProfile: ${fallbackError.message}`);
    
    // Ultimate fallback - very simple bot profile
    // ... existing simple fallback code ...
    
    const firstName = normalizedGender === 'female' 
      ? indianFemaleFirstNames[Math.floor(Math.random() * indianFemaleFirstNames.length)]
      : normalizedGender === 'male'
        ? indianMaleFirstNames[Math.floor(Math.random() * indianMaleFirstNames.length)]
        : indianNonBinaryFirstNames[Math.floor(Math.random() * indianNonBinaryFirstNames.length)];
        
    const lastName = indianLastNames[Math.floor(Math.random() * indianLastNames.length)];
    const age = generateRandomAge();
    const city = indianCities[Math.floor(Math.random() * indianCities.length)];
    const interests = generateRandomInterests(userInterests);
    const education = generateRandomEducation();
    const occupation = generateRandomOccupation();
    
    // Generate date of birth based on age
    const dob = getDateOfBirthFromAge(age);
    
    // Create unique ID for the bot - use standard UUID without prefix
    const botId = uuidv4();
    
    // Simple fallback bio
    const bio = `Hi, I'm ${firstName}! I'm ${age} years old from ${city}. I work as a ${occupation} and I love ${interests.slice(0, 3).join(', ')}. Looking forward to connecting with like-minded people!`;
    
    // Create a username
    const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${Math.floor(Math.random() * 1000)}`;
    
    // Profile picture URL
    const profilePictureUrl = normalizedGender === 'male' 
      ? `https://randomuser.me/api/portraits/men/${Math.floor(Math.random() * 99)}.jpg`
      : normalizedGender === 'female'
        ? `https://randomuser.me/api/portraits/women/${Math.floor(Math.random() * 99)}.jpg`
        : `https://randomuser.me/api/portraits/lego/${Math.floor(Math.random() * 8)}.jpg`;
    
    // Create the bot profile
    const botProfile = {
      id: botId,
      firstName,
      lastName,
      username,
      gender: normalizedGender,
      bio,
      interests,
      education,
      occupation,
      location: city,
      date_of_birth: dob,
      profile_picture_url: profilePictureUrl,
      isBot: true, // Flag to identify this as a bot
      preference: preference, // Add preference to profile
      lastActive: new Date().toISOString(), // Current time
      joinDate: getDateFromDaysAgo(Math.floor(Math.random() * 90) + 5) // Joined 5-95 days ago
    };
    
    // Create user record in database - retry logic
    let retryCount = 0;
    let success = false;
    
    while (retryCount < 3 && !success) {
      try {
        await createBotUserRecord(botProfile);
        success = true;
        info(`Successfully created fallback bot user ${botProfile.id} after ${retryCount} retries`);
      } catch (dbError) {
        retryCount++;
        error(`Failed to create fallback bot user (attempt ${retryCount}/3): ${dbError.message}`);
        
        if (retryCount >= 3) {
          error(`Maximum retries reached for creating bot user ${botProfile.id}. Bot profile will be returned but messages may fail.`);
        } else {
          // Wait briefly before retrying
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    
    return botProfile;
  }
};

/**
 * Generate a fallback bot profile without AI
 * @param {string} gender - Gender for the bot
 * @param {string} preference - Preference type
 * @param {Array} userInterests - User's interests
 * @returns {Promise<Object>} Bot profile
 */
const generateFallbackBotProfile = async (gender = 'male', preference = 'Friendship', userInterests = []) => {
  try {
    const normalizedGender = gender.toLowerCase();
    
    // Select appropriate first name based on gender
    let firstName;
    if (normalizedGender === 'male') {
      firstName = indianMaleFirstNames[Math.floor(Math.random() * indianMaleFirstNames.length)];
    } else if (normalizedGender === 'female') {
      firstName = indianFemaleFirstNames[Math.floor(Math.random() * indianFemaleFirstNames.length)];
    } else {
      firstName = indianNonBinaryFirstNames[Math.floor(Math.random() * indianNonBinaryFirstNames.length)];
    }
    
    const lastName = indianLastNames[Math.floor(Math.random() * indianLastNames.length)];
    const age = generateRandomAge();
    const city = indianCities[Math.floor(Math.random() * indianCities.length)];
    const interests = generateRandomInterests(userInterests);
    const education = generateRandomEducation();
    const occupation = generateRandomOccupation();
    
    // Generate date of birth based on age
    const dob = getDateOfBirthFromAge(age);
    
    // Create unique ID for the bot - use standard UUID without prefix
    const botId = uuidv4();
    
    // Simple fallback bio
    const bio = `Hi, I'm ${firstName}! I'm ${age} years old from ${city}. I work as a ${occupation} and I love ${interests.slice(0, 3).join(', ')}. Looking forward to connecting with like-minded people!`;
    
    // Create a username
    const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${Math.floor(Math.random() * 1000)}`;
    
    // Profile picture URL
    const profilePictureUrl = normalizedGender === 'male' 
      ? `https://randomuser.me/api/portraits/men/${Math.floor(Math.random() * 99)}.jpg`
      : normalizedGender === 'female'
        ? `https://randomuser.me/api/portraits/women/${Math.floor(Math.random() * 99)}.jpg`
        : `https://randomuser.me/api/portraits/lego/${Math.floor(Math.random() * 8)}.jpg`;
    
    // Create the bot profile with all necessary fields in snake_case format for DB compatibility
    const botProfile = {
      id: botId,
      firstName, // camelCase for use in code
      lastName,  // camelCase for use in code
      username,
      gender: normalizedGender,
      bio,
      interests,
      education,
      occupation,
      location: city,
      date_of_birth: dob,
      profile_picture_url: profilePictureUrl, // snake_case for DB
      isBot: true,          // camelCase for use in code
      is_bot: true,         // snake_case for DB 
      preference: preference,
      lastActive: new Date().toISOString(),
      joinDate: getDateFromDaysAgo(Math.floor(Math.random() * 90) + 5),
      
      // Additional fields to ensure DB compatibility
      first_name: firstName, // snake_case for DB
      last_name: lastName,   // snake_case for DB
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
      is_active: true,
      is_online: true,
      is_verified: true
    };
    
    // Create user record in database with retry logic
    let retryCount = 0;
    const maxRetries = 3;
    let success = false;
    
    while (retryCount < maxRetries && !success) {
      try {
        await createBotUserRecord(botProfile);
        success = true;
        info(`Successfully created fallback bot user ${botProfile.id} after ${retryCount} retries`);
      } catch (dbError) {
        retryCount++;
        error(`Failed to create fallback bot user (attempt ${retryCount}/${maxRetries}): ${dbError.message}`);
        
        if (retryCount >= maxRetries) {
          error(`Maximum retries reached for creating bot user ${botProfile.id}. Bot profile will be returned but messages may fail.`);
        } else {
          // Wait briefly before retrying
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    
    return botProfile;
  } catch (err) {
    error(`Error in generateFallbackBotProfile: ${err.message}`);
    throw err;
  }
};

/**
 * Generate a bot response to a user message with improved Gemini AI integration
 * @param {string} userMessage - User's message
 * @param {object} botProfile - Bot's profile
 * @param {string} preference - Preference type
 * @param {string} userId - User ID
 * @returns {Promise<string>} Bot's response
 */
const generateBotResponse = async (userMessage, botProfile, preference = 'Friendship', userId) => {
  try {
    // First verify the bot user exists in the database
    await verifyAndRecoverBotUser(botProfile);
    
    // Detect the language of the user message (simplified approach)
    const hasNonEnglishChars = /[^\x00-\x7F]/.test(userMessage);
    const probableLanguage = hasNonEnglishChars ? 'non-english' : 'english';
    
    // Log message receipt
    info(`Generating bot response from ${botProfile.id} to user ${userId}: "${userMessage}" (detected language: ${probableLanguage})`);
    
    let botResponse = '';
    
    // Check if AI model is available
    if (model) {
      try {
        // Personality traits based on gender and preference
        let personalityTraits = '';
        
        if (botProfile.gender === 'female') {
          if (preference === 'Dating') {
            personalityTraits = 'friendly, warm, engaging, slightly flirtatious but respectful';
          } else {
            personalityTraits = 'friendly, supportive, compassionate, thoughtful';
          }
        } else if (botProfile.gender === 'male') {
          if (preference === 'Dating') {
            personalityTraits = 'confident, charming, attentive, slightly flirtatious but respectful';
          } else {
            personalityTraits = 'friendly, reliable, thoughtful, supportive';
          }
        } else {
          // Non-binary or other gender
          personalityTraits = 'friendly, open-minded, thoughtful, authentic';
        }
        
        // Enhanced prompt for better Gemini responses
        const prompt = `
          You are ${botProfile.firstName} ${botProfile.lastName}, a ${botProfile.gender}, ${new Date().getFullYear() - new Date(botProfile.date_of_birth).getFullYear()} years old from ${typeof botProfile.location === 'string' ? botProfile.location : JSON.parse(botProfile.location).city || 'Mumbai'}, India.
          
          YOUR PERSONALITY: You are ${personalityTraits}.
          
          YOUR PROFILE:
          - You work as a ${botProfile.occupation || 'professional'}
          - You have ${botProfile.education || 'a college education'}
          - Your interests include ${botProfile.interests.join(', ')}
          - Your bio: "${botProfile.bio}"
          
          CURRENT CONVERSATION:
          - You are chatting with someone on a ${preference.toLowerCase()} app
          - This is a ${preference.toLowerCase()} context interaction
          - You should be authentic, relatable, and show genuine interest
          
          IMPORTANT INSTRUCTIONS:
          - Respond in the SAME LANGUAGE the person is using to talk to you. If they write in Hindi, respond in Hindi. Match their language.
          - Keep your response natural, conversational and SHORT (1-3 sentences maximum)
          - Show genuine interest in what they've shared
          - Be warm and friendly but don't overdo the friendliness
          - Don't use emojis
          - Don't mention that you are an AI - respond as if you are a real person
          - Don't explain your behavior or apologize
          - Make your response feel like a genuine human message
          
          Respond naturally to this message: "${userMessage}"
        `;
        
        const safetySettings = [
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE'
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE'
          },
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE'
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE'
          }
        ];
        
        const generationConfig = {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 256,
        };
        
        // Generate response with Gemini
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          safetySettings,
          generationConfig
        });
        
        const response = await result.response;
        botResponse = response.text().trim();
        
        // Ensure the response isn't too long
        if (botResponse.length > 300) {
          botResponse = botResponse.substring(0, 300).trim();
          
          // Find the last complete sentence
          const lastPeriod = botResponse.lastIndexOf('.');
          const lastQuestion = botResponse.lastIndexOf('?');
          const lastExclamation = botResponse.lastIndexOf('!');
          
          const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);
          
          if (lastSentenceEnd > 150) {
            botResponse = botResponse.substring(0, lastSentenceEnd + 1);
          }
        }
        
        info(`Successfully generated AI response: "${botResponse}"`);
      } catch (genError) {
        error(`Error generating bot response with AI: ${genError.message}`);
        // Fall through to fallback responses
        botResponse = ''; // Ensure empty so we use fallback
      }
    } else {
      warn('AI model not available for bot response generation, using fallback');
    }
    
    // If no response was generated (due to error or no model), use fallback
    if (!botResponse) {
      // Use language-appropriate fallback responses
      const fallbackResponses = hasNonEnglishChars ? 
        getHindiFallbackResponses(botProfile) : 
        getEnglishFallbackResponses(botProfile);
      
      botResponse = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
      info(`Using fallback response for bot ${botProfile.id}: "${botResponse}"`);
    }
    
    // Store both messages in the database if userId is provided
    if (userId && botProfile.id) {
      try {
        // Store user's message to bot
        await storeBotMessage(userId, botProfile.id, userMessage);
        info(`Stored user message in database: from ${userId} to ${botProfile.id}`);
        
        // Store bot's response to user
        await storeBotMessage(botProfile.id, userId, botResponse);
        info(`Stored bot response in database: from ${botProfile.id} to ${userId}`);
      } catch (dbError) {
        error(`Failed to store bot messages in database: ${dbError.message}`);
        // Continue even if message storage fails
      }
    }
    
    return botResponse;
  } catch (err) {
    error(`Error in bot response generation: ${err.message}`);
    // Return a generic response that won't break the conversation
    return "I'm sorry, I was a bit distracted. What were you saying?";
  }
};

/**
 * Get Hindi fallback responses with bot profile substitutions
 * @param {object} botProfile - Bot profile data
 * @returns {Array} Array of Hindi responses
 */
const getHindiFallbackResponses = (botProfile) => {
  const name = botProfile.firstName || 'दोस्त';
  const interest = botProfile.interests && botProfile.interests.length > 0 ? 
    botProfile.interests[0] : 'बातचीत';
  const location = typeof botProfile.location === 'string' ? 
    botProfile.location : 
    (botProfile.location ? JSON.parse(botProfile.location).city : 'मुंबई');
  
  return [
    `नमस्ते! आपसे बात करके अच्छा लगा। और बताइए अपने बारे में?`,
    `बहुत दिलचस्प! मुझे भी ऐसी चीज़ें पसंद हैं।`,
    `आप क्या करना पसंद करते हैं? मुझे ${interest} बहुत पसंद है।`,
    `वाह, यह तो बहुत अच्छा है! और सुनाइए?`,
    `मैं ${location} में रहता/रहती हूँ। आप कहाँ से हैं?`,
    `ये बात मुझे पसंद आई! थोड़ा और बताइए?`,
    `मेरा नाम ${name} है। आपसे मिलकर खुशी हुई!`,
    `क्या आप भी ${interest} पसंद करते हैं? मुझे बहुत शौक है इसका।`
  ];
};

/**
 * Get English fallback responses with bot profile substitutions
 * @param {object} botProfile - Bot profile data
 * @returns {Array} Array of English responses
 */
const getEnglishFallbackResponses = (botProfile) => {
  const name = botProfile.firstName || 'friend';
  const interest = botProfile.interests && botProfile.interests.length > 0 ? 
    botProfile.interests[0] : 'conversations';
  const interest2 = botProfile.interests && botProfile.interests.length > 1 ? 
    botProfile.interests[1] : 'meeting new people';
  const location = typeof botProfile.location === 'string' ? 
    botProfile.location : 
    (botProfile.location ? JSON.parse(botProfile.location).city : 'Mumbai');
  const occupation = botProfile.occupation || 'professional';
  
  return [
    `That's interesting! Tell me more about yourself.`,
    `I enjoy ${interest} too! What else do you like to do?`,
    `I've been working as a ${occupation} for a while now. What about you?`,
    `I'm from ${location}. Have you ever visited?`,
    `That's cool! I'd love to hear more about your interests.`,
    `I'm actually learning more about ${interest2} these days. Any recommendations?`,
    `Thanks for sharing that! I've had similar experiences.`,
    `That's a good point. I hadn't thought about it that way before.`,
    `I'm curious to know more about your perspective on that.`,
    `That sounds fun! I should try that sometime.`,
    `I'm ${name}, by the way. Nice to connect with you!`,
    `Do you often spend time ${interest}? It's one of my favorite things to do.`
  ];
};

module.exports = {
  generateBotProfile,
  generateBotResponse,
  createBotUserRecord,
  storeBotMessage,
  verifyAndRecoverBotUser
};