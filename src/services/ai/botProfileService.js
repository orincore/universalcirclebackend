const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../../utils/logger');
const { info, error } = logger;
const supabase = require('../../config/database');

// Initialize Google Generative AI client
const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

// Lists of common Indian first names
const indianMaleFirstNames = [
  'Aarav', 'Vihaan', 'Vivaan', 'Ansh', 'Dhruv', 'Arjun', 'Reyansh', 'Mohammed', 
  'Sai', 'Arnav', 'Aayan', 'Krishna', 'Ishaan', 'Shaurya', 'Atharva', 'Advik', 
  'Pranav', 'Advaith', 'Aaryan', 'Dhruv', 'Kabir', 'Ritvik', 'Aadit', 'Karthik', 
  'Rohan', 'Siddharth', 'Yash', 'Sai', 'Pranav', 'Virat'
];

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
 * Create a bot user record in the database
 * @param {object} botProfile - Bot profile data
 * @returns {Promise<object>} Created user record
 */
const createBotUserRecord = async (botProfile) => {
  try {
    if (!botProfile || !botProfile.id) {
      throw new Error('Invalid bot profile provided - missing ID');
    }
    
    console.log(`[BOT DEBUG] Creating bot user record for ${botProfile.id}`);
    
    // Check if user already exists to avoid duplicates
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('*')
      .eq('id', botProfile.id)
      .single();
    
    if (checkError && !checkError.message.includes('No rows found')) {
      // This is a real error, not just "no rows found"
      error(`Error checking for existing bot: ${checkError.message}`);
    }
    
    if (existingUser) {
      info(`Bot user ${botProfile.id} already exists in database`);
      return existingUser;
    }
    
    // Format the user record for database insertion
    const userRecord = {
      id: botProfile.id,
      username: botProfile.username,
      first_name: botProfile.firstName,
      last_name: botProfile.lastName,
      email: `bot.${botProfile.username}@example.com`, // Dummy email
      password: uuidv4(), // Random password, not used
      gender: botProfile.gender,
      bio: botProfile.bio,
      interests: botProfile.interests,
      date_of_birth: botProfile.date_of_birth,
      profile_picture_url: botProfile.profile_picture_url,
      is_online: true,
      last_active: new Date().toISOString(),
      created_at: botProfile.joinDate || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      preference: botProfile.preference || 'Friendship', // Default preference
      location: botProfile.location || 'Mumbai'
    };
    
    // Try to add is_bot field if it exists in the schema
    try {
      // Check if 'is_bot' column exists by doing a test select
      const { error: schemaError } = await supabase
        .from('users')
        .select('is_bot')
        .limit(1);
        
      // If no error, the column exists, so add it
      if (!schemaError) {
        userRecord.is_bot = true;
        info('Added is_bot field to user record');
      } else {
        info('is_bot field not available in schema, skipping');
      }
    } catch (schemaCheckError) {
      // If error, the column doesn't exist, so don't add it
      info(`is_bot field check failed: ${schemaCheckError.message}`);
    }
    
    console.log(`[BOT DEBUG] Inserting bot user record with fields: ${Object.keys(userRecord).join(', ')}`);
    
    // Insert the bot as a user in the database
    const { data, error: insertError } = await supabase
      .from('users')
      .insert(userRecord)
      .select()
      .single();
    
    if (insertError) {
      error(`Failed to create bot user record: ${insertError.message}`);
      
      // Check if the error is due to missing required fields
      if (insertError.message.includes('violates not-null constraint')) {
        const missingField = insertError.message.match(/column "([^"]+)"/);
        if (missingField && missingField[1]) {
          error(`Missing required field: ${missingField[1]}`);
        }
      }
      
      throw new Error(`Failed to create bot user record: ${insertError.message}`);
    }
    
    if (!data) {
      throw new Error('No data returned from bot user creation');
    }
    
    console.log(`[BOT DEBUG] Successfully created bot user ${botProfile.id} (${data.username}) in database`);
    return data;
  } catch (err) {
    error(`Error creating bot user record: ${err.message}`);
    console.error(err.stack);
    throw err;
  }
};

/**
 * Generate a fake bot profile and store it in the database
 * @param {string} gender - Gender for the bot ('male', 'female', or 'other')
 * @param {string} preference - Preference type ('Dating' or 'Friendship')
 * @param {Array} userInterests - User's interests to potentially match with
 * @returns {Promise<Object>} Bot profile with database record
 */
const generateBotProfile = async (gender = 'male', preference = 'Friendship', userInterests = []) => {
  try {
    console.log(`[BOT DEBUG] Generating bot profile with gender ${gender}, preference ${preference}`);
    
    // Normalize gender to lowercase
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
    
    // Generate date of birth based on age using our utility function
    const dob = getDateOfBirthFromAge(age);
    
    // Create unique ID for the bot - use standard UUID without prefix
    const botId = uuidv4();
    
    // Create a username - ensure it's unique by adding the UUID fragment
    const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${botId.substring(0, 6)}`;
    
    // Use AI to generate bio if available
    let bio = '';
    try {
      const prompt = `
        Generate a ${preference.toLowerCase()} profile bio for a ${age}-year-old ${normalizedGender} from ${city}, India named ${firstName}. 
        Their interests include ${interests.join(', ')}.
        They work as a ${occupation} and have ${education}.
        Write in first person, be friendly, authentic, and keep it around 100 words.
        Don't use emojis or hashtags. Be conversational and natural.
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      bio = response.text().trim();
      console.log(`[BOT DEBUG] Generated AI bio for bot ${botId}: ${bio.substring(0, 50)}...`);
    } catch (aiError) {
      error(`Error generating AI bio: ${aiError.message}`);
      // Fallback bio
      bio = `Hi, I'm ${firstName}! I'm ${age} years old from ${city}. I work as a ${occupation} and I love ${interests.slice(0, 3).join(', ')}. Looking forward to connecting with like-minded people!`;
      console.log(`[BOT DEBUG] Using fallback bio for bot ${botId}: ${bio}`);
    }
    
    // Create profile picture URL using randomuser.me API
    const profilePictureUrl = normalizedGender === 'male' 
      ? `https://randomuser.me/api/portraits/men/${Math.floor(Math.random() * 99)}.jpg`
      : normalizedGender === 'female'
        ? `https://randomuser.me/api/portraits/women/${Math.floor(Math.random() * 99)}.jpg`
        : `https://randomuser.me/api/portraits/lego/${Math.floor(Math.random() * 8)}.jpg`;
    
    const joinDate = getDateFromDaysAgo(Math.floor(Math.random() * 90) + 5); // Joined 5-95 days ago
    
    // Create the bot profile with all required fields
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
      lastActive: new Date().toISOString(), // Current time
      joinDate,
      preference // Include the preference in the bot profile
    };
    
    console.log(`[BOT DEBUG] Generated bot profile for ${botId} (${username})`);
    
    // CRITICAL: Create user record in database FIRST and await its completion
    // This ensures the bot exists in the database before any references to it
    let dbUser;
    try {
      info(`Creating bot user record in database for ${botId}`);
      dbUser = await createBotUserRecord(botProfile);
      if (!dbUser) {
        throw new Error('Failed to create bot user record in database');
      }
      info(`Successfully created bot user record for ${botId}`);
    } catch (dbError) {
      error(`Error creating bot user record: ${dbError.message}`);
      // Try once more with the fallback method
      console.log(`[BOT DEBUG] Attempting fallback bot creation for ${botId}`);
      return generateFallbackBotProfile(gender, preference, userInterests);
    }
    
    return botProfile;
  } catch (err) {
    error(`Error generating bot profile: ${err.message}`);
    console.error(err.stack);
    // In case of any error, use the fallback but ensure it's created in DB
    return generateFallbackBotProfile(gender, preference, userInterests);
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
      lastActive: new Date().toISOString(), // Current time
      joinDate: getDateFromDaysAgo(Math.floor(Math.random() * 90) + 5) // Joined 5-95 days ago
    };
    
    // CRITICAL: Create user record in database FIRST and await its completion
    try {
      info(`Creating fallback bot user record in database for ${botId}`);
      const dbUser = await createBotUserRecord(botProfile);
      if (!dbUser) {
        throw new Error('Failed to create fallback bot user record in database');
      }
      info(`Successfully created fallback bot user record for ${botId}`);
    } catch (dbError) {
      error(`Critical error creating fallback bot user record: ${dbError.message}`);
      throw new Error(`Failed to create fallback bot in database: ${dbError.message}`);
    }
    
    return botProfile;
  } catch (finalError) {
    error(`Fatal error in fallback bot creation: ${finalError.message}`);
    throw finalError; // Rethrow as this is our last resort
  }
};

/**
 * Verify a bot exists in the database or create it
 * @param {string} botId - The bot ID to verify
 * @returns {Promise<boolean>} - True if bot exists or was created
 */
const verifyBotExists = async (botId) => {
  try {
    if (!botId) {
      error('verifyBotExists called with null or undefined botId');
      return false;
    }
    
    console.log(`[BOT DEBUG] Verifying bot ${botId} exists in database`);
    
    // Check if bot exists in users table
    const { data, error: queryError } = await supabase
      .from('users')
      .select('id, username')
      .eq('id', botId)
      .single();
      
    if (queryError) {
      error(`Database error checking bot ${botId}: ${queryError.message}`);
    }
      
    if (data) {
      console.log(`[BOT DEBUG] Bot ${botId} (${data.username}) verified in database`);
      return true; // Bot exists
    }
    
    // Bot doesn't exist, log error
    error(`Bot ${botId} does not exist in database and no profile data available to create it`);
    return false;
  } catch (err) {
    error(`Error verifying bot existence: ${err.message}`);
    console.error(err.stack);
    return false;
  }
};

/**
 * Store a message from or to a bot in the messages table
 * @param {string} senderId - Sender user ID
 * @param {string} receiverId - Receiver user ID
 * @param {string} content - Message content
 * @returns {Promise<Object>} Created message data
 */
const storeBotMessage = async (senderId, receiverId, content) => {
  try {
    // Verify both sender and receiver exist in the database
    const senderExists = await verifyBotExists(senderId);
    const receiverExists = await verifyBotExists(receiverId);
    
    if (!senderExists || !receiverExists) {
      throw new Error(`Cannot store message: ${!senderExists ? 'Sender' : 'Receiver'} does not exist in database`);
    }
    
    // Create message in database
    const { data, error: msgError } = await supabase
      .from('messages')
      .insert({
        sender_id: senderId,
        receiver_id: receiverId,
        content,
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select();
    
    if (msgError) {
      error(`Error creating bot message in database: ${msgError.message}`);
      throw msgError;
    }
    
    return data;
  } catch (err) {
    error(`Error storing bot message: ${err.message}`);
    throw err;
  }
};

// Update generateBotResponse to store messages in the database
const generateBotResponse = async (userMessage, botProfile, preference = 'Friendship', userId) => {
  try {
    // First ensure bot exists in database
    await verifyBotExists(botProfile.id);
    
    // Detect the language of the user message (simplified approach)
    const isEnglishMessage = /^[A-Za-z\s\d.,!?'"\-():;]+$/.test(userMessage);
    
    const prompt = `
      You are ${botProfile.firstName} ${botProfile.lastName}, a ${botProfile.gender}, ${new Date().getFullYear() - new Date(botProfile.date_of_birth).getFullYear()} years old from ${botProfile.location}, India.
      You work as a ${botProfile.occupation} and have ${botProfile.education}.
      Your interests include ${botProfile.interests.join(', ')}.
      Your bio: "${botProfile.bio}"
      
      You are chatting with someone on a ${preference.toLowerCase()} app. You are having a conversation in a ${preference.toLowerCase()} context, not a romantic one.
      
      IMPORTANT: Respond in the SAME LANGUAGE that the person is using to talk to you. If they write in Hindi, respond in Hindi. If they write in Tamil, respond in Tamil. Match their language.
      
      Respond naturally and conversationally to this message from them: "${userMessage}"
      
      Keep your response short (1-3 sentences), friendly, and authentic.
      Don't use emojis or hashtags. Be conversational and very natural like a real human.
      Don't mention that you are an AI.
      Don't explain your behavior - just respond naturally.
    `;
    
    let botResponse = '';
    
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      botResponse = response.text().trim();
    } catch (genError) {
      error(`Error generating bot response content: ${genError.message}`);
      // Fallback responses in appropriate language based on simple detection
      // Check if message is likely non-English
      const isNonEnglish = /[^\x00-\x7F]/.test(userMessage);
      
      // Hindi fallback responses
      const hindiFallbackResponses = [
        "नमस्ते! आपसे बात करके अच्छा लगा। और बताइए अपने बारे में?",
        "बहुत दिलचस्प! मुझे भी ऐसी चीज़ें पसंद हैं।",
        "आप क्या करना पसंद करते हैं? मुझे ${botProfile.interests[0]} बहुत पसंद है।",
        "वाह, यह तो बहुत अच्छा है! और सुनाइए?",
        "मैं ${botProfile.location} में रहता/रहती हूँ। आप कहाँ से हैं?",
        "ये बात मुझे पसंद आई! थोड़ा और बताइए?"
      ];
      
      // English fallback responses
      const englishFallbackResponses = [
        `That's interesting! Tell me more about yourself.`,
        `I enjoy ${botProfile.interests[0]} too! What else do you like to do?`,
        `I've been working as a ${botProfile.occupation} for a while now. What about you?`,
        `I'm from ${botProfile.location}. Have you ever visited?`,
        `That's cool! I'd love to hear more about your interests.`,
        `I'm actually learning more about ${botProfile.interests[1]} these days. Any recommendations?`,
        `Thanks for sharing that! I've had similar experiences.`,
        `That's a good point. I hadn't thought about it that way before.`,
        `I'm curious to know more about your perspective on that.`,
        `That sounds like fun! I should try that sometime.`
      ];
      
      // Choose appropriate language fallbacks
      const fallbackResponses = isNonEnglish ? hindiFallbackResponses : englishFallbackResponses;
      
      botResponse = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)]
        .replace(/\${botProfile\.interests\[0\]}/g, botProfile.interests[0] || "reading")
        .replace(/\${botProfile\.interests\[1\]}/g, botProfile.interests[1] || "traveling")
        .replace(/\${botProfile\.location}/g, botProfile.location || "Mumbai")
        .replace(/\${botProfile\.occupation}/g, botProfile.occupation || "professional");
    }
    
    // Store both messages in the database if userId is provided
    if (userId && botProfile.id) {
      try {
        // Store user's message to bot
        await storeBotMessage(userId, botProfile.id, userMessage);
        
        // Store bot's response to user
        await storeBotMessage(botProfile.id, userId, botResponse);
      } catch (dbError) {
        error(`Failed to store bot messages in database: ${dbError.message}`);
        // Continue even if message storage fails
      }
    }
    
    return botResponse;
  } catch (err) {
    error(`Error in bot response generation: ${err.message}`);
    return "I'm sorry, I couldn't process that message. Can you try again?";
  }
};

module.exports = {
  generateBotProfile,
  generateBotResponse,
  createBotUserRecord,
  storeBotMessage,
  verifyBotExists
}; 