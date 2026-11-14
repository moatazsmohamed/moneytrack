-- MoneyTrack Stage 4 initial additive schema. Never drop or truncate application data.
CREATE TABLE IF NOT EXISTS mt_schema_migrations (
  migration_key VARCHAR(190) NOT NULL PRIMARY KEY,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_profiles (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  session_version INT NOT NULL DEFAULT 0,
  last_login_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_profiles_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_user_roles (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  role ENUM('USER','ADMIN','SUPER_ADMIN') NOT NULL DEFAULT 'USER',
  permissions_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_mt_user_roles_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  session_version INT NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_mt_sessions_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  KEY ix_mt_sessions_user (user_id),
  KEY ix_mt_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_email_tokens (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  purpose ENUM('verify_email','reset_password','change_email') NOT NULL,
  payload_json JSON NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_email_tokens_hash (token_hash),
  KEY ix_mt_email_tokens_user_purpose (user_id, purpose),
  CONSTRAINT fk_mt_email_tokens_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_user_settings (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  prefs_json JSON NOT NULL,
  notification_prefs_json JSON NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_mt_user_settings_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_categories (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name_en VARCHAR(120) NOT NULL,
  name_ar VARCHAR(120) NOT NULL,
  category_type ENUM('income','expense') NOT NULL,
  icon VARCHAR(80) NOT NULL,
  color CHAR(7) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_categories_user_id (user_id, id),
  KEY ix_mt_categories_user (user_id),
  CONSTRAINT fk_mt_categories_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  CONSTRAINT chk_mt_categories_color CHECK (color REGEXP '^#[0-9A-Fa-f]{6}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_transactions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  category_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  transaction_type ENUM('income','expense') NOT NULL,
  transaction_date DATE NOT NULL,
  description TEXT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY ix_mt_transactions_user_date (user_id, transaction_date),
  CONSTRAINT fk_mt_transactions_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_mt_transactions_category_owner FOREIGN KEY (user_id, category_id) REFERENCES mt_categories(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_mt_transactions_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_budgets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  month_key CHAR(7) NOT NULL,
  scope_key VARCHAR(36) NOT NULL,
  category_id CHAR(36) NULL,
  amount DECIMAL(16,2) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_budgets_scope (user_id, month_key, scope_key),
  KEY ix_mt_budgets_user (user_id),
  CONSTRAINT fk_mt_budgets_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_mt_budgets_category_owner FOREIGN KEY (user_id, category_id) REFERENCES mt_categories(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_mt_budgets_amount CHECK (amount >= 0),
  CONSTRAINT chk_mt_budgets_month CHECK (month_key REGEXP '^[0-9]{4}-[0-9]{2}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_savings_goals (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL,
  target_amount DECIMAL(16,2) NOT NULL,
  target_date DATE NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_savings_goals_owner_id (user_id, id),
  CONSTRAINT fk_mt_savings_goals_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  CONSTRAINT chk_mt_savings_goals_amount CHECK (target_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_goal_contributions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  goal_id CHAR(36) NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  contribution_date DATE NOT NULL,
  note VARCHAR(240) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY ix_mt_goal_contributions_goal (user_id, goal_id),
  CONSTRAINT fk_mt_goal_contributions_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_mt_goal_contributions_goal_owner FOREIGN KEY (user_id, goal_id) REFERENCES mt_savings_goals(user_id, id) ON DELETE CASCADE,
  CONSTRAINT chk_mt_goal_contributions_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_recurring_transactions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  transaction_type ENUM('income','expense') NOT NULL,
  category_id CHAR(36) NOT NULL,
  frequency ENUM('weekly','monthly','yearly') NOT NULL,
  start_date DATE NOT NULL,
  next_due_date DATE NOT NULL,
  end_date DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_recurring_transactions_owner_id (user_id, id),
  KEY ix_mt_recurring_transactions_user_active (user_id, is_active, next_due_date),
  CONSTRAINT fk_mt_recurring_transactions_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_mt_recurring_transactions_category_owner FOREIGN KEY (user_id, category_id) REFERENCES mt_categories(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_mt_recurring_transactions_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_recurring_occurrences (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  recurring_id CHAR(36) NOT NULL,
  due_date DATE NOT NULL,
  transaction_id CHAR(36) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_recurring_occurrences_date (recurring_id, due_date),
  KEY ix_mt_recurring_occurrences_user (user_id),
  CONSTRAINT fk_mt_recurring_occurrences_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_mt_recurring_occurrences_rule_owner FOREIGN KEY (user_id, recurring_id) REFERENCES mt_recurring_transactions(user_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mt_recurring_occurrences_transaction FOREIGN KEY (transaction_id) REFERENCES mt_transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  notification_type VARCHAR(40) NOT NULL,
  title_key VARCHAR(80) NOT NULL,
  body_json JSON NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  dedupe_key VARCHAR(120) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_notifications_user_dedupe (user_id, dedupe_key),
  KEY ix_mt_notifications_user_read (user_id, is_read, created_at),
  CONSTRAINT fk_mt_notifications_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_activity_logs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  actor_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  target_id CHAR(36) NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY ix_mt_activity_logs_actor_time (actor_id, created_at),
  KEY ix_mt_activity_logs_action_time (action, created_at),
  CONSTRAINT fk_mt_activity_logs_actor FOREIGN KEY (actor_id) REFERENCES mt_profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_imports (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  record_count INT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_imports_user_fingerprint (user_id, fingerprint),
  CONSTRAINT fk_mt_imports_user FOREIGN KEY (user_id) REFERENCES mt_profiles(id) ON DELETE CASCADE,
  CONSTRAINT chk_mt_imports_record_count CHECK (record_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_platform_content (
  id CHAR(36) NOT NULL PRIMARY KEY,
  content_type ENUM('faq','announcement','settings') NOT NULL,
  content_key VARCHAR(120) NOT NULL,
  data_json JSON NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_mt_platform_content_key (content_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_contact_messages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new','read') NOT NULL DEFAULT 'new',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY ix_mt_contact_messages_status_time (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mt_rate_limits (
  key_hash CHAR(64) NOT NULL PRIMARY KEY,
  hits INT NOT NULL,
  window_start DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
