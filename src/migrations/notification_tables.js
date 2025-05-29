/**
 * Migration to add notification-related tables
 * 
 * This migration adds:
 * 1. device_tokens table - to store FCM tokens for user devices
 * 2. admin_notifications table - to track admin broadcast notifications
 * 3. user_notification_settings table - to track user notification preferences
 */

const supabase = require('../config/database');
const logger = require('../utils/logger');

const up = async () => {
  try {
    logger.info('Starting notification tables migration');

    // Create device_tokens table
    const { error: deviceTokensError } = await supabase.rpc('create_table_if_not_exists', {
      table_name: 'device_tokens',
      table_definition: `
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        device_type TEXT,
        device_name TEXT,
        app_version TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(user_id, token)
      `
    });
    if (deviceTokensError) throw deviceTokensError;
    logger.info('Created device_tokens table');

    // Create device_tokens indexes
    const { error: deviceTokensIndexError } = await supabase.rpc('run_sql_command', {
      sql_command: `
        CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx ON public.device_tokens(user_id);
        CREATE INDEX IF NOT EXISTS device_tokens_token_idx ON public.device_tokens(token);
      `
    });
    if (deviceTokensIndexError) throw deviceTokensIndexError;
    logger.info('Created device_tokens indexes');

    // Create admin_notifications table to track broadcast notifications
    const { error: adminNotificationsError } = await supabase.rpc('create_table_if_not_exists', {
      table_name: 'admin_notifications',
      table_definition: `
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        data JSONB DEFAULT '{}',
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
      `
    });
    if (adminNotificationsError) throw adminNotificationsError;
    logger.info('Created admin_notifications table');

    // Create user_notification_settings table
    const { error: notificationSettingsError } = await supabase.rpc('create_table_if_not_exists', {
      table_name: 'user_notification_settings',
      table_definition: `
        user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        messages_enabled BOOLEAN DEFAULT TRUE,
        matches_enabled BOOLEAN DEFAULT TRUE,
        likes_enabled BOOLEAN DEFAULT TRUE,
        system_enabled BOOLEAN DEFAULT TRUE,
        promotional_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      `
    });
    if (notificationSettingsError) throw notificationSettingsError;
    logger.info('Created user_notification_settings table');
    
    // Triggers to auto-update updated_at
    const { error: triggersError } = await supabase.rpc('run_sql_command', {
      sql_command: `
        -- Trigger for device_tokens
        CREATE OR REPLACE FUNCTION update_device_tokens_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS update_device_tokens_updated_at_trigger ON public.device_tokens;
        CREATE TRIGGER update_device_tokens_updated_at_trigger
        BEFORE UPDATE ON public.device_tokens
        FOR EACH ROW
        EXECUTE FUNCTION update_device_tokens_updated_at();

        -- Trigger for user_notification_settings
        CREATE OR REPLACE FUNCTION update_user_notification_settings_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS update_user_notification_settings_updated_at_trigger ON public.user_notification_settings;
        CREATE TRIGGER update_user_notification_settings_updated_at_trigger
        BEFORE UPDATE ON public.user_notification_settings
        FOR EACH ROW
        EXECUTE FUNCTION update_user_notification_settings_updated_at();
      `
    });
    if (triggersError) throw triggersError;
    logger.info('Created triggers for notification tables');

    logger.info('Notification tables migration completed successfully');
    return { success: true };
  } catch (error) {
    logger.error('Error in notification tables migration:', error);
    return { success: false, error };
  }
};

module.exports = { up }; 