-- Ejecuta despues de las migraciones 0001 y 0002.
BEGIN;

-- Habilita las operaciones de prueba en instalaciones sin permisos de Supabase.
GRANT SELECT, INSERT, UPDATE, DELETE ON nutrition_logs, ai_predictions TO authenticated;

DO $$
DECLARE
  user_a CONSTANT uuid := gen_random_uuid();
  user_b CONSTANT uuid := gen_random_uuid();
  test_date CONSTANT date := DATE '2026-11-18';
  model_version_name CONSTANT text := 'v1.0.0-mlp14x64x32x1';
  rice CONSTANT vector(768) := array_prepend(1::real, array_fill(0::real, ARRAY[767]))::vector(768);
  water CONSTANT vector(768) := (ARRAY[0, 1]::real[] || array_fill(0::real, ARRAY[766]))::vector(768);
  food text;
  distance double precision;
  hits integer;
  found_constraint text;
  invalid_row record;
  shap CONSTANT jsonb := '{"baseScore":80,"predictedScore":72,"contributions":[]}'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'nutrition_logs'::regclass AND attname = 'embedding'
      AND atttypid = 'vector'::regtype AND atttypmod = 768 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'FALLO [1/7]: embedding debe ser vector(768)';
  END IF;
  INSERT INTO nutrition_logs (user_id, logged_at, meal_slot, food_name, kcal, embedding)
  VALUES
    (user_a, test_date, 'almuerzo', 'Arroz con pollo', 565, rice),
    (user_a, test_date, 'snack', 'Agua isotonica', 90, water),
    (user_b, test_date, 'almuerzo', 'Arroz con pollo', 565, rice);
  RAISE NOTICE 'OK [1/7]: columnas y registros vector(768)';

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_am am ON am.oid = idx.relam
    JOIN pg_opclass op ON op.oid = i.indclass[0]
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'nutrition_logs'::regclass
      AND idx.relname = 'idx_nutrition_logs_embedding_hnsw'
      AND am.amname = 'hnsw' AND op.opcname = 'vector_cosine_ops'
      AND a.attname = 'embedding' AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'FALLO [2/7]: falta el indice HNSW de coseno';
  END IF;
  SELECT food_name, embedding <=> rice INTO food, distance
  FROM nutrition_logs WHERE user_id = user_a
  ORDER BY embedding <=> rice LIMIT 1;
  IF food IS DISTINCT FROM 'Arroz con pollo' OR distance IS DISTINCT FROM 0 OR (rice <=> water) <> 1 THEN
    RAISE EXCEPTION 'FALLO [2/7]: el operador <=> no ordeno los vectores';
  END IF;
  RAISE NOTICE 'OK [2/7]: busqueda por coseno e indice HNSW';

  BEGIN
    INSERT INTO nutrition_logs (user_id, logged_at, meal_slot, food_name, kcal, source)
    VALUES (user_a, test_date, 'cena', 'Fuente prohibida', 500, 'apple_health');
    RAISE EXCEPTION 'FALLO [3/7]: apple_health aceptado';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS found_constraint = CONSTRAINT_NAME;
    IF found_constraint <> 'chk_nutrition_logs_source' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'OK [3/7]: chk_nutrition_logs_source rechaza apple_health';

  INSERT INTO ai_predictions (
    user_id, target_date, model_version, readiness_score, acwr, strain_score, anomaly_mse, shap_breakdown
  ) VALUES
    (user_a, test_date, model_version_name, 72, 1.16, 10.75, 0.091, shap),
    (user_b, test_date, model_version_name, 80, 0.85, 7.25, 0.01, shap);
  IF NOT EXISTS (
    SELECT 1 FROM ai_predictions WHERE user_id = user_a AND target_date = test_date
      AND strain_score = 10.75 AND anomaly_mse = 0.091 AND shap_breakdown = shap
      AND jsonb_typeof(shap_breakdown -> 'contributions') = 'array'
  ) THEN
    RAISE EXCEPTION 'FALLO [4/7]: no se conservaron strain_score, anomaly_mse y shap_breakdown';
  END IF;
  RAISE NOTICE 'OK [4/7]: extensiones y SHAP en ai_predictions';

  FOR invalid_row IN SELECT * FROM (VALUES
    (101::numeric, 1::numeric, 10::numeric, 0.05::numeric, 'chk_ai_predictions_bounds'),
    (72, -1, 10, 0.05, 'chk_ai_predictions_bounds'),
    (72, 1, 22, 0.05, 'chk_ai_predictions_extensions'),
    (72, 1, 10, -0.05, 'chk_ai_predictions_extensions'),
    (72, 1, 10, 'NaN'::numeric, 'chk_ai_predictions_extensions')
  ) AS invalid(readiness, acwr, strain, mse, constraint_name) LOOP
    BEGIN
      INSERT INTO ai_predictions (
        user_id, target_date, model_version, readiness_score, acwr, strain_score, anomaly_mse
      ) VALUES (
        user_a, test_date, 'prueba-limites', invalid_row.readiness, invalid_row.acwr, invalid_row.strain, invalid_row.mse
      );
      RAISE EXCEPTION 'FALLO [5/7]: limites aceptaron un valor invalido';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS found_constraint = CONSTRAINT_NAME;
      IF found_constraint <> invalid_row.constraint_name THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE NOTICE 'OK [5/7]: chk_ai_predictions_bounds y chk_ai_predictions_extensions';

  BEGIN
    INSERT INTO ai_predictions (user_id, target_date, model_version, readiness_score, acwr)
    VALUES (user_a, test_date, model_version_name, 70, 1);
    RAISE EXCEPTION 'FALLO [6/7]: se acepto una prediccion duplicada';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS found_constraint = CONSTRAINT_NAME;
    IF found_constraint <> 'uq_ai_predictions_user_date_model' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'OK [6/7]: uq_ai_predictions_user_date_model';

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', user_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  IF (SELECT count(*) FROM nutrition_logs WHERE user_id IN (user_a, user_b)) <> 2
    OR (SELECT count(*) FROM ai_predictions WHERE user_id IN (user_a, user_b)) <> 1
    OR EXISTS (SELECT 1 FROM nutrition_logs WHERE user_id = user_b)
    OR EXISTS (SELECT 1 FROM ai_predictions WHERE user_id = user_b) THEN
    RAISE EXCEPTION 'FALLO [7/7]: lecturas de user_a no aisladas';
  END IF;
  INSERT INTO nutrition_logs (user_id, logged_at, meal_slot, food_name, kcal)
  VALUES (user_a, test_date, 'cena', 'Cena propia', 475);
  INSERT INTO ai_predictions (user_id, target_date, model_version, readiness_score, acwr)
  VALUES (user_a, test_date + 1, model_version_name, 79, 1);
  BEGIN
    INSERT INTO nutrition_logs (user_id, logged_at, meal_slot, food_name, kcal)
    VALUES (user_b, test_date, 'cena', 'Registro ajeno', 475);
    RAISE EXCEPTION 'FALLO [7/7]: insercion ajena en nutrition_logs';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO ai_predictions (user_id, target_date, model_version, readiness_score, acwr)
    VALUES (user_b, test_date + 1, model_version_name, 79, 1);
    RAISE EXCEPTION 'FALLO [7/7]: insercion ajena en ai_predictions';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE ai_predictions SET readiness_score = 0 WHERE user_id = user_b;
  GET DIAGNOSTICS hits = ROW_COUNT;
  IF hits <> 0 THEN RAISE EXCEPTION 'FALLO [7/7]: actualizacion ajena'; END IF;
  DELETE FROM nutrition_logs WHERE user_id = user_b;
  GET DIAGNOSTICS hits = ROW_COUNT;
  IF hits <> 0 THEN RAISE EXCEPTION 'FALLO [7/7]: borrado ajeno'; END IF;

  PERFORM set_config('request.jwt.claim.sub', user_b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  IF (SELECT count(*) FROM nutrition_logs WHERE user_id IN (user_a, user_b)) <> 1
    OR (SELECT count(*) FROM ai_predictions WHERE user_id IN (user_a, user_b)) <> 1
    OR EXISTS (SELECT 1 FROM nutrition_logs WHERE user_id = user_a)
    OR EXISTS (SELECT 1 FROM ai_predictions WHERE user_id = user_a) THEN
    RAISE EXCEPTION 'FALLO [7/7]: lecturas de user_b no aisladas';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'OK [7/7]: aislamiento RLS entre user_a y user_b';
END
$$;

ROLLBACK;
