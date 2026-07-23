
REVOKE EXECUTE ON FUNCTION public.is_caregiver_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_caregiver_of(uuid) TO authenticated;
