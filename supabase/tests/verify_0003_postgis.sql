-- Script autonomo de verificacion para gpx_routes (PostGIS LINESTRING Z, GIST, CHECKs no-NaN y ADR-001)
-- Asume que 0001_init_pulsetrack_schema.sql y 0002_biometrics_ml_extensions.sql ya fueron aplicados.
-- Se ejecuta en transaccion con ROLLBACK para dejar la base intacta.

BEGIN;

DO $$
DECLARE
  v_user CONSTANT UUID := '33333333-3333-4333-8333-333333333333';
  v_route_id UUID;
  v_npoints INT;
  v_is3d BOOLEAN;
  v_len3d DOUBLE PRECISION;
  v_len_geog DOUBLE PRECISION;
  v_len2d_utm DOUBLE PRECISION;
  v_decoupling NUMERIC;
  v_index_def TEXT;
BEGIN
  -- 1. Insercion de una ruta LINESTRING Z real (Volcan Masaya) con desacople Pa:Hr
  INSERT INTO gpx_routes (
    user_id, external_id, source, title, activity_type, geom,
    distance_m, elevation_gain_m, gap_pace_sec_km, started_at, pa_hr_decoupling_pct
  ) VALUES (
    v_user, 'verify:0003:masaya', 'gpx_upload', 'Circuito Volcan Masaya', 'running',
    ST_GeomFromText('LINESTRING Z(-86.161 11.984 420, -86.158 11.987 510, -86.154 11.990 615)', 4326),
    1250.40, 195.00, 342.50, TIMESTAMPTZ '2026-11-08T12:30:00Z', 4.85
  )
  RETURNING id INTO v_route_id;

  IF v_route_id IS NULL THEN
    RAISE EXCEPTION 'FALLO: no se inserto la ruta LINESTRING Z en gpx_routes';
  END IF;
  RAISE NOTICE 'OK [1/7]: ruta LINESTRING Z insertada en gpx_routes';

  -- 2. Numero de vertices
  SELECT ST_NPoints(geom) INTO v_npoints FROM gpx_routes WHERE id = v_route_id;
  IF v_npoints IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FALLO: ST_NPoints(geom) = %, esperado 3', v_npoints;
  END IF;
  RAISE NOTICE 'OK [2/7]: ST_NPoints(geom) = 3';

  -- 3. Geometria con dimension Z (PostGIS no expone ST_Is3D; se usa ST_NDims/ST_CoordDim/ST_ZMin/ST_ZMax)
  SELECT (ST_NDims(geom) = 3 AND ST_CoordDim(geom) = 3 AND ST_ZMin(geom) = 420 AND ST_ZMax(geom) = 615)
    INTO v_is3d FROM gpx_routes WHERE id = v_route_id;
  IF v_is3d IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALLO: la geometria no es 3D (Z 420..615 esperado)';
  END IF;
  RAISE NOTICE 'OK [3/7]: geometria 3D (ST_NDims = 3, Z entre 420 y 615)';

  -- 4. Longitud 3D en metros (UTM 16N, EPSG:32616) y longitud geodesica sobre geography
  SELECT ST_3DLength(ST_Transform(geom, 32616)), ST_Length(geom::geography), ST_Length(ST_Transform(geom, 32616))
    INTO v_len3d, v_len_geog, v_len2d_utm
    FROM gpx_routes WHERE id = v_route_id;
  IF v_len3d IS NULL OR v_len3d <= 0 OR v_len_geog IS NULL OR v_len_geog <= 0 THEN
    RAISE EXCEPTION 'FALLO: longitud no positiva (3d = %, geography = %)', v_len3d, v_len_geog;
  END IF;
  IF v_len3d < v_len2d_utm THEN
    RAISE EXCEPTION 'FALLO: ST_3DLength (%) menor que la longitud 2D proyectada (%)', v_len3d, v_len2d_utm;
  END IF;
  RAISE NOTICE 'OK [4/7]: ST_3DLength = % m, ST_Length(geography) = % m', round(v_len3d::numeric, 2), round(v_len_geog::numeric, 2);

  -- 5. Indice GIST espacial
  SELECT indexdef INTO v_index_def
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'gpx_routes'
      AND indexname = 'idx_gpx_routes_geom_gist';
  IF v_index_def IS NULL THEN
    RAISE EXCEPTION 'FALLO: no existe el indice idx_gpx_routes_geom_gist';
  END IF;
  IF v_index_def NOT ILIKE '%USING gist%' THEN
    RAISE EXCEPTION 'FALLO: idx_gpx_routes_geom_gist no es GIST: %', v_index_def;
  END IF;
  RAISE NOTICE 'OK [5/7]: indice idx_gpx_routes_geom_gist (GIST) presente';

  -- 6. Rechazo NaN en pa_hr_decoupling_pct
  BEGIN
    INSERT INTO gpx_routes (
      user_id, external_id, source, title, activity_type, geom,
      distance_m, elevation_gain_m, started_at, pa_hr_decoupling_pct
    ) VALUES (
      v_user, 'verify:0003:nan', 'gpx_upload', 'Ruta NaN', 'running',
      ST_GeomFromText('LINESTRING Z(-86.161 11.984 420, -86.158 11.987 510)', 4326),
      500.00, 90.00, TIMESTAMPTZ '2026-11-09T12:30:00Z', 'NaN'::numeric
    );
    RAISE EXCEPTION 'FALLO: gpx_routes permitio pa_hr_decoupling_pct = NaN';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [6/7]: pa_hr_decoupling_pct = NaN rechazado en gpx_routes';
  END;

  -- 7. Rechazo ADR-001: apple_health prohibido en gpx_routes
  BEGIN
    INSERT INTO gpx_routes (
      user_id, external_id, source, title, activity_type, geom,
      distance_m, elevation_gain_m, started_at
    ) VALUES (
      v_user, 'verify:0003:apple', 'apple_health', 'Ruta Apple Health', 'running',
      ST_GeomFromText('LINESTRING Z(-86.161 11.984 420, -86.158 11.987 510)', 4326),
      500.00, 90.00, TIMESTAMPTZ '2026-11-10T12:30:00Z'
    );
    RAISE EXCEPTION 'FALLO: gpx_routes permitio source = apple_health';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'OK [7/7]: apple_health rechazado en gpx_routes';
  END;

  SELECT pa_hr_decoupling_pct INTO v_decoupling FROM gpx_routes WHERE id = v_route_id;
  IF v_decoupling IS DISTINCT FROM 4.85 THEN
    RAISE EXCEPTION 'FALLO: pa_hr_decoupling_pct = %, esperado 4.85', v_decoupling;
  END IF;
END
$$;

ROLLBACK;
