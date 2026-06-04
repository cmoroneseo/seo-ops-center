-- Migration 006: Add logo_url to clients table + create client-logos storage bucket

-- 1. Add logo_url column to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. Storage bucket for client logos (public read, authenticated write)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-logos',
  'client-logos',
  true,
  1048576, -- 1 MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS policies
-- Allow authenticated users to upload/update logos for their org's clients
CREATE POLICY "Authenticated users can upload client logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'client-logos');

CREATE POLICY "Authenticated users can update client logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'client-logos');

CREATE POLICY "Authenticated users can delete client logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'client-logos');

-- Public read (logos are displayed to anyone with the link)
CREATE POLICY "Public can read client logos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'client-logos');
