const supabase = require('../../config/database');
const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

/**
 * Migration script to create the reports table
 */
const migrateReportsTable = async () => {
  try {
    logger.info('Starting reports table migration...');
    
    // Check if the table already exists
    const { data: existingTable, error: tableError } = await supabase.rpc('check_table_exists', {
      table_name: 'reports'
    });
    
    if (tableError) {
      // The RPC function might not exist yet, so we'll try a different approach
      try {
        const { data, error } = await supabase.from('reports').select('id').limit(1);
        if (!error) {
          logger.info('Reports table already exists. Migration skipped.');
          return true;
        }
      } catch (directError) {
        // Table doesn't exist, continue with migration
      }
    } else if (existingTable) {
      logger.info('Reports table already exists. Migration skipped.');
      return true;
    }
    
    // Read the SQL file for creating the table
    const sqlPath = path.join(__dirname, '..', 'createReportsTable.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL to create the function
    const { error: createFunctionError } = await supabase.rpc('exec_sql', {
      sql_string: sql
    });
    
    if (createFunctionError) {
      // If the exec_sql RPC doesn't exist, create it first
      const execSqlFunc = `
        CREATE OR REPLACE FUNCTION exec_sql(sql_string TEXT)
        RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
          EXECUTE sql_string;
        END;
        $$;
      `;
      
      // Create the exec_sql function (this might need admin privileges)
      const { error: execSqlError } = await supabase.rpc('exec_sql', {
        sql_string: execSqlFunc
      });
      
      if (execSqlError) {
        // As a last resort, try to execute the SQL using the PostgreSQL extension
        logger.warn('Failed to create exec_sql function. Trying direct SQL execution...');
        const { error: directSqlError } = await supabase.rpc('postgres_extension', {
          sql_string: sql
        });
        
        if (directSqlError) {
          logger.error('Failed to execute SQL directly:', directSqlError);
          throw new Error('Could not create reports table: ' + directSqlError.message);
        }
      } else {
        // Now try creating the reports table function again
        const { error: retryError } = await supabase.rpc('exec_sql', {
          sql_string: sql
        });
        
        if (retryError) {
          logger.error('Failed to create reports table function:', retryError);
          throw new Error('Could not create reports table function: ' + retryError.message);
        }
      }
    }
    
    // Now that we have the function, call it to create the table
    const { error: createTableError } = await supabase.rpc('create_reports_table');
    
    if (createTableError) {
      logger.error('Failed to create reports table:', createTableError);
      throw new Error('Could not create reports table: ' + createTableError.message);
    }
    
    logger.info('Reports table migration completed successfully!');
    return true;
  } catch (error) {
    logger.error('Reports table migration failed:', error);
    throw error;
  }
};

module.exports = {
  migrateReportsTable
}; 