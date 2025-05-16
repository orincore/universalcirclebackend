-- Add Gemini AI as a special user in the system
DO $$
BEGIN
  -- Check if the Gemini AI user already exists
  IF NOT EXISTS (SELECT FROM users WHERE id = '00000000-0000-4000-a000-000000000001') THEN
    -- Insert Gemini AI user
    INSERT INTO users (
      id,
      first_name,
      last_name,
      username,
      email,
      password_hash, -- Placeholder (not used for login)
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
      '00000000-0000-4000-a000-000000000001', -- Fixed UUID for Gemini AI
      'Gemini',
      'AI',
      'gemini.ai',
      'gemini.ai@system.internal',
      '$2a$10$SomeHashThatCantBeUsedForLogin123456789012345678901234', -- Unusable hash
      '+00000000000',
      '2023-12-15', -- Gemini launch date
      'other',
      'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Chrome-New_Gemini_AI_hero.max-1000x1000.png',
      'I am Gemini AI, an automated content moderation system. I help keep the platform safe by analyzing reported content.',
      FALSE,
      TRUE, -- Gemini has admin privileges
      NOW(),
      NOW()
    );
    
    RAISE NOTICE 'Gemini AI user created successfully.';
  ELSE
    RAISE NOTICE 'Gemini AI user already exists.';
  END IF;
END
$$; 