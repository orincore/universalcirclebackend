const supabase = require('../config/database');
const { info, error } = require('../utils/logger');

async function createVideoVerificationTable() {
  try {
    info('Creating user_video_verifications table...');
    
    // Check if the table already exists
    const { data: existingTable, error: checkError } = await supabase
      .from('user_video_verifications')
      .select('id')
      .limit(1);
      
    if (!checkError) {
      info('user_video_verifications table already exists, skipping creation');
      return true;
    }
    
    // Create the table if it doesn't exist
    const { error: sqlError } = await supabase.rpc('run_sql', {
      sql: `
        CREATE TABLE IF NOT EXISTS user_video_verifications (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          video_key VARCHAR(255) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'verified', 'rejected'
          rejection_reason TEXT,
          face_match_score FLOAT,
          liveness_score FLOAT,
          reviewer_id UUID REFERENCES users(id),
          verified_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_video_verifications_user_id ON user_video_verifications(user_id);
        CREATE INDEX IF NOT EXISTS idx_video_verifications_status ON user_video_verifications(status);
      `
    });
    
    if (sqlError) {
      error(`Failed to create user_video_verifications table: ${sqlError.message}`);
      return false;
    }
    
    info('user_video_verifications table created successfully');
    return true;
  } catch (err) {
    error(`Error creating user_video_verifications table: ${err.message}`);
    return false;
  }
}

// Run the migration
if (require.main === module) {
  createVideoVerificationTable()
    .then(success => {
      if (success) {
        console.log('Video verification table migration completed successfully');
        process.exit(0);
      } else {
        console.error('Video verification table migration failed');
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Unexpected error in video verification table migration:', err);
      process.exit(1);
    });
}

module.exports = { createVideoVerificationTable }; 