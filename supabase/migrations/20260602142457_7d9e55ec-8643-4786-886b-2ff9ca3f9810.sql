-- Firmware files stored at: {patient_user_id}/{filename}
-- Patients can manage their own; linked caregivers can too.

CREATE POLICY "firmware owner read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'firmware'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.caregiver_links cl
      WHERE cl.caregiver_id = auth.uid()
        AND cl.patient_id::text = (storage.foldername(name))[1]
    )
  )
);

CREATE POLICY "firmware owner write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'firmware'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.caregiver_links cl
      WHERE cl.caregiver_id = auth.uid()
        AND cl.patient_id::text = (storage.foldername(name))[1]
    )
  )
);

CREATE POLICY "firmware owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'firmware'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.caregiver_links cl
      WHERE cl.caregiver_id = auth.uid()
        AND cl.patient_id::text = (storage.foldername(name))[1]
    )
  )
);

CREATE POLICY "firmware owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'firmware'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR EXISTS (
      SELECT 1 FROM public.caregiver_links cl
      WHERE cl.caregiver_id = auth.uid()
        AND cl.patient_id::text = (storage.foldername(name))[1]
    )
  )
);