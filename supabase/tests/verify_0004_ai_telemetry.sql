-- Script autonomo de verificacion para ai_telemetry_logs (Sprint 4 - Issue #4)
-- Asume que 0001_init_pulsetrack_schema.sql y 0002_biometrics_ml_extensions.sql ya fueron aplicados.
-- Se ejecuta en transaccion con ROLLBACK para dejar la base intacta.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_telemetry_logs TO authenticated;

DO $$
DECLARE
  v_user_a CONSTANT UUID := '44444444-4444-4444-8444-444444444441';
  v_user_b CONSTANT UUID := '44444444-4444-4444-8444-444444444442';
  v_req_onnx CONSTANT UUID := '55555555-5555-4555-8555-555555555501';
  v_req_workers CONSTANT UUID := '55555555-5555-4555-8555-555555555502';
  v_req_nim CONSTANT UUID := '55555555-5555-4555-8555-555555555503';
  v_req_gemini CONSTANT UUID := '55555555-5555-4555-8555-555555555504';
  v_req_openrouter CONSTANT UUID := '55555555-5555-4555-8555-555555555505';
  v_req_user_b CONSTANT UUID := '55555555-5555-4555-8555-555555555506';
  v_count INT;
  v_index_def TEXT;
BEGIN
  -- [1/7] Insercion valida para los 5 proveedores con fallback_used y status_code
  INSERT INTO ai_telemetry_logs (
    user_id, request_id, provider, model_name, latency_ms,
    tokens_in, tokens_out, status, fallback_used, status_code
  ) VALUES
    (v_user_a, v_req_onnx, 'onnx_local', 'pulsetrack-readiness-mlp-v1.onnx', 1, 14, 6, 'ok', false, 200),
    (v_user_a, v_req_workers, 'workers_ai', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 132, 280, 118, 'ok', false, 200),
    (v_user_a, v_req_nim, 'nim', 'nvidia/nemotron-3-ultra-550b-a55b', 318, 640, 260, 'ok', false, 200),
    (v_user_a, v_req_gemini, 'gemini', 'gemini-2.5-flash-lite', 248, 510, 175, 'ok', false, 200),
    (v_user_a, v_req_openrouter, 'openrouter', 'openrouter/free', 410, 310, 145, 'fallback', true, 200),
    (v_user_b, v_req_user_b, 'workers_ai', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 140, 200, 90, 'ok', false, 200);

  SELECT COUNT(*) INTO v_count
  FROM ai_telemetry_logs
  WHERE user_id = v_user_a;

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FALLO [1/7]: se esperaban 5 registros para user_a, obtenido %', v_count;
  END IF;
  RAISE NOTICE 'OK [1/7]: insercion valida en ai_telemetry_logs para los 5 proveedores (onnx_local, workers_ai, nim, gemini, openrouter)';

  -- [2/7] Rechazo de proveedor invalido ('apple_health' y 'openai') por chk_ai_telemetry_logs_provider
  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, gen_random_uuid(), 'apple_health', 'healthkit-v1', 10, 10, 10, 'error', false, 403
    );
    RAISE EXCEPTION 'FALLO [2/7]: ai_telemetry_logs permitio provider = apple_health';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, gen_random_uuid(), 'openai', 'gpt-4o', 100, 50, 50, 'ok', false, 200
    );
    RAISE EXCEPTION 'FALLO [2/7]: ai_telemetry_logs permitio provider = openai';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [2/7]: proveedores invalidos (apple_health y openai) rechazados por chk_ai_telemetry_logs_provider';
  END;

  -- [3/7] Rechazo de latency_ms < 0, tokens_in < 0 o tokens_out < 0
  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, gen_random_uuid(), 'workers_ai', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', -1, 10, 10, 'ok', false, 200
    );
    RAISE EXCEPTION 'FALLO [3/7]: ai_telemetry_logs permitio latency_ms < 0';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, gen_random_uuid(), 'workers_ai', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 10, -1, 10, 'ok', false, 200
    );
    RAISE EXCEPTION 'FALLO [3/7]: ai_telemetry_logs permitio tokens_in < 0';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, gen_random_uuid(), 'workers_ai', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 10, 10, -1, 'ok', false, 200
    );
    RAISE EXCEPTION 'FALLO [3/7]: ai_telemetry_logs permitio tokens_out < 0';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [3/7]: valores negativos en latency_ms, tokens_in y tokens_out rechazados';
  END;

  -- [4/7] Rechazo de status_code fuera de 100..599 (99 y 600) por chk_ai_telemetry_logs_status_code
  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, gen_random_uuid(), 'nim', 'nvidia/nemotron-3-ultra-550b-a55b', 100, 20, 20, 'error', false, 99
    );
    RAISE EXCEPTION 'FALLO [4/7]: ai_telemetry_logs permitio status_code = 99';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, gen_random_uuid(), 'nim', 'nvidia/nemotron-3-ultra-550b-a55b', 100, 20, 20, 'error', false, 600
    );
    RAISE EXCEPTION 'FALLO [4/7]: ai_telemetry_logs permitio status_code = 600';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [4/7]: status_code fuera de 100..599 (99 y 600) rechazado por chk_ai_telemetry_logs_status_code';
  END;

  -- [5/7] Unicidad uq_ai_telemetry_logs_request sobre request_id
  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_a, v_req_nim, 'nim', 'nvidia/nemotron-3-ultra-550b-a55b', 300, 100, 50, 'ok', false, 200
    );
    RAISE EXCEPTION 'FALLO [5/7]: ai_telemetry_logs permitio request_id duplicado';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'OK [5/7]: unicidad uq_ai_telemetry_logs_request sobre request_id verificada';
  END;

  -- [6/7] Existencia del indice idx_ai_telemetry_logs_user_created en pg_indexes
  SELECT indexdef INTO v_index_def
  FROM pg_indexes
  WHERE schemaname = current_schema()
    AND tablename = 'ai_telemetry_logs'
    AND indexname = 'idx_ai_telemetry_logs_user_created';

  IF v_index_def IS NULL THEN
    RAISE EXCEPTION 'FALLO [6/7]: no existe el indice idx_ai_telemetry_logs_user_created';
  END IF;
  RAISE NOTICE 'OK [6/7]: indice idx_ai_telemetry_logs_user_created presente en pg_indexes';

  -- [7/7] Aislamiento RLS en ai_telemetry_logs entre dos usuarios autenticados
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT COUNT(*) INTO v_count FROM ai_telemetry_logs;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FALLO [7/7]: user_a debio ver 5 filas propias por RLS, vio %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM ai_telemetry_logs WHERE user_id = v_user_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALLO [7/7]: user_a vio % filas de user_b', v_count;
  END IF;

  BEGIN
    INSERT INTO ai_telemetry_logs (
      user_id, request_id, provider, model_name, latency_ms,
      tokens_in, tokens_out, status, fallback_used, status_code
    ) VALUES (
      v_user_b, gen_random_uuid(), 'gemini', 'gemini-2.5-flash-lite', 150, 40, 20, 'ok', false, 200
    );
    RAISE EXCEPTION 'FALLO [7/7]: RLS permitio a user_a insertar fila a nombre de user_b';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text,
    true
  );

  SELECT COUNT(*) INTO v_count FROM ai_telemetry_logs;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FALLO [7/7]: user_b debio ver 1 fila propia por RLS, vio %', v_count;
  END IF;

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'OK [7/7]: aislamiento RLS en ai_telemetry_logs verificado entre user_a y user_b';
END
$$;

ROLLBACK;
