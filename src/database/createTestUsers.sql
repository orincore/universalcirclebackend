-- Create test users for moderation testing

-- Check if test users already exist
DO $$
DECLARE
  user1_exists BOOLEAN;
  user2_exists BOOLEAN;
BEGIN
  -- Check if test user 1 exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = '11111111-1111-1111-1111-111111111111') INTO user1_exists;
  
  -- Check if test user 2 exists
  SELECT EXISTS(SELECT 1 FROM users WHERE id = '22222222-2222-2222-2222-222222222222') INTO user2_exists;
  
  -- Create test user 1 if it doesn't exist
  IF NOT user1_exists THEN
    INSERT INTO users (
      id, 
      first_name, 
      last_name, 
      username, 
      email, 
      password_hash, 
      phone_number, 
      date_of_birth, 
      gender, 
      profile_picture_url, 
      bio, 
      is_online, 
      is_admin, 
      created_at, 
      updated_at
    ) VALUES (
      '11111111-1111-1111-1111-111111111111',
      'Test',
      'Sender',
      'test.sender',
      'test.sender@example.com',
      '$2a$10$XHvjKGXSGOZ9xQ85HhLGPOsGYXHDQnXELBXG1hBvRoH.1EXxDrn2W', -- hashed 'password'
      '+15551234567',
      '1990-01-01',
      'other',
      'https://ui-avatars.com/api/?name=Test+Sender&background=random',
      'This is a test user for sending messages',
      false,
      false,
      NOW(),
      NOW()
    );
    
    RAISE NOTICE 'Created test user 1 (sender)';
  ELSE
    RAISE NOTICE 'Test user 1 (sender) already exists';
  END IF;
  
  -- Create test user 2 if it doesn't exist
  IF NOT user2_exists THEN
    INSERT INTO users (
      id, 
      first_name, 
      last_name, 
      username, 
      email, 
      password_hash, 
      phone_number, 
      date_of_birth, 
      gender, 
      profile_picture_url, 
      bio, 
      is_online, 
      is_admin, 
      created_at, 
      updated_at
    ) VALUES (
      '22222222-2222-2222-2222-222222222222',
      'Test',
      'Reporter',
      'test.reporter',
      'test.reporter@example.com',
      '$2a$10$XHvjKGXSGOZ9xQ85HhLGPOsGYXHDQnXELBXG1hBvRoH.1EXxDrn2W', -- hashed 'password'
      '+15559876543',
      '1992-05-15',
      'other',
      'https://ui-avatars.com/api/?name=Test+Reporter&background=random',
      'This is a test user for reporting messages',
      false,
      false,
      NOW(),
      NOW()
    );
    
    RAISE NOTICE 'Created test user 2 (reporter)';
  ELSE
    RAISE NOTICE 'Test user 2 (reporter) already exists';
  END IF;
END $$; 