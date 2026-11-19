-- Script autonomo de verificacion para migracion 0002 (RLS granular, ADR-001, CHECKs no-NaN y OpenRouter)
-- Asume que 0001_init_pulsetrack_schema.sql y 0002_biometrics_ml_extensions.sql ya fueron aplicados.
-- Se ejecuta en transaccion con ROLLBACK para dejar la base intacta.

BEGIN;

DO $$
DECLARE
  v_user_a CONSTANT UUID := '11111111-1111-4111-8111-111111111111';
  v_user_b CONSTANT UUID := '22222222-2222-4222-8222-222222222222';
  v_rows INT;
  v_energy SMALLINT;
  v_soreness SMALLINT;
  v_mood SMALLINT;
  v_req_id UUID := gen_random_uuid();
BEGIN
  -- Semilla base como service_role para ambos usuarios
  INSERT INTO daily_biometrics (
    user_id, date, source, active_kcal, resting_kcal, sleep_minutes,
    hrv_ms, resting_hr, sleep_score, body_battery, stress_avg,
    camp_temp_c, camp_pressure_hpa, weather_temp_c, weather_humidity_pct
  ) VALUES
    (v_user_a, DATE '2026-11-18', 'garmin', 620, 1780, 462, 68.50, 51, 88, 82, 24, 18.40, 1012.50, 27.20, 64.00),
    (v_user_b, DATE '2026-11-18', 'garmin', 510, 1720, 430, 61.00, 54, 81, 75, 29, 19.10, 1011.80, 27.20, 64.00);

  INSERT INTO body_composition (
    user_id, measured_at, source, weight_kg, body_fat_pct, muscle_mass_kg,
    water_pct, visceral_fat, bmr_kcal, synced_to_garmin
  ) VALUES
    (v_user_a, TIMESTAMPTZ '2026-11-18T06:35:00Z', 'renpho', 76.40, 14.80, 61.70, 60.40, 6, 1795, true),
    (v_user_b, TIMESTAMPTZ '2026-11-18T06:40:00Z', 'renpho', 82.10, 18.20, 63.00, 58.10, 8, 1840, true);

  -- 1. Rechazo ADR-001: apple_health prohibido en daily_biometrics
  BEGIN
    INSERT INTO daily_biometrics (user_id, date, source, active_kcal, resting_kcal, sleep_minutes)
    VALUES (v_user_a, DATE '2026-11-19', 'apple_health', 400, 1700, 420);
    RAISE EXCEPTION 'FALLO: daily_biometrics permitio source = apple_health';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [1/7]: apple_health rechazado en daily_biometrics';
  END;

  -- 2. Rechazo NaN en columnas numericas de 0002
  BEGIN
    INSERT INTO daily_biometrics (
      user_id, date, source, active_kcal, resting_kcal, sleep_minutes, camp_temp_c
    ) VALUES (
      v_user_a, DATE '2026-11-19', 'garmin', 400, 1700, 420, 'NaN'::numeric
    );
    RAISE EXCEPTION 'FALLO: daily_biometrics permitio camp_temp_c = NaN';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [2/7]: NaN rechazado en daily_biometrics.camp_temp_c';
  END;

  BEGIN
    INSERT INTO ai_predictions (
      user_id, target_date, model_version, readiness_score, acwr, strain_score, anomaly_mse
    ) VALUES (
      v_user_a, DATE '2026-11-18', 'v2-test', 85.00, 1.050, 'NaN'::numeric, 0.001000
    );
    RAISE EXCEPTION 'FALLO: ai_predictions permitio strain_score = NaN';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [2b/7]: NaN rechazado en ai_predictions.strain_score';
  END;

  -- Cambiar contexto a rol authenticated como user_a
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 3. UPDATE permitido sobre columnas subjetivas en fila propia
  UPDATE daily_biometrics
  SET subj_energy = 4,
      subj_soreness = 2,
      subj_mood = 5,
      updated_at = now()
  WHERE user_id = v_user_a AND date = DATE '2026-11-18';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FALLO: esperado 1 fila actualizada para user_a, obtenido %', v_rows;
  END IF;

  SELECT subj_energy, subj_soreness, subj_mood
  INTO v_energy, v_soreness, v_mood
  FROM daily_biometrics
  WHERE user_id = v_user_a AND date = DATE '2026-11-18';

  IF v_energy <> 4 OR v_soreness <> 2 OR v_mood <> 5 THEN
    RAISE EXCEPTION 'FALLO: valores subjetivos no persistidos correctamente (%, %, %)', v_energy, v_soreness, v_mood;
  END IF;
  RAISE NOTICE 'OK [3/7]: UPDATE subjetivo permitido para authenticated en fila propia';

  -- 4. Rechazo de rango subjetivo fuera de 1..5
  BEGIN
    UPDATE daily_biometrics
    SET subj_energy = 6
    WHERE user_id = v_user_a AND date = DATE '2026-11-18';
    RAISE EXCEPTION 'FALLO: subj_energy = 6 debio fallar por CHECK 1..5';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [4/7]: subj_energy fuera de rango rechazado';
  END;

  -- 5. Error permission denied al intentar UPDATE de columna Garmin (active_kcal) como authenticated
  BEGIN
    UPDATE daily_biometrics
    SET active_kcal = 999
    WHERE user_id = v_user_a AND date = DATE '2026-11-18';
    RAISE EXCEPTION 'FALLO: authenticated pudo actualizar daily_biometrics.active_kcal';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK [5/7]: permission denied al intentar UPDATE active_kcal como authenticated';
  END;

  -- 6. 0 filas afectadas al intentar UPDATE subjetivo sobre otro user_id
  UPDATE daily_biometrics
  SET subj_energy = 5,
      subj_soreness = 1,
      subj_mood = 5
  WHERE user_id = v_user_b AND date = DATE '2026-11-18';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'FALLO: RLS permitio actualizar % filas de otro usuario', v_rows;
  END IF;
  RAISE NOTICE 'OK [6/7]: 0 filas afectadas al intentar UPDATE sobre otro user_id';

  -- 6b. Bloqueo ADR-001 en body_composition para authenticated (solo SELECT propio)
  SELECT COUNT(*) INTO v_rows FROM body_composition;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FALLO: SELECT en body_composition para user_a debio ver 1 fila, obtuvo %', v_rows;
  END IF;

  BEGIN
    INSERT INTO body_composition (
      user_id, measured_at, source, weight_kg
    ) VALUES (
      v_user_a, TIMESTAMPTZ '2026-11-19T06:35:00Z', 'renpho', 76.00
    );
    RAISE EXCEPTION 'FALLO: authenticated pudo insertar en body_composition';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'OK [6b/7]: INSERT en body_composition bloqueado para authenticated (ADR-001)';
  END;

  EXECUTE 'RESET ROLE';

  -- 7. INSERT con provider = openrouter en ai_telemetry_logs y rechazo de status_code invalido
  INSERT INTO ai_telemetry_logs (
    user_id, request_id, provider, model_name, latency_ms,
    tokens_in, tokens_out, status, fallback_used, status_code
  ) VALUES (
    v_user_a, v_req_id, 'openrouter', 'meta-llama/llama-3.3-70b-instruct',
    315, 420, 128, 'ok', true, 200
  );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'FALLO: INSERT openrouter en ai_telemetry_logs no inserto fila';
  END IF;
  RAISE NOTICE 'OK [7/7]: INSERT con provider = openrouter aceptado en ai_telemetry_logs';

  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, gen_random_uuid(), 'openrouter', 'meta-llama/llama-3.3-70b-instruct',
      100, 10, 10, 'error', true, 999
    );
    RAISE EXCEPTION 'FALLO: ai_telemetry_logs permitio status_code = 999';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [7b/7]: status_code fuera de 100..599 rechazado en ai_telemetry_logs';
  END;
END $$;

ROLLBACK;
