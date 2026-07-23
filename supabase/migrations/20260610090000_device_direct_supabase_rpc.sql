-- Direct-to-Supabase device bridge. Replaces lovable.app webapp routes.
-- Device calls these via PostgREST RPC with anon key + pairing code.

-- Public-read firmware bucket so device can stream OTA blobs by URL.
UPDATE storage.buckets SET public = true WHERE id = 'firmware';

CREATE OR REPLACE FUNCTION public.device_sync_get(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.devices%ROWTYPE;
  med_first public.medication_schedules%ROWTYPE;
  meds_json jsonb;
  sos_row record;
  ota_payload jsonb := NULL;
  music_payload jsonb := NULL;
BEGIN
  SELECT * INTO d FROM public.devices WHERE pairing_code = upper(trim(_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','unknown device','status',404); END IF;
  UPDATE public.devices SET last_seen_at = now() WHERE id = d.id;

  SELECT * INTO med_first FROM public.medication_schedules
   WHERE user_id = d.user_id AND enabled = true
   ORDER BY hour ASC, minute ASC LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'hour', m.hour, 'minute', m.minute, 'enabled', m.enabled, 'label', m.label
         )), '[]'::jsonb) INTO meds_json
    FROM (SELECT * FROM public.medication_schedules
           WHERE user_id = d.user_id
           ORDER BY hour ASC, minute ASC LIMIT 5) m;

  SELECT id INTO sos_row FROM public.sos_events
   WHERE user_id = d.user_id AND status = 'active' AND resolved_at IS NULL LIMIT 1;

  IF d.ota_storage_path IS NOT NULL
     AND (d.ota_consumed_at IS NULL
          OR (d.ota_uploaded_at IS NOT NULL AND d.ota_uploaded_at > d.ota_consumed_at)) THEN
    ota_payload := jsonb_build_object(
      'url', 'https://lsnnbyytxsttllfropeq.supabase.co/storage/v1/object/public/firmware/' || d.ota_storage_path,
      'version', COALESCE(d.ota_version, ''));
  END IF;

  IF d.current_song_url IS NOT NULL AND d.current_song_at IS NOT NULL THEN
    music_payload := jsonb_build_object(
      'query', d.current_song_url,
      'at', floor(extract(epoch from d.current_song_at))::bigint);
  ELSIF d.current_song_at IS NOT NULL AND d.current_song_url IS NULL THEN
    music_payload := jsonb_build_object('query','stop',
      'at', floor(extract(epoch from d.current_song_at))::bigint);
  END IF;

  RETURN jsonb_build_object(
    'mode', COALESCE(d.current_mode, 'ANXIETY'),
    'med', CASE WHEN med_first.id IS NULL
                THEN jsonb_build_object('hour',20,'minute',0,'enabled',false)
                ELSE jsonb_build_object('hour',med_first.hour,'minute',med_first.minute,'enabled',med_first.enabled) END,
    'meds', meds_json,
    'sos_active', sos_row.id IS NOT NULL,
    'caregiver_email', COALESCE(d.caregiver_email, ''),
    'sound_enabled', COALESCE(d.sound_enabled, true),
    'preferred_voice', CASE WHEN d.preferred_voice = 'male' THEN 'male' ELSE 'female' END,
    'speaker_volume', COALESCE(d.speaker_volume, 70),
    'ota', ota_payload,
    'music', music_payload);
END; $$;

CREATE OR REPLACE FUNCTION public.device_sync_post(_code text, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.devices%ROWTYPE;
  med_existing public.medication_schedules%ROWTYPE;
  mp jsonb;
  v text;
BEGIN
  SELECT * INTO d FROM public.devices WHERE pairing_code = upper(trim(_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','unknown device','status',404); END IF;

  IF jsonb_typeof(_payload->'mode') = 'string' THEN
    UPDATE public.devices SET current_mode = _payload->>'mode' WHERE id = d.id;
    INSERT INTO public.mode_history (user_id, mode) VALUES (d.user_id, _payload->>'mode');
  END IF;
  IF jsonb_typeof(_payload->'caregiver_email') = 'string' THEN
    UPDATE public.devices SET caregiver_email = lower(trim(_payload->>'caregiver_email')) WHERE id = d.id;
  END IF;
  IF jsonb_typeof(_payload->'sound_enabled') = 'boolean' THEN
    UPDATE public.devices SET sound_enabled = (_payload->>'sound_enabled')::boolean WHERE id = d.id;
  END IF;
  IF jsonb_typeof(_payload->'preferred_voice') = 'string' THEN
    v := lower(_payload->>'preferred_voice');
    IF v IN ('male','female') THEN UPDATE public.devices SET preferred_voice = v WHERE id = d.id; END IF;
  END IF;
  IF jsonb_typeof(_payload->'speaker_volume') = 'number' THEN
    UPDATE public.devices SET speaker_volume = GREATEST(0,LEAST(100,(_payload->>'speaker_volume')::int)) WHERE id = d.id;
  END IF;
  IF jsonb_typeof(_payload->'ota_progress') = 'number' THEN
    UPDATE public.devices SET ota_progress = GREATEST(0,LEAST(100,(_payload->>'ota_progress')::int)) WHERE id = d.id;
  END IF;
  IF jsonb_typeof(_payload->'ota_status') = 'string' THEN
    UPDATE public.devices SET ota_status = _payload->>'ota_status' WHERE id = d.id;
  END IF;
  IF COALESCE((_payload->>'ota_consumed')::boolean, false) THEN
    UPDATE public.devices SET ota_consumed_at = now(), ota_status='idle', ota_progress=100 WHERE id = d.id;
  END IF;

  mp := _payload->'med';
  IF jsonb_typeof(mp) = 'object' AND jsonb_typeof(mp->'hour') = 'number' THEN
    SELECT * INTO med_existing FROM public.medication_schedules
     WHERE user_id = d.user_id ORDER BY created_at ASC LIMIT 1;
    IF med_existing.id IS NULL THEN
      INSERT INTO public.medication_schedules (user_id,label,hour,minute,enabled)
      VALUES (d.user_id,'Medication',
              LEAST(23,GREATEST(0,(mp->>'hour')::int)),
              LEAST(59,GREATEST(0,COALESCE((mp->>'minute')::int,0))),
              COALESCE((mp->>'enabled')::boolean,true));
    ELSE
      UPDATE public.medication_schedules
         SET hour=LEAST(23,GREATEST(0,(mp->>'hour')::int)),
             minute=LEAST(59,GREATEST(0,COALESCE((mp->>'minute')::int,0))),
             enabled=COALESCE((mp->>'enabled')::boolean,true)
       WHERE id = med_existing.id;
    END IF;
  END IF;

  IF COALESCE((_payload->>'sos_resolve')::boolean, false) THEN
    UPDATE public.sos_events SET status='resolved', resolved_at=now()
     WHERE user_id = d.user_id AND status='active' AND resolved_at IS NULL;
  END IF;

  UPDATE public.devices SET last_seen_at = now() WHERE id = d.id;
  RETURN jsonb_build_object('ok', true);
END; $$;

REVOKE EXECUTE ON FUNCTION public.device_sync_get(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.device_sync_post(text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.device_sync_get(text)  TO anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.device_sync_post(text, jsonb) TO anon, authenticated, service_role;
