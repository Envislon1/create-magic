CREATE OR REPLACE FUNCTION public.device_sync_get(_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device_record public.devices%ROWTYPE;
  med_record public.medication_schedules%ROWTYPE;
  sos_record record;
  ota_payload jsonb := NULL;
BEGIN
  SELECT * INTO device_record
  FROM public.devices
  WHERE pairing_code = upper(trim(_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'unknown device', 'status', 404);
  END IF;

  UPDATE public.devices
  SET last_seen_at = now()
  WHERE id = device_record.id;

  SELECT * INTO med_record
  FROM public.medication_schedules
  WHERE user_id = device_record.user_id
  ORDER BY enabled DESC, hour ASC, minute ASC, created_at ASC
  LIMIT 1;

  SELECT id, source INTO sos_record
  FROM public.sos_events
  WHERE user_id = device_record.user_id
    AND status <> 'resolved'
  ORDER BY created_at DESC
  LIMIT 1;

  IF device_record.ota_consumed_at IS NULL AND device_record.ota_url IS NOT NULL THEN
    ota_payload := jsonb_build_object(
      'url', device_record.ota_url,
      'version', COALESCE(device_record.ota_version, ''),
      'requested_at', device_record.ota_requested_at,
      'uploaded_at', device_record.ota_uploaded_at
    );
  END IF;

  RETURN jsonb_build_object(
    'mode', COALESCE(device_record.current_mode, 'ANXIETY'),
    'med', CASE WHEN med_record.id IS NULL THEN
      jsonb_build_object('hour', 20, 'minute', 0, 'enabled', false)
    ELSE
      jsonb_build_object('hour', med_record.hour, 'minute', med_record.minute, 'enabled', med_record.enabled)
    END,
    'sos_active', sos_record.id IS NOT NULL,
    'sos_id', sos_record.id,
    'sos_source', sos_record.source,
    'caregiver_email', COALESCE(device_record.caregiver_email, ''),
    'ota', ota_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.device_sync_post(_code text, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device_record public.devices%ROWTYPE;
  med_record public.medication_schedules%ROWTYPE;
  med_payload jsonb;
  med_hour int;
  med_minute int;
  med_enabled boolean;
  mode_value text;
  caregiver_value text;
BEGIN
  SELECT * INTO device_record
  FROM public.devices
  WHERE pairing_code = upper(trim(_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'unknown device', 'status', 404);
  END IF;

  IF jsonb_typeof(_payload->'mode') = 'string' THEN
    mode_value := _payload->>'mode';
    UPDATE public.devices
    SET current_mode = mode_value, last_seen_at = now()
    WHERE id = device_record.id;

    INSERT INTO public.mode_history (user_id, mode)
    VALUES (device_record.user_id, mode_value);
  END IF;

  IF jsonb_typeof(_payload->'caregiver_email') = 'string' THEN
    caregiver_value := lower(trim(_payload->>'caregiver_email'));
    UPDATE public.devices
    SET caregiver_email = caregiver_value, last_seen_at = now()
    WHERE id = device_record.id;
  END IF;

  IF COALESCE((_payload->>'ota_consumed')::boolean, false) THEN
    UPDATE public.devices
    SET ota_consumed_at = now(), last_seen_at = now()
    WHERE id = device_record.id;
  END IF;

  med_payload := _payload->'med';
  IF jsonb_typeof(med_payload) = 'object' THEN
    med_hour := LEAST(23, GREATEST(0, COALESCE((med_payload->>'hour')::int, 20)));
    med_minute := LEAST(59, GREATEST(0, COALESCE((med_payload->>'minute')::int, 0)));
    med_enabled := COALESCE((med_payload->>'enabled')::boolean, true);

    SELECT * INTO med_record
    FROM public.medication_schedules
    WHERE user_id = device_record.user_id
    ORDER BY created_at ASC
    LIMIT 1;

    IF med_record.id IS NULL THEN
      INSERT INTO public.medication_schedules (user_id, label, hour, minute, enabled)
      VALUES (device_record.user_id, 'Medication', med_hour, med_minute, med_enabled);
    ELSE
      UPDATE public.medication_schedules
      SET hour = med_hour, minute = med_minute, enabled = med_enabled
      WHERE id = med_record.id;
    END IF;
  END IF;

  IF COALESCE((_payload->>'sos_resolve')::boolean, false) THEN
    UPDATE public.sos_events
    SET status = 'resolved', resolved_at = now()
    WHERE user_id = device_record.user_id
      AND status <> 'resolved';
  END IF;

  UPDATE public.devices
  SET last_seen_at = now()
  WHERE id = device_record.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.device_sos_post(_code text, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device_record public.devices%ROWTYPE;
  active_record public.sos_events%ROWTYPE;
  event_record public.sos_events%ROWTYPE;
  sos_note text := 'SOS triggered from device';
BEGIN
  SELECT * INTO device_record
  FROM public.devices
  WHERE pairing_code = upper(trim(_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'unknown device', 'status', 404);
  END IF;

  IF jsonb_typeof(_payload->'note') = 'string' THEN
    sos_note := left(_payload->>'note', 500);
  END IF;

  SELECT * INTO active_record
  FROM public.sos_events
  WHERE user_id = device_record.user_id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF active_record.id IS NOT NULL THEN
    UPDATE public.devices SET last_seen_at = now() WHERE id = device_record.id;
    RETURN jsonb_build_object('ok', true, 'id', active_record.id, 'duplicate', true);
  END IF;

  INSERT INTO public.sos_events (user_id, device_id, source, note)
  VALUES (device_record.user_id, device_record.id, 'device', sos_note)
  RETURNING * INTO event_record;

  UPDATE public.devices SET last_seen_at = now() WHERE id = device_record.id;

  RETURN jsonb_build_object('ok', true, 'id', event_record.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.device_sync_get(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.device_sync_post(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.device_sos_post(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_sync_get(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.device_sync_post(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.device_sos_post(text, jsonb) TO anon, authenticated, service_role;
