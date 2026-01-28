-- Reset the vote boost applied marker so it can run again
UPDATE public.contest_settings 
SET setting_value = 'false', updated_at = now() 
WHERE setting_key = 'vote_boost_applied';