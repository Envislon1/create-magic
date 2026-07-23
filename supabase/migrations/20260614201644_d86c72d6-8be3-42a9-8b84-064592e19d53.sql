CREATE OR REPLACE FUNCTION public.device_sync_get(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.devices%ROWTYPE;
  med_first public.medication_schedules%ROWTYPE;
  meds_json jsonb;
  sos_row record;
  ota_payload jsonb := NULL;
  music_payload jsonb := NULL;
  api_base text;
BEGIN
  BEGIN
    api_base := current_setting('app.settings.api_external_url', true);
  EXCEPTION WHEN OTHERS THEN
    api_base := NULL;
  END;
  IF api_base IS NULL OR length(api_base) = 0 THEN
    api_base := 'https://cnfebzqkltxrixdlszyb.supabase.co';
  END IF;
  api_base := rtrim(api_base, '/');

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
      'url', api_base || '/storage/v1/object/public/firmware/' || d.ota_storage_path,
      'version', COALESCE(d.ota_version, ''));
  END IF;

  IF d.current_song_url IS NOT NULL AND d.current_song_at IS NOT NULL THEN
    music_payload := jsonb_build_object(
      'query', d.current_song_url,
      'title', COALESCE(d.current_song_title, ''),
      'artist', COALESCE(d.current_song_artist, ''),
      'at', floor(extract(epoch from d.current_song_at))::bigint);
  ELSIF d.current_song_at IS NOT NULL AND d.current_song_url IS NULL THEN
    music_payload := jsonb_build_object('query','stop',
      'title', '', 'artist', '',
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

GRANT EXECUTE ON FUNCTION public.device_sync_get(text) TO anon, authenticated, service_role;