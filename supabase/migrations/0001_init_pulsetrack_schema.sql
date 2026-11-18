-- PulseTrack PostgreSQL 17 Schema (Supabase + PostGIS + pgvector)
-- ADR-001: Autoridad unica anti-duplicados (sin Apple Health)

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. oauth_vault
CREATE TABLE IF NOT EXISTS oauth_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  access_token_enc BYTEA NOT NULL,
  refresh_token_enc BYTEA,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_oauth_vault_user_provider UNIQUE (user_id, provider),
  CONSTRAINT chk_oauth_vault_provider CHECK (provider IN ('garmin', 'renpho', 'hevy'))
);

-- 2. daily_biometrics (Autoridad unica: Garmin)
CREATE TABLE IF NOT EXISTS daily_biometrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'garmin',
  active_kcal INT NOT NULL DEFAULT 0,
  resting_kcal INT NOT NULL DEFAULT 0,
  sleep_minutes INT NOT NULL DEFAULT 0,
  hrv_ms NUMERIC(6, 2),
  resting_hr INT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_biometrics_user_date UNIQUE (user_id, date),
  CONSTRAINT chk_daily_biometrics_source CHECK (
    source = 'garmin'
    AND active_kcal >= 0
    AND resting_kcal >= 0
    AND sleep_minutes >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_daily_biometrics_user_date
  ON daily_biometrics (user_id, date DESC);

-- 3. body_composition (Autoridad: RENPHO -> Garmin)
CREATE TABLE IF NOT EXISTS body_composition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  weight_kg NUMERIC(5, 2) NOT NULL,
  body_fat_pct NUMERIC(5, 2),
  muscle_mass_kg NUMERIC(5, 2),
  synced_to_garmin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_body_composition_user_ts_source UNIQUE (user_id, measured_at, source),
  CONSTRAINT chk_body_composition_source CHECK (
    source IN ('renpho', 'garmin')
    AND weight_kg > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_body_composition_user_measured
  ON body_composition (user_id, measured_at DESC);

-- 4. strength (catalog / sessions / sets con garmin_step_note)
CREATE TABLE IF NOT EXISTS strength_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  muscle_group TEXT,
  equipment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_strength_catalog_user_ext UNIQUE (user_id, external_id)
);

CREATE TABLE IF NOT EXISTS strength_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  total_volume_kg NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_strength_sessions_user_ext UNIQUE (user_id, external_id),
  CONSTRAINT chk_strength_sessions_source CHECK (
    source IN ('hevy', 'pulsetrack')
    AND total_volume_kg >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_strength_sessions_user_started
  ON strength_sessions (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS strength_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES strength_sessions(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES strength_catalog(id) ON DELETE RESTRICT,
  set_index INT NOT NULL,
  weight_kg NUMERIC(6, 2) NOT NULL DEFAULT 0,
  reps INT NOT NULL,
  rpe NUMERIC(3, 1),
  garmin_step_note TEXT,
  CONSTRAINT uq_strength_sets_session_ex_idx UNIQUE (session_id, exercise_id, set_index),
  CONSTRAINT chk_strength_sets_values CHECK (
    set_index >= 0
    AND reps > 0
    AND weight_kg >= 0
  )
);

-- 5. gpx_routes (LineStringZ + GIST + GAP)
CREATE TABLE IF NOT EXISTS gpx_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  source TEXT NOT NULL,
  geom geometry(LineStringZ, 4326) NOT NULL,
  distance_m NUMERIC(10, 2) NOT NULL,
  elevation_gain_m NUMERIC(8, 2) NOT NULL DEFAULT 0,
  gap_pace_sec_km NUMERIC(7, 2),
  started_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_gpx_routes_user_ext UNIQUE (user_id, external_id),
  CONSTRAINT chk_gpx_routes_source CHECK (
    source IN ('garmin', 'gpx_upload')
    AND distance_m >= 0
    AND elevation_gain_m >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_gpx_routes_geom_gist
  ON gpx_routes USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_gpx_routes_user_started
  ON gpx_routes (user_id, started_at DESC);

-- 6. nutrition_logs (portion_templates + vector 768 + HNSW)
CREATE TABLE IF NOT EXISTS nutrition_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL,
  meal_slot TEXT NOT NULL,
  food_name TEXT NOT NULL,
  portion_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
  kcal NUMERIC(7, 2) NOT NULL,
  protein_g NUMERIC(6, 2) NOT NULL DEFAULT 0,
  carbs_g NUMERIC(6, 2) NOT NULL DEFAULT 0,
  fat_g NUMERIC(6, 2) NOT NULL DEFAULT 0,
  embedding vector(768),
  source TEXT NOT NULL DEFAULT 'pulsetrack',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_nutrition_logs_user_ts_food_slot UNIQUE (user_id, logged_at, food_name, meal_slot),
  CONSTRAINT chk_nutrition_logs_source CHECK (
    source = 'pulsetrack'
    AND kcal >= 0
    AND protein_g >= 0
    AND carbs_g >= 0
    AND fat_g >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_user_logged
  ON nutrition_logs (user_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_embedding_hnsw
  ON nutrition_logs USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 7. ai_predictions (shap_breakdown JSONB + ACWR)
CREATE TABLE IF NOT EXISTS ai_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  target_date DATE NOT NULL,
  model_version TEXT NOT NULL,
  readiness_score NUMERIC(5, 2) NOT NULL,
  acwr NUMERIC(5, 3) NOT NULL,
  shap_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_predictions_user_date_model UNIQUE (user_id, target_date, model_version),
  CONSTRAINT chk_ai_predictions_bounds CHECK (
    readiness_score BETWEEN 0 AND 100
    AND acwr >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_user_date
  ON ai_predictions (user_id, target_date DESC);

-- 8. ai_telemetry_logs
CREATE TABLE IF NOT EXISTS ai_telemetry_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  request_id UUID NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  latency_ms INT NOT NULL,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_telemetry_logs_request UNIQUE (request_id),
  CONSTRAINT chk_ai_telemetry_logs_provider CHECK (
    provider IN ('onnx_local', 'workers_ai', 'nim', 'gemini')
    AND latency_ms >= 0
    AND tokens_in >= 0
    AND tokens_out >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_telemetry_logs_user_created
  ON ai_telemetry_logs (user_id, created_at DESC);

-- Row Level Security (RLS)
ALTER TABLE oauth_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_biometrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_composition ENABLE ROW LEVEL SECURITY;
ALTER TABLE strength_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE strength_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strength_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpx_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_telemetry_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_oauth_vault_owner ON oauth_vault
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY p_daily_biometrics_owner ON daily_biometrics
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY p_body_composition_owner ON body_composition
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY p_strength_catalog_owner ON strength_catalog
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY p_strength_sessions_owner ON strength_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY p_strength_sets_owner ON strength_sets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM strength_sessions s
      WHERE s.id = strength_sets.session_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM strength_sessions s
      WHERE s.id = strength_sets.session_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY p_gpx_routes_owner ON gpx_routes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY p_nutrition_logs_owner ON nutrition_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY p_ai_predictions_owner ON ai_predictions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY p_ai_telemetry_logs_owner ON ai_telemetry_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
