-- PulseTrack PostgreSQL 17 Migration 0002
-- Extensiones biometricas/ML, telemetria OpenRouter y RLS granular subjetiva (ADR-001)

BEGIN;

-- 1. daily_biometrics: metricas extendidas, contexto ambiental y check-in subjetivo
ALTER TABLE daily_biometrics
  ADD COLUMN IF NOT EXISTS sleep_score INT,
  ADD COLUMN IF NOT EXISTS body_battery INT,
  ADD COLUMN IF NOT EXISTS stress_avg INT,
  ADD COLUMN IF NOT EXISTS camp_temp_c NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS camp_pressure_hpa NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS weather_temp_c NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS weather_humidity_pct NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS subj_energy SMALLINT,
  ADD COLUMN IF NOT EXISTS subj_soreness SMALLINT,
  ADD COLUMN IF NOT EXISTS subj_mood SMALLINT;

ALTER TABLE daily_biometrics
  DROP CONSTRAINT IF EXISTS chk_daily_biometrics_ml_extensions;

ALTER TABLE daily_biometrics
  ADD CONSTRAINT chk_daily_biometrics_ml_extensions CHECK (
    (sleep_score IS NULL OR sleep_score BETWEEN 0 AND 100)
    AND (body_battery IS NULL OR body_battery BETWEEN 0 AND 100)
    AND (stress_avg IS NULL OR stress_avg BETWEEN 0 AND 100)
    AND (camp_temp_c IS NULL OR (camp_temp_c BETWEEN -90 AND 90 AND camp_temp_c <> 'NaN'::numeric))
    AND (camp_pressure_hpa IS NULL OR (camp_pressure_hpa BETWEEN 300 AND 1100 AND camp_pressure_hpa <> 'NaN'::numeric))
    AND (weather_temp_c IS NULL OR (weather_temp_c BETWEEN -90 AND 90 AND weather_temp_c <> 'NaN'::numeric))
    AND (weather_humidity_pct IS NULL OR (weather_humidity_pct BETWEEN 0 AND 100 AND weather_humidity_pct <> 'NaN'::numeric))
    AND (subj_energy IS NULL OR subj_energy BETWEEN 1 AND 5)
    AND (subj_soreness IS NULL OR subj_soreness BETWEEN 1 AND 5)
    AND (subj_mood IS NULL OR subj_mood BETWEEN 1 AND 5)
  );

-- RLS granular en daily_biometrics: escritura Garmin solo service_role; check-in subjetivo para authenticated
REVOKE INSERT, UPDATE, DELETE ON daily_biometrics FROM authenticated, anon;
GRANT SELECT ON daily_biometrics TO authenticated;
GRANT UPDATE (subj_energy, subj_soreness, subj_mood, updated_at) ON daily_biometrics TO authenticated;

DROP POLICY IF EXISTS p_daily_biometrics_update_subjective ON daily_biometrics;
CREATE POLICY p_daily_biometrics_update_subjective ON daily_biometrics
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. body_composition: hidratacion, grasa visceral y TMB
ALTER TABLE body_composition
  ADD COLUMN IF NOT EXISTS water_pct NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS visceral_fat SMALLINT,
  ADD COLUMN IF NOT EXISTS bmr_kcal INT;

ALTER TABLE body_composition
  DROP CONSTRAINT IF EXISTS chk_body_composition_extensions;

ALTER TABLE body_composition
  ADD CONSTRAINT chk_body_composition_extensions CHECK (
    (water_pct IS NULL OR (water_pct BETWEEN 0 AND 100 AND water_pct <> 'NaN'::numeric))
    AND (visceral_fat IS NULL OR visceral_fat BETWEEN 0 AND 60)
    AND (bmr_kcal IS NULL OR bmr_kcal > 0)
  );

-- 3. gpx_routes: metadatos de ruta y desacople aerobico Pa:Hr
ALTER TABLE gpx_routes
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS activity_type TEXT,
  ADD COLUMN IF NOT EXISTS pa_hr_decoupling_pct NUMERIC(5, 2);

ALTER TABLE gpx_routes
  DROP CONSTRAINT IF EXISTS chk_gpx_routes_extensions;

ALTER TABLE gpx_routes
  ADD CONSTRAINT chk_gpx_routes_extensions CHECK (
    pa_hr_decoupling_pct IS NULL
    OR (pa_hr_decoupling_pct BETWEEN -100 AND 100 AND pa_hr_decoupling_pct <> 'NaN'::numeric)
  );

-- 4. ai_predictions: indice de esfuerzo y error MSE de anomalias
ALTER TABLE ai_predictions
  ADD COLUMN IF NOT EXISTS strain_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS anomaly_mse NUMERIC(10, 6);

ALTER TABLE ai_predictions
  DROP CONSTRAINT IF EXISTS chk_ai_predictions_extensions;

ALTER TABLE ai_predictions
  ADD CONSTRAINT chk_ai_predictions_extensions CHECK (
    (strain_score IS NULL OR (strain_score BETWEEN 0 AND 21 AND strain_score <> 'NaN'::numeric))
    AND (anomaly_mse IS NULL OR (anomaly_mse >= 0 AND anomaly_mse <> 'NaN'::numeric))
  );

-- 5. ai_telemetry_logs: proveedor openrouter, bandera de fallback y codigo HTTP
ALTER TABLE ai_telemetry_logs
  ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_code INT NOT NULL DEFAULT 200;

ALTER TABLE ai_telemetry_logs
  DROP CONSTRAINT IF EXISTS chk_ai_telemetry_logs_provider;

ALTER TABLE ai_telemetry_logs
  ADD CONSTRAINT chk_ai_telemetry_logs_provider CHECK (
    provider IN ('onnx_local', 'workers_ai', 'nim', 'gemini', 'openrouter')
    AND latency_ms >= 0
    AND tokens_in >= 0
    AND tokens_out >= 0
  );

ALTER TABLE ai_telemetry_logs
  DROP CONSTRAINT IF EXISTS chk_ai_telemetry_logs_status_code;

ALTER TABLE ai_telemetry_logs
  ADD CONSTRAINT chk_ai_telemetry_logs_status_code CHECK (
    status_code BETWEEN 100 AND 599
  );

COMMIT;
