-- Add contest start date setting
INSERT INTO public.contest_settings (setting_key, setting_value)
VALUES ('contest_start_date', '2026-01-08 00:00:00+01')
ON CONFLICT (setting_key) DO NOTHING;