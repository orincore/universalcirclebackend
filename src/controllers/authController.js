const supabase = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/password');
const { generateToken } = require('../utils/jwt');
const { userRegistrationSchema, userLoginSchema } = require('../models/user');

/**
 * Register a new user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const register = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = userRegistrationSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const {
      firstName,
      lastName,
      gender,
      dateOfBirth,
      email,
      phoneNumber,
      username,
      password,
      preference,
      location,
      interests
    } = value;

    // Check if email already exists
    const { data: emailExist } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    if (emailExist) {
      return res.status(409).json({
        success: false,
        message: 'Email already in use'
      });
    }

    // Check if username already exists
    const { data: usernameExist } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .single();

    if (usernameExist) {
      return res.status(409).json({
        success: false,
        message: 'Username already taken'
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user in database
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        first_name: firstName,
        last_name: lastName,
        gender,
        date_of_birth: dateOfBirth,
        email,
        phone_number: phoneNumber,
        username,
        password: hashedPassword,
        preference,
        location,
        interests,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating user:', insertError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create user'
      });
    }

    // Remove password from response
    delete newUser.password;

    // Generate JWT token
    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: newUser,
        token
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

/**
 * Login a user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const login = async (req, res) => {
  try {
    // Validate request body
    const { error, value } = userLoginSchema.validate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }

    const { emailOrUsername, password } = value;

    // Find user by email or username
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('*')
      .or(`email.eq.${emailOrUsername},username.eq.${emailOrUsername}`)
      .single();

    if (findError || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Compare passwords
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Remove password from response
    delete user.password;

    // Generate JWT token with admin flag if user is admin
    const token = generateToken({
      ...user,
      isAdmin: user.is_admin // Add admin flag to token payload based on user status
    });

    // Update last login timestamp (and admin_login_count if user is admin)
    const updateData = { last_login: new Date() };
    
    if (user.is_admin) {
      updateData.admin_login_count = (user.admin_login_count || 0) + 1;
    }
    
    await supabase
      .from('users')
      .update(updateData)
      .eq('id', user.id);

    // Log admin login
    if (user.is_admin) {
      console.log(`Admin login successful: ${user.username} (${user.id})`);
    }

    return res.status(200).json({
      success: true,
      message: user.is_admin ? 'Admin login successful' : 'Login successful',
      data: {
        user,
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

/**
 * Get current authenticated user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const me = async (req, res) => {
  try {
    // User is already attached to req by auth middleware
    return res.status(200).json({
      success: true,
      data: {
        user: req.user
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching user data'
    });
  }
};

module.exports = {
  register,
  login,
  me
}; 